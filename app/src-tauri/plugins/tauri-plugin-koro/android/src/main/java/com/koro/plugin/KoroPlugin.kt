package com.koro.plugin

import android.Manifest
import android.app.Activity
import android.app.AppOpsManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.view.WindowManager
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONObject
import java.util.Calendar

/** Every @Command name here must match a `cmd` in app/src/lib/native.ts. */
@TauriPlugin
class KoroPlugin(private val activity: Activity) : Plugin(activity) {
    private val ctx: Context get() = activity.applicationContext

    override fun load(webView: android.webkit.WebView) {
        super.load(webView)
        Notifier.channels(ctx)
    }

    @Command
    fun battery(invoke: Invoke) {
        val bm = ctx.getSystemService(BatteryManager::class.java)
        invoke.resolve(JSObject().put("pct", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)).put("charging", bm.isCharging))
    }

    @Command
    fun vibrate(invoke: Invoke) {
        val arr = invoke.getArgs().optJSONArray("pattern")
        val p = LongArray((arr?.length() ?: 0) + 1) { i -> if (i == 0) 0L else arr!!.optLong(i - 1) }
        val v: Vibrator = if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(VibratorManager::class.java).defaultVibrator
                          else @Suppress("DEPRECATION") ctx.getSystemService(Vibrator::class.java)
        if (p.size > 1) v.vibrate(VibrationEffect.createWaveform(p, -1))
        invoke.resolve()
    }

    @Command
    fun reminderSchedule(invoke: Invoke) {
        val a = invoke.getArgs()
        val id = a.optString("id"); val at = a.optLong("at")
        if (id.isEmpty() || at <= 0) return invoke.reject("id and at required")
        Alarms.reminder(ctx, id, a.optString("title", "Reminder"), at, a.optString("repeat", ""))
        invoke.resolve()
    }

    @Command
    fun reminderCancel(invoke: Invoke) {
        Alarms.cancelReminder(ctx, invoke.getArgs().optString("id"))
        invoke.resolve()
    }

    @Command
    fun focusStart(invoke: Invoke) {
        val min = invoke.getArgs().optInt("minutes", 25).coerceIn(1, 600)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val dnd = nm.isNotificationPolicyAccessGranted
        if (dnd) nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        Prefs.setFlag(ctx, "focusDnd", dnd); Prefs.setFlag(ctx, "focusOn", true)
        Alarms.timer(ctx, Alarms.FOCUS_END, System.currentTimeMillis() + min * 60_000L)
        invoke.resolve(JSObject().put("dnd", dnd))
    }

    @Command
    fun focusStop(invoke: Invoke) {
        Alarms.cancelTimer(ctx, Alarms.FOCUS_END)
        AlarmReceiver.endFocus(ctx, notify = false)
        invoke.resolve()
    }

    @Command
    fun sleepStart(invoke: Invoke) {
        val min = invoke.getArgs().optInt("minutes", 30).coerceIn(1, 600)
        Prefs.setFlag(ctx, "sleepOn", true)
        Alarms.timer(ctx, Alarms.SLEEP, System.currentTimeMillis() + min * 60_000L)
        invoke.resolve()
    }

    @Command
    fun sleepStop(invoke: Invoke) {
        Alarms.cancelTimer(ctx, Alarms.SLEEP)
        Prefs.setFlag(ctx, "sleepOn", false)
        invoke.resolve()
    }

    private fun usageGranted(): Boolean {
        val ops = ctx.getSystemService(AppOpsManager::class.java)
        val mode = if (Build.VERSION.SDK_INT >= 29) ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
                   else @Suppress("DEPRECATION") ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    @Command
    fun permissions(invoke: Invoke) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val pm = ctx.getSystemService(PowerManager::class.java)
        invoke.resolve(JSObject()
            .put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
            .put("exactAlarm", Alarms.canExact(ctx))
            .put("dnd", nm.isNotificationPolicyAccessGranted)
            .put("usage", usageGranted())
            .put("batteryUnrestricted", pm.isIgnoringBatteryOptimizations(ctx.packageName)))
    }

    @Command
    fun openSettings(invoke: Invoke) {
        val pkg = ctx.packageName
        val i = when (invoke.getArgs().optString("kind")) {
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            "exactAlarm" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$pkg")) else null
            "dnd" -> Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            "usage" -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            "battery" -> @Suppress("BatteryLife") Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg"))
            else -> null
        } ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
        try { activity.startActivity(i) }
        catch (_: Exception) { activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))) }
        invoke.resolve()
    }

    @Command
    fun requestNotifications(invoke: Invoke) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7001)
        }
        invoke.resolve()
    }

    @Command
    fun screenTime(invoke: Invoke) {
        val out = JSObject()
        if (!usageGranted()) return invoke.resolve(out)
        val arr = invoke.getArgs().optJSONArray("packages")
        val want = (0 until (arr?.length() ?: 0)).map { arr!!.optString(it) }.toSet()
        val start = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val usm = ctx.getSystemService(UsageStatsManager::class.java)
        for ((pkg, s) in usm.queryAndAggregateUsageStats(start, System.currentTimeMillis())) {
            if (want.isEmpty() || pkg in want) {
                val m = (s.totalTimeInForeground / 60_000L).toInt()
                if (m > 0) out.put(pkg, m)
            }
        }
        invoke.resolve(out)
    }

    @Command
    fun desk(invoke: Invoke) {
        val on = invoke.getArgs().optBoolean("on")
        activity.runOnUiThread {
            if (on) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            }
        }
        invoke.resolve()
    }

    @Command
    fun pushInit(invoke: Invoke) {
        val a = invoke.getArgs()
        val cfg = JSONObject()
        for (k in listOf("appId", "apiKey", "senderId", "projectId")) cfg.put(k, a.optString(k))
        Push.token(ctx, cfg) { token ->
            Prefs.setFlag(ctx, "tokenChanged", false)
            invoke.resolve(JSObject().put("token", token))
        }
    }
}

package com.koro.plugin

import android.Manifest
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.location.Location
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import org.json.JSONArray
import java.util.concurrent.atomic.AtomicBoolean
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
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import androidx.activity.result.ActivityResult
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
            .put("batteryUnrestricted", pm.isIgnoringBatteryOptimizations(ctx.packageName))
            .put("media", Media.granted(ctx))
            .put("calendar", granted(Manifest.permission.READ_CALENDAR))
            .put("location", granted(Manifest.permission.ACCESS_COARSE_LOCATION) || granted(Manifest.permission.ACCESS_FINE_LOCATION)))
    }

    @Command
    fun openSettings(invoke: Invoke) {
        val pkg = ctx.packageName
        val i = when (invoke.getArgs().optString("kind")) {
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            "exactAlarm" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$pkg")) else null
            "dnd" -> Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
            "usage" -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
            "media" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            "battery" -> @Suppress("BatteryLife") Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$pkg"))
            else -> null
        } ?: Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))
        try { activity.startActivity(i) }
        catch (_: Exception) { activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))) }
        invoke.resolve()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

    /** Ask for a runtime permission: location (weather) or calendar (today's events). */
    @Command
    fun requestPermission(invoke: Invoke) {
        val perms = when (invoke.getArgs().optString("kind")) {
            "location" -> arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION)
            "calendar" -> arrayOf(Manifest.permission.READ_CALENDAR)
            else -> return invoke.reject("unknown permission")
        }
        if (perms.all { granted(it) }) return invoke.resolve(JSObject().put("granted", true))
        ActivityCompat.requestPermissions(activity, perms, 7002)
        invoke.resolve(JSObject().put("granted", false))
    }

    /** Coarse location for weather: last known if recent, else one fresh fix (8 s max). */
    @SuppressLint("MissingPermission")
    @Command
    fun location(invoke: Invoke) {
        if (!granted(Manifest.permission.ACCESS_COARSE_LOCATION) && !granted(Manifest.permission.ACCESS_FINE_LOCATION))
            return invoke.resolve(JSObject().put("granted", false))
        val lm = ctx.getSystemService(LocationManager::class.java)
        val names = buildList {
            if (Build.VERSION.SDK_INT >= 31) add(LocationManager.FUSED_PROVIDER)
            add(LocationManager.NETWORK_PROVIDER); add(LocationManager.GPS_PROVIDER); add(LocationManager.PASSIVE_PROVIDER)
        }.filter { try { lm.isProviderEnabled(it) } catch (_: Exception) { false } }
        val best = names.mapNotNull { try { lm.getLastKnownLocation(it) } catch (_: Exception) { null } }.maxByOrNull { it.time }
        val once = AtomicBoolean(false)
        fun done(l: Location?) {
            if (!once.compareAndSet(false, true)) return
            val o = JSObject().put("granted", true)
            if (l != null) o.put("lat", l.latitude).put("lon", l.longitude).put("acc", l.accuracy.toDouble()).put("at", l.time)
            invoke.resolve(o)
        }
        val live = names.firstOrNull { it != LocationManager.PASSIVE_PROVIDER }
        val fresh = best != null && System.currentTimeMillis() - best.time < 30 * 60_000L
        if (!fresh && live != null && Build.VERSION.SDK_INT >= 30) {
            try {
                lm.getCurrentLocation(live, null, ctx.mainExecutor) { l -> done(l ?: best) }
                Handler(Looper.getMainLooper()).postDelayed({ done(best) }, 8000)
                return
            } catch (_: Exception) { }
        }
        done(best)
    }

    /** Events from the phone's calendars (Google Calendar syncs here) for today (+ `days`). */
    @Command
    fun calendar(invoke: Invoke) {
        if (!granted(Manifest.permission.READ_CALENDAR)) return invoke.resolve(JSObject().put("granted", false).put("events", JSONArray()))
        val days = invoke.getArgs().optInt("days", 1).coerceIn(1, 7)
        val start = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val end = start + days * 86_400_000L
        val uri = CalendarContract.Instances.CONTENT_URI.buildUpon().also { ContentUris.appendId(it, start); ContentUris.appendId(it, end) }.build()
        val proj = arrayOf(CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.TITLE, CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY, CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.DISPLAY_COLOR, CalendarContract.Instances.CALENDAR_DISPLAY_NAME)
        val out = JSONArray()
        try {
            ctx.contentResolver.query(uri, proj, "${CalendarContract.Instances.VISIBLE} = 1", null, "${CalendarContract.Instances.BEGIN} ASC")?.use { cur ->
                while (cur.moveToNext() && out.length() < 50) {
                    out.put(JSONObject()
                        .put("id", "${cur.getLong(0)}:${cur.getLong(2)}")
                        .put("title", cur.getString(1) ?: "(no title)")
                        .put("begin", cur.getLong(2)).put("end", cur.getLong(3))
                        .put("allDay", cur.getInt(4) == 1)
                        .put("location", cur.getString(5) ?: "")
                        .put("color", String.format("#%06X", 0xFFFFFF and cur.getInt(6)))
                        .put("calendar", cur.getString(7) ?: ""))
                }
            }
        } catch (e: Exception) { return invoke.reject("calendar: ${e.message}") }
        invoke.resolve(JSObject().put("granted", true).put("events", out))
    }

    @Command
    fun setAuth(invoke: Invoke) {
        val a = invoke.getArgs()
        Prefs.setAuth(ctx, a.optString("server"), a.optString("token"))
        invoke.resolve()
    }

    /** The app is in the foreground, so it may read the clipboard (to send it to the Mac). */
    @Command
    fun clipboardRead(invoke: Invoke) {
        activity.runOnUiThread {
            val cm = ctx.getSystemService(ClipboardManager::class.java)
            val text = try { cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString() } catch (_: Exception) { null }
            invoke.resolve(JSObject().put("text", text ?: ""))
        }
    }

    @Command
    fun clipboardWrite(invoke: Invoke) {
        val text = invoke.getArgs().optString("text")
        activity.runOnUiThread {
            ctx.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Koro", text))
            invoke.resolve()
        }
    }

    /** Lists for the home-screen widgets. */
    @Command
    fun widgetData(invoke: Invoke) {
        val d = invoke.getArgs().optJSONObject("data") ?: JSONObject()
        Prefs.setWidgetData(ctx, d)
        Widgets.updateAll(ctx)
        invoke.resolve()
    }

    /** Ticks from widgets / "+1 glass" from notifications since the app was last open. */
    @Command
    fun takeOps(invoke: Invoke) = invoke.resolve(JSObject().put("ops", Prefs.takeOps(ctx)))

    /** Today's most-used apps (Usage access). */
    @Command
    fun screenTimeTop(invoke: Invoke) {
        if (!usageGranted()) return invoke.resolve(JSObject().put("granted", false).put("apps", JSONArray()))
        val limit = invoke.getArgs().optInt("limit", 6).coerceIn(1, 20)
        val start = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis
        val usm = ctx.getSystemService(UsageStatsManager::class.java)
        val pm = ctx.packageManager
        val home = pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)?.activityInfo?.packageName
        val skip = setOf(ctx.packageName, home, "com.android.systemui", "com.sec.android.app.launcher", "com.samsung.android.honeyboard")
        val apps = usm.queryAndAggregateUsageStats(start, System.currentTimeMillis())
            .filter { (pkg, s) -> pkg !in skip && s.totalTimeInForeground >= 60_000L }
            .entries.sortedByDescending { it.value.totalTimeInForeground }
        val out = JSONArray()
        var total = 0L
        for ((pkg, s) in apps) {
            total += s.totalTimeInForeground
            if (out.length() >= limit) continue
            val label = try { pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString() } catch (_: Exception) { pkg }
            out.put(JSONObject().put("pkg", pkg).put("label", label).put("min", (s.totalTimeInForeground / 60_000L).toInt()))
        }
        invoke.resolve(JSObject().put("granted", true).put("apps", out).put("totalMin", (total / 60_000L).toInt()))
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
    fun media(invoke: Invoke) {
        val key = invoke.getArgs().optString("artKey", "")
        invoke.resolve(Media.snapshot(ctx, key.ifEmpty { null }))
    }

    @Command
    fun mediaControl(invoke: Invoke) {
        val a = invoke.getArgs()
        invoke.resolve(JSObject().put("ok", Media.control(ctx, a.optString("action"), a.optLong("pos"))))
    }

    /** {limits: {pkg: {min, label}}} — daily per-app limits, enforced in the background. */
    @Command
    fun setLimits(invoke: Invoke) {
        Limits.set(ctx, invoke.getArgs().optJSONObject("limits") ?: JSONObject())
        invoke.resolve()
    }

    /** Save a file to Downloads/Koro: {name, mime, text} or {name, md, pdf: true}. Returns {uri}. */
    @Command
    fun saveFile(invoke: Invoke) {
        val a = invoke.getArgs()
        Thread {
            try {
                val uri = if (a.optBoolean("pdf")) Files.savePdf(ctx, a.optString("name", "Koro.pdf"), a.optString("md"))
                          else Files.saveText(ctx, a.optString("name", "Koro.md"), a.optString("mime", "text/markdown"), a.optString("text"))
                invoke.resolve(JSObject().put("uri", uri))
            } catch (e: Exception) { invoke.resolve(JSObject().put("error", e.message ?: "Couldn't save")) }
        }.start()
    }

    @Command
    fun shareText(invoke: Invoke) {
        val a = invoke.getArgs()
        try { Files.share(activity, a.optString("text"), a.optString("title", "Koro")) } catch (_: Exception) { }
        invoke.resolve()
    }

    @Command
    fun openUri(invoke: Invoke) {
        val a = invoke.getArgs()
        try { Files.open(activity, a.optString("uri"), a.optString("mime", "*/*")) } catch (_: Exception) { }
        invoke.resolve()
    }

    @Command
    fun mediaQueue(invoke: Invoke) { invoke.resolve(Media.queue(ctx)) }

    @Command
    fun mediaAction(invoke: Invoke) {
        val a = invoke.getArgs()
        val ok = when (a.optString("type")) {
            "queue" -> Media.skipTo(ctx, a.optLong("id"))
            "custom" -> Media.custom(ctx, a.optString("action"))
            "search" -> Media.playSearch(ctx, a.optString("query"), a.optString("pkg", "com.google.android.apps.youtube.music"))
            else -> false
        }
        invoke.resolve(JSObject().put("ok", ok))
    }

    /** Speech to text with the phone's recogniser (Google, en-IN). */
    @Command
    fun listen(invoke: Invoke) {
        val i = Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, "en-IN")
            putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Say what to add")
        }
        try { startActivityForResult(invoke, i, "onSpeech") }
        catch (_: Exception) { invoke.resolve(JSObject().put("text", "").put("error", "No speech recogniser on this phone")) }
    }

    @ActivityCallback
    fun onSpeech(invoke: Invoke, result: ActivityResult) {
        val text = result.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull() ?: ""
        invoke.resolve(JSObject().put("text", text))
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

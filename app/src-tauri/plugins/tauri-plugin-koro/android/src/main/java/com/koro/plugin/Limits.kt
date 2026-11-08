package com.koro.plugin

import android.app.usage.UsageStatsManager
import android.content.Context
import org.json.JSONObject
import java.util.Calendar

/** Daily per-app time limits: checked every 15 min in the background; one nudge per app per day when over. */
object Limits {
    const val ALARM_ID = "limits:check"
    private const val EVERY = 15 * 60_000L

    fun get(c: Context): JSONObject = try { JSONObject(c.getSharedPreferences("koro", Context.MODE_PRIVATE).getString("limits", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }

    fun set(c: Context, limits: JSONObject) {
        c.getSharedPreferences("koro", Context.MODE_PRIVATE).edit().putString("limits", limits.toString()).apply()
        if (limits.length() > 0) schedule(c) else Alarms.cancelReminder(c, ALARM_ID)
    }

    fun schedule(c: Context) = Alarms.reminder(c, ALARM_ID, "limits", System.currentTimeMillis() + EVERY, "")

    private fun startOfDay() = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0) }.timeInMillis

    fun check(c: Context) {
        val limits = get(c)
        if (limits.length() == 0) return
        try {
            val usm = c.getSystemService(UsageStatsManager::class.java)
            val used = usm.queryAndAggregateUsageStats(startOfDay(), System.currentTimeMillis())
            val day = Calendar.getInstance().get(Calendar.DAY_OF_YEAR)
            for (pkg in limits.keys()) {
                val o = limits.optJSONObject(pkg) ?: continue
                val max = o.optInt("min", 0); if (max <= 0) continue
                val min = ((used[pkg]?.totalTimeInForeground ?: 0L) / 60_000L).toInt()
                val key = "lim:$pkg"
                if (min >= max && Prefs.int(c, key) != day) {
                    Prefs.setInt(c, key, day)
                    val label = o.optString("label", pkg)
                    Notifier.show(c, key.hashCode(), Notifier.CH_GENERAL, "⏳ $label limit reached", "You've used $label for $min min today (limit $max min). Time for a break?")
                }
            }
        } catch (_: Exception) { /* usage access revoked */ }
        schedule(c)
    }
}

package com.koro.plugin

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

object Alarms {
    const val REMINDER = "com.koro.REMINDER"
    const val FOCUS_END = "com.koro.FOCUS_END"
    const val SLEEP = "com.koro.SLEEP"

    private fun pi(c: Context, action: String, id: String, extras: (Intent) -> Unit = {}): PendingIntent {
        val i = Intent(c, AlarmReceiver::class.java).setAction(action).putExtra("id", id)
        extras(i)
        return PendingIntent.getBroadcast(c, (action + id).hashCode(), i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun canExact(c: Context): Boolean {
        val am = c.getSystemService(AlarmManager::class.java)
        return Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
    }

    private fun set(c: Context, at: Long, p: PendingIntent) {
        val am = c.getSystemService(AlarmManager::class.java)
        if (canExact(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, p)
    }

    fun reminder(c: Context, id: String, title: String, at: Long, repeat: String) {
        Prefs.putReminder(c, id, title, at, repeat)
        set(c, at, pi(c, REMINDER, id) { it.putExtra("title", title).putExtra("repeat", repeat).putExtra("at", at) })
    }

    fun cancelReminder(c: Context, id: String) {
        Prefs.dropReminder(c, id)
        c.getSystemService(AlarmManager::class.java).cancel(pi(c, REMINDER, id))
        Notifier.cancel(c, id.hashCode())
    }

    fun timer(c: Context, action: String, at: Long) = set(c, at, pi(c, action, "timer"))
    fun cancelTimer(c: Context, action: String) = c.getSystemService(AlarmManager::class.java).cancel(pi(c, action, "timer"))

    /** After reboot / app update: re-arm everything; roll daily reminders forward, fire missed one-offs now. */
    fun restoreAll(c: Context) {
        val all = Prefs.reminders(c)
        val now = System.currentTimeMillis()
        for (id in all.keys().asSequence().toList()) {
            val r = all.getJSONObject(id)
            var at = r.getLong("at")
            val repeat = r.optString("repeat")
            if (repeat == "daily" || repeat.startsWith("days:")) while (at < now) at += 86_400_000L
            else if (at < now - 6 * 3_600_000L) { Prefs.dropReminder(c, id); continue }
            else if (at < now) at = now + 5_000L
            reminder(c, id, r.getString("title"), at, repeat)
        }
    }
}

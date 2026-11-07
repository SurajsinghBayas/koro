package com.koro.plugin

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notifier {
    const val CH_REMINDERS = "reminders"
    const val CH_LIVE = "match_live"     // silent; one notification per match, updated in place
    const val CH_ALERT = "match_alert"   // buzzes: milestones (10/20/30… overs, sessions) and results
    const val CH_GENERAL = "general"

    fun channels(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_REMINDERS, "Reminders", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(CH_LIVE, "Live score (silent)", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
            NotificationChannel(CH_ALERT, "Match updates", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CH_GENERAL, "General", NotificationManager.IMPORTANCE_DEFAULT),
        ))
    }

    private fun openApp(c: Context, req: Int): PendingIntent? {
        val i = c.packageManager.getLaunchIntentForPackage(c.packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        } ?: return null
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    fun show(c: Context, id: Int, channel: String, title: String, body: String, ongoing: Boolean = false, silent: Boolean = false) {
        channels(c)
        val n = NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_koro)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openApp(c, id))
            .setAutoCancel(!ongoing)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(silent)
            .setSilent(silent)
            .setColor(0xFF3AA7E8.toInt())
            .build()
        try { NotificationManagerCompat.from(c).notify(id, n) } catch (_: SecurityException) { /* notifications not granted */ }
    }

    fun cancel(c: Context, id: Int) = NotificationManagerCompat.from(c).cancel(id)

    /** Cricket push: same tag → same notification id, so a match never stacks more than one card. */
    fun match(c: Context, tag: String, title: String, body: String, buzz: Boolean, final: Boolean) {
        val id = tag.hashCode()
        if (buzz) cancel(c, id) // re-post so the alert channel actually sounds
        show(c, id, if (buzz) CH_ALERT else CH_LIVE, title, body, ongoing = !final && !buzz, silent = !buzz)
    }
}

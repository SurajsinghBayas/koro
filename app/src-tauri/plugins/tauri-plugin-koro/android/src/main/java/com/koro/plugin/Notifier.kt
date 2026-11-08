package com.koro.plugin

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Notifier {
    const val CH_REMINDERS = "reminders"
    const val CH_LIVE = "match_live"     // silent; one notification per match, updated in place
    const val CH_ALERT = "match_alert"   // buzzes: milestones (10/20/30… overs, sessions) and results
    const val CH_GENERAL = "general"
    const val CH_X_BREAKING = "x_breaking" // breaking cricket posts from X
    const val CH_X_DIGEST = "x_digest"     // quiet 3-hourly X summary
    const val CH_CLIP = "clipboard"        // quiet: "copied from your Mac"
    const val CH_WATER = "water"           // water reminders with a "+1 glass" button
    const val CH_BRIEF = "brief"           // 8 AM / 10 PM brief

    fun channels(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(listOf(
            NotificationChannel(CH_REMINDERS, "Reminders", NotificationManager.IMPORTANCE_HIGH),
            NotificationChannel(CH_LIVE, "Live score (silent)", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
            NotificationChannel(CH_ALERT, "Match updates", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CH_GENERAL, "General", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CH_X_BREAKING, "X: breaking cricket", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CH_X_DIGEST, "X: summaries", NotificationManager.IMPORTANCE_LOW),
            NotificationChannel(CH_CLIP, "Clipboard from Mac", NotificationManager.IMPORTANCE_LOW),
            NotificationChannel(CH_WATER, "Water reminders", NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(CH_BRIEF, "Morning & night brief", NotificationManager.IMPORTANCE_DEFAULT),
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

    /** X post / summary: optional photo (BigPicture) and a link opened on tap (falls back to the app). */
    fun x(c: Context, id: Int, channel: String, title: String, body: String, image: Bitmap?, url: String?) {
        channels(c)
        val tap = url?.takeIf { it.startsWith("https://") }?.let {
            PendingIntent.getActivity(c, id, Intent(Intent.ACTION_VIEW, Uri.parse(it)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        } ?: openApp(c, id)
        val b = NotificationCompat.Builder(c, channel)
            .setSmallIcon(R.drawable.ic_stat_koro)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setColor(0xFF3AA7E8.toInt())
        if (image != null) {
            b.setLargeIcon(image)
            b.setStyle(NotificationCompat.BigPictureStyle().bigPicture(image).bigLargeIcon(null as Bitmap?).setSummaryText(body))
        } else {
            b.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }
        try { NotificationManagerCompat.from(c).notify(id, b.build()) } catch (_: SecurityException) { }
    }

    private fun linkIntent(c: Context, id: Int, url: String?): PendingIntent? = url?.takeIf { it.startsWith("http") }?.let {
        PendingIntent.getActivity(c, id, Intent(Intent.ACTION_VIEW, Uri.parse(it)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /** Mac clipboard arrived (already copied on the phone). Links open on tap. */
    fun clip(c: Context, title: String, body: String, url: String?) {
        channels(c)
        val n = NotificationCompat.Builder(c, CH_CLIP)
            .setSmallIcon(R.drawable.ic_stat_koro)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(linkIntent(c, 4301, url) ?: openApp(c, 4301))
            .setAutoCancel(true)
            .setTimeoutAfter(10 * 60_000L)
            .setColor(0xFF3AA7E8.toInt())
            .build()
        try { NotificationManagerCompat.from(c).notify(4301, n) } catch (_: SecurityException) { }
    }

    const val WATER_ID = 4401
    /** Water reminder with a "+1 glass" action (logged by the app next time it opens). */
    fun water(c: Context, title: String) {
        channels(c)
        val add = PendingIntent.getBroadcast(c, WATER_ID, Intent(c, WidgetActionReceiver::class.java).setAction(WidgetActionReceiver.WATER),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(c, CH_WATER)
            .setSmallIcon(R.drawable.ic_stat_koro)
            .setContentTitle(title)
            .setContentText("Tap +1 glass when you've had it")
            .setContentIntent(openApp(c, WATER_ID))
            .addAction(0, "+1 glass", add)
            .setAutoCancel(true)
            .setColor(0xFF3AA7E8.toInt())
            .build()
        try { NotificationManagerCompat.from(c).notify(WATER_ID, n) } catch (_: SecurityException) { }
    }

    fun cancel(c: Context, id: Int) = NotificationManagerCompat.from(c).cancel(id)

    /** Cricket push: same tag → same notification id, so a match never stacks more than one card. */
    fun match(c: Context, tag: String, title: String, body: String, buzz: Boolean, final: Boolean) {
        val id = tag.hashCode()
        if (buzz) cancel(c, id) // re-post so the alert channel actually sounds
        show(c, id, if (buzz) CH_ALERT else CH_LIVE, title, body, ongoing = !final && !buzz, silent = !buzz)
    }
}

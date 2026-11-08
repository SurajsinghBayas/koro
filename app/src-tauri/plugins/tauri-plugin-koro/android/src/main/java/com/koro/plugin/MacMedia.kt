package com.koro.plugin

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject
import java.io.File

/**
 * What's playing on the paired Mac. The server sends a silent data push (kind "macmedia") whenever the Mac's track
 * or play state changes; we keep it here, redraw the holo player widget and show a holo "Playing on your Mac"
 * notification with prev / play-pause / next, so the Mac can be controlled from any app or the lock screen.
 */
object MacMedia {
    const val NOTIF_ID = 7300
    const val CH_MAC = "mac_media"
    private fun sp(c: Context) = c.getSharedPreferences("koro_mac", Context.MODE_PRIVATE)

    data class State(val title: String, val artist: String, val app: String, val playing: Boolean, val at: Long)

    fun state(c: Context): State? {
        val s = sp(c)
        val t = s.getString("title", "") ?: ""
        val at = s.getLong("at", 0)
        // stale after 3 h without news (e.g. the Mac went to sleep mid-video)
        if (t.isEmpty() || System.currentTimeMillis() - at > 3 * 3_600_000L) return null
        return State(t, s.getString("artist", "") ?: "", s.getString("app", "") ?: "", s.getBoolean("playing", false), at)
    }
    private fun artFile(c: Context) = File(c.filesDir, "mac_art.png")
    fun art(c: Context): Bitmap? = artFile(c).takeIf { it.exists() && state(c) != null }?.let { BitmapFactory.decodeFile(it.path) }

    /** Which player the widget shows: "phone" or "mac". */
    fun source(c: Context) = sp(c).getString("src", "phone") ?: "phone"
    fun setSource(c: Context, s: String) = sp(c).edit().putString("src", s).apply()

    /** Called on FCM's worker thread. */
    fun onPush(c: Context, d: Map<String, String>) {
        val title = d["title"] ?: ""
        val playing = d["playing"] == "1"
        val prevArt = sp(c).getString("artUrl", "")
        val artUrl = d["art"] ?: ""
        sp(c).edit().putString("title", title).putString("artist", d["body"] ?: "").putString("app", d["app"] ?: "")
            .putBoolean("playing", playing).putLong("at", System.currentTimeMillis()).putString("artUrl", artUrl).apply()
        if (artUrl != prevArt) {
            artFile(c).delete()
            if (artUrl.startsWith("https://")) fetchArt(artUrl)?.let { b -> artFile(c).outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        }
        // follow the music: the Mac playing wins (even if the phone plays too)
        if (title.isNotEmpty() && playing) setSource(c, "mac")
        if (title.isEmpty() && source(c) == "mac") setSource(c, "phone")
        Widgets.updateMusic(c)
        notifyMac(c)
    }

    /** Remote-control the Mac (from widget / notification). Optimistic: flips play state immediately. */
    fun send(c: Context, cmd: String) {
        if (cmd == "toggle") state(c)?.let { sp(c).edit().putBoolean("playing", !it.playing).apply() }
        Widgets.updateMusic(c); notifyMac(c)
        Net.post(c, "/v1/mac/send", JSONObject().put("type", "cmd").put("cmd", cmd))
    }

    private fun fetchArt(url: String): Bitmap? = try {
        val conn = java.net.URL(url).openConnection().apply { connectTimeout = 5000; readTimeout = 5000 }
        val bytes = conn.getInputStream().use { it.readBytes() }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { b ->
            // square centre crop (YouTube thumbnails are 4:3 with bars)
            val side = minOf(b.width, (b.height * 0.75).toInt())
            val sq = Bitmap.createBitmap(b, (b.width - side) / 2, (b.height - side) / 2, side, side)
            Bitmap.createScaledBitmap(sq, 240, 240, true)
        }
    } catch (_: Exception) { null }

    fun action(c: Context, req: Int, cmd: String): PendingIntent =
        PendingIntent.getBroadcast(c, req, Intent(c, WidgetActionReceiver::class.java).setAction(WidgetActionReceiver.MAC).putExtra("cmd", cmd),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun notifyMac(c: Context) {
        val st = state(c)
        if (st == null) { Notifier.cancel(c, NOTIF_ID); return }
        Notifier.channels(c)
        val rv = RemoteViews(c.packageName, R.layout.koro_notif_mac)
        rv.setTextViewText(R.id.n_app, (if (st.playing) "▶ ON YOUR MAC" else "❚❚ PAUSED ON YOUR MAC") + if (st.app.isNotEmpty()) " · ${st.app.uppercase()}" else "")
        rv.setTextViewText(R.id.n_title, st.title)
        rv.setTextViewText(R.id.n_artist, st.artist)
        rv.setViewVisibility(R.id.n_artist, if (st.artist.isEmpty()) View.GONE else View.VISIBLE)
        art(c)?.let { rv.setImageViewBitmap(R.id.n_art, Widgets.rounded(it, 156, 22f)) } ?: rv.setImageViewResource(R.id.n_art, R.drawable.koro_w_art_mac)
        rv.setImageViewResource(R.id.n_play, if (st.playing) R.drawable.koro_w_pause else R.drawable.koro_w_play)
        rv.setOnClickPendingIntent(R.id.n_prev, action(c, 9301, "prev"))
        rv.setOnClickPendingIntent(R.id.n_play, action(c, 9302, "toggle"))
        rv.setOnClickPendingIntent(R.id.n_next, action(c, 9303, "next"))
        val n = NotificationCompat.Builder(c, CH_MAC)
            .setSmallIcon(R.drawable.ic_stat_koro)
            .setStyle(NotificationCompat.DecoratedCustomViewStyle())
            .setCustomContentView(rv)
            .setCustomBigContentView(rv)
            .setContentTitle(st.title)
            .setContentText(st.artist)
            .setContentIntent(Widgets.openApp(c, 9300))
            .setOngoing(st.playing)          // stays while the Mac plays; swipe away once paused
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setTimeoutAfter(3 * 3_600_000L)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC) // controls on the lock screen
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setColor(0xFFE8C46A.toInt())
            .build()
        try { NotificationManagerCompat.from(c).notify(NOTIF_ID, n) } catch (_: SecurityException) { }
    }
}

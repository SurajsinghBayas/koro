package com.koro.plugin

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Data-only FCM from the Koro server. Keys: kind, title, body, tag, buzz, matchId, event, final. */
class KoroMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(m: RemoteMessage) {
        val d = m.data
        val title = d["title"] ?: m.notification?.title ?: "Koro"
        val body = d["body"] ?: m.notification?.body ?: ""
        val tag = d["tag"]
        if (d["kind"] == "clip") {
            val text = d["text"] ?: body
            val url = d["url"]?.takeIf { it.isNotEmpty() }
            android.os.Handler(android.os.Looper.getMainLooper()).post {
                try {
                    val cm = getSystemService(android.content.ClipboardManager::class.java)
                    cm.setPrimaryClip(android.content.ClipData.newPlainText("From Mac", text))
                } catch (_: Exception) { }
            }
            Notifier.clip(this, title, body, url)
        } else if (d["kind"] == "x") {
            val ch = if (d["channel"] == Notifier.CH_X_DIGEST) Notifier.CH_X_DIGEST else Notifier.CH_X_BREAKING
            Notifier.x(this, (tag ?: title).hashCode(), ch, title, body, d["image"]?.let { fetchImage(it) }, d["url"])
        } else if (d["kind"] == "cmd") {
            Remote.handle(this, d["cmd"] ?: "", d["url"])
        } else if (d["kind"] == "macmedia") {
            MacMedia.onPush(this, d)
        } else if (d["kind"] == "brief") {
            Notifier.show(this, (tag ?: "brief").hashCode(), Notifier.CH_BRIEF, title, body)
        } else if (d["kind"] == "match" && tag != null) {
            Notifier.match(this, tag, title, body, buzz = d["buzz"] == "1", final = d["final"] == "1")
        } else {
            Notifier.show(this, (tag ?: title).hashCode(), Notifier.CH_GENERAL, title, body)
        }
    }

    /** Small, bounded image download (runs on FCM's worker thread). */
    private fun fetchImage(url: String): Bitmap? = try {
        if (!url.startsWith("https://")) null else {
            val conn = java.net.URL(url).openConnection().apply { connectTimeout = 5000; readTimeout = 5000 }
            val bytes = conn.getInputStream().use { it.readBytes() }
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
            var s = 1
            while (o.outWidth / (s * 2) >= 720) s *= 2
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = s })
        }
    } catch (_: Exception) { null }

    override fun onNewToken(token: String) {
        // The app re-registers the token with the server on next launch (pushInit is idempotent).
        Prefs.setFlag(this, "tokenChanged", true)
    }
}

package com.koro.plugin

import android.app.PendingIntent
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/** Images on the clipboard between Mac and phone (text works the same way through Notifier.clip). */
object ClipImage {
    private const val NOTIF_ID = 4302
    private fun dir(c: Context) = File(c.cacheDir, "clip").apply { mkdirs() }

    /** Mac copied an image (FCM "clipimg", worker thread): download, put on the clipboard, show a preview. */
    fun receive(c: Context, id: String, mime: String) {
        if (!Regex("^[0-9a-f-]{36}$").matches(id)) return
        val bytes = Net.getBytes(c, "/v1/clip/image/$id") ?: return
        dir(c).listFiles()?.forEach { it.delete() } // keep only the latest
        val ext = when (mime) { "image/png" -> "png"; "image/gif" -> "gif"; "image/webp" -> "webp"; else -> "jpg" }
        val f = File(dir(c), "from-mac-${System.currentTimeMillis()}.$ext").apply { writeBytes(bytes) }
        val uri = FileProvider.getUriForFile(c, c.packageName + ".koroclip", f)
        Handler(Looper.getMainLooper()).post {
            try {
                val cm = c.getSystemService(ClipboardManager::class.java)
                cm.setPrimaryClip(ClipData.newUri(c.contentResolver, "Image from Mac", uri))
            } catch (_: Exception) { }
        }
        notify(c, uri, mime, BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample(bytes) }))
    }

    private fun sample(bytes: ByteArray): Int {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        var s = 1
        while (maxOf(o.outWidth, o.outHeight) / (s * 2) >= 900) s *= 2
        return s
    }

    private fun notify(c: Context, uri: Uri, mime: String, preview: Bitmap?) {
        Notifier.channels(c)
        val share = Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share image").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        val b = NotificationCompat.Builder(c, Notifier.CH_CLIP)
            .setSmallIcon(R.drawable.ic_stat_koro)
            .setContentTitle("Image copied from your Mac")
            .setContentText("Long-press any message box and Paste")
            .setContentIntent(PendingIntent.getActivity(c, 4303, view, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .addAction(0, "Share", PendingIntent.getActivity(c, 4304, share, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .setAutoCancel(true)
            .setTimeoutAfter(10 * 60_000L)
            .setColor(0xFF3AA7E8.toInt())
        if (preview != null) b.setLargeIcon(preview).setStyle(NotificationCompat.BigPictureStyle().bigPicture(preview).bigLargeIcon(null as Bitmap?))
        try { NotificationManagerCompat.from(c).notify(NOTIF_ID, b.build()) } catch (_: SecurityException) { }
    }

    /** Share sheet → "Copy to Mac": ≤ 2000 px, PNG if small else JPEG 85 %. Returns the HTTP status (0 = unreachable). */
    fun sendToMac(c: Context, uri: Uri): Int {
        val raw = c.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return 400
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, o)
        val inMime = o.outMimeType ?: "image/jpeg"
        val small = maxOf(o.outWidth, o.outHeight) <= 2000 && raw.size <= 1_500_000 && inMime in setOf("image/png", "image/jpeg")
        val (data, mime) = if (small) raw to inMime else {
            var s = 1
            while (maxOf(o.outWidth, o.outHeight) / (s * 2) >= 2000) s *= 2
            val bm = BitmapFactory.decodeByteArray(raw, 0, raw.size, BitmapFactory.Options().apply { inSampleSize = s }) ?: return 400
            val k = minOf(1.0, 2000.0 / maxOf(bm.width, bm.height))
            val sc = if (k < 1) Bitmap.createScaledBitmap(bm, (bm.width * k).toInt(), (bm.height * k).toInt(), true) else bm
            val out = ByteArrayOutputStream()
            sc.compress(Bitmap.CompressFormat.JPEG, 85, out)
            out.toByteArray() to "image/jpeg"
        }
        return Net.post(c, "/v1/clip/image", JSONObject().put("mime", mime).put("data", Base64.encodeToString(data, Base64.NO_WRAP))).first
    }
}

/** Own subclass so it never clashes with another FileProvider in the merged manifest. */
class KoroClipProvider : FileProvider()

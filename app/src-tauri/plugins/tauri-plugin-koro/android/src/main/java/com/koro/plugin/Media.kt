package com.koro.plugin

import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.SystemClock
import android.util.Base64
import androidx.core.app.NotificationManagerCompat
import app.tauri.plugin.JSObject
import java.io.ByteArrayOutputStream
import org.json.JSONArray
import org.json.JSONObject

/** Now playing from any app, via MediaSessionManager (needs Notification access for KoroMediaListener). */
object Media {
    fun granted(c: Context) = NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.packageName)

    private fun controllers(c: Context): List<MediaController> = try {
        c.getSystemService(MediaSessionManager::class.java).getActiveSessions(ComponentName(c, KoroMediaListener::class.java))
    } catch (_: SecurityException) { emptyList() }

    private fun isPlaying(mc: MediaController) = mc.playbackState?.state.let { it == PlaybackState.STATE_PLAYING || it == PlaybackState.STATE_BUFFERING }

    fun current(c: Context): MediaController? {
        val list = controllers(c).filter { it.metadata != null }
        return list.firstOrNull { isPlaying(it) } ?: list.firstOrNull()
    }

    fun artBitmap(md: MediaMetadata): Bitmap? = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
        ?: md.getBitmap(MediaMetadata.METADATA_KEY_ART)
        ?: md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)

    fun playing(mc: MediaController) = isPlaying(mc)

    private fun art(md: MediaMetadata): String? {
        val bmp = artBitmap(md) ?: return null
        val max = 480f
        val scale = minOf(1f, max / maxOf(bmp.width, bmp.height))
        val out = if (scale < 1f) Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true) else bmp
        val bytes = ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.JPEG, 82, it) }.toByteArray()
        return "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }

    /** artKey: the key the app already has art for; art is only sent when the track changes. */
    fun snapshot(c: Context, artKey: String?): JSObject {
        if (!granted(c)) return JSObject().put("access", false)
        val mc = current(c) ?: return JSObject().put("access", true).put("active", false)
        val md = mc.metadata!!
        val st = mc.playbackState
        val title = md.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: ""
        val artist = md.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST)
            ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: ""
        val album = md.getString(MediaMetadata.METADATA_KEY_ALBUM) ?: ""
        val playing = isPlaying(mc)
        var pos = st?.position ?: 0L
        if (playing && st != null && st.lastPositionUpdateTime > 0) pos += ((SystemClock.elapsedRealtime() - st.lastPositionUpdateTime) * st.playbackSpeed).toLong()
        val pkg = mc.packageName
        val label = try { c.packageManager.getApplicationLabel(c.packageManager.getApplicationInfo(pkg, 0)).toString() } catch (_: Exception) { pkg }
        val key = "$pkg|$title|$artist|$album"
        val actions = st?.actions ?: 0L
        val o = JSObject()
            .put("access", true).put("active", true)
            .put("title", title).put("artist", artist).put("album", album)
            .put("app", label).put("package", pkg)
            .put("playing", playing)
            .put("position", maxOf(0L, pos)).put("duration", md.getLong(MediaMetadata.METADATA_KEY_DURATION))
            .put("canNext", actions and PlaybackState.ACTION_SKIP_TO_NEXT != 0L)
            .put("canPrev", actions and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L)
            .put("canSeek", actions and PlaybackState.ACTION_SEEK_TO != 0L)
            .put("key", key)
        if (key != artKey) art(md)?.let { o.put("art", it) }
        return o
    }

    /** Up-next queue + the app's own buttons (YT Music: like/dislike, shuffle, repeat…). */
    fun queue(c: Context): JSObject {
        val mc = current(c) ?: return JSObject().put("items", JSONArray()).put("customs", JSONArray())
        val activeId = mc.playbackState?.activeQueueItemId ?: -1L
        val items = JSONArray()
        val q = mc.queue ?: emptyList()
        val start = maxOf(0, q.indexOfFirst { it.queueId == activeId })
        for (it in q.drop(start).take(40)) {
            val d = it.description
            items.put(JSONObject().put("id", it.queueId).put("title", d.title?.toString() ?: "").put("subtitle", d.subtitle?.toString() ?: "")
                .put("active", it.queueId == activeId))
        }
        val customs = JSONArray()
        for (a in mc.playbackState?.customActions ?: emptyList()) customs.put(JSONObject().put("action", a.action).put("name", a.name?.toString() ?: a.action))
        return JSObject().put("items", items).put("customs", customs).put("package", mc.packageName)
    }

    fun skipTo(c: Context, id: Long): Boolean { (current(c) ?: return false).transportControls.skipToQueueItem(id); return true }

    fun custom(c: Context, action: String): Boolean { (current(c) ?: return false).transportControls.sendCustomAction(action, null); return true }

    /** Play a song/artist/playlist by name in YT Music (or another app). Falls back to opening its search. */
    fun playSearch(c: Context, query: String, pkg: String): Boolean {
        val mc = controllers(c).firstOrNull { it.packageName == pkg }
        if (mc != null && (mc.playbackState?.actions ?: 0L) and PlaybackState.ACTION_PLAY_FROM_SEARCH != 0L) {
            mc.transportControls.playFromSearch(query, android.os.Bundle()); return true
        }
        // Voice-search intent: YT Music / YouTube handle it and start playing the best match.
        val i = android.content.Intent(android.provider.MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH).apply {
            setPackage(pkg); putExtra(android.app.SearchManager.QUERY, query); addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try { c.startActivity(i); true } catch (_: Exception) {
            val web = if (pkg.contains("music")) "https://music.youtube.com/search?q=" else "https://www.youtube.com/results?search_query="
            try { c.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(web + android.net.Uri.encode(query))).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)); true } catch (_: Exception) { false }
        }
    }

    fun control(c: Context, action: String, pos: Long): Boolean {
        val t = (current(c) ?: return false).transportControls
        when (action) {
            "play" -> t.play()
            "pause" -> t.pause()
            "toggle" -> if (current(c)?.let { isPlaying(it) } == true) t.pause() else t.play()
            "next" -> t.skipToNext()
            "prev" -> t.skipToPrevious()
            "seek" -> t.seekTo(pos)
            else -> return false
        }
        return true
    }
}

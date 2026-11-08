package com.koro.plugin

import android.content.ComponentName
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService

/**
 * Lets Koro read media sessions (what Spotify / YT Music / etc. are playing) and keeps the music widget fresh.
 * We never read or store other apps' notifications.
 */
class KoroMediaListener : NotificationListenerService() {
    private val main = Handler(Looper.getMainLooper())
    private var msm: MediaSessionManager? = null
    private val tracked = mutableMapOf<MediaController, MediaController.Callback>()
    private val refresh = Runnable { Widgets.updateMusic(this); report() }
    private var lastReport = ""

    /** Tell the server what's playing (the Mac menu bar shows it). Only when the track or play state changes. */
    private fun report() {
        val mc = Media.current(this)
        val md = mc?.metadata
        val title = md?.getString(MediaMetadata.METADATA_KEY_TITLE) ?: ""
        val artist = md?.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: ""
        val playing = mc?.let { Media.playing(it) } ?: false
        val key = "$title|$artist|$playing"
        if (key == lastReport) return
        lastReport = key
        // phone started playing → the widget follows it, unless the Mac is playing (the Mac wins)
        if (playing && MacMedia.state(this)?.playing != true) { MacMedia.setSource(this, "phone"); Widgets.updateMusic(this) }
        val app = mc?.packageName?.let { p -> try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(p, 0)).toString() } catch (_: Exception) { p } } ?: ""
        Thread { Net.post(this, "/v1/phone/status", org.json.JSONObject().put("title", title).put("artist", artist).put("app", app).put("playing", playing)) }.start()
    }
    private fun soon() { main.removeCallbacks(refresh); main.postDelayed(refresh, 300) }

    private val sessions = MediaSessionManager.OnActiveSessionsChangedListener { list -> track(list ?: emptyList()) }

    private fun track(list: List<MediaController>) {
        for ((mc, cb) in tracked) try { mc.unregisterCallback(cb) } catch (_: Exception) { }
        tracked.clear()
        for (mc in list) {
            val cb = object : MediaController.Callback() {
                override fun onMetadataChanged(metadata: MediaMetadata?) = soon()
                override fun onPlaybackStateChanged(state: PlaybackState?) = soon()
                override fun onSessionDestroyed() = soon()
            }
            try { mc.registerCallback(cb, main); tracked[mc] = cb } catch (_: Exception) { }
        }
        soon()
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        try {
            val comp = ComponentName(this, KoroMediaListener::class.java)
            msm = getSystemService(MediaSessionManager::class.java)
            msm?.addOnActiveSessionsChangedListener(sessions, comp, main)
            track(msm?.getActiveSessions(comp) ?: emptyList())
        } catch (_: SecurityException) { }
    }

    override fun onListenerDisconnected() {
        try { msm?.removeOnActiveSessionsChangedListener(sessions) } catch (_: Exception) { }
        for ((mc, cb) in tracked) try { mc.unregisterCallback(cb) } catch (_: Exception) { }
        tracked.clear()
        super.onListenerDisconnected()
    }
}

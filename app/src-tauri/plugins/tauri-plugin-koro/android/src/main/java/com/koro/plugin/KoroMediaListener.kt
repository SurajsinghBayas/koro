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
    private val refresh = Runnable { Widgets.updateMusic(this) }
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

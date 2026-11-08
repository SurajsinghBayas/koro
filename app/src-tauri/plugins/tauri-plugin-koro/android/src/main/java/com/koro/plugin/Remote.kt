package com.koro.plugin

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper

/** Commands from the Mac's menu bar (arrive as data-only FCM). */
object Remote {
    fun handle(c: Context, cmd: String, url: String?) {
        val main = Handler(Looper.getMainLooper())
        when (cmd) {
            "toggle", "next", "prev" -> main.post { Media.control(c, cmd, 0) }
            "volup", "voldown" -> {
                val am = c.getSystemService(AudioManager::class.java)
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, if (cmd == "volup") AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            }
            "ring" -> ring(c)
            "link" -> url?.takeIf { it.startsWith("http") }?.let { Notifier.x(c, it.hashCode(), Notifier.CH_CLIP, "Tab from your Mac", it, null, it) }
        }
    }

    /** Find my phone: alarm sound at full alarm volume for ~12 s, even on silent. */
    private fun ring(c: Context) {
        try {
            val am = c.getSystemService(AudioManager::class.java)
            val before = am.getStreamVolume(AudioManager.STREAM_ALARM)
            am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0)
            val r = RingtoneManager.getRingtone(c, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            r.audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            r.play()
            Notifier.show(c, 4301, Notifier.CH_REMINDERS, "📍 Your Mac is looking for this phone", "Ringing for a few seconds")
            Handler(Looper.getMainLooper()).postDelayed({ try { r.stop() } catch (_: Exception) { }; am.setStreamVolume(AudioManager.STREAM_ALARM, before, 0) }, 12_000)
        } catch (_: Exception) { }
    }
}

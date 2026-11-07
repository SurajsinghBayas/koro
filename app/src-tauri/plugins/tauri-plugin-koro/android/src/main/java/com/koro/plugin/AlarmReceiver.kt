package com.koro.plugin

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.KeyEvent

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        when (i.action) {
            Alarms.REMINDER -> {
                val id = i.getStringExtra("id") ?: return
                val title = i.getStringExtra("title") ?: "Reminder"
                val repeat = i.getStringExtra("repeat") ?: ""
                if (id.startsWith("water:")) Notifier.water(c, title)
                else Notifier.show(c, id.hashCode(), Notifier.CH_REMINDERS, "⏰ $title", "Koro reminder")
                if (repeat == "daily") Alarms.reminder(c, id, title, i.getLongExtra("at", System.currentTimeMillis()) + 86_400_000L, repeat)
                else Prefs.dropReminder(c, id)
            }
            Alarms.FOCUS_END -> endFocus(c, notify = true)
            Alarms.SLEEP -> fadeAndPause(c, goAsync())
        }
    }

    companion object {
        fun endFocus(c: Context, notify: Boolean) {
            val nm = c.getSystemService(NotificationManager::class.java)
            if (Prefs.flag(c, "focusDnd") && nm.isNotificationPolicyAccessGranted) {
                nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
            }
            Prefs.setFlag(c, "focusDnd", false)
            Prefs.setFlag(c, "focusOn", false)
            if (notify) Notifier.show(c, 4201, Notifier.CH_REMINDERS, "Focus done ✨", "Nice work. Take a short break.")
        }

        /** ~5 s volume fade, then pause whatever is playing, then restore the volume for next time. */
        fun fadeAndPause(c: Context, pending: PendingResult?) {
            val am = c.getSystemService(AudioManager::class.java)
            val start = am.getStreamVolume(AudioManager.STREAM_MUSIC)
            val h = Handler(Looper.getMainLooper())
            val steps = 6
            for (s in 1..steps) h.postDelayed({
                am.setStreamVolume(AudioManager.STREAM_MUSIC, (start * (steps - s)) / steps, 0)
            }, s * 800L)
            h.postDelayed({
                val t = SystemClock.uptimeMillis()
                am.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE, 0))
                am.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PAUSE, 0))
                // Taking audio focus makes well-behaved players (Spotify, YT Music) stop even if they ignore the key.
                if (Build.VERSION.SDK_INT >= 26) {
                    val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build())
                        .setOnAudioFocusChangeListener { }
                        .build()
                    am.requestAudioFocus(req)
                    h.postDelayed({ am.abandonAudioFocusRequest(req) }, 1500)
                }
            }, (steps + 1) * 800L)
            h.postDelayed({
                am.setStreamVolume(AudioManager.STREAM_MUSIC, start, 0)
                Prefs.setFlag(c, "sleepOn", false)
                Notifier.show(c, 4202, Notifier.CH_GENERAL, "Sleep timer", "Music paused. Good night 🌙", silent = true)
                pending?.finish()
            }, (steps + 3) * 800L)
        }
    }
}

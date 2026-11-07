package com.koro.plugin

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Data-only FCM from the Koro server. Keys: kind, title, body, tag, buzz, matchId, event, final. */
class KoroMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(m: RemoteMessage) {
        val d = m.data
        val title = d["title"] ?: m.notification?.title ?: "Koro"
        val body = d["body"] ?: m.notification?.body ?: ""
        val tag = d["tag"]
        if (d["kind"] == "match" && tag != null) {
            Notifier.match(this, tag, title, body, buzz = d["buzz"] == "1", final = d["final"] == "1")
        } else {
            Notifier.show(this, (tag ?: title).hashCode(), Notifier.CH_GENERAL, title, body)
        }
    }

    override fun onNewToken(token: String) {
        // The app re-registers the token with the server on next launch (pushInit is idempotent).
        Prefs.setFlag(this, "tokenChanged", true)
    }
}

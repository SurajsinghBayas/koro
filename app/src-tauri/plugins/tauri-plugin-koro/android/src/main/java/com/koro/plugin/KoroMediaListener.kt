package com.koro.plugin

import android.service.notification.NotificationListenerService

/**
 * Exists only so Android lets Koro read media sessions (what Spotify / YT Music / etc. are playing).
 * We never read or store other apps' notifications.
 */
class KoroMediaListener : NotificationListenerService()

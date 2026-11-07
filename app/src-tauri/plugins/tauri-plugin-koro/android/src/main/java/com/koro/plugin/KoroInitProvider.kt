package com.koro.plugin

import android.content.ContentProvider
import android.content.ContentValues
import android.net.Uri

/** Runs at process start (before any FCM delivery) so Firebase and channels exist even on a cold start. */
class KoroInitProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        val c = context ?: return true
        Notifier.channels(c)
        try { Push.ensure(c) } catch (_: Exception) {}
        return true
    }
    override fun query(u: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?) = null
    override fun getType(u: Uri): String? = null
    override fun insert(u: Uri, v: ContentValues?): Uri? = null
    override fun delete(u: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(u: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0
}

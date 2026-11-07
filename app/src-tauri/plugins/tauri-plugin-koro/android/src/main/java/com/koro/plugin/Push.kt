package com.koro.plugin

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

/** Firebase without google-services.json: the server hands us the public config at runtime. */
object Push {
    fun ensure(c: Context, cfg: JSONObject? = Prefs.firebase(c)): Boolean {
        if (FirebaseApp.getApps(c).isNotEmpty()) return true
        cfg ?: return false
        val appId = cfg.optString("appId"); val apiKey = cfg.optString("apiKey"); val projectId = cfg.optString("projectId")
        if (appId.isEmpty() || apiKey.isEmpty() || projectId.isEmpty()) return false
        val opts = FirebaseOptions.Builder()
            .setApplicationId(appId).setApiKey(apiKey).setProjectId(projectId)
            .setGcmSenderId(cfg.optString("senderId"))
            .build()
        FirebaseApp.initializeApp(c.applicationContext, opts)
        return true
    }

    fun token(c: Context, cfg: JSONObject, done: (String?) -> Unit) {
        Prefs.putFirebase(c, cfg)
        try {
            if (!ensure(c, cfg)) return done(null)
            FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
                done(if (t.isSuccessful) t.result else null)
            }
        } catch (e: Exception) { done(null) }
    }
}

package com.koro.plugin

import android.content.Context
import org.json.JSONObject

/** Tiny persisted state: scheduled reminders (for reboot), Firebase config, focus/sleep flags. */
object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("koro", Context.MODE_PRIVATE)

    fun reminders(c: Context): JSONObject = JSONObject(sp(c).getString("reminders", "{}") ?: "{}")
    fun putReminder(c: Context, id: String, title: String, at: Long, repeat: String) {
        val all = reminders(c)
        all.put(id, JSONObject().put("title", title).put("at", at).put("repeat", repeat))
        sp(c).edit().putString("reminders", all.toString()).apply()
    }
    fun dropReminder(c: Context, id: String) {
        val all = reminders(c); all.remove(id)
        sp(c).edit().putString("reminders", all.toString()).apply()
    }

    fun firebase(c: Context): JSONObject? = sp(c).getString("firebase", null)?.let { JSONObject(it) }
    fun putFirebase(c: Context, cfg: JSONObject) = sp(c).edit().putString("firebase", cfg.toString()).apply()

    fun flag(c: Context, k: String) = sp(c).getBoolean(k, false)
    fun setFlag(c: Context, k: String, v: Boolean) = sp(c).edit().putBoolean(k, v).apply()
    fun int(c: Context, k: String, d: Int = -1) = sp(c).getInt(k, d)
    fun setInt(c: Context, k: String, v: Int) = sp(c).edit().putInt(k, v).apply()
}

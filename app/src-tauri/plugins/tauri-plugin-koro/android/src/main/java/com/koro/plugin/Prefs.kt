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

    /** Server + device token (set by the app) so the share sheet and widgets can talk to the server without the WebView. */
    fun auth(c: Context): Pair<String, String>? {
        val s = sp(c).getString("server", "") ?: ""; val t = sp(c).getString("token", "") ?: ""
        return if (s.isNotEmpty() && t.isNotEmpty()) s to t else null
    }
    fun setAuth(c: Context, server: String, token: String) = sp(c).edit().putString("server", server).putString("token", token).apply()

    /** Snapshot of lists for the home-screen widgets: {tasks:[…], habits:[…], grocery:[…]}. */
    fun widgetData(c: Context): JSONObject = try { JSONObject(sp(c).getString("widget", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
    fun setWidgetData(c: Context, d: JSONObject) = sp(c).edit().putString("widget", d.toString()).apply()

    /** Actions taken outside the app (widget ticks, "+1 glass" on a notification) that the app applies on next open. */
    @Synchronized fun addOp(c: Context, op: JSONObject) {
        val arr = try { org.json.JSONArray(sp(c).getString("ops", "[]")) } catch (_: Exception) { org.json.JSONArray() }
        arr.put(op.put("at", System.currentTimeMillis()))
        sp(c).edit().putString("ops", arr.toString()).apply()
    }
    @Synchronized fun takeOps(c: Context): org.json.JSONArray {
        val arr = try { org.json.JSONArray(sp(c).getString("ops", "[]")) } catch (_: Exception) { org.json.JSONArray() }
        sp(c).edit().putString("ops", "[]").apply()
        return arr
    }

    fun flag(c: Context, k: String) = sp(c).getBoolean(k, false)
    fun setFlag(c: Context, k: String, v: Boolean) = sp(c).edit().putBoolean(k, v).apply()
    fun int(c: Context, k: String, d: Int = -1) = sp(c).getInt(k, d)
    fun setInt(c: Context, k: String, v: Int) = sp(c).edit().putInt(k, v).apply()
}

package com.koro.plugin

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Minimal JSON POST to the Koro server for code that runs without the app's WebView (share sheet). Call off the main thread. */
object Net {
    fun post(c: Context, path: String, body: JSONObject): Pair<Int, JSONObject?> {
        val (server, token) = Prefs.auth(c) ?: return 0 to null
        return try {
            val conn = (URL(server.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"; connectTimeout = 10_000; readTimeout = 20_000; doOutput = true
                setRequestProperty("authorization", "Bearer $token"); setRequestProperty("content-type", "application/json")
            }
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            code to (try { JSONObject(text) } catch (_: Exception) { null })
        } catch (_: Exception) { 0 to null }
    }

    /** Raw bytes (images), with the device token. */
    fun getBytes(c: Context, path: String, max: Int = 9 * 1024 * 1024): ByteArray? {
        val (server, token) = Prefs.auth(c) ?: return null
        return try {
            val conn = (URL(server.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
                connectTimeout = 10_000; readTimeout = 30_000; setRequestProperty("authorization", "Bearer $token")
            }
            if (conn.responseCode >= 400 || conn.contentLength > max) null else conn.inputStream.use { it.readBytes() }
        } catch (_: Exception) { null }
    }
}

package com.koro.plugin

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

/** "Koro" in Android's share sheet: send a link or text to the Mac, save it to read later, or add it as a task. */
class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // an image (Gallery, screenshot…): straight onto the Mac clipboard
        if (intent?.type?.startsWith("image/") == true) {
            @Suppress("DEPRECATION")
            val uri = intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM)
            if (uri == null) { finish(); return }
            if (Prefs.auth(this) == null) { toast("Open Koro and pair it with your server first"); finish(); return }
            toast("Copying image to your Mac…")
            Thread {
                val code = try { ClipImage.sendToMac(this, uri) } catch (_: Exception) { 400 }
                runOnUiThread {
                    toast(when (code) { in 200..299 -> "Image copied to your Mac. Paste with ⌘V"; 0 -> "Couldn't reach your Koro server"; else -> "Couldn't send that image ($code)" })
                    finish()
                }
            }.start()
            return
        }
        val text = (intent?.getStringExtra(Intent.EXTRA_TEXT) ?: "").trim()
        val subject = intent?.getStringExtra(Intent.EXTRA_SUBJECT)?.trim()?.takeIf { it.isNotEmpty() }
        if (text.isEmpty()) { finish(); return }
        if (Prefs.auth(this) == null) { toast("Open Koro and pair it with your server first"); finish(); return }
        val url = Regex("https?://\\S+").find(text)?.value
        val options = if (url != null) arrayOf("Open on Mac", "Read later (saved offline)", "Copy to Mac clipboard")
                      else arrayOf("Copy to Mac clipboard", "Add as task")
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle(subject ?: "Koro")
            .setItems(options) { _, which -> send(options[which], text, url, subject) }
            .setOnCancelListener { finish() }
            .show()
    }

    private fun send(choice: String, text: String, url: String?, subject: String?) {
        Thread {
            val code = when {
                choice.startsWith("Open on Mac") ->
                    Net.post(this, "/v1/mac/send", JSONObject().put("type", "link").put("url", url).put("title", (subject ?: "").take(300))).first
                choice.startsWith("Read later") ->
                    Net.post(this, "/v1/saved", JSONObject().put("url", url).apply { if (subject != null) put("title", subject.take(300)) }).first
                choice.startsWith("Copy to Mac") ->
                    Net.post(this, "/v1/mac/send", JSONObject().put("type", "clip").put("text", text.take(20_000))).first
                else -> {
                    val now = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
                    val row = JSONObject().put("id", UUID.randomUUID().toString()).put("title", text.take(300)).put("updated_at", now)
                    // A high cursor: we only push the new task; the app pulls it on its next sync.
                    Net.post(this, "/v1/sync", JSONObject().put("cursor", Long.MAX_VALUE / 4).put("changes",
                        JSONArray().put(JSONObject().put("table", "tasks").put("row", row)))).first
                }
            }
            runOnUiThread {
                toast(when {
                    code in 200..299 -> when {
                        choice.startsWith("Open on Mac") -> "Opening on your Mac"
                        choice.startsWith("Read later") -> "Saved. Summary and offline copy coming up"
                        choice.startsWith("Copy") -> "Copied to your Mac"
                        else -> "Task added"
                    }
                    code == 0 -> "Couldn't reach your Koro server"
                    else -> "Koro server said no ($code)"
                })
                finish()
            }
        }.start()
    }

    private fun toast(msg: String) = Toast.makeText(applicationContext, msg, Toast.LENGTH_SHORT).show()
}

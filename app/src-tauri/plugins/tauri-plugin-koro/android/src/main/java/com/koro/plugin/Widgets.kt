package com.koro.plugin

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.media.MediaMetadata
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

/**
 * Home-screen widgets. Lists (To-do, Habits, Grocery) render from a snapshot the app writes (Prefs.widgetData);
 * ticking a row updates the snapshot right away and queues the change for the app to sync on next open.
 * The music widget reads the live media session (needs Notification access) and refreshes from KoroMediaListener.
 */
object Widgets {
    const val TASKS = "tasks"
    const val HABITS = "habits"
    const val GROCERY = "grocery"
    private val ROW = intArrayOf(R.id.w_row0, R.id.w_row1, R.id.w_row2, R.id.w_row3, R.id.w_row4, R.id.w_row5)
    private val CHECK = intArrayOf(R.id.w_check0, R.id.w_check1, R.id.w_check2, R.id.w_check3, R.id.w_check4, R.id.w_check5)
    private val TEXT = intArrayOf(R.id.w_text0, R.id.w_text1, R.id.w_text2, R.id.w_text3, R.id.w_text4, R.id.w_text5)
    private val META = intArrayOf(R.id.w_meta0, R.id.w_meta1, R.id.w_meta2, R.id.w_meta3, R.id.w_meta4, R.id.w_meta5)

    private fun provider(kind: String): Class<*> = when (kind) {
        TASKS -> TasksWidget::class.java
        HABITS -> HabitsWidget::class.java
        else -> GroceryWidget::class.java
    }
    private fun ids(c: Context, cls: Class<*>) = AppWidgetManager.getInstance(c).getAppWidgetIds(ComponentName(c, cls))

    fun updateAll(c: Context) { for (k in listOf(TASKS, HABITS, GROCERY)) update(c, k); updateMusic(c) }

    fun openApp(c: Context, req: Int): PendingIntent? {
        val i = c.packageManager.getLaunchIntentForPackage(c.packageName)?.apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP } ?: return null
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    private fun action(c: Context, req: Int, act: String, extras: Intent.() -> Unit): PendingIntent =
        PendingIntent.getBroadcast(c, req, Intent(c, WidgetActionReceiver::class.java).setAction(act).apply(extras),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun update(c: Context, kind: String) {
        val ids = ids(c, provider(kind))
        if (ids.isEmpty()) return
        val rv = RemoteViews(c.packageName, R.layout.koro_widget_list)
        val items = Prefs.widgetData(c).optJSONArray(kind) ?: JSONArray()
        val done = (0 until items.length()).count { items.optJSONObject(it)?.optBoolean("done") == true }
        rv.setTextViewText(R.id.w_title, when (kind) { TASKS -> "To-do"; HABITS -> "Habits"; else -> "Grocery" })
        rv.setTextViewText(R.id.w_icon, when (kind) { TASKS -> "✅"; HABITS -> "🔥"; else -> "🛒" })
        rv.setTextViewText(R.id.w_kicker, when (kind) { TASKS -> "KORO · TODAY"; HABITS -> "KORO · STREAKS"; else -> "KORO · SHOPPING" })
        // each list gets its own holo glow: cyan to-do, violet habits, gold-green grocery
        rv.setInt(R.id.w_glow, "setColorFilter", when (kind) { TASKS -> 0xFF4FB8FF.toInt(); HABITS -> 0xFFB06CFF.toInt(); else -> 0xFF9EDB6A.toInt() })
        rv.setTextViewText(R.id.w_count, if (kind == GROCERY) "${items.length()} to buy" else "$done / ${items.length()}")
        if (kind == GROCERY || items.length() == 0) rv.setViewVisibility(R.id.w_progress, View.GONE)
        else { rv.setViewVisibility(R.id.w_progress, View.VISIBLE); rv.setProgressBar(R.id.w_progress, 100, done * 100 / items.length(), false) }
        rv.setOnClickPendingIntent(R.id.w_header, openApp(c, kind.hashCode()))
        for (i in ROW.indices) {
            val it = items.optJSONObject(i)
            if (it == null) { rv.setViewVisibility(ROW[i], View.GONE); continue }
            val isDone = it.optBoolean("done")
            val label = it.optString("text")
            rv.setViewVisibility(ROW[i], View.VISIBLE)
            rv.setTextViewText(TEXT[i], if (isDone) SpannableString(label).apply { setSpan(StrikethroughSpan(), 0, label.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) } else label)
            val meta = it.optString("meta")
            rv.setTextViewText(META[i], meta)
            rv.setViewVisibility(META[i], if (meta.isEmpty()) View.GONE else View.VISIBLE)
            rv.setImageViewResource(CHECK[i], if (isDone) R.drawable.koro_w_check_on else R.drawable.koro_w_check_off)
            rv.setOnClickPendingIntent(ROW[i], action(c, (kind.hashCode() and 0xfff) * 16 + i, WidgetActionReceiver.TOGGLE) {
                putExtra("kind", kind); putExtra("id", it.optString("id"))
            })
        }
        val more = items.length() - ROW.size
        rv.setTextViewText(R.id.w_empty, when {
            items.length() == 0 -> when (kind) { TASKS -> "Nothing due today"; HABITS -> "No habits yet"; else -> "List is empty" }
            more > 0 -> "+$more more"
            else -> ""
        })
        rv.setViewVisibility(R.id.w_empty, if (items.length() == 0 || more > 0) View.VISIBLE else View.GONE)
        rv.setOnClickPendingIntent(R.id.w_empty, openApp(c, kind.hashCode() + 1))
        AppWidgetManager.getInstance(c).updateAppWidget(ids, rv)
    }

    /** A tick on the widget: instant visual change + queued for the app. */
    fun toggle(c: Context, kind: String, id: String) {
        val d = Prefs.widgetData(c)
        val items = d.optJSONArray(kind) ?: return
        val out = JSONArray()
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            if (it.optString("id") == id) {
                if (kind == GROCERY) continue // bought: drop from the list
                it.put("done", !it.optBoolean("done"))
            }
            out.put(it)
        }
        d.put(kind, out)
        Prefs.setWidgetData(c, d)
        Prefs.addOp(c, JSONObject().put("kind", kind).put("id", id))
        update(c, kind)
    }

    // ---------- music ----------
    fun rounded(src: Bitmap, size: Int, radius: Float): Bitmap {
        val scaled = Bitmap.createScaledBitmap(src, size, size, true)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        Canvas(out).drawRoundRect(RectF(0f, 0f, size.toFloat(), size.toFloat()), radius, radius, p)
        return out
    }
    /** Cheap blur: shrink to a few pixels and stretch back (a soft colour wash behind the holo foil). */
    private fun wash(src: Bitmap): Bitmap = Bitmap.createScaledBitmap(Bitmap.createScaledBitmap(src, 6, 4, true), 240, 120, true)

    fun updateMusic(c: Context) {
        val ids = ids(c, MusicWidget::class.java)
        if (ids.isEmpty()) return
        val rv = RemoteViews(c.packageName, R.layout.koro_widget_music)
        rv.setOnClickPendingIntent(R.id.m_art, openApp(c, 9100))
        rv.setOnClickPendingIntent(R.id.m_info, openApp(c, 9101))
        val mac = MacMedia.source(c) == "mac"
        rv.setImageViewResource(R.id.m_src_icon, if (mac) R.drawable.koro_w_mac else R.drawable.koro_w_phone)
        rv.setTextViewText(R.id.m_src_text, if (mac) "Mac" else "Phone")
        rv.setOnClickPendingIntent(R.id.m_src, action(c, 9204, WidgetActionReceiver.SOURCE) { })
        if (mac) {
            val st = MacMedia.state(c)
            rv.setTextViewText(R.id.m_app, if (st == null) "YOUR MAC" else "ON YOUR MAC" + if (st.app.isNotEmpty()) " · ${st.app.uppercase()}" else "")
            rv.setTextViewText(R.id.m_title, st?.title ?: "Nothing playing on your Mac")
            rv.setTextViewText(R.id.m_artist, st?.artist?.ifEmpty { null } ?: if (st == null) "Play music or a video on the Mac" else "")
            val art = MacMedia.art(c)
            if (art != null) { rv.setImageViewBitmap(R.id.m_art, rounded(art, 220, 26f)); rv.setImageViewBitmap(R.id.m_wash, wash(art)) }
            else { rv.setImageViewResource(R.id.m_art, R.drawable.koro_w_art_mac); rv.setImageViewResource(R.id.m_wash, android.R.color.transparent) }
            rv.setImageViewResource(R.id.m_play, if (st?.playing == true) R.drawable.koro_w_pause else R.drawable.koro_w_play)
            rv.setOnClickPendingIntent(R.id.m_prev, MacMedia.action(c, 9211, "prev"))
            rv.setOnClickPendingIntent(R.id.m_play, MacMedia.action(c, 9212, "toggle"))
            rv.setOnClickPendingIntent(R.id.m_next, MacMedia.action(c, 9213, "next"))
            AppWidgetManager.getInstance(c).updateAppWidget(ids, rv)
            return
        }
        val mc = if (Media.granted(c)) Media.current(c) else null
        if (!Media.granted(c)) {
            rv.setTextViewText(R.id.m_title, "See what's playing")
            rv.setTextViewText(R.id.m_artist, "Open Koro → Settings → Notification access")
            rv.setTextViewText(R.id.m_app, "KORO")
        } else if (mc?.metadata == null) {
            rv.setTextViewText(R.id.m_title, "Nothing playing")
            rv.setTextViewText(R.id.m_artist, MacMedia.state(c)?.let { "Your Mac is playing ${it.title} · tap Mac" } ?: "Play something in Spotify or YouTube Music")
            rv.setTextViewText(R.id.m_app, "KORO")
            rv.setImageViewResource(R.id.m_art, R.drawable.koro_w_art_empty)
            rv.setImageViewResource(R.id.m_wash, android.R.color.transparent)
        } else {
            val md = mc.metadata!!
            rv.setTextViewText(R.id.m_title, md.getString(MediaMetadata.METADATA_KEY_TITLE) ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE) ?: "")
            rv.setTextViewText(R.id.m_artist, md.getString(MediaMetadata.METADATA_KEY_ARTIST) ?: md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE) ?: "")
            val label = try { c.packageManager.getApplicationLabel(c.packageManager.getApplicationInfo(mc.packageName, 0)).toString() } catch (_: Exception) { "" }
            rv.setTextViewText(R.id.m_app, label.uppercase())
            val art = Media.artBitmap(md)
            if (art != null) {
                rv.setImageViewBitmap(R.id.m_art, rounded(art, 220, 26f))
                rv.setImageViewBitmap(R.id.m_wash, wash(art))
            } else {
                rv.setImageViewResource(R.id.m_art, R.drawable.koro_w_art_empty)
                rv.setImageViewResource(R.id.m_wash, android.R.color.transparent)
            }
            rv.setImageViewResource(R.id.m_play, if (Media.playing(mc)) R.drawable.koro_w_pause else R.drawable.koro_w_play)
        }
        rv.setOnClickPendingIntent(R.id.m_prev, action(c, 9201, WidgetActionReceiver.MEDIA) { putExtra("cmd", "prev") })
        rv.setOnClickPendingIntent(R.id.m_play, action(c, 9202, WidgetActionReceiver.MEDIA) { putExtra("cmd", "toggle") })
        rv.setOnClickPendingIntent(R.id.m_next, action(c, 9203, WidgetActionReceiver.MEDIA) { putExtra("cmd", "next") })
        AppWidgetManager.getInstance(c).updateAppWidget(ids, rv)
    }
}

open class KoroListWidget(private val kind: String) : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) = Widgets.update(c, kind)
}
class TasksWidget : KoroListWidget(Widgets.TASKS)
class HabitsWidget : KoroListWidget(Widgets.HABITS)
class GroceryWidget : KoroListWidget(Widgets.GROCERY)
class MusicWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) = Widgets.updateMusic(c)
}

/** Taps on widgets and notification actions. */
class WidgetActionReceiver : BroadcastReceiver() {
    companion object {
        const val TOGGLE = "com.koro.widget.TOGGLE"
        const val MEDIA = "com.koro.widget.MEDIA"
        const val WATER = "com.koro.water.ADD"
        const val MAC = "com.koro.widget.MAC"
        const val SOURCE = "com.koro.widget.SOURCE"
    }
    override fun onReceive(c: Context, i: Intent) {
        when (i.action) {
            TOGGLE -> Widgets.toggle(c, i.getStringExtra("kind") ?: return, i.getStringExtra("id") ?: return)
            MEDIA -> {
                Media.control(c, i.getStringExtra("cmd") ?: "toggle", 0)
                val pending = goAsync()
                Handler(Looper.getMainLooper()).postDelayed({ Widgets.updateMusic(c); pending.finish() }, 600)
            }
            MAC -> {
                val pending = goAsync()
                Thread { try { MacMedia.send(c, i.getStringExtra("cmd") ?: "toggle") } finally { pending.finish() } }.start()
            }
            SOURCE -> {
                MacMedia.setSource(c, if (MacMedia.source(c) == "mac") "phone" else "mac")
                Widgets.updateMusic(c)
            }
            WATER -> {
                Prefs.addOp(c, JSONObject().put("kind", "water").put("ml", 250))
                Notifier.cancel(c, Notifier.WATER_ID)
                Notifier.show(c, Notifier.WATER_ID + 1, Notifier.CH_CLIP, "💧 Logged a glass", "Nice. Koro adds it next time you open the app.")
            }
        }
    }
}

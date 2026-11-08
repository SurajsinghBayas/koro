package com.koro.plugin

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * Holo widgets beyond the lists and the player: Today (weather + AI brief + next), Water (one-tap glass),
 * Mac remote and Cricket. They render from the snapshot the app writes (Prefs.widgetData); taps that change
 * something (a glass of water) update the snapshot at once and queue the change for the app, like the lists.
 */
object MoreWidgets {
    private fun ids(c: Context, cls: Class<*>) = AppWidgetManager.getInstance(c).getAppWidgetIds(ComponentName(c, cls))
    private fun data(c: Context, key: String): JSONObject? = Prefs.widgetData(c).optJSONObject(key)
    private fun action(c: Context, req: Int, act: String, extra: Intent.() -> Unit = {}): PendingIntent =
        PendingIntent.getBroadcast(c, req, Intent(c, WidgetActionReceiver::class.java).setAction(act).apply(extra),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    fun updateAll(c: Context) { today(c); water(c); mac(c); cricket(c) }

    fun today(c: Context) {
        val ids = ids(c, TodayWidget::class.java); if (ids.isEmpty()) return
        val rv = RemoteViews(c.packageName, R.layout.koro_widget_today)
        val d = data(c, "today")
        rv.setTextViewText(R.id.t_date, (d?.optString("date") ?: "Today").uppercase())
        rv.setTextViewText(R.id.t_temp, d?.optString("temp")?.ifEmpty { null } ?: "--°")
        rv.setTextViewText(R.id.t_wx, d?.optString("wx") ?: "")
        rv.setTextViewText(R.id.t_hilo, d?.optString("hilo") ?: "")
        val lines = d?.optJSONArray("lines")
        val ln = intArrayOf(R.id.t_line0, R.id.t_line1, R.id.t_line2)
        for (i in ln.indices) {
            val t = lines?.optString(i)?.takeIf { it.isNotEmpty() }
            rv.setTextViewText(ln[i], t ?: ""); rv.setViewVisibility(ln[i], if (t == null) View.GONE else View.VISIBLE)
        }
        if (lines == null || lines.length() == 0) { rv.setTextViewText(ln[0], "Open Koro for today's brief"); rv.setViewVisibility(ln[0], View.VISIBLE) }
        val next = d?.optString("next") ?: ""
        rv.setTextViewText(R.id.t_next, "Next · $next"); rv.setViewVisibility(R.id.t_next, if (next.isEmpty()) View.GONE else View.VISIBLE)
        rv.setInt(R.id.t_glow, "setColorFilter", 0xFFE8C46A.toInt())
        rv.setOnClickPendingIntent(R.id.t_root, Widgets.openApp(c, 9400))
        AppWidgetManager.getInstance(c).updateAppWidget(ids, rv)
    }

    /** 750 → "750 ml", 1250 → "1.25 L", 2000 → "2 L" */
    private fun litres(ml: Int) = if (ml < 1000) "$ml ml" else String.format(java.util.Locale.US, "%.2f", ml / 1000.0).trimEnd('0').trimEnd('.') + " L"

    fun water(c: Context) {
        val ids = ids(c, WaterWidget::class.java); if (ids.isEmpty()) return
        val rv = RemoteViews(c.packageName, R.layout.koro_widget_water)
        val d = data(c, "water")
        val ml = d?.optInt("ml") ?: 0; val goal = d?.optInt("goal", 2500) ?: 2500; val glass = d?.optInt("glass", 250) ?: 250
        rv.setTextViewText(R.id.w2_amount, litres(ml))
        val left = goal - ml
        rv.setTextViewText(R.id.w2_goal, if (left <= 0) "Goal reached 🎉" else "of ${litres(goal)} · ${litres(left)} to go")
        rv.setProgressBar(R.id.w2_progress, 100, if (goal > 0) minOf(100, ml * 100 / goal) else 0, false)
        rv.setTextViewText(R.id.w2_add_text, "$glass ml")
        rv.setInt(R.id.w2_glow, "setColorFilter", 0xFF4FB8FF.toInt())
        rv.setOnClickPendingIntent(R.id.w2_add, action(c, 9410, WidgetActionReceiver.WATER_W))
        rv.setOnClickPendingIntent(R.id.w2_root, Widgets.openApp(c, 9411))
        AppWidgetManager.getInstance(c).updateAppWidget(ids, rv)
    }

    /** "+ glass" on the widget: instant on screen, synced next time the app opens. */
    fun addGlass(c: Context) {
        val all = Prefs.widgetData(c)
        val w = all.optJSONObject("water") ?: JSONObject().put("goal", 2500).put("glass", 250)
        val glass = w.optInt("glass", 250)
        w.put("ml", w.optInt("ml") + glass); all.put("water", w); Prefs.setWidgetData(c, all)
        Prefs.addOp(c, JSONObject().put("kind", "water").put("ml", glass))
        water(c)
    }

    fun mac(c: Context) {
        val ids = ids(c, MacWidget::class.java); if (ids.isEmpty()) return
        val rv = RemoteViews(c.packageName, R.layout.koro_widget_mac)
        val d = data(c, "mac")
        val online = d?.optBoolean("online") == true
        val bat = d?.opt("battery") as? Int
        val np = MacMedia.state(c)
        rv.setTextViewText(R.id.mc_kick, "💻 " + (d?.optString("name")?.ifEmpty { null } ?: "MAC").uppercase() + if (bat != null) " · $bat%" else "")
        rv.setTextViewText(R.id.mc_state, when {
            np != null -> (if (np.playing) "▶ " else "❚❚ ") + np.title
            online -> "● Online"
            else -> "Offline · commands wait"
        })
        rv.setInt(R.id.mc_glow, "setColorFilter", 0xFFB06CFF.toInt())
        val cmds = listOf(R.id.mc_vdown to "voldown", R.id.mc_vup to "volup", R.id.mc_play to "toggle", R.id.mc_lock to "lock", R.id.mc_work to "workmode")
        cmds.forEachIndexed { i, (id, cmd) -> rv.setOnClickPendingIntent(id, action(c, 9420 + i, WidgetActionReceiver.MACCMD) { putExtra("cmd", cmd) }) }
        rv.setOnClickPendingIntent(R.id.mc_info, Widgets.openApp(c, 9429))
        AppWidgetManager.getInstance(c).updateAppWidget(ids, rv)
    }

    fun cricket(c: Context) {
        val ids = ids(c, CricketWidget::class.java); if (ids.isEmpty()) return
        val rv = RemoteViews(c.packageName, R.layout.koro_widget_cricket)
        val m = data(c, "match")
        val live = m?.optBoolean("live") == true
        rv.setViewVisibility(R.id.ck_live, if (live) View.VISIBLE else View.GONE)
        rv.setTextViewText(R.id.ck_kick, if (m == null) "INDIA · MI" else if (live) "INDIA · MI" else "NEXT MATCH")
        rv.setTextViewText(R.id.ck_title, m?.optString("title")?.ifEmpty { null } ?: "No India / MI match soon")
        val line = m?.optString("line") ?: ""; val sub = m?.optString("sub") ?: ""
        rv.setTextViewText(R.id.ck_line, line); rv.setViewVisibility(R.id.ck_line, if (line.isEmpty()) View.GONE else View.VISIBLE)
        rv.setTextViewText(R.id.ck_sub, sub); rv.setViewVisibility(R.id.ck_sub, if (sub.isEmpty()) View.GONE else View.VISIBLE)
        rv.setInt(R.id.ck_glow, "setColorFilter", if (live) 0xFFFF4D5E.toInt() else 0xFF9EDB6A.toInt())
        rv.setOnClickPendingIntent(R.id.ck_root, Widgets.openApp(c, 9430))
        AppWidgetManager.getInstance(c).updateAppWidget(ids, rv)
    }

    /** A live-score push arrived: show it on the cricket widget even while the app is closed. */
    fun onMatchPush(c: Context, title: String, body: String, final: Boolean) {
        val all = Prefs.widgetData(c)
        all.put("match", JSONObject().put("live", !final).put("title", title).put("line", body.lineSequence().firstOrNull() ?: "")
            .put("sub", body.lineSequence().drop(1).firstOrNull() ?: ""))
        Prefs.setWidgetData(c, all)
        cricket(c)
    }
}

class TodayWidget : AppWidgetProvider() { override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) = MoreWidgets.today(c) }
class WaterWidget : AppWidgetProvider() { override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) = MoreWidgets.water(c) }
class MacWidget : AppWidgetProvider() { override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) = MoreWidgets.mac(c) }
class CricketWidget : AppWidgetProvider() { override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) = MoreWidgets.cricket(c) }

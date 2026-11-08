package com.koro.plugin

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.StyleSpan
import java.io.File
import java.io.OutputStream

/** Save text / PDF files to Downloads/Koro (no storage permission needed on Android 10+), share, open. */
object Files {
    private fun output(c: Context, name: String, mime: String): Pair<Uri, OutputStream> {
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), " ").trim().take(120)
        if (Build.VERSION.SDK_INT >= 29) {
            val v = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, safe); put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Koro")
            }
            val uri = c.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v) ?: error("Couldn't create the file")
            return uri to (c.contentResolver.openOutputStream(uri) ?: error("Couldn't open the file"))
        }
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Koro").apply { mkdirs() }
        val f = File(dir, safe)
        return Uri.fromFile(f) to f.outputStream()
    }

    fun saveText(c: Context, name: String, mime: String, text: String): String {
        val (uri, out) = output(c, name, mime)
        out.use { it.write(text.toByteArray()) }
        return uri.toString()
    }

    /** Markdown → simple, readable A4 PDF (headings, bullets, bold), paginated line by line. */
    fun savePdf(c: Context, name: String, md: String): String {
        val pageW = 595; val pageH = 842; val m = 50f; val w = (pageW - 2 * m).toInt()
        val doc = PdfDocument()
        var n = 0
        var page = doc.startPage(PdfDocument.PageInfo.Builder(pageW, pageH, ++n).create())
        var y = m
        fun newPage() {
            footer(page, n, pageW, pageH)
            doc.finishPage(page)
            page = doc.startPage(PdfDocument.PageInfo.Builder(pageW, pageH, ++n).create()); y = m
        }
        for (raw in md.lines()) {
            val line = raw.trimEnd()
            if (line.isBlank()) { y += 6f; continue }
            val (text, size, bold, color, indent, before) = when {
                line.startsWith("# ") -> Style(line.drop(2), 20f, true, 0xFF0A1428.toInt(), 0f, 6f)
                line.startsWith("## ") -> Style(line.drop(3), 15f, true, 0xFF1F7FCF.toInt(), 0f, 12f)
                line.startsWith("### ") -> Style(line.drop(4), 12.5f, true, 0xFF0A1428.toInt(), 0f, 8f)
                line.trimStart().startsWith("- ") || line.trimStart().startsWith("* ") -> Style("•  " + line.trimStart().drop(2), 10.5f, false, 0xFF222831.toInt(), 12f, 2f)
                line.trimStart().matches(Regex("^\\d+\\.\\s.*")) -> Style(line.trimStart(), 10.5f, false, 0xFF222831.toInt(), 12f, 2f)
                line.startsWith("> ") -> Style(line.drop(2), 10.5f, false, 0xFF555F6D.toInt(), 12f, 2f)
                else -> Style(line, 10.5f, false, 0xFF222831.toInt(), 0f, 2f)
            }
            val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { textSize = size; this.color = color; typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT }
            val layout = StaticLayout.Builder.obtain(inline(text), 0, inline(text).length, paint, w - indent.toInt())
                .setAlignment(Layout.Alignment.ALIGN_NORMAL).setLineSpacing(0f, 1.25f).build()
            y += before
            for (i in 0 until layout.lineCount) {
                val top = layout.getLineTop(i).toFloat(); val h = layout.getLineBottom(i) - top
                if (y + h > pageH - m) newPage()
                val cv = page.canvas
                cv.save(); cv.clipRect(m + indent, y, m + w, y + h); cv.translate(m + indent, y - top); layout.draw(cv); cv.restore()
                y += h
            }
        }
        footer(page, n, pageW, pageH)
        doc.finishPage(page)
        val (uri, out) = output(c, name, "application/pdf")
        out.use { doc.writeTo(it) }
        doc.close()
        return uri.toString()
    }

    private data class Style(val text: String, val size: Float, val bold: Boolean, val color: Int, val indent: Float, val before: Float)

    /** **bold** → bold span; `code` and _italics_ markers stripped. */
    private fun inline(s: String): CharSequence {
        val out = SpannableStringBuilder()
        val parts = s.split("**")
        parts.forEachIndexed { i, p ->
            val clean = p.replace("`", "").replace(Regex("(?<![\\w])_([^_]+)_(?![\\w])"), "$1")
            val start = out.length
            out.append(clean)
            if (i % 2 == 1) out.setSpan(StyleSpan(Typeface.BOLD), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return out
    }

    private fun footer(p: PdfDocument.Page, n: Int, w: Int, h: Int) {
        val paint = TextPaint(TextPaint.ANTI_ALIAS_FLAG).apply { textSize = 8f; color = Color.GRAY }
        p.canvas.drawText("Koro · page $n", 50f, h - 24f, paint)
    }

    fun share(c: Context, text: String, title: String) {
        val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_SUBJECT, title); putExtra(Intent.EXTRA_TEXT, text) }
        c.startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun open(c: Context, uri: String, mime: String) {
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), mime)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        c.startActivity(Intent.createChooser(i, "Open with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

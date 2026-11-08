/** Tiny, safe Markdown → HTML for AI-written text (escapes everything first; headings, lists, bold, italics, quotes). */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s: string) => esc(s)
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
  .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<i>$2</i>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of md.split('\n')) {
    const l = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!l.trim()) { close(); continue; }
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { close(); const n = Math.min(4, m[1]!.length + 1); out.push(`<h${n}>${inline(m[2]!)}</h${n}>`); continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1]!)}</li>`); continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1]!)}</li>`); continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { close(); out.push(`<blockquote>${inline(m[1]!)}</blockquote>`); continue; }
    if (/^-{3,}$/.test(l.trim())) { close(); out.push('<hr>'); continue; }
    close(); out.push(`<p>${inline(l)}</p>`);
  }
  close();
  return out.join('');
}

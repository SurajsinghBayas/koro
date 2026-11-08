import { describe, expect, test } from 'bun:test';
import { currentSeq, nextEvents, pushToMac } from '../src/services/mac.ts';
import { toBlocks } from '../src/services/saved.ts';
import { rainSoon } from '../src/services/weather.ts';
import { fromAgo, parseChannelPage } from '../src/services/yt.ts';

describe('read later', () => {
  test('article HTML becomes plain text blocks, scripts dropped', () => {
    const b = toBlocks('<div><h2>Big news</h2><p>First <b>para</b>.</p><script>alert(1)</script><ul><li>One</li></ul><blockquote>Quote</blockquote><figure><figcaption>cap</figcaption></figure></div>');
    expect(b).toEqual([{ t: 'h', x: 'Big news' }, { t: 'p', x: 'First para.' }, { t: 'li', x: 'One' }, { t: 'q', x: 'Quote' }]);
  });
});

describe('weather', () => {
  test('rain alert only within the next 6 hours', () => {
    const now = Date.parse('2026-11-08T10:00:00+05:30');
    const h = (t: string, rain: number) => ({ at: `2026-11-08T${t}:00+05:30`, temp: 28, code: 61, rain });
    expect(rainSoon([h('11:00', 20), h('14:00', 70)], now)).toBe('Rain likely around 14:00');
    expect(rainSoon([h('11:00', 20), h('18:00', 90)], now)).toBeNull();
  });
});

describe('youtube', () => {
  test('relative ages', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    expect(fromAgo('3 days ago', now)).toBe('2026-11-05T12:00:00.000Z');
    expect(fromAgo('Streamed 2 hours ago', now)).toBe('2026-11-08T10:00:00.000Z');
  });
  test('parses the channel Videos page, skips #shorts', () => {
    const data = { contents: [
      { lockupViewModel: { contentId: 'abcdefghijk', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: { lockupMetadataViewModel: { title: { content: 'Why & how' },
        metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '10M' }, accessibilityLabel: '10 million views' }, { text: { content: '3d ago' }, accessibilityLabel: '3 days ago' }] }] } } } } } },
      { lockupViewModel: { contentId: 'zzzzzzzzzzz', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: { lockupMetadataViewModel: { title: { content: 'Quick one #shorts' } } } } },
    ] };
    const html = `<meta property="og:title" content="Veritasium"><script>var ytInitialData = ${JSON.stringify(data)};</script>`;
    const now = Date.parse('2026-11-08T12:00:00Z');
    const { title, videos } = parseChannelPage(html, 'UC123', now);
    expect(title).toBe('Veritasium');
    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({ id: 'abcdefghijk', title: 'Why & how', channel: 'Veritasium', publishedAt: '2026-11-05T12:00:00.000Z' });
  });
});

describe('mac relay', () => {
  test('long-poll receives events pushed after it started; first poll never replays', async () => {
    expect(await nextEvents(0)).toEqual([]);
    const since = currentSeq();
    const wait = nextEvents(since, 2000);
    pushToMac({ type: 'cmd', cmd: 'toggle' });
    const got = await wait;
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ type: 'cmd', cmd: 'toggle' });
    expect(await nextEvents(got[0]!.seq, 50)).toEqual([]);
  });
});

import { clean, parseLrc } from '../src/services/lyrics.ts';
describe('lyrics', () => {
  test('parses LRC with multiple stamps', () => {
    const l = parseLrc('[ar:x]\n[00:12.50]Hello\n[00:05.00][01:00.00]Chorus\n');
    expect(l.map((x) => x.t)).toEqual([5000, 12500, 60000]);
    expect(l[1]!.x).toBe('Hello');
  });
  test('cleans YouTube noise', () => {
    expect(clean('Kesariya (Official Video)')).toBe('Kesariya');
    expect(clean('Arijit Singh - Topic')).toBe('Arijit Singh');
  });
});

import { parseIcs } from '../src/services/festivals.ts';
test('festival calendar parses and de-duplicates', () => {
  const ics = 'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261108\r\nSUMMARY:Diwali/Deepavali\r\nDESCRIPTION:Public holiday\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261108\r\nSUMMARY:Diwali/Deepavali\r\nDESCRIPTION:Public holiday\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261111\r\nSUMMARY:Bhai Duj\r\nDESCRIPTION:Observance\r\nEND:VEVENT';
  expect(parseIcs(ics)).toEqual([{ day: '2026-11-08', name: 'Diwali/Deepavali', holiday: true }, { day: '2026-11-11', name: 'Bhai Duj', holiday: false }]);
});

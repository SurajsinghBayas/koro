import { describe, expect, test } from 'bun:test';
import { toTable, winnerOf } from '../src/services/cricket/history.ts';
import { parseFeed, storiesFromAi, type NewsItem } from '../src/services/news.ts';

describe('match history', () => {
  test('winner from status', () => {
    expect(winnerOf('India won by 6 wkts', ['India', 'Australia'])).toBe('India');
    expect(winnerOf('Mumbai Indians won by 12 runs', ['Chennai Super Kings', 'Mumbai Indians'])).toBe('Mumbai Indians');
    expect(winnerOf('Match drawn', ['India', 'England'])).toBeUndefined();
  });
  test('points table sorted by points then wins', () => {
    const t = toTable('IPL 2026', [
      { teamname: 'Chennai Super Kings', matches: 14, wins: 7, loss: 7 },
      { teamname: 'Mumbai Indians', shortname: 'MI', matches: 14, wins: 9, loss: 5 },
      { teamname: 'Delhi Capitals', matches: 14, wins: 6, loss: 6, nr: 2 },
    ]);
    expect(t.rows.map((r) => r.short ?? r.team)).toEqual(['MI', 'Chennai Super Kings', 'Delhi Capitals']);
    expect(t.rows[0]!.pts).toBe(18);
    expect(t.rows[2]!.pts).toBe(14);
  });
});

describe('news digest', () => {
  const items: NewsItem[] = [
    { id: 'a', title: 'Chip maker beats estimates', url: 'https://a', source: 'The Verge', publishedAt: '2026-11-08T01:00:00Z', cat: 'ai' },
    { id: 'b', title: 'Chip maker posts record quarter', url: 'https://b', source: 'TechCrunch', publishedAt: '2026-11-08T02:00:00Z', cat: 'ai', image: 'https://img/b.jpg' },
    { id: 'c', title: 'New phone launched', url: 'https://c', source: 'The Verge', publishedAt: '2026-11-08T00:00:00Z', cat: 'ai' },
  ];
  test('merges duplicates, keeps image and every source, ignores bad indexes', () => {
    const s = storiesFromAi([
      { title: 'Chip maker has a record quarter', summary: 'Results beat estimates.', items: [0, 1] },
      { title: 'Bad', items: [99] },
      { title: 'Repeat', items: [1] },
      { title: 'New phone launched', items: [2] },
    ], items);
    expect(s).toHaveLength(2);
    expect(s[0]!.image).toBe('https://img/b.jpg');
    expect(s[0]!.sources.map((x) => x.source)).toEqual(['The Verge', 'TechCrunch']);
    expect(s[0]!.publishedAt).toBe('2026-11-08T02:00:00Z');
  });
  test('feed parser reads description and https image', () => {
    const xml = `<rss><channel><item><title>Hello</title><link>https://x/1</link><pubDate>Sat, 07 Nov 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>Short <b>summary</b> here.</p>]]></description>
      <media:content url="https://img/1.jpg" medium="image"/></item>
      <item><title>Insecure</title><link>https://x/2</link><enclosure url="http://img/2.jpg" type="image/jpeg"/></item></channel></rss>`;
    const [a, b] = parseFeed(xml, 'ai', 'Test');
    expect(a!.desc).toBe('Short summary here.');
    expect(a!.image).toBe('https://img/1.jpg');
    expect(b!.image).toBeUndefined();
  });
});

import { normalize, score } from '../src/services/x.ts';
describe('x posts', () => {
  test('normalises an OpenCLI row with photo and video', () => {
    const p = normalize({ id: '1987', author: 'mufaddal_vohra', text: 'Rohit 100* 🔥 https://t.co/abc', likes: 5200, retweets: '410', replies: 88, views: 120000,
      created_at: 'Sat Nov 07 10:00:00 +0000 2026', url: 'https://x.com/mufaddal_vohra/status/1987',
      media_urls: ['https://pbs.twimg.com/media/a.jpg', 'https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/b.mp4?tag=12'],
      media_posters: ['https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/b.jpg'] })!;
    expect(p.text).toBe('Rohit 100* 🔥');
    expect(p.retweets).toBe(410);
    expect(p.media.map((m) => m.type)).toEqual(['photo', 'video']);
    expect(p.media[1]!.poster).toContain('thumb');
    expect(p.createdAt).toBe('2026-11-07T10:00:00.000Z');
  });
  test('rejects rows without a numeric id or author, drops http media', () => {
    expect(normalize({ id: 'abc', author: 'x' })).toBeNull();
  });
  test('normalize: Agent-Reach string-encoded fields', () => {
    const p = normalize({ id: '2119124200497811804', author: 'mufaddal_vohra', text: 'Parag stays captain https://t.co/5RcKRhWIDe', likes: '3945', views: '72026',
      created_at: 'Sat Nov 07 17:45:55 +0000 2026', media_urls: "['https://pbs.twimg.com/media/A.jpg', 'https://video.twimg.com/v/B.mp4']",
      media_posters: "['https://pbs.twimg.com/media/A.jpg', 'https://pbs.twimg.com/p/B.jpg']", quoted_tweet: 'None' })!;
    expect(p.likes).toBe(3945);
    expect(p.text).toBe('Parag stays captain');
    expect(p.createdAt).toBe('2026-11-07T17:45:55.000Z');
    expect(p.media).toEqual([{ type: 'photo', url: 'https://pbs.twimg.com/media/A.jpg' }, { type: 'video', url: 'https://video.twimg.com/v/B.mp4', poster: 'https://pbs.twimg.com/p/B.jpg' }]);
    expect(p.quoted).toBeUndefined();
    expect(normalize({ id: '1', author: 'a', media_urls: ['http://insecure/a.jpg'] })!.media).toEqual([]);
  });
  test('engagement score decays with age', () => {
    const now = Date.parse('2026-11-08T00:00:00Z');
    const base = { id: '1', author: 'a', text: '', url: '', likes: 1000, retweets: 0, replies: 0, views: 0, media: [] };
    expect(score({ ...base, createdAt: '2026-11-07T23:00:00Z' }, now)).toBeGreaterThan(score({ ...base, createdAt: '2026-11-06T00:00:00Z' }, now));
  });
});

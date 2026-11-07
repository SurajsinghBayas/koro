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
    { id: 'a', title: 'Chip maker beats estimates', url: 'https://a', source: 'The Verge', publishedAt: '2026-11-08T01:00:00Z', cat: 'tech' },
    { id: 'b', title: 'Chip maker posts record quarter', url: 'https://b', source: 'TechCrunch', publishedAt: '2026-11-08T02:00:00Z', cat: 'tech', image: 'https://img/b.jpg' },
    { id: 'c', title: 'New phone launched', url: 'https://c', source: 'The Verge', publishedAt: '2026-11-08T00:00:00Z', cat: 'tech' },
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
    const [a, b] = parseFeed(xml, 'tech', 'Test');
    expect(a!.desc).toBe('Short summary here.');
    expect(a!.image).toBe('https://img/1.jpg');
    expect(b!.image).toBeUndefined();
  });
});

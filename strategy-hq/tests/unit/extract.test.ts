import { describe, it, expect } from 'vitest';
import { numbersIn, coverage, groundCard, readWithRules, publishDecision, type Card, type SourceItem } from '@/lib/workers/extract';
import { parseFeed, articleText, GTA6_RE } from '@/lib/workers/sources';

const src = (title: string, body = ''): SourceItem => ({ title, body, url: 'https://www.reddit.com/r/GTA6/x', sourceKind: 'reddit' });
const card = (over: Partial<Card> = {}): Card => ({
  category: 'vehicle', subject: 'Zentorno', title: 't', summary: 's', landmark: null, region: null, how_to: [], payout_min: null, payout_max: null,
  price: null, is_free: null, chapter: null, spoiler: 'none', availability: null, make_model: null, vehicle_class: null, weapon_type: null,
  unlock_condition: null, respawns: null, confidence: 'high', ...over,
});

describe('grounding', () => {
  it('reads money in all the ways people write it', () => {
    expect([...numbersIn('$25,000 and 50k plus 1.5 million and 300 thousand')].sort((a, b) => a - b)).toEqual([25000, 50000, 300000, 1500000]);
  });
  it('keeps only facts present in the source', () => {
    const s = src('Zentorno at the marina', 'Parked at Vice City marina pier, worth $40,000 if sold. Chapter 2 needed.');
    const g = groundCard(card({ landmark: 'Vice City marina pier', payout_min: 40000, payout_max: 75000, chapter: 2, price: 1 }), s)!;
    expect(g.landmark).toBe('Vice City marina pier');
    expect(g.payout_min).toBe(40000);
    expect(g.payout_max).toBeNull();          // 75,000 never stated
    expect(g.chapter).toBe(2);
    const h = groundCard(card({ landmark: 'Downtown airport hangar', chapter: 4 }), s)!;
    expect(h.landmark).toBeNull();            // not in the post
    expect(h.chapter).toBeNull();             // chapter 4 never stated
  });
  it('drops a card whose subject the source never mentions', () => {
    expect(groundCard(card({ subject: 'Golden Railgun' }), src('Zentorno at the marina'))).toBeNull();
  });
  it('removes steps that contain invented amounts', () => {
    const g = groundCard(card({ how_to: ['Pay $9,000 to the guard', 'Climb the fence'] }), src('Zentorno behind the fence'))!;
    expect(g.how_to).toEqual(['Climb the fence']);
  });
  it('a source spoiler flag always wins over the model', () => {
    const s = { ...src('Zentorno after the big mission'), spoilerFlag: true };
    expect(groundCard(card(), s)!.spoiler).toBe('story');
  });
  it('coverage ignores filler words', () => {
    expect(coverage('behind the lifeguard tower', 'lifeguard tower at the beach')).toBe(1);
  });
});

describe('rules reader (no AI key)', () => {
  it('turns a relevant post into one cautious card and ignores questions', () => {
    expect(readWithRules(src('Free Zentorno supercar parked at the marina')).cards[0]).toMatchObject({ category: 'vehicle', spoiler: 'none' });
    expect(readWithRules(src('Where is the best car?')).cards).toHaveLength(0);
    expect(readWithRules(src('Cash grind: best robbery job for money')).cards[0].category).toBe('money_activity');
    expect(readWithRules(src('GTA Online free car bonus', 'GTA Online only')).game).toBe('GTA_ONLINE');
  });
});

describe('publish policy', () => {
  it('auto-publishes plain finds; holds story spoilers of unknown chapter and low confidence', () => {
    expect(publishDecision(card(), 'GTA_VI', true)).toBe('published');
    expect(publishDecision(card({ spoiler: 'story' }), 'GTA_VI', true)).toBe('in_review');
    expect(publishDecision(card({ spoiler: 'story', chapter: 3 }), 'GTA_VI', true)).toBe('published');   // the chapter gate then hides it below Ch 3
    expect(publishDecision(card({ confidence: 'low' }), 'GTA_VI', true)).toBe('in_review');
    expect(publishDecision(card(), 'GTA_VI', false)).toBe('in_review');
  });
});

describe('feeds', () => {
  it('parses RSS and Atom, keeps https links, detects GTA VI items', () => {
    const rss = '<rss><channel><item><title><![CDATA[GTA 6 money guide]]></title><link>https://a.example/x</link><pubDate>Mon, 23 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>';
    const atom = '<feed><entry><title>Leonida map secrets</title><link href="https://b.example/y"/><updated>2026-11-23T10:00:00Z</updated></entry></feed>';
    expect(parseFeed(rss)[0]).toMatchObject({ title: 'GTA 6 money guide', link: 'https://a.example/x' });
    expect(parseFeed(atom)[0].link).toBe('https://b.example/y');
    expect(GTA6_RE.test('Grand Theft Auto VI review')).toBe(true);
    expect(GTA6_RE.test('GTA V mods')).toBe(false);
  });
  it('extracts article text without navigation or scripts', () => {
    const t = articleText('<nav>menu</nav><article><p>Micro SMG on the roof.</p><script>x()</script></article><footer>f</footer>');
    expect(t).toContain('Micro SMG on the roof.');
    expect(t).not.toMatch(/menu|x\(\)/);
  });
});

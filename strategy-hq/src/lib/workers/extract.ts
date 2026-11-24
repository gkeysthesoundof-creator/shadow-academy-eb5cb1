import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { routeText, looksLikeStorySpoiler, chapterMentioned } from '../domain/router';
import type { FindingCategory } from '../domain/scouts';

/**
 * Turns a community post / guide article / official article into scout cards.
 *
 * Two readers:
 *  - Claude Haiku (when a key is configured): reads the text and writes structured cards.
 *  - Deterministic fallback (always available): one card per relevant post from its title.
 *
 * Every model-written card is GROUNDED against the source text before use: numbers,
 * landmarks and chapters that do not appear in the source are removed, and a card whose
 * subject is not in the source is dropped. The model cannot add facts the source lacks.
 */
export const CARD_CATEGORIES = ['vehicle', 'weapon', 'cash_pickup', 'money_activity', 'secret', 'collectible', 'mission_tip', 'reward', 'update'] as const;

const CardSchema = z.object({
  category: z.enum(CARD_CATEGORIES),
  subject: z.string().describe('Exact name of the car, weapon, item, activity or reward as written in the source'),
  title: z.string().describe('Short spoiler-free card title, max 90 characters'),
  summary: z.string().describe('One or two sentence paraphrase in your own words, max 280 characters. No story spoilers.'),
  landmark: z.string().nullable().describe('Physical location exactly as described by the source, or null if not stated'),
  region: z.string().nullable(),
  how_to: z.array(z.string()).describe('Up to 6 short steps, only if the source gives them'),
  payout_min: z.number().nullable().describe('Only a dollar amount stated in the source'),
  payout_max: z.number().nullable(),
  price: z.number().nullable(),
  is_free: z.boolean().nullable(),
  chapter: z.number().nullable().describe('Only if the source names the chapter'),
  spoiler: z.enum(['none', 'mild', 'story']).describe('story = reveals plot, characters\' fates or mission outcomes'),
  availability: z.string().nullable().describe('e.g. one-time, respawns, limited-time — only if stated'),
  make_model: z.string().nullable(), vehicle_class: z.string().nullable(), weapon_type: z.string().nullable(),
  unlock_condition: z.string().nullable(), respawns: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});
export const ExtractionSchema = z.object({
  relevant: z.boolean().describe('Does the text contain practical GTA VI gameplay information?'),
  game: z.enum(['GTA_VI', 'GTA_ONLINE', 'unclear']),
  cards: z.array(CardSchema),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Card = z.infer<typeof CardSchema>;

export interface SourceItem {
  title: string; body: string; url: string; sourceKind: 'reddit' | 'guide' | 'rockstar' | 'other';
  spoilerFlag?: boolean; author?: string | null;
}

const SYSTEM = [
  'You extract practical GTA VI gameplay facts from one source text for a spoiler-safe strategy guide.',
  'Use ONLY facts stated in the text. Never add locations, prices, payouts, chapters or steps from your own knowledge.',
  'If a fact is not in the text, use null (or an empty list). Write summaries in your own words; never copy long passages.',
  'Separate GTA Online from GTA VI story mode. If the text is about GTA Online, set game to GTA_ONLINE.',
  'Keep titles and summaries free of story spoilers; mark spoiler "story" when the text reveals plot, character fates or mission outcomes.',
  'Categories: vehicle, weapon, cash_pickup (money lying in the world: stashes, safes, bags), money_activity (jobs, robberies, ways to earn),',
  'secret, collectible, mission_tip, reward (bonuses, free items), update (patches, news).',
  'Return at most 15 cards. Opinion, memes, questions without answers, and rumors about unreleased content are not relevant.',
].join('\n');

/* --------------------------------- grounding -------------------------------- */

/** All dollar-ish numbers mentioned in a text: 25,000 / $25k / 1.5 million → numbers. */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  const re = /\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|m|million|thousand)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let n = Number(m[1].replace(/,/g, ''));
    const suf = (m[2] ?? '').toLowerCase();
    if (suf === 'k' || suf === 'thousand') n *= 1_000;
    if (suf === 'm' || suf === 'million') n *= 1_000_000;
    if (Number.isFinite(n)) out.add(Math.round(n));
  }
  return out;
}

const STOP = new Set(['the', 'and', 'near', 'with', 'from', 'that', 'this', 'into', 'onto', 'behind', 'next', 'inside', 'outside', 'across', 'located', 'location', 'area', 'side']);
function tokens(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
}
/** Share of a phrase's meaningful words that appear in the text. */
export function coverage(phrase: string, text: string): number {
  const t = tokens(phrase); if (!t.length) return 0;
  const hay = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `;
  return t.filter((w) => hay.includes(` ${w}`)).length / t.length;
}

export function groundCard(card: Card, source: SourceItem): Card | null {
  const text = `${source.title}\n${source.body}`;
  if (coverage(card.subject, text) < 0.5) return null;                 // subject must come from the source
  const nums = numbersIn(text);
  const keep = (n: number | null) => (n != null && nums.has(Math.round(n)) ? n : null);
  const stated = chapterMentioned(text);
  const g: Card = {
    ...card,
    title: card.title.slice(0, 90), summary: card.summary.slice(0, 280),
    landmark: card.landmark && coverage(card.landmark, text) >= 0.6 ? card.landmark.slice(0, 200) : null,
    region: card.region && coverage(card.region, text) >= 0.6 ? card.region.slice(0, 80) : null,
    payout_min: keep(card.payout_min), payout_max: keep(card.payout_max), price: keep(card.price),
    chapter: card.chapter != null && stated === card.chapter ? card.chapter : null,
    how_to: card.how_to.slice(0, 6).map((s) => s.slice(0, 200))
      .filter((s) => [...numbersIn(s)].every((n) => n < 10 || nums.has(n))),  // no invented amounts inside steps
  };
  if (g.payout_min != null && g.payout_max != null && g.payout_min > g.payout_max) [g.payout_min, g.payout_max] = [g.payout_max, g.payout_min];
  // Spoiler: the source's own spoiler flag or spoiler language always wins over the model.
  if (source.spoilerFlag || looksLikeStorySpoiler(`${g.title} ${g.summary}`)) g.spoiler = 'story';
  return g;
}

/* --------------------------------- readers ---------------------------------- */

export type ParseFn = (params: Record<string, unknown>) => Promise<{
  parsed_output: Extraction | null; stop_reason: string | null;
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
}>;

export function defaultParse(apiKey: string): ParseFn {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  return (params) => client.messages.parse(params as never) as never;
}

export interface ReadResult { game: 'GTA_VI' | 'GTA_ONLINE' | 'unclear'; cards: Card[]; reader: 'haiku' | 'rules'; usage?: { input_tokens?: number | null; output_tokens?: number | null } | null }

export async function readWithModel(source: SourceItem, parse: ParseFn, model: string): Promise<ReadResult | null> {
  const body = source.body.slice(0, 24_000);
  const res = await parse({
    model, max_tokens: 4096, output_config: { effort: 'low', format: zodOutputFormat(ExtractionSchema) }, system: SYSTEM,
    messages: [{ role: 'user', content: `Source (${source.sourceKind}): ${source.url}\nTitle: ${source.title}\n\n${body}` }],
  });
  if (res.stop_reason === 'refusal' || !res.parsed_output) return null;
  const out = res.parsed_output;
  if (!out.relevant) return { game: out.game, cards: [], reader: 'haiku', usage: res.usage };
  const cards = out.cards.slice(0, 15).map((c) => groundCard(c, source)).filter((c): c is Card => !!c);
  return { game: out.game, cards, reader: 'haiku', usage: res.usage };
}

const ROUTE_TO_CATEGORY: [string, FindingCategory][] = [
  ['vehicle_scout', 'vehicle'], ['weapons_scout', 'weapon'], ['money_scout', 'cash_pickup'],
  ['secrets_scout', 'secret'], ['strategy_scout', 'mission_tip'], ['rewards_scout', 'reward'],
];

/** No model available: one cautious card per relevant post, built from its title only. */
export function readWithRules(source: SourceItem): ReadResult {
  const text = `${source.title} ${source.body.slice(0, 2000)}`;
  const online = /\bgta online\b/i.test(text) && !/\bgta (vi|6)\b/i.test(text);
  const scouts = routeText(source.title, source.body.slice(0, 2000));
  const hit = ROUTE_TO_CATEGORY.find(([s]) => scouts.includes(s as never));
  if (!hit || /\?\s*$/.test(source.title.trim())) return { game: online ? 'GTA_ONLINE' : 'GTA_VI', cards: [], reader: 'rules' };  // questions aren't intel
  let category = hit[1] as Card['category'];
  if (category === 'cash_pickup' && /\b(job|heist|robbery|business|grind|per hour|farm)\b/i.test(text)) category = 'money_activity';
  const clean = source.title.replace(/\s+/g, ' ').trim();
  const spoiler: Card['spoiler'] = source.spoilerFlag || looksLikeStorySpoiler(text) ? 'story' : category === 'mission_tip' ? 'mild' : 'none';
  const n = [...numbersIn(text)].filter((x) => x >= 100).sort((a, b) => a - b);
  return {
    game: online ? 'GTA_ONLINE' : 'GTA_VI', reader: 'rules',
    cards: [{
      category, subject: clean.slice(0, 120), title: clean.slice(0, 90),
      summary: `${source.sourceKind === 'reddit' ? 'Community report' : 'Guide'} (not yet confirmed): "${clean.slice(0, 160)}". Open the source for the full details.`,
      landmark: null, region: null, how_to: [],
      payout_min: category.startsWith('cash') || category === 'money_activity' ? (n[0] ?? null) : null,
      payout_max: category.startsWith('cash') || category === 'money_activity' ? (n.at(-1) ?? null) : null,
      price: null, is_free: /\bfree\b/i.test(text) ? true : null, chapter: chapterMentioned(text), spoiler,
      availability: null, make_model: null, vehicle_class: null, weapon_type: null, unlock_condition: null, respawns: null,
      confidence: 'medium',
    }],
  };
}

/** Auto-publish policy: populated by default, but never story spoilers of unknown chapter and never low confidence. */
export function publishDecision(card: Card, game: ReadResult['game'], autoPublish: boolean): 'published' | 'in_review' {
  if (!autoPublish) return 'in_review';
  if (card.confidence === 'low' || game === 'unclear') return 'in_review';
  if (card.spoiler !== 'none' && card.chapter == null) return 'in_review';
  return 'published';
}

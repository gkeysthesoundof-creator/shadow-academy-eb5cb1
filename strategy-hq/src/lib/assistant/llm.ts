import Anthropic from '@anthropic-ai/sdk';
import { asService, asUser } from '../db';
import { config } from '../config';
import { localParts } from '../domain/schedule';
import { assertAllVisible } from '../domain/spoilers';
import type { FindingRow } from '../repo/intel';
import { buildLocalAnswer, retrieveFindings, toCitation, type Citation, type LocalAnswer } from './retrieval';

/**
 * Optional LLM layer. It is used ONLY when every gate passes (key, owner flag,
 * user quota, platform budget); otherwise the response is the local-search answer
 * plus a plain reason. The model only ever sees findings already retrieved as the
 * user, and its output is scrubbed so it can never cite a finding outside that set.
 */

/** USD per million tokens. micros = USD x 1e6, so micros per token == USD per million tokens. */
export const PRICES: Record<string, { in: number; out: number }> = {
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
};

export function costMicros(model: string, usage: { input_tokens?: number | null; output_tokens?: number | null }): number {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  const p = PRICES[key ?? 'claude-opus-5-5']; // unknown model: bill at the highest known rate
  return Math.ceil((usage.input_tokens ?? 0) * p.in + (usage.output_tokens ?? 0) * p.out);
}

export const SYSTEM_RULES = [
  'You are the Strategy HQ game coach for GTA VI (an independent, unofficial guide).',
  'Answer ONLY from the findings JSON in the user message. If the answer is not in that data, say "unknown". Never guess or use outside knowledge.',
  'Cite the finding id in square brackets, like [<id>], for every claim. Cite only ids that appear in the data.',
  'Never reveal, hint at or speculate about anything beyond the data given; the user is spoiler-protected at their chapter.',
  'Mention PS5 controls only if they appear in the data.',
  'Never claim a GTA Online offer or reward applies to GTA VI.',
  'Be short and practical: steps first, no filler.',
].join('\n');

export interface LlmMessage {
  stop_reason: string | null;
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
}
/** Injectable so tests never touch the network. */
export type CreateFn = (params: Record<string, unknown>) => Promise<LlmMessage>;

export function defaultCreate(apiKey: string): CreateFn {
  const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });
  return (params) => client.beta.messages.create(params as never) as unknown as Promise<LlmMessage>;
}

function findingPayload(f: FindingRow) {
  return {
    id: f.id, title: f.title, category: f.category, verification: f.verification, summary: f.summary,
    how_to: f.how_to, prerequisites: f.prerequisites, hazards: f.hazards, landmark: f.landmark, region: f.region,
    chapter_min: f.chapter_min, is_free: f.is_free, payout_min: f.payout_min, payout_max: f.payout_max, availability: f.availability,
    game_scope: f.game_scope,
  };
}

export type LlmOutcome =
  | { ok: true; text: string; citations: Citation[]; costMicros: number; model: string }
  | { ok: false; reason: string; costMicros: number };

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Remove any id-looking citation that is not in the retrieved set (and the
 * bracket around it) and return only citations for retrieved findings the text names.
 */
export function renderAnswer(text: string, rows: FindingRow[]): { text: string; citations: Citation[] } {
  const known = new Map(rows.map((r) => [r.id.toLowerCase(), r]));
  const cited = new Set<string>();
  let out = text.replace(/\[([^\]]*)\]/g, (m, inner: string) => {
    const ids = inner.match(UUID_RE);
    if (!ids) return m;
    const good = ids.filter((i) => known.has(i.toLowerCase()));
    good.forEach((i) => cited.add(i.toLowerCase()));
    return good.length ? `[${good.map((i) => i.toLowerCase().slice(0, 8)).join(', ')}]` : '';
  });
  out = out.replace(UUID_RE, (i) => {
    if (known.has(i.toLowerCase())) { cited.add(i.toLowerCase()); return i.toLowerCase().slice(0, 8); }
    return '';
  }).replace(/[ \t]{2,}/g, ' ').trim();
  return { text: out, citations: rows.filter((r) => cited.has(r.id.toLowerCase())).map(toCitation) };
}

export async function askLlm(args: {
  question: string; rows: FindingRow[]; chapter: number; noVideo: boolean; model: string; create: CreateFn;
}): Promise<LlmOutcome> {
  assertAllVisible(args.rows, args.chapter);
  const prompt = `Question: ${args.question}\n${args.noVideo ? 'The player does not want video; give written steps.\n' : ''}`
    + `Player chapter: ${args.chapter}\nFindings (the only allowed source):\n${JSON.stringify(args.rows.map(findingPayload))}`;
  let msg: LlmMessage;
  try {
    msg = await args.create({
      model: args.model, max_tokens: 1024, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low' }, system: SYSTEM_RULES, messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, reason: 'The AI service is rate limited right now.', costMicros: 0 };
    if (e instanceof Anthropic.APIError) return { ok: false, reason: `The AI service returned an error (${e.status ?? 'network'}).`, costMicros: 0 };
    return { ok: false, reason: 'The AI service could not be reached.', costMicros: 0 };
  }
  const cost = msg.usage ? costMicros(args.model, msg.usage) : 0;
  if (msg.stop_reason === 'refusal') return { ok: false, reason: 'The AI model declined this request.', costMicros: cost };
  let text = '';
  for (const block of msg.content ?? []) if (block.type === 'text' && typeof block.text === 'string') text += block.text;
  text = text.trim();
  if (!text) return { ok: false, reason: 'The AI model returned no text.', costMicros: cost };
  assertAllVisible(args.rows, args.chapter); // second check right before anything is returned
  const r = renderAnswer(text, args.rows);
  if (!r.text) return { ok: false, reason: 'The AI model returned no usable text.', costMicros: cost };
  return { ok: true, text: r.text, citations: r.citations, costMicros: cost, model: args.model };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
export interface AssistResponse {
  mode: 'local' | 'llm';
  modeLabel: string;
  reason?: string;
  answer: string;
  noMatch: boolean;
  citations: Citation[];
  /** Local-search cards, always included so the answer can be checked against sources. */
  matches: Citation[];
}

export interface AssistDeps {
  apiKey?: string | null; // undefined = config
  create?: CreateFn;
  now?: Date;
  model?: string;
  budgetMicros?: number;
}

async function budgetUsed(day: string): Promise<number> {
  const r = await asService((c) => c.query(`select cost_micros from platform_budget where day = $1 and meter = 'llm'`, [day]));
  return Number(r.rows[0]?.cost_micros ?? 0);
}

async function recordCost(day: string, micros: number) {
  await asService((c) => c.query(
    `insert into platform_budget(day, meter, cost_micros, calls) values ($1,'llm',$2,1)
     on conflict (day, meter) do update set cost_micros = platform_budget.cost_micros + excluded.cost_micros, calls = platform_budget.calls + 1`,
    [day, Math.round(micros)]));
}

const local = (rows: FindingRow[], reason?: string): AssistResponse => {
  const a: LocalAnswer = buildLocalAnswer(rows);
  return { mode: 'local', modeLabel: 'Local search (no AI)', reason, answer: a.text, noMatch: a.noMatch, citations: a.citations, matches: a.citations };
};

/** Decide, in order, whether the LLM may be used. Quota is consumed LAST so a blocked gate never burns it. */
export async function llmGate(userId: string, day: string, deps: AssistDeps): Promise<{ ok: true } | { ok: false; reason: string }> {
  const key = deps.apiKey === undefined ? config.anthropicApiKey : deps.apiKey;
  if (!key) return { ok: false, reason: 'AI answers are not configured (no API key).' };
  const flag = await asUser(userId, (c) => c.query(`select enabled from feature_flags where key = 'llm_assistant'`));
  if (flag.rows[0]?.enabled !== true) return { ok: false, reason: 'AI answers are switched off by the owner.' };
  const budget = deps.budgetMicros ?? config.llmDailyBudgetMicros;
  if ((await budgetUsed(day)) >= budget) return { ok: false, reason: "Today's AI budget is used up." };
  const ent = await asUser(userId, (c) => c.query(`select limit_value from entitlements where feature = 'assistant_queries_daily'`));
  if (!ent.rowCount) return { ok: false, reason: 'Your plan does not include AI answers.' };
  const limit: number | null = ent.rows[0].limit_value;
  const ok = await asUser(userId, (c) => c.query(`select consume_usage('assistant_queries_daily', $1, $2) ok`, [limit, day]));
  if (!ok.rows[0].ok) return { ok: false, reason: 'You have used your AI answers for today.' };
  return { ok: true };
}

export async function answerQuestion(
  p: { userId: string; chapter: number; question: string; noVideo?: boolean },
  deps: AssistDeps = {},
): Promise<AssistResponse> {
  const rows = await retrieveFindings(p.userId, p.question, 5);
  const base = local(rows);
  if (!rows.length) return { ...base, reason: 'No matching findings, so no AI call was made.' };
  const day = localParts(deps.now ?? new Date(), config.timezone).date;
  const gate = await llmGate(p.userId, day, deps);
  if (!gate.ok) return { ...base, reason: gate.reason };
  const key = deps.apiKey === undefined ? config.anthropicApiKey : deps.apiKey;
  const create = deps.create ?? defaultCreate(key as string);
  const out = await askLlm({
    question: p.question, rows, chapter: p.chapter, noVideo: !!p.noVideo, model: deps.model ?? config.assistantModel, create,
  });
  if (out.costMicros > 0) await recordCost(day, out.costMicros).catch(() => {});
  if (!out.ok) return { ...base, reason: `${out.reason} Showing local search instead.` };
  return { mode: 'llm', modeLabel: `AI answer (${out.model}) from your findings`, answer: out.text, noMatch: false, citations: out.citations, matches: base.matches };
}

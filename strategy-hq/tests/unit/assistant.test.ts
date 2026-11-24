import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { askLlm, costMicros, renderAnswer, llmGate, SYSTEM_RULES, type CreateFn } from '@/lib/assistant/llm';
import { buildLocalAnswer, keywordQuery, NO_MATCH_MESSAGE } from '@/lib/assistant/retrieval';
import type { FindingRow } from '@/lib/repo/intel';

const row = (id: string, title: string, over: Partial<FindingRow> = {}): FindingRow => ({
  id, game_scope: 'GTA_VI', category: 'vehicle', title, summary: 'sum', why_it_matters: null, source_label: null, has_official: null, how_to: ['step one'], prerequisites: null, hazards: null,
  risk: 'low', chapter_min: 1, chapter_max: null, spoiler_level: 'none', verification: 'verified', lifecycle: 'active', publication_status: 'published',
  is_free: null, payout_min: null, payout_max: null, price: null, availability: null, patch_version: null, attributes: {},
  first_seen_at: '', last_confirmed_at: null, last_checked_at: null, published_at: null, updated_at: '', landmark: 'Somewhere', region: null,
  place_id: null, pin_id: null, pin_precision: null, hunt_status: null, evidence_count: 1, scouts: [], ...over,
});
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const OUTSIDE = '99999999-9999-4999-8999-999999999999';
const rows = [row(A, 'Official map'), row(B, 'Second')];

const ok = (text: string, usage = { input_tokens: 1000, output_tokens: 100 }): CreateFn => async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage });

describe('assistant LLM layer (no network)', () => {
  it('refusal falls back (ok:false) and still reports cost', async () => {
    const create: CreateFn = async () => ({ stop_reason: 'refusal', content: [], usage: { input_tokens: 500, output_tokens: 0 } });
    const r = await askLlm({ question: 'q', rows, chapter: 1, noVideo: false, model: 'claude-opus-5-5', create });
    expect(r.ok).toBe(false);
    expect(r.costMicros).toBe(2000);
    if (!r.ok) expect(r.reason).toMatch(/declined/);
  });

  it('missing API key -> local with a reason, before any DB or network use', async () => {
    const g = await llmGate('00000000-0000-4000-8000-000000000000', '2026-01-01', { apiKey: null });
    expect(g).toEqual({ ok: false, reason: expect.stringMatching(/no API key/) });
    const local = buildLocalAnswer(rows);
    expect(local.citations).toHaveLength(2);
    expect(buildLocalAnswer([]).text).toBe(NO_MATCH_MESSAGE);
  });

  it('API errors become a fallback reason, never a throw', async () => {
    const rl: CreateFn = async () => { throw new Anthropic.RateLimitError(429, { type: 'error' }, 'slow down', new Headers()); };
    const r = await askLlm({ question: 'q', rows, chapter: 1, noVideo: false, model: 'm', create: rl });
    expect(r.ok).toBe(false);
    const boom: CreateFn = async () => { throw new Error('socket'); };
    expect((await askLlm({ question: 'q', rows, chapter: 1, noVideo: false, model: 'm', create: boom })).ok).toBe(false);
  });

  it('never renders a finding that is not in the retrieved set', async () => {
    const r = await askLlm({
      question: 'q', rows, chapter: 1, noVideo: true, model: 'claude-opus-5-5',
      create: ok(`Go there [${A}]. Also try [${OUTSIDE}] and ${OUTSIDE} then [${B}, ${OUTSIDE}].`),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toContain(OUTSIDE);
      expect(r.text).not.toContain('99999999');
      expect(r.citations.map((c) => c.id).sort()).toEqual([A, B]);
    }
    expect(renderAnswer(`only [${OUTSIDE}]`, rows).citations).toHaveLength(0);
  });

  it('blocks rows above the player chapter and sends the safe request shape', async () => {
    await expect(askLlm({ question: 'q', rows: [row(A, 'x', { chapter_min: 5 })], chapter: 1, noVideo: false, model: 'm', create: ok('hi') })).rejects.toThrow(/spoiler gate/);
    let seen: Record<string, unknown> = {};
    await askLlm({ question: 'q', rows, chapter: 1, noVideo: false, model: 'claude-opus-5-5', create: async (p) => { seen = p; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }; } });
    expect(seen).toMatchObject({ max_tokens: 1024, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low' }, system: SYSTEM_RULES });
    for (const k of ['thinking', 'temperature', 'top_p', 'budget_tokens']) expect(seen).not.toHaveProperty(k);
    expect(JSON.stringify(seen)).not.toContain('"thinking"');
  });

  it('computes cost micros per model', () => {
    expect(costMicros('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(24_000_000);
    expect(costMicros('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 1000 })).toBe(12_000);
    expect(costMicros('claude-haiku-5-5', { input_tokens: 100_000, output_tokens: 100_000 })).toBe(60_000);       // base tier
    expect(costMicros('claude-haiku-5-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(3_000_000); // >100K prompt tier
    expect(costMicros('claude-opus-5-5', { input_tokens: 0, output_tokens: 0 })).toBe(0);
  });

  it('turns filler words into a keyword query', () => {
    expect(keywordQuery('Where can I find money?')).toBe('money');
    expect(keywordQuery('where is the leonida map')).toBe('leonida map');
  });
});

describe('Haiku 5.5 as the coach model', () => {
  it('is the default and never sends the server-side fallback (unsupported on Haiku)', async () => {
    const { config } = await import('@/lib/config');
    expect(config.assistantModel).toBe('claude-haiku-5-5');
    let seen: Record<string, unknown> = {};
    await askLlm({ question: 'q', rows: [], chapter: 1, noVideo: false, model: 'claude-haiku-5-5',
      create: async (p) => { seen = p as Record<string, unknown>; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'unknown' }] }; } });
    expect(seen.model).toBe('claude-haiku-5-5');
    expect(seen).not.toHaveProperty('fallbacks');
    expect(seen).not.toHaveProperty('betas');
    expect(seen).not.toHaveProperty('thinking');
  });
  it('prices Haiku correctly, including the long-prompt tier', () => {
    expect(costMicros('claude-haiku-5-5', { input_tokens: 1500, output_tokens: 400 })).toBe(350);
    expect(costMicros('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 0 })).toBe(100_000);
  });
});


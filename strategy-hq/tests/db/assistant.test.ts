import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { asUser, asService, pool } from '@/lib/db';
import { resetDb, makeUser, makeFinding } from './helpers';
import { retrieveFindings } from '@/lib/assistant/retrieval';
import { answerQuestion, type CreateFn } from '@/lib/assistant/llm';

let U1: string, U5: string;
const TITLE5 = 'Zephyr Obelisk Secret Ending';
let calls = 0;
const fake: CreateFn = async () => { calls++; return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Use it.' }], usage: { input_tokens: 100, output_tokens: 10 } }; };

beforeAll(async () => {
  await resetDb();
  U1 = await makeUser('coach1', 'customer', 1);
  U5 = await makeUser('coach5', 'customer', 5);
  await makeFinding({ title: 'Quill Harbor Skiff', chapter_min: 1, spoiler: 'none' });
  await makeFinding({ title: TITLE5, chapter_min: 5, spoiler: 'story' });
  await asService(async (c) => {
    await c.query(`update feature_flags set enabled = true where key = 'llm_assistant'`);
    await c.query(`delete from entitlements where user_id = $1 and feature = 'assistant_queries_daily'`, [U5]);
    await c.query(`insert into entitlements(user_id, feature, limit_value, source) values ($1,'assistant_queries_daily',1,'plan') on conflict (user_id, feature) do update set limit_value = 1`, [U1]);
  });
});
afterAll(async () => { await pool().end(); });

describe('assistant retrieval and gates (DB)', () => {
  it('chapter 1 never retrieves a chapter 5 finding even on an exact title match', async () => {
    const r1 = await retrieveFindings(U1, TITLE5);
    expect(r1).toHaveLength(0);
    const r5 = await retrieveFindings(U5, TITLE5);
    expect(r5.map((f) => f.title)).toContain(TITLE5);
    const ok = await retrieveFindings(U1, 'Quill Harbor');
    expect(ok.map((f) => f.title)).toEqual(['Quill Harbor Skiff']);
  });

  it('LLM answers once, then quota exhausted -> local with reason; budget cost recorded', async () => {
    const deps = { apiKey: 'sk-test-not-real', create: fake, model: 'claude-opus-5-5', budgetMicros: 1_000_000 };
    const first = await answerQuestion({ userId: U1, chapter: 1, question: 'Quill Harbor' }, deps);
    expect(first.mode).toBe('llm');
    expect(calls).toBe(1);
    const second = await answerQuestion({ userId: U1, chapter: 1, question: 'Quill Harbor' }, deps);
    expect(second.mode).toBe('local');
    expect(second.reason).toMatch(/used your AI answers/);
    expect(second.citations).toHaveLength(1);
    expect(calls).toBe(1);
    const b = await asService((c) => c.query(`select cost_micros, calls from platform_budget where meter = 'llm'`));
    expect(Number(b.rows[0].cost_micros)).toBe(100 * 4 + 10 * 20);
    expect(b.rows[0].calls).toBe(1);
  });

  it('no key / flag off / no entitlement / budget spent -> local with a reason', async () => {
    const q = { userId: U5, chapter: 5, question: TITLE5 };
    expect((await answerQuestion(q, { apiKey: null, create: fake })).reason).toMatch(/no API key/);
    expect((await answerQuestion(q, { apiKey: 'k', create: fake })).reason).toMatch(/not include/);
    await asService((c) => c.query(`update feature_flags set enabled = false where key = 'llm_assistant'`));
    expect((await answerQuestion({ ...q, userId: U1, chapter: 1, question: 'Quill' }, { apiKey: 'k', create: fake })).reason).toMatch(/switched off/);
    await asService((c) => c.query(`update feature_flags set enabled = true where key = 'llm_assistant'`));
    expect((await answerQuestion({ ...q, userId: U1, chapter: 1, question: 'Quill' }, { apiKey: 'k', create: fake, budgetMicros: 10 })).reason).toMatch(/budget/);
    expect(calls).toBe(1);
  });

  it('no match -> honest no-answer without calling the model', async () => {
    const r = await answerQuestion({ userId: U1, chapter: 1, question: 'rare supercar' }, { apiKey: 'k', create: fake });
    expect(r.noMatch).toBe(true);
    expect(r.answer).toBe("I can't verify an answer for that yet. Nothing is guessed.");
    expect(calls).toBe(1);
  });

  it('screenshot rows are isolated between users', async () => {
    await asUser(U1, (c) => c.query(`insert into user_screenshots(user_id, storage_key, mime, bytes, sha256) values (app_uid(),'a/shots/1.png','image/png',10,'x')`));
    const seen = await asUser(U5, (c) => c.query('select count(*)::int n from user_screenshots'));
    expect(seen.rows[0].n).toBe(0);
    const own = await asUser(U1, (c) => c.query('select count(*)::int n from user_screenshots'));
    expect(own.rows[0].n).toBe(1);
  });
});

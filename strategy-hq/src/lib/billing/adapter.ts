import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { asService } from '../db';
import { setPlan } from '../auth/core';
import type { PlanId } from '../domain/plans';

/**
 * Provider-neutral billing boundary. No checkout is ever created here. A real
 * provider (e.g. Stripe) plugs in by mapping its events onto NormalizedEvent.
 * Webhooks are verified (HMAC-SHA256 over `${timestamp}.${body}`, 5-minute
 * tolerance), stored idempotently by (provider, event_id), and only applied
 * when the owner flag `billing_test_mode` is on. `billing_live` is locked off.
 */
export interface NormalizedEvent {
  id: string;
  type: 'subscription.activated' | 'subscription.updated' | 'subscription.canceled' | 'other';
  userId?: string;
  plan?: PlanId;
  interval?: 'month' | 'year';
  periodEnd?: string;
  testMode: boolean;
}

export function sign(secret: string, timestamp: number, body: string) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export function verifySignature(secret: string, header: string | null, body: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const t = Number(parts.t); const v1 = parts.v1;
  if (!t || !v1 || Math.abs(nowSec - t) > 300) return false;
  const expected = Buffer.from(sign(secret, t, body), 'hex');
  const got = Buffer.from(v1, 'hex');
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function normalize(raw: unknown): NormalizedEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const data = (r.data ?? {}) as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.type !== 'string') return null;
  const type = (['subscription.activated', 'subscription.updated', 'subscription.canceled'] as const).find((x) => x === r.type) ?? 'other';
  const plan = typeof data.plan === 'string' && ['free', 'plus', 'pro'].includes(data.plan) ? (data.plan as PlanId) : undefined;
  return {
    id: r.id, type, plan, userId: typeof data.user_id === 'string' ? data.user_id : undefined,
    interval: data.interval === 'year' ? 'year' : data.interval === 'month' ? 'month' : undefined,
    periodEnd: typeof data.period_end === 'string' ? data.period_end : undefined,
    testMode: r.livemode !== true,
  };
}

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'rejected_live';

export async function applyEvent(provider: string, ev: NormalizedEvent, body: string): Promise<WebhookOutcome> {
  return asService(async (c) => {
    const ins = await c.query(
      `insert into billing_webhook_events(provider, event_id, event_type, payload_sha256) values ($1,$2,$3,$4)
       on conflict (provider, event_id) do nothing returning id`, [provider, ev.id, ev.type, createHash('sha256').update(body).digest('hex')]);
    if (!ins.rowCount) return 'duplicate';
    const flags = Object.fromEntries((await c.query(`select key, enabled from feature_flags where key in ('billing_live','billing_test_mode')`)).rows.map((r) => [r.key, r.enabled]));
    let outcome: WebhookOutcome = 'ignored';
    if (!ev.testMode && !flags.billing_live) outcome = 'rejected_live';
    else if (ev.testMode && !flags.billing_test_mode) outcome = 'ignored';
    else if (ev.userId && /^[0-9a-f-]{36}$/i.test(ev.userId)) {
      const isFounder = (await c.query(`select 1 from subscriptions where user_id = $1 and status = 'grandfathered'`, [ev.userId])).rowCount;
      if (isFounder) outcome = 'ignored';   // grandfathered founder is never downgraded by a webhook
      else if (ev.type === 'subscription.canceled') { await setPlan(c, ev.userId, 'free', 'active'); outcome = 'processed'; }
      else if ((ev.type === 'subscription.activated' || ev.type === 'subscription.updated') && ev.plan) {
        await setPlan(c, ev.userId, ev.plan, 'active');
        await c.query(`update subscriptions set provider = $2, interval = $3, current_period_end = $4, test_mode = $5 where user_id = $1 and status = 'active'`,
          [ev.userId, provider, ev.interval ?? null, ev.periodEnd ?? null, ev.testMode]);
        outcome = 'processed';
      }
    }
    await c.query(`update billing_webhook_events set status = $3, processed_at = now() where provider = $1 and event_id = $2`,
      [provider, ev.id, outcome === 'processed' ? 'processed' : 'ignored']);
    return outcome;
  });
}

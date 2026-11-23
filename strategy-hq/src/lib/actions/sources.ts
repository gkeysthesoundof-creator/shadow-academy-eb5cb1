'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../auth/session';
import { asUser } from '../db';
import { config } from '../config';
import { localParts } from '../domain/schedule';
import { runScoutPipeline } from '../workers/pipeline';

export interface RefreshState {
  ok: boolean;
  message: string;
  status?: string;
  sources?: { name: string; outcome: string; items: number; new: number; note: string }[];
  at?: string;
}

/** Manual refresh: metered by the `manual_refresh_daily` entitlement (0 or missing = not allowed). */
export async function manualRefreshAction(_prev: RefreshState | null, _form: FormData): Promise<RefreshState> {
  const user = await requireUser('/sources');
  const day = localParts(new Date(), config.timezone).date;
  const ent = await asUser(user.id, (c) => c.query(`select limit_value from entitlements where feature = 'manual_refresh_daily'`));
  if (!ent.rowCount || (ent.rows[0].limit_value !== null && ent.rows[0].limit_value <= 0)) {
    return { ok: false, message: 'Your plan does not include manual refresh.' };
  }
  const ok = await asUser(user.id, (c) => c.query(`select consume_usage('manual_refresh_daily', $1, $2) ok`, [ent.rows[0].limit_value, day]));
  if (!ok.rows[0].ok) return { ok: false, message: 'You have used your manual refreshes for today.' };
  try {
    const r = await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: `manual:${user.id}:${Date.now()}`, requestedBy: user.id });
    revalidatePath('/sources');
    return { ok: r.status !== 'failed', message: `Refresh finished with status: ${r.status}.`, status: r.status, sources: r.sources, at: new Date().toISOString() };
  } catch (e) {
    revalidatePath('/sources');
    return { ok: false, message: `Refresh failed: ${(e as Error).message.slice(0, 200)}`, status: 'failed' };
  }
}

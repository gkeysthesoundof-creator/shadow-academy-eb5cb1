import { asService } from '../db';
import { config } from '../config';
import { decideStage, localParts } from '../domain/schedule';
import { runScoutPipeline, type RunResult } from './pipeline';
import { runBriefStage } from './briefing';
import type { Fetcher } from './sources';

/**
 * One tick of the server-side scheduler (Vercel Cron / Supabase pg_cron / GitHub
 * Actions call /api/cron/tick every 15 min, UTC). The tick itself decides, in
 * America/New_York wall-clock time, whether to scan (~7:15), brief (~8:30), or refresh (every 3 h, 6 AM–midnight).
 * Idempotency keys make overlapping/parallel ticks harmless.
 */
export async function tick(opts: { now?: Date; fetcher?: Fetcher } = {}) {
  const now = opts.now ?? new Date();
  const tz = config.timezone;
  const { date } = localParts(now, tz);
  const state = await asService(async (c) => {
    const scan = (await c.query(`select id, status from ingestion_jobs where idempotency_key = $1`, [`daily_scan:${date}`])).rows[0];
    const brief = (await c.query(`select id, status from ingestion_jobs where idempotency_key = $1`, [`briefing:${date}`])).rows[0];
    return { scan, brief };
  });
  const scanDone = !!state.scan && state.scan.status !== 'running';
  const stage = decideStage({
    now, timeZone: tz, scanTime: config.scanLocalTime, briefTime: config.briefLocalTime,
    scanDoneToday: !!state.scan, briefDoneToday: !!state.brief,
  });
  if (stage === 'scan') {
    const r: RunResult = await runScoutPipeline({ kind: 'daily_scan', idempotencyKey: `daily_scan:${date}`, fetcher: opts.fetcher, now });
    return { stage, localDate: date, result: { status: r.status, sources: r.sources.length } };
  }
  if (stage === 'brief') {
    if (state.scan && !scanDone) return { stage: 'idle' as const, localDate: date, result: { waiting: 'scan still running' } };
    const claim = await asService((c) => c.query(
      `insert into ingestion_jobs(kind, idempotency_key, status) values ('briefing',$1,'running') on conflict do nothing returning id`, [`briefing:${date}`]));
    if (!claim.rowCount) return { stage: 'idle' as const, localDate: date, result: { skipped: 'brief already claimed' } };
    const out = await runBriefStage(date, { jobId: state.scan?.id ?? null, now });
    const failed = out.filter((o) => o.status === 'failed').length;
    await asService((c) => c.query(`update ingestion_jobs set status = $2, finished_at = now(), summary = $3 where id = $1`,
      [claim.rows[0].id, failed ? 'partial' : 'succeeded', JSON.stringify({ users: out.length, failed })]));
    return { stage, localDate: date, result: { users: out.length, failed } };
  }
  // Intraday refresh: keep sections current — one extra scan per 3-hour block, 6 AM–midnight local.
  const { hour } = localParts(now, tz);
  const last = (await asService((c) => c.query(`select max(started_at) t from ingestion_jobs where kind in ('daily_scan','manual_refresh')`))).rows[0]?.t;
  const stale = !last || now.getTime() - new Date(last).getTime() >= 3 * 3600_000 - 5 * 60_000;
  if (hour >= 6 && state.scan && stale) {
    const block = Math.floor(hour / 3);
    const r = await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: `scan:${date}:${block}`, fetcher: opts.fetcher, now });
    if (r.status !== 'skipped') return { stage: 'refresh' as const, localDate: date, result: { status: r.status, sources: r.sources.length } };
  }
  return { stage, localDate: date, result: {} };
}

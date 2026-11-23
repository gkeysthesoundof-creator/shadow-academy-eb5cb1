import { asService, type Tx } from '../db';
import { config } from '../config';
import { SCOUTS, type ScoutId } from '../domain/scouts';
import { routeText, looksLikeStorySpoiler, chapterMentioned } from '../domain/router';
import { computeVerification, normalizeKey, originOf, type EvidenceItem } from '../domain/evidence';
import { classifyRewardText } from '../domain/rewards';
import { ingestionAllowed, type RightsRecord } from '../domain/rights';
import { officialChangeWatch, redditNew, type Fetcher, type AdapterResult } from './sources';

/**
 * ONE shared ingestion pass feeding all ten scout lenses.
 *  1. Source stage   — fetch enabled, rights-cleared sources (Community Discovery + Rewards feeds)
 *  2. Router stage   — deterministic keyword routing of new raw items to scout lenses
 *  3. Intake stage   — new items become IN-REVIEW drafts (never auto-published); official pages
 *                      that match existing evidence mark it as system-observed
 *  4. Evidence stage — recompute verification tiers, expire past-deadline rewards
 *  5. Map stage      — audit pins (no pin without calibrated platform map)
 *  6. Scout logs     — one scout_runs row per scout with honest counts
 * Idempotent per local day; manual refreshes get their own key.
 */
export interface RunOptions {
  kind: 'daily_scan' | 'manual_refresh';
  idempotencyKey: string;
  requestedBy?: string | null;
  fetcher?: Fetcher;
  now?: Date;
}

export interface RunResult {
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  jobId: string | null;
  sources: { name: string; outcome: string; items: number; new: number; note: string }[];
  scouts: Record<string, { examined: number; added: number; updated: number; corrected: number; status: string }>;
}

export async function runScoutPipeline(opts: RunOptions): Promise<RunResult> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const job = await asService(async (c) => {
    const r = await c.query(
      `insert into ingestion_jobs(kind, idempotency_key, requested_by) values ($1,$2,$3)
       on conflict (idempotency_key) do nothing returning id`, [opts.kind, opts.idempotencyKey, opts.requestedBy ?? null]);
    return r.rows[0]?.id as string | undefined;
  });
  if (!job) return { status: 'skipped', jobId: null, sources: [], scouts: {} };

  const result: RunResult = { status: 'succeeded', jobId: job, sources: [], scouts: {} };
  const scoutStarted = new Date();
  const counts = Object.fromEntries(SCOUTS.map((s) => [s.id, { examined: 0, added: 0, updated: 0, corrected: 0, status: 'succeeded' }])) as RunResult['scouts'];

  try {
    // ---------------- 1. Source stage ----------------
    const flags = await asService((c) => c.query('select key, enabled from feature_flags')).then((r) => Object.fromEntries(r.rows.map((x) => [x.key, x.enabled])));
    const sources = await asService((c) => c.query(`
      select s.*, cr.rights_status, cr.allowed_uses, cr.expires_at from sources s left join content_rights cr on cr.id = s.rights_id
      where s.game_id = 'gta6' order by s.kind, s.name`)).then((r) => r.rows);

    for (const s of sources) {
      const rights: RightsRecord | null = s.rights_status ? { rights_status: s.rights_status, allowed_uses: s.allowed_uses, expires_at: s.expires_at } : null;
      let res: AdapterResult;
      const gate = ingestionAllowed({ kind: s.kind, rights }, config.appMode);
      if (s.access_method === 'manual') res = { outcome: 'skipped', items: [], coverage_note: 'Manual source: founder imports it personally.' };
      else if (!gate.ok) res = { outcome: 'blocked', items: [], coverage_note: `Rights gate: ${gate.reason}` };
      else if (s.access_method === 'reddit_api') {
        res = !flags.reddit_ingestion
          ? { outcome: 'not_configured', items: [], coverage_note: 'Reddit ingestion is switched off (owner flag) and/or credentials are missing.' }
          : await redditNew(String(s.canonical_url).split('/r/')[1]?.replace(/\/$/, '') ?? '', { id: config.redditClientId, secret: config.redditClientSecret, ua: config.redditUserAgent }, fetcher);
      } else if (s.access_method === 'html_change_watch') {
        res = !s.enabled || !flags.official_watch
          ? { outcome: 'skipped', items: [], coverage_note: 'Source disabled.' }
          : await officialChangeWatch(s.canonical_url, fetcher);
      } else res = { outcome: 'skipped', items: [], coverage_note: 'Unsupported access method.' };

      const inserted = await asService(async (c) => {
        let n = 0;
        for (const it of res.items) {
          const ins = await c.query(
            `insert into raw_posts(source_id, original_id, url, title, excerpt, published_at, content_hash)
             values ($1,$2,$3,$4,$5,$6,$7) on conflict (source_id, content_hash) do nothing returning id`,
            [s.id, it.original_id, it.url, it.title, it.excerpt, it.published_at, it.content_hash]);
          n += ins.rowCount ?? 0;
        }
        await c.query(
          `insert into source_runs(source_id, ingestion_job_id, finished_at, outcome, items_fetched, items_new, coverage_note, error, window_to)
           values ($1,$2, now(), $3,$4,$5,$6,$7, now())`,
          [s.id, job, res.outcome, res.items.length, n, res.coverage_note, res.error ?? null]);
        const status = res.outcome === 'success' ? 'ok' : res.outcome === 'partial' ? 'partial'
          : res.outcome === 'not_configured' ? (s.kind === 'reddit' ? 'needs_credentials' : 'not_configured')
          : res.outcome === 'blocked' ? 'blocked' : res.outcome === 'skipped' ? s.status : 'failing';
        await c.query(
          `update sources set last_check_at = now(), status = $2, last_error = $3,
             last_success_at = case when $4 then now() else last_success_at end where id = $1`,
          [s.id, status, res.error ?? null, res.outcome === 'success' || res.outcome === 'partial']);
        return n;
      });
      result.sources.push({ name: s.name, outcome: res.outcome, items: res.items.length, new: inserted, note: res.coverage_note });
    }

    // ---------------- 2+3. Router + intake ----------------
    await asService(async (c) => {
      const pending = await c.query(`select rp.*, s.kind as source_kind from raw_posts rp join sources s on s.id = rp.source_id where rp.processed_at is null limit 500`);
      for (const p of pending.rows) {
        const scouts = routeText(p.title, p.excerpt ?? '');
        if (p.source_kind === 'reddit') counts.community_scout.examined++;
        for (const sid of scouts) counts[sid].examined++;
        await intakeRawPost(c, p, scouts, counts);
        await c.query('update raw_posts set routed_scouts = $2, processed_at = now() where id = $1', [p.id, scouts]);
      }
    });

    // ---------------- 4. Evidence stage ----------------
    await asService((c) => evidencePass(c, counts, opts.now ?? new Date()));

    // ---------------- 5. Map audit ----------------
    await asService(async (c) => {
      const bad = await c.query(`delete from map_pins mp using map_assets ma where ma.id = mp.map_asset_id and (not ma.calibrated or ma.owner_user_id is not null) returning mp.id`);
      counts.map_scout.corrected += bad.rowCount ?? 0;
      const unpinned = await c.query(`select count(*)::int n from findings where place_id is not null and publication_status = 'published'
                                      and not exists (select 1 from map_pins mp where mp.place_id = findings.place_id)`);
      counts.map_scout.examined = unpinned.rows[0].n;
    });

    // ---------------- 6. Scout logs ----------------
    const failedSources = result.sources.filter((s) => s.outcome === 'failed').length;
    const okOfficial = result.sources.some((s) => (s.outcome === 'success' || s.outcome === 'partial'));
    const communityOn = result.sources.some((s) => s.name.startsWith('r/') && s.outcome === 'success');
    await asService(async (c) => {
      for (const s of SCOUTS) {
        const k = counts[s.id];
        const needsCommunity = ['vehicle_scout', 'weapons_scout', 'money_scout', 'secrets_scout', 'strategy_scout', 'community_scout'].includes(s.id);
        let status = 'succeeded'; let note = '';
        if (s.id === 'community_scout' && !communityOn) { status = 'not_configured'; note = 'No approved community API access; nothing collected.'; }
        else if (needsCommunity && !communityOn) { status = 'partial'; note = 'Community feed not configured; checked official sources + manual intake only.'; }
        else if (s.id === 'rewards_scout' && !okOfficial) { status = 'partial'; note = 'Official sources unreachable this run; existing rewards re-checked for expiry only.'; }
        if (s.id === 'briefing_scout') { status = 'succeeded'; note = 'Briefs are built in the brief stage after this scan. Email delivery is a separate owner-controlled switch.'; }
        if (s.id === 'map_scout') note = 'Audited pins. No licensed, calibrated platform map is configured, so locations stay as text landmarks.';
        k.status = status;
        await c.query(
          `insert into scout_runs(ingestion_job_id, scout_id, started_at, finished_at, status, items_examined, findings_added, findings_updated, findings_corrected, note)
           values ($1,$2,$3, now(), $4,$5,$6,$7,$8,$9)`,
          [job, s.id, scoutStarted, status, k.examined, k.added, k.updated, k.corrected, note || null]);
      }
    });
    result.scouts = counts;
    result.status = failedSources > 0 || !okOfficial ? 'partial' : 'succeeded';
  } catch (e) {
    result.status = 'failed';
    await asService((c) => c.query(`insert into scout_runs(ingestion_job_id, scout_id, finished_at, status, error) values ($1,'evidence_scout', now(),'failed',$2)`,
      [job, (e as Error).message.slice(0, 500)]));
  }
  await asService((c) => c.query(`update ingestion_jobs set status = $2, finished_at = now(), summary = $3 where id = $1`,
    [job, result.status, JSON.stringify({ sources: result.sources, scouts: result.scouts })]));
  return result;
}

/** Turn a raw item into evidence. Official pages that match existing evidence upgrade it; everything else becomes an IN-REVIEW draft. */
async function intakeRawPost(c: Tx, p: Record<string, any>, scouts: ScoutId[], counts: RunResult['scouts']) {
  const matched = await c.query(`update evidence set raw_post_id = $1, captured_at = now() where url = $2 and raw_post_id is null returning finding_id`, [p.id, p.url]);
  if (matched.rowCount) {
    for (const r of matched.rows) {
      await c.query(`update findings set last_checked_at = now(), last_confirmed_at = now() where id = $1`, [r.finding_id]);
    }
    counts.evidence_scout.updated += matched.rowCount ?? 0;
    return;
  }
  // Same URL already captured → just a content change on a known page; log it for review.
  const known = await c.query(`select 1 from evidence where url = $1 limit 1`, [p.url]);
  if (known.rowCount) {
    await c.query(`insert into admin_review_log(action, target_type, target_id, after) values ('source_page_changed','raw_post',$1,$2)`,
      [p.id, JSON.stringify({ url: p.url, title: p.title })]);
    return;
  }
  if (!scouts.length && p.source_kind !== 'rockstar') return;    // irrelevant chatter: keep raw only
  const isOfficial = p.source_kind === 'rockstar';
  if (isOfficial && !/\/newswire\/article\//.test(p.url)) {
    // Index/landing page changed: a moderator looks; no draft is invented from a page title.
    await c.query(`insert into admin_review_log(action, target_type, target_id, after) values ('source_page_changed','raw_post',$1,$2)`,
      [p.id, JSON.stringify({ url: p.url, title: p.title })]);
    return;
  }
  const category = isOfficial ? (scouts.includes('rewards_scout') ? 'reward' : 'update') : primaryCategory(scouts);
  const reward = isOfficial ? classifyRewardText(`${p.title} ${p.excerpt ?? ''}`) : null;
  const spoiler = looksLikeStorySpoiler(`${p.title} ${p.excerpt ?? ''}`) ? 'story' : isOfficial ? 'none' : 'mild';
  const dedupe = normalizeKey(category, p.title);
  const ins = await c.query(
    `insert into findings(game_id, game_scope, category, title, summary, spoiler_level, chapter_min, verification, publication_status, dedupe_key, attributes)
     values ('gta6',$1,$2,$3,$4,$5,$6,'unverified','in_review',$7,$8)
     on conflict (game_id, dedupe_key) do nothing returning id`,
    [reward?.game_scope ?? 'GTA_VI', category, p.title.slice(0, 200),
     'Auto-intake draft. A moderator must write a factual paraphrase, confirm chapter and verify before publication.',
     spoiler, chapterMentioned(`${p.title} ${p.excerpt ?? ''}`), dedupe,
     JSON.stringify({ intake_source_kind: p.source_kind, suggested_cost_type: reward?.cost_type ?? null })]);
  const fid = ins.rows[0]?.id;
  if (!fid) return;
  await c.query(
    `insert into evidence(finding_id, source_id, raw_post_id, url, title, published_at, paraphrase, evidence_type, independent_origin)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict do nothing`,
    [fid, p.source_id, p.id, p.url, p.title.slice(0, 300), p.published_at, 'Link-out reference captured by intake; not yet summarized.',
     isOfficial ? 'official' : 'community', originOf(p.url)]);
  const lenses = scouts.length ? scouts : (['rewards_scout'] as ScoutId[]);
  for (const sid of lenses) {
    await c.query('insert into scout_finding_links values ($1,$2) on conflict do nothing', [sid, fid]);
    counts[sid].added++;
  }
}

function primaryCategory(scouts: ScoutId[]): string {
  const order: [ScoutId, string][] = [['vehicle_scout', 'vehicle'], ['weapons_scout', 'weapon'], ['money_scout', 'cash_pickup'],
    ['secrets_scout', 'secret'], ['strategy_scout', 'mission_tip'], ['map_scout', 'map_location'], ['rewards_scout', 'reward']];
  return order.find(([s]) => scouts.includes(s))?.[1] ?? 'community';
}

/** Verification & Corrections Scout: recompute tiers from evidence; expire rewards past deadline. */
export async function evidencePass(c: Tx, counts: RunResult['scouts'], now: Date) {
  const expired = await c.query(
    `update rewards set status = 'expired' where status <> 'expired' and ends_at is not null and ends_at < $1 returning finding_id`, [now]);
  for (const r of expired.rows) {
    await c.query(`update findings set verification = 'expired', lifecycle = 'updated' where id = $1`, [r.finding_id]);
    counts.rewards_scout.updated++; counts.evidence_scout.corrected++;
  }
  const fs = await c.query(`select f.id, f.verification, (f.attributes ->> 'patched') = 'true' as patched,
                              (f.attributes ->> 'debunked_by_moderator') = 'true' as debunked
                            from findings f where f.publication_status in ('published','in_review') and f.verification <> 'expired'`);
  for (const f of fs.rows) {
    const ev = await c.query(`select evidence_type, independent_origin, contradicts, raw_post_id is not null as system_observed from evidence where finding_id = $1`, [f.id]);
    const tier = computeVerification({ evidence: ev.rows as EvidenceItem[], patched: f.patched, moderatorDebunked: f.debunked });
    if (tier !== f.verification) {
      await c.query(`update findings set verification = $2, lifecycle = case when $2 in ('debunked','expired') then 'corrected' else 'updated' end,
                       last_checked_at = now() where id = $1`, [f.id, tier]);
      await c.query(`insert into admin_review_log(action, target_type, target_id, before, after) values ('verification_recomputed','finding',$1,$2,$3)`,
        [f.id, JSON.stringify({ verification: f.verification }), JSON.stringify({ verification: tier })]);
      if (tier === 'debunked' || tier === 'expired') counts.evidence_scout.corrected++;
      else counts.evidence_scout.updated++;
    }
    counts.evidence_scout.examined++;
  }
}

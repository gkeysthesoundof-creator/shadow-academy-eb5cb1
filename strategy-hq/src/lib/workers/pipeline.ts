import { asService, type Tx } from '../db';
import { config } from '../config';
import { SCOUTS } from '../domain/scouts';
import { routeText } from '../domain/router';
import { computeVerification, normalizeKey, originOf, type EvidenceItem } from '../domain/evidence';
import { classifyRewardText } from '../domain/rewards';
import { ingestionAllowed, type RightsRecord } from '../domain/rights';
import { officialChangeWatch, redditNew, feedWatch, type Fetcher, type AdapterResult } from './sources';
import { readWithModel, readWithRules, publishDecision, defaultParse, type Card, type ParseFn, type ReadResult, type SourceItem } from './extract';
import { costMicros } from '../assistant/llm';
import { scoutsForCategory } from '../domain/scouts';
import { localParts } from '../domain/schedule';

/**
 * ONE shared ingestion pass feeding all ten scout lenses.
 *  1. Source stage   — fetch enabled, rights-cleared sources (Community Discovery + Rewards feeds)
 *  2. Router stage   — deterministic keyword routing of new raw items to scout lenses
 *  3. Reader stage   — each new post/article is read (Claude Haiku when configured, rules otherwise),
 *                      every fact is grounded against the source text, and cards are merged into the
 *                      one store: same thing at the same place = one card with more evidence.
 *                      Cards auto-publish with honest evidence badges; story spoilers of unknown
 *                      chapter and low-confidence cards wait in review instead.
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
  /** Injected model reader for tests; defaults to Claude Haiku when ANTHROPIC_API_KEY is set. */
  parse?: ParseFn | null;
}

export interface RunResult {
  status: 'succeeded' | 'partial' | 'failed' | 'skipped';
  jobId: string | null;
  sources: { name: string; kind: string; outcome: string; items: number; new: number; note: string }[];
  scouts: Record<string, { examined: number; added: number; updated: number; corrected: number; status: string }>;
}

export async function runScoutPipeline(opts: RunOptions): Promise<RunResult> {
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  const job = await asService(async (c) => {
    const r = await c.query(
      `insert into ingestion_jobs(kind, idempotency_key, requested_by, started_at) values ($1,$2,$3, coalesce($4::timestamptz, now()))
       on conflict (idempotency_key) do nothing returning id`, [opts.kind, opts.idempotencyKey, opts.requestedBy ?? null, opts.now ?? null]);
    return r.rows[0]?.id as string | undefined;
  });
  if (!job) return { status: 'skipped', jobId: null, sources: [], scouts: {} };

  const result: RunResult = { status: 'succeeded', jobId: job, sources: [], scouts: {} };
  const transient = new Map<string, { body: string; author: string | null; spoiler: boolean }>();   // raw_post id → full text (this run only)
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
      } else if (s.access_method === 'rss') {
        res = !s.enabled ? { outcome: 'skipped', items: [], coverage_note: 'Source disabled.' } : await feedWatch(s.canonical_url, fetcher);
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
          if (ins.rows[0]) transient.set(ins.rows[0].id, { body: it.body ?? it.excerpt ?? '', author: it.author ?? null, spoiler: !!it.spoiler });
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
      result.sources.push({ name: s.name, kind: s.kind, outcome: res.outcome, items: res.items.length, new: inserted, note: res.coverage_note });
    }

    // ---------------- 2+3. Router + reader ----------------
    const reader = await makeReader(opts.parse, opts.now ?? new Date());
    const pending = await asService((c) => c.query(`select rp.*, s.kind as source_kind from raw_posts rp join sources s on s.id = rp.source_id
                                                    where rp.processed_at is null order by rp.retrieved_at limit 500`)).then((r) => r.rows);
    for (const p of pending) {
      const scouts = routeText(p.title, p.excerpt ?? '');
      if (p.source_kind === 'reddit' || p.source_kind === 'guide') counts.community_scout.examined++;
      for (const sid of scouts) counts[sid].examined++;
      const handled = await asService((c) => matchKnownEvidence(c, p, counts));
      let read: ReadResult | null = null;
      if (!handled) {
        const t = transient.get(p.id);
        read = await reader.read({
          title: p.title, body: t?.body ?? p.excerpt ?? '', url: p.url, author: t?.author ?? null, spoilerFlag: t?.spoiler ?? false,
          sourceKind: p.source_kind === 'reddit' ? 'reddit' : p.source_kind === 'guide' ? 'guide' : p.source_kind === 'rockstar' ? 'rockstar' : 'other',
        });
      }
      await asService(async (c) => {
        if (read) for (const card of read.cards) await upsertCard(c, card, read.game, p, transient.get(p.id)?.author ?? null, reader.autoPublish, counts);
        await c.query('update raw_posts set routed_scouts = $2, processed_at = now() where id = $1', [p.id, scouts]);
      });
    }
    await reader.flushCost();

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
    const communityOn = result.sources.some((s) => (s.name.startsWith('r/') || s.kind === 'guide') && s.outcome === 'success');
    await asService(async (c) => {
      for (const s of SCOUTS) {
        const k = counts[s.id];
        const needsCommunity = ['vehicle_scout', 'weapons_scout', 'money_scout', 'secrets_scout', 'strategy_scout', 'community_scout'].includes(s.id);
        let status = 'succeeded'; let note = '';
        if (s.id === 'community_scout' && !communityOn) { status = 'not_configured'; note = 'No community or guide source answered this run; nothing collected.'; }
        else if (needsCommunity && !communityOn) { status = 'partial'; note = 'No community or guide source answered; checked official sources only.'; }
        else if (needsCommunity && !result.sources.some((x) => x.name.startsWith('r/') && x.outcome === 'success')) { status = 'partial'; note = 'News/guide feeds read; Reddit not connected yet.'; }
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

/**
 * Official pages the store already cites: mark that evidence as observed by this system (→ VERIFIED).
 * Landing pages that changed are logged for a look rather than turned into intel. Returns true when handled.
 */
async function matchKnownEvidence(c: Tx, p: Record<string, any>, counts: RunResult['scouts']): Promise<boolean> {
  const matched = await c.query(`update evidence set raw_post_id = $1, captured_at = now() where url = $2 and raw_post_id is null returning finding_id`, [p.id, p.url]);
  if (matched.rowCount) {
    for (const r of matched.rows) await c.query(`update findings set last_checked_at = now(), last_confirmed_at = now() where id = $1`, [r.finding_id]);
    counts.evidence_scout.updated += matched.rowCount ?? 0;
    return true;
  }
  const known = (await c.query(`select 1 from evidence where url = $1 limit 1`, [p.url])).rowCount;
  const landing = p.source_kind === 'rockstar' && !/\/newswire\/article\//.test(p.url);
  if (known || landing) {
    await c.query(`insert into admin_review_log(action, target_type, target_id, after) values ('source_page_changed','raw_post',$1,$2)`,
      [p.id, JSON.stringify({ url: p.url, title: p.title })]);
    return true;
  }
  return false;
}

/** Chooses the model reader when configured and within budget, otherwise the rules reader. */
async function makeReader(injected: ParseFn | null | undefined, now: Date) {
  const flags = await asService((c) => c.query(`select key, enabled from feature_flags where key in ('llm_extraction','auto_publish_community')`))
    .then((r) => Object.fromEntries(r.rows.map((x) => [x.key, x.enabled])));
  const day = localParts(now, config.timezone).date;
  const spentBefore = Number((await asService((c) => c.query(`select coalesce(sum(cost_micros),0) s from platform_budget where day = $1 and meter = 'llm_extract'`, [day]))).rows[0].s);
  const parse = injected !== undefined ? injected : (config.anthropicApiKey && flags.llm_extraction ? defaultParse(config.anthropicApiKey) : null);
  let spent = 0; let calls = 0; let unflushed = 0; let unflushedCalls = 0;
  return {
    autoPublish: flags.auto_publish_community !== false,
    async read(src: SourceItem): Promise<ReadResult> {
      const relevantish = routeText(src.title, src.body.slice(0, 3000)).length > 0 || src.sourceKind === 'rockstar' || src.sourceKind === 'guide';
      if (!relevantish) return { game: 'unclear', cards: [], reader: 'rules' };
      if (parse && calls < config.extractMaxCallsPerRun && spentBefore + spent < config.extractDailyBudgetMicros) {
        try {
          calls++;
          const r = await readWithModel(src, parse, config.extractModel);
          const cost = r?.usage ? costMicros(config.extractModel, r.usage) : 0;
          spent += cost; unflushed += cost; unflushedCalls++;
          if (r) return r;
        } catch { /* model unavailable: fall through to rules */ }
      }
      return readWithRules(src);
    },
    async flushCost() {
      if (!unflushedCalls) return;
      await asService((c) => c.query(`insert into platform_budget(day, meter, cost_micros, calls) values ($1,'llm_extract',$2,$3)
        on conflict (day, meter) do update set cost_micros = platform_budget.cost_micros + excluded.cost_micros, calls = platform_budget.calls + excluded.calls`,
        [day, unflushed, unflushedCalls]));
    },
  };
}

/** Merge one card into the canonical store: one record per thing-at-a-place, evidence accumulates. */
export async function upsertCard(c: Tx, card: Card, game: ReadResult['game'], p: Record<string, any>, author: string | null,
  autoPublish: boolean, counts: RunResult['scouts']) {
  const scope = game === 'GTA_ONLINE' ? 'GTA_ONLINE' : 'GTA_VI';
  let placeId: string | null = null;
  if (card.landmark) {
    const pl = await c.query(`insert into places(game_id, location_key, landmark, region) values ('gta6',$1,$2,$3)
      on conflict (game_id, location_key) do update set region = coalesce(places.region, excluded.region) returning id`,
      [normalizeKey(card.landmark), card.landmark, card.region]);
    placeId = pl.rows[0].id;
  }
  const dedupe = normalizeKey(scope === 'GTA_ONLINE' ? 'online' : '', card.category, card.make_model ?? card.subject, card.landmark ?? '');
  const decision = publishDecision(card, game, autoPublish);
  const evType = p.source_kind === 'rockstar' ? 'official' : p.source_kind === 'guide' ? 'guide' : 'community';
  const attrs = Object.fromEntries(Object.entries({ make_model: card.make_model, vehicle_class: card.vehicle_class, weapon_type: card.weapon_type,
    unlock_condition: card.unlock_condition, respawns: card.respawns }).filter(([, v]) => v));
  const existing = (await c.query(`select id, publication_status from findings where game_id = 'gta6' and dedupe_key = $1`, [dedupe])).rows[0];
  let id: string;
  if (existing) {
    id = existing.id;
    await c.query(`update findings set
        place_id = coalesce(place_id, $2), payout_min = coalesce(payout_min, $3), payout_max = coalesce(payout_max, $4), price = coalesce(price, $5),
        how_to = case when cardinality(how_to) = 0 then $6 else how_to end, is_free = coalesce(is_free, $7), availability = coalesce(availability, $8),
        attributes = $9::jsonb || attributes, last_confirmed_at = now(), lifecycle = case when publication_status = 'published' then 'updated' else lifecycle end,
        publication_status = case when publication_status = 'in_review' and $10 = 'published' then 'published' else publication_status end,
        published_at = case when publication_status = 'in_review' and $10 = 'published' then now() else published_at end
      where id = $1`, [id, placeId, card.payout_min, card.payout_max, card.price, card.how_to, card.is_free, card.availability, JSON.stringify(attrs), decision]);
    for (const sid of scoutsForCategory(card.category)) counts[sid].updated++;
  } else {
    const ins = await c.query(
      `insert into findings(game_id, game_scope, category, title, summary, how_to, chapter_min, spoiler_level, verification, publication_status,
         is_free, payout_min, payout_max, price, availability, place_id, attributes, dedupe_key, published_at, risk)
       values ('gta6',$1,$2,$3,$4,$5,$6,$7,'unverified',$8,$9,$10,$11,$12,$13,$14,$15,$16, case when $8 = 'published' then now() end, 'unknown')
       returning id`,
      [scope, card.category, card.title, card.summary, card.how_to, card.chapter, card.spoiler, decision, card.is_free,
       card.payout_min, card.payout_max, card.price, card.availability, placeId, JSON.stringify({ ...attrs, reader: card.confidence }), dedupe]);
    id = ins.rows[0].id;
    for (const sid of scoutsForCategory(card.category)) {
      await c.query('insert into scout_finding_links values ($1,$2) on conflict do nothing', [sid, id]);
      counts[sid].added++;
    }
    if (placeId) await c.query(`insert into scout_finding_links values ('map_scout',$1) on conflict do nothing`, [id]);
    if (card.category === 'cash_pickup' || card.category === 'money_activity') {
      await c.query(`insert into money_routes(finding_id, money_kind, repeatable) values ($1,$2,$3) on conflict do nothing`,
        [id, card.category === 'cash_pickup' ? 'world_pickup' : 'repeatable_activity', card.category === 'money_activity' ? true : null]);
    }
    if (card.category === 'reward' && evType === 'official') {
      const r = classifyRewardText(`${card.title} ${card.summary}`);
      await c.query(`insert into rewards(finding_id, game_scope, cost_type, status, source_url) values ($1,$2,$3,'unknown',$4) on conflict do nothing`,
        [id, scope, r.cost_type, p.url]);
    }
  }
  await c.query(
    `insert into evidence(finding_id, source_id, raw_post_id, url, title, published_at, paraphrase, evidence_type, independent_origin)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (finding_id, url) do nothing`,
    [id, p.source_id, p.id, p.url, p.title.slice(0, 300), p.published_at, card.summary.slice(0, 600), evType, originOf(p.url, author)]);
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

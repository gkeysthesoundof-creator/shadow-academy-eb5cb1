import { asUser, type Tx, inOrder } from '../db';
import { SCOUTS, type ScoutId } from '../domain/scouts';

/**
 * All customer-facing intel reads go through asUser(), so the database spoiler
 * gate and publication rules apply to every list, detail page, search, email
 * and assistant answer. There is no "admin bypass" path in this module.
 */
export type HuntStatus = 'saved' | 'found' | 'skipped';

export interface FindingRow {
  id: string; game_scope: 'GTA_VI' | 'GTA_ONLINE'; category: string; title: string; summary: string;
  why_it_matters: string | null; how_to: string[]; prerequisites: string | null; hazards: string | null;
  risk: string; chapter_min: number | null; chapter_max: number | null; spoiler_level: 'none' | 'mild' | 'story';
  verification: string; lifecycle: string; publication_status: string; is_free: boolean | null;
  payout_min: number | null; payout_max: number | null; price: number | null; availability: string | null;
  patch_version: string | null; attributes: Record<string, unknown>; first_seen_at: string; last_confirmed_at: string | null;
  last_checked_at: string | null; published_at: string | null; updated_at: string;
  landmark: string | null; region: string | null; place_id: string | null;
  pin_id: string | null; pin_precision: string | null;
  hunt_status: HuntStatus | null; evidence_count: number; scouts: ScoutId[];
}

export const FILTERS = ['chapter', 'free', 'verified', 'precise', 'not_found', 'saved', 'patched', 'new24h'] as const;
export type FilterKey = (typeof FILTERS)[number];
export const FILTER_LABELS: Record<FilterKey, string> = {
  chapter: 'Available to me now', free: 'Free', verified: 'Verified', precise: 'Precise location',
  not_found: 'Not yet found', saved: 'Saved', patched: 'Patched', new24h: 'New in 24h',
};

const BASE_SELECT = `
  select f.*, p.landmark, p.region,
    (select mp.id from map_pins mp join map_assets ma on ma.id = mp.map_asset_id
       where mp.place_id = f.place_id and ma.calibrated and ma.owner_user_id is null limit 1) as pin_id,
    (select mp.precision from map_pins mp where mp.place_id = f.place_id limit 1) as pin_precision,
    h.status as hunt_status,
    (select count(*)::int from evidence e where e.finding_id = f.id and not e.contradicts) as evidence_count,
    coalesce((select array_agg(l.scout_id order by l.scout_id) from scout_finding_links l where l.finding_id = f.id), '{}') as scouts
  from findings f
  left join places p on p.id = f.place_id
  left join user_hunts h on h.finding_id = f.id and h.user_id = app_uid()
`;

export interface ListOpts {
  scout?: ScoutId; categories?: string[]; filters?: FilterKey[]; q?: string; scope?: 'GTA_VI' | 'GTA_ONLINE' | 'any'; limit?: number;
}

export async function listFindingsTx(c: Tx, opts: ListOpts = {}): Promise<FindingRow[]> {
  // Explicit chapter gate on top of RLS: moderators can read everything at the DB level,
  // but their personal views must still respect their own spoiler shield.
  const where: string[] = [`f.game_id = 'gta6'`, `f.publication_status = 'published'`, `app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level)`];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
  if (opts.scout) add(`exists (select 1 from scout_finding_links l where l.finding_id = f.id and l.scout_id = ?)`, opts.scout);
  if (opts.categories?.length) add(`f.category = any(?)`, opts.categories);
  if (opts.scope && opts.scope !== 'any') add(`f.game_scope = ?`, opts.scope);
  const fl = new Set(opts.filters ?? []);
  if (fl.has('free')) where.push(`f.is_free is true`);
  if (fl.has('verified')) where.push(`f.verification in ('verified','corroborated')`);
  if (fl.has('precise')) where.push(`exists (select 1 from map_pins mp where mp.place_id = f.place_id and mp.precision = 'exact')`);
  if (fl.has('not_found')) where.push(`coalesce(h.status, '') <> 'found'`);
  if (fl.has('saved')) where.push(`h.status = 'saved'`);
  if (fl.has('patched')) where.push(`(f.verification in ('expired','debunked') or f.lifecycle = 'corrected' or (f.attributes ->> 'patched') = 'true')`);
  else where.push(`f.verification not in ('debunked')`);
  if (fl.has('new24h')) where.push(`f.published_at > now() - interval '24 hours'`);
  if (opts.q?.trim()) {
    args.push(opts.q.trim().slice(0, 100), opts.q.trim().slice(0, 100).replace(/[%_\\]/g, ''));
    const a = args.length - 1; const b = args.length;
    where.push(`(to_tsvector('english', f.title || ' ' || f.summary) @@ plainto_tsquery('english', $${a}) or f.title ilike '%' || $${b} || '%' or coalesce(p.landmark,'') ilike '%' || $${b} || '%')`);
  }
  args.push(Math.min(opts.limit ?? 100, 200));
  const sql = `${BASE_SELECT} where ${where.join(' and ')}
    order by case f.verification when 'verified' then 0 when 'corroborated' then 1 when 'single_report' then 2 else 3 end,
             f.published_at desc nulls last limit $${args.length}`;
  const r = await c.query(sql, args);
  return r.rows.map(normalize);
}

export const listFindings = (userId: string, opts: ListOpts = {}) => asUser(userId, (c) => listFindingsTx(c, opts));

function normalize(r: Record<string, unknown>): FindingRow {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...(r as unknown as FindingRow), payout_min: num(r.payout_min), payout_max: num(r.payout_max), price: num(r.price) };
}

export async function getFindingTx(c: Tx, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const f = await c.query(`${BASE_SELECT} where f.id = $1 and app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level)`, [id]);
  if (!f.rowCount) return null;
  const finding = normalize(f.rows[0]);
  const [evidence, media, money, reward, pin] = await inOrder([
    () => c.query(`select e.*, s.name as source_name, cr.rights_status, cr.allowed_uses, cr.expires_at as rights_expires
             from evidence e left join sources s on s.id = e.source_id left join content_rights cr on cr.id = s.rights_id
             where e.finding_id = $1 order by e.contradicts, e.published_at desc nulls last`, [id]),
    () => c.query(`select m.*, ml.license_type, ml.allowed_uses, ml.expires_at, ml.attribution
             from finding_media m left join media_licenses ml on ml.id = m.media_license_id where m.finding_id = $1`, [id]),
    () => c.query('select * from money_routes where finding_id = $1', [id]),
    () => c.query('select * from rewards where finding_id = $1', [id]),
    () => finding.place_id
      ? c.query(`select mp.*, ma.calibrated, ma.kind as asset_kind from map_pins mp join map_assets ma on ma.id = mp.map_asset_id where mp.place_id = $1`, [finding.place_id])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
  ]);
  return { finding, evidence: evidence.rows, media: media.rows, money: money.rows[0] ?? null, reward: reward.rows[0] ?? null, pins: pin.rows };
}
export const getFinding = (userId: string, id: string) => asUser(userId, (c) => getFindingTx(c, id));
export type FindingDetail = NonNullable<Awaited<ReturnType<typeof getFinding>>>;

export async function lockedCounts(userId: string): Promise<Record<string, number>> {
  const r = await asUser(userId, (c) => c.query(`select * from locked_future_counts('gta6')`));
  return Object.fromEntries(r.rows.map((x) => [x.scout_id, x.locked]));
}

export async function setHunt(userId: string, findingId: string, status: HuntStatus | null) {
  return asUser(userId, async (c) => {
    // Finding must be visible to this user (RLS) — prevents saving hidden future-chapter ids.
    const ok = await c.query('select 1 from findings f where f.id = $1 and app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level)', [findingId]);
    if (!ok.rowCount) throw new Error('not available');
    if (status === null) await c.query('delete from user_hunts where user_id = app_uid() and finding_id = $1', [findingId]);
    else await c.query(`insert into user_hunts(user_id, finding_id, status) values (app_uid(), $1, $2)
                        on conflict (user_id, finding_id) do update set status = excluded.status, updated_at = now()`, [findingId, status]);
  });
}

export async function fileCorrection(userId: string, findingId: string, kind: string, details: string) {
  return asUser(userId, async (c) => {
    const ok = await c.query('select 1 from findings f where f.id = $1 and app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level)', [findingId]);
    if (!ok.rowCount) throw new Error('not available');
    await c.query(`insert into corrections(finding_id, reported_by, kind, details) values ($1, app_uid(), $2, $3)`, [findingId, kind, details.slice(0, 2000)]);
  });
}

export type ScoutState = 'CONNECTED' | 'PARTIAL' | 'STALE' | 'NOT CONFIGURED' | 'FAILING' | 'PREVIEW — NO SCANS RUN';

export interface ScoutStatusRow {
  scout_id: ScoutId; state: ScoutState; last_run_at: string | null; last_success_at: string | null;
  visible_count: number; locked_count: number; last_note: string | null;
  items_examined: number; findings_added: number; findings_updated: number; findings_corrected: number; error: string | null;
}

/** Which feeds a scout depends on. Community-led scouts need the Reddit API to be anything but PARTIAL. */
const SCOUT_FEEDS: Record<ScoutId, ('official' | 'community' | 'manual')[]> = {
  vehicle_scout: ['community', 'manual', 'official'], weapons_scout: ['community', 'manual', 'official'],
  money_scout: ['community', 'manual', 'official'], secrets_scout: ['community', 'manual'],
  strategy_scout: ['community', 'manual'], map_scout: ['manual'], rewards_scout: ['official'],
  community_scout: ['community'], evidence_scout: ['official', 'community', 'manual'], briefing_scout: ['manual'],
};

export async function scoutStatusTx(c: Tx, now = new Date()): Promise<ScoutStatusRow[]> {
  const runs = await c.query(`
    select distinct on (scout_id) scout_id, started_at, finished_at, status, items_examined, findings_added, findings_updated,
      findings_corrected, note, error,
      (select max(finished_at) from scout_runs s2 where s2.scout_id = s.scout_id and s2.status in ('succeeded','partial')) as last_success_at
    from scout_runs s order by scout_id, started_at desc`);
  const byScout = new Map(runs.rows.map((r) => [r.scout_id, r]));
  const visible = await c.query(`select l.scout_id, count(*)::int n from scout_finding_links l join findings f on f.id = l.finding_id
                                 where app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level) and f.verification <> 'debunked' group by l.scout_id`);
  const vis = new Map(visible.rows.map((r) => [r.scout_id, r.n]));
  const locked = await c.query(`select * from locked_future_counts('gta6')`);
  const lock = new Map(locked.rows.map((r) => [r.scout_id, r.locked]));
  const src = await c.query(`select kind, bool_or(enabled and status in ('ok','partial')) as healthy, bool_or(enabled) as enabled from sources group by kind`);
  const kinds = new Map(src.rows.map((r) => [r.kind, r]));
  const communityReady = !!kinds.get('reddit')?.healthy;
  const calibratedMap = ((await c.query(`select count(*)::int n from map_assets where owner_user_id is null and calibrated`)).rows[0].n) > 0;
  const emailOn = (await c.query(`select enabled from feature_flags where key = 'email_delivery'`)).rows[0]?.enabled === true;
  const officialReady = !!kinds.get('rockstar')?.healthy;

  return SCOUTS.map((s) => {
    const r = byScout.get(s.id);
    const feeds = SCOUT_FEEDS[s.id];
    const missing = (feeds.includes('community') && !communityReady) || (feeds.includes('official') && !officialReady);
    const onlyCommunity = feeds.every((f) => f === 'community');
    let state: ScoutState;
    if (!r) state = onlyCommunity && !communityReady ? 'NOT CONFIGURED' : 'PREVIEW — NO SCANS RUN';
    else if (r.status === 'failed') state = 'FAILING';
    else if (r.status === 'not_configured') state = 'NOT CONFIGURED';
    else if (!r.last_success_at || now.getTime() - new Date(r.last_success_at).getTime() > 36 * 3600_000) state = 'STALE';
    else if (missing || r.status === 'partial') state = 'PARTIAL';
    else if (s.id === 'map_scout' && !calibratedMap) state = 'PARTIAL';        // no licensed, calibrated map → text guidance only
    else if (s.id === 'briefing_scout' && !emailOn) state = 'PARTIAL';         // in-app archive works; email delivery off
    else state = 'CONNECTED';
    return {
      scout_id: s.id, state, last_run_at: r?.started_at ?? null, last_success_at: r?.last_success_at ?? null,
      visible_count: vis.get(s.id) ?? 0, locked_count: lock.get(s.id) ?? 0, last_note: r?.note ?? null,
      items_examined: r?.items_examined ?? 0, findings_added: r?.findings_added ?? 0, findings_updated: r?.findings_updated ?? 0,
      findings_corrected: r?.findings_corrected ?? 0, error: r?.error ?? null,
    };
  });
}
export const scoutStatus = (userId: string) => asUser(userId, (c) => scoutStatusTx(c));

export async function sourceHealth(userId: string) {
  return asUser(userId, (c) => c.query(`
    select s.id, s.kind, s.name, s.canonical_url, s.access_method, s.enabled, s.status, s.access_notes, s.terms_url,
      s.last_check_at, s.last_success_at, s.last_error,
      (select row_to_json(r) from (select outcome, items_fetched, items_new, coverage_note, error, started_at
         from source_runs sr where sr.source_id = s.id order by started_at desc limit 1) r) as last_run
    from sources s order by s.kind, s.name`).then((r) => r.rows));
}

export async function rewardsList(userId: string) {
  return asUser(userId, (c) => c.query(`
    select r.*, f.title, f.summary, f.verification, f.id as finding_id, f.attributes
    from rewards r join findings f on f.id = r.finding_id
    where app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level) order by r.ends_at desc nulls last`).then((r) => r.rows));
}

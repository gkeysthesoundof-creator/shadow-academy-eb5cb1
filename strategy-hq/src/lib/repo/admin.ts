import { asUser, asService, type Tx } from '../db';
import { normalizeKey, originOf, computeVerification, type EvidenceItem } from '../domain/evidence';
import { scoutsForCategory, type FindingCategory } from '../domain/scouts';
import { setPlan } from '../auth/core';
import type { PlanId } from '../domain/plans';

/**
 * Moderator/admin operations. Writes run AS the moderator (RLS checks
 * app_is_moderator()), and every change is written to admin_review_log.
 * Verification tiers are never typed in by hand — they are computed from evidence.
 */
async function log(c: Tx, action: string, targetType: string, targetId: string | null, before: unknown, after: unknown) {
  await c.query(`insert into admin_review_log(actor_id, action, target_type, target_id, before, after) values (app_uid(),$1,$2,$3,$4,$5)`,
    [action, targetType, targetId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)]);
}

export interface IntakeInput {
  category: FindingCategory; game_scope: 'GTA_VI' | 'GTA_ONLINE'; title: string; summary: string; why_it_matters?: string;
  how_to: string[]; prerequisites?: string; hazards?: string; risk: 'low' | 'medium' | 'high' | 'unknown';
  chapter_min: number | null; spoiler_level: 'none' | 'mild' | 'story'; landmark?: string; region?: string;
  is_free: boolean | null; payout_min: number | null; payout_max: number | null; price: number | null; availability?: string;
  attributes: Record<string, string>;
  evidence: { url: string; title: string; paraphrase: string; evidence_type: 'official' | 'guide' | 'community' | 'user_report' | 'founder_observation'; published_at?: string | null; author?: string | null }[];
}

export async function createDraft(modId: string, input: IntakeInput): Promise<string> {
  if (!input.evidence.length) throw new Error('At least one evidence source is required.');
  for (const e of input.evidence) if (!/^https:\/\//.test(e.url)) throw new Error('Evidence URLs must be https links.');
  return asUser(modId, async (c) => {
    let placeId: string | null = null;
    if (input.landmark?.trim()) {
      const key = normalizeKey(input.landmark);
      const p = await c.query(`insert into places(game_id, location_key, landmark, region) values ('gta6',$1,$2,$3)
                               on conflict (game_id, location_key) do update set landmark = excluded.landmark returning id`,
        [key, input.landmark.trim(), input.region?.trim() || null]);
      placeId = p.rows[0].id;
    }
    // Dedupe: same place + category, or same normalized title+category, is ONE finding.
    const dedupe = placeId ? normalizeKey(input.category, input.landmark) : normalizeKey(input.category, input.title);
    const existing = await c.query(`select id from findings where game_id = 'gta6' and dedupe_key = $1`, [dedupe]);
    if (existing.rowCount) throw new Error(`Duplicate: this ${input.category} at this place already exists (finding ${existing.rows[0].id}). Add evidence to it instead.`);
    const r = await c.query(
      `insert into findings(game_id, game_scope, category, title, summary, why_it_matters, how_to, prerequisites, hazards, risk, chapter_min,
         spoiler_level, is_free, payout_min, payout_max, price, availability, place_id, attributes, dedupe_key, publication_status, created_by, verification)
       values ('gta6',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'in_review', app_uid(), 'unverified') returning id`,
      [input.game_scope, input.category, input.title.trim(), input.summary.trim(), input.why_it_matters?.trim() || null, input.how_to.filter(Boolean),
       input.prerequisites?.trim() || null, input.hazards?.trim() || null, input.risk, input.chapter_min, input.spoiler_level, input.is_free,
       input.payout_min, input.payout_max, input.price, input.availability?.trim() || null, placeId, JSON.stringify(input.attributes), dedupe]);
    const id = r.rows[0].id as string;
    for (const sid of scoutsForCategory(input.category)) await c.query('insert into scout_finding_links values ($1,$2) on conflict do nothing', [sid, id]);
    if (placeId) await c.query(`insert into scout_finding_links values ('map_scout',$1) on conflict do nothing`, [id]);
    if (input.category === 'cash_pickup' || input.category === 'money_activity') {
      await c.query(`insert into money_routes(finding_id, money_kind) values ($1,$2)`, [id, input.category === 'cash_pickup' ? 'world_pickup' : 'repeatable_activity']);
    }
    for (const e of input.evidence) await addEvidenceTx(c, id, e);
    await recomputeTx(c, id);
    await log(c, 'finding_created', 'finding', id, null, { title: input.title, category: input.category });
    return id;
  });
}

async function addEvidenceTx(c: Tx, findingId: string, e: IntakeInput['evidence'][number] & { contradicts?: boolean }) {
  await c.query(`insert into evidence(finding_id, url, title, published_at, paraphrase, evidence_type, independent_origin, contradicts)
                 values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (finding_id, url) do nothing`,
    [findingId, e.url, e.title.slice(0, 300), e.published_at || null, e.paraphrase.slice(0, 600), e.evidence_type,
     e.evidence_type === 'founder_observation' ? 'founder' : originOf(e.url, e.author), !!e.contradicts]);
}

async function recomputeTx(c: Tx, id: string) {
  const f = (await c.query(`select verification, attributes from findings where id = $1`, [id])).rows[0];
  const ev = await c.query(`select evidence_type, independent_origin, contradicts, raw_post_id is not null as system_observed from evidence where finding_id = $1`, [id]);
  const tier = computeVerification({ evidence: ev.rows as EvidenceItem[], patched: f.attributes?.patched === true || f.attributes?.patched === 'true', moderatorDebunked: f.attributes?.debunked_by_moderator === true });
  if (tier !== f.verification) await c.query(`update findings set verification = $2, last_checked_at = now() where id = $1`, [id, tier]);
  return tier;
}

export async function addEvidence(modId: string, findingId: string, e: IntakeInput['evidence'][number] & { contradicts?: boolean }) {
  if (!/^https:\/\//.test(e.url)) throw new Error('Evidence URLs must be https links.');
  return asUser(modId, async (c) => {
    await addEvidenceTx(c, findingId, e);
    const tier = await recomputeTx(c, findingId);
    await c.query(`update findings set lifecycle = case when publication_status = 'published' then 'updated' else lifecycle end, last_confirmed_at = case when $2 then last_confirmed_at else now() end where id = $1`, [findingId, !!e.contradicts]);
    await log(c, 'evidence_added', 'finding', findingId, null, { url: e.url, contradicts: !!e.contradicts, tier });
  });
}

/** Publication gate: evidence, chapter decision and a real paraphrase are mandatory. */
export async function publish(modId: string, findingId: string) {
  return asUser(modId, async (c) => {
    const f = (await c.query(`select * from findings where id = $1`, [findingId])).rows[0];
    if (!f) throw new Error('not found');
    const ev = await c.query(`select count(*)::int n from evidence where finding_id = $1 and not contradicts`, [findingId]);
    const problems: string[] = [];
    if (!ev.rows[0].n) problems.push('needs at least one supporting source');
    if (f.chapter_min === null && f.spoiler_level !== 'none') problems.push('set a chapter, or mark it as containing no story content');
    if (/^Auto-intake draft/.test(f.summary)) problems.push('write a factual paraphrase (summary) first');
    if (f.verification === 'debunked') problems.push('debunked findings cannot be published');
    if (problems.length) throw new Error(`Cannot publish: ${problems.join('; ')}.`);
    await c.query(`update findings set publication_status = 'published', published_at = coalesce(published_at, now()), lifecycle = 'new' where id = $1`, [findingId]);
    await log(c, 'published', 'finding', findingId, { publication_status: f.publication_status }, { publication_status: 'published' });
  });
}

export async function retract(modId: string, findingId: string, reason: string) {
  return asUser(modId, async (c) => {
    await c.query(`update findings set publication_status = 'retracted', lifecycle = 'corrected' where id = $1`, [findingId]);
    await log(c, 'retracted', 'finding', findingId, null, { reason });
  });
}

export async function markPatchedOrDebunked(modId: string, findingId: string, which: 'patched' | 'debunked', note: string) {
  return asUser(modId, async (c) => {
    const key = which === 'patched' ? 'patched' : 'debunked_by_moderator';
    await c.query(`update findings set attributes = attributes || jsonb_build_object($2::text, true, 'correction_note', $3::text), lifecycle = 'corrected' where id = $1`, [findingId, key, note]);
    await c.query(`update money_routes set patched = true where finding_id = $1 and $2 = 'patched'`, [findingId, which]);
    const tier = await recomputeTx(c, findingId);
    await log(c, `marked_${which}`, 'finding', findingId, null, { note, tier });
  });
}

export async function updateDraftText(modId: string, findingId: string, patch: { title: string; summary: string; why_it_matters: string; chapter_min: number | null; spoiler_level: string; how_to: string[] }) {
  return asUser(modId, async (c) => {
    const before = (await c.query(`select title, summary, chapter_min, spoiler_level from findings where id = $1`, [findingId])).rows[0];
    await c.query(`update findings set title=$2, summary=$3, why_it_matters=$4, chapter_min=$5, spoiler_level=$6, how_to=$7,
                     lifecycle = case when publication_status='published' then 'updated' else lifecycle end where id = $1`,
      [findingId, patch.title, patch.summary, patch.why_it_matters || null, patch.chapter_min, patch.spoiler_level, patch.how_to]);
    await log(c, 'edited', 'finding', findingId, before, patch);
  });
}

export async function resolveCorrection(modId: string, correctionId: string, status: 'accepted' | 'rejected') {
  return asUser(modId, async (c) => {
    const r = await c.query(`update corrections set status = $2, resolved_by = app_uid(), resolved_at = now() where id = $1 and status = 'open' returning finding_id, kind`, [correctionId, status]);
    if (r.rowCount && status === 'accepted') {
      await c.query(`update findings set lifecycle = 'corrected', last_checked_at = now() where id = $1`, [r.rows[0].finding_id]);
    }
    await log(c, `correction_${status}`, 'correction', correctionId, null, r.rows[0] ?? null);
  });
}

export async function reviewQueue(modId: string) {
  return asUser(modId, async (c) => ({
    drafts: (await c.query(`select f.*, (select count(*)::int from evidence e where e.finding_id = f.id) ev,
                              (select json_agg(json_build_object('url',e.url,'title',e.title,'type',e.evidence_type,'contradicts',e.contradicts)) from evidence e where e.finding_id = f.id) evidence_list
                            from findings f where publication_status in ('draft','in_review') order by created_at desc limit 100`)).rows,
    published: (await c.query(`select id, title, category, verification, lifecycle, chapter_min, published_at from findings where publication_status = 'published' order by published_at desc limit 100`)).rows,
    corrections: (await c.query(`select co.*, f.title from corrections co join findings f on f.id = co.finding_id where co.status = 'open' order by co.created_at desc`)).rows,
    changes: (await c.query(`select * from admin_review_log order by at desc limit 40`)).rows,
  }));
}

export async function adminOverview(adminId: string) {
  return asUser(adminId, async (c) => {
    const flags = (await c.query(`select * from feature_flags order by locked desc, key`)).rows;
    const users = (await c.query(`select u.id, u.email, u.display_name, u.status, u.created_at, u.last_login_at,
        (select role from membership_roles m join workspaces w on w.id = m.workspace_id where w.slug='platform' and m.user_id = u.id) platform_role,
        (select plan_id from subscriptions s where s.user_id = u.id and s.status in ('grandfathered','active','trialing','past_due') limit 1) plan
      from users u order by u.created_at`)).rows;
    const rights = (await c.query(`select cr.*, (select count(*)::int from sources s where s.rights_id = cr.id) sources from content_rights cr order by label`)).rows;
    const takedowns = (await c.query(`select * from content_takedowns order by received_at desc limit 20`)).rows;
    const plans = (await c.query(`select * from plan_catalog order by case id when 'free' then 0 when 'plus' then 1 when 'pro' then 2 else 3 end`)).rows;
    return { flags, users, rights, takedowns, plans };
  });
}

/** Usage + cost: service role (cross-user aggregate), only called after requireAdmin(). */
export async function usageToday(day: string) {
  return asService(async (c) => ({
    meters: (await c.query(`select meter, sum(count)::int calls, count(distinct user_id)::int users from usage_meter where day = $1 group by meter order by meter`, [day])).rows,
    budget: (await c.query(`select * from platform_budget where day = $1`, [day])).rows,
    webhooks: (await c.query(`select provider, event_type, status, received_at from billing_webhook_events order by received_at desc limit 10`)).rows,
    jobs: (await c.query(`select kind, status, started_at, finished_at, idempotency_key from ingestion_jobs order by started_at desc limit 8`)).rows,
  }));
}

export async function setFlag(adminId: string, key: string, enabled: boolean) {
  return asUser(adminId, async (c) => {
    const r = await c.query(`update feature_flags set enabled = $2, updated_by = app_uid(), updated_at = now() where key = $1 returning key`, [key, enabled]);
    if (!r.rowCount) throw new Error('Flag is locked or unknown. Locked flags need an explicit owner decision outside the app.');
    await log(c, 'flag_set', 'feature_flag', key, null, { enabled });
  });
}

export async function setRights(adminId: string, id: string, status: string, uses: string[], notes: string, agreementRef: string) {
  return asUser(adminId, async (c) => {
    await c.query(`update content_rights set rights_status = $2, allowed_uses = $3, notes = $4, agreement_ref = nullif($5,''), reviewed_by = app_uid(), reviewed_at = now() where id = $1`,
      [id, status, uses, notes, agreementRef]);
    await log(c, 'rights_updated', 'content_rights', id, null, { status, uses });
  });
}

export async function setSourceEnabled(adminId: string, id: string, enabled: boolean) {
  return asUser(adminId, async (c) => {
    await c.query(`update sources set enabled = $2 where id = $1`, [id, enabled]);
    await log(c, enabled ? 'source_enabled' : 'source_disabled', 'source', id, null, null);
  });
}

/** Plan changes are a backend operation (as if from a billing webhook) — audited, test-mode, no charge. */
export async function grantPlan(adminId: string, userId: string, plan: PlanId) {
  await asService((c) => setPlan(c, userId, plan, plan === 'founder' ? 'grandfathered' : 'active'));
  await asUser(adminId, (c) => log(c, 'plan_granted_manually', 'user', userId, null, { plan, note: 'manual grant, no payment' }));
}

import { asService, asUser } from '../db';
import { config } from '../config';
import { listFindingsTx, type FindingRow } from '../repo/intel';
import { isRecommendable, type Verification } from '../domain/evidence';
import { assertAllVisible } from '../domain/spoilers';
import { SCOUTS } from '../domain/scouts';
import { renderBriefEmail, subjectFor, preheaderFor, type BriefItem, type BriefModel, type BriefSection } from '../email/render';
import { deliverBrief } from '../email/deliver';

/**
 * Morning Brief & Operations Scout. Builds ONE deduplicated brief per user per
 * local day, from data read AS THAT USER (database spoiler gate), double-checked
 * by the application spoiler gate, then stored + (optionally) emailed.
 */
const SECTION_DEFS: { key: string; title: string; scouts?: string[]; empty: string }[] = [
  { key: 'vehicles', title: 'Rare vehicles', scouts: ['vehicle_scout'], empty: 'No new verified vehicle finds.' },
  { key: 'weapons', title: 'Weapons & items', scouts: ['weapons_scout'], empty: 'No new verified weapon finds.' },
  { key: 'money', title: 'Money: stashes & fast cash', scouts: ['money_scout'], empty: 'No new verified money finds. No payout rates are guessed.' },
  { key: 'secrets', title: 'Secrets & collectibles', scouts: ['secrets_scout'], empty: 'No new verified secrets.' },
  { key: 'missions', title: 'Missions & strategies', scouts: ['strategy_scout'], empty: 'No new verified strategies.' },
  { key: 'rewards', title: 'Rockstar free rewards & deadlines', scouts: ['rewards_scout'], empty: 'No new GTA VI rewards. GTA Online offers are never listed here.' },
  { key: 'corrections', title: 'Patches + corrections', empty: 'No corrections in the last 48 hours.' },
];

function toItem(f: FindingRow, previouslyKnown = false): BriefItem {
  return {
    id: f.id, title: f.title, category: f.category, verification: f.verification, chapter_min: f.chapter_min,
    landmark: f.landmark, why: f.why_it_matters, payout_min: f.payout_min, payout_max: f.payout_max, pin_id: f.pin_id, previously_known: previouslyKnown,
  };
}

export async function buildBriefForUser(userId: string, localDate: string, opts: { jobId?: string | null; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const since48 = now.getTime() - 48 * 3600_000;
  const since24 = now.getTime() - 24 * 3600_000;

  const data = await asUser(userId, async (c) => {
    const user = (await c.query(`select u.display_name, p.chapter, p.platform from users u join user_game_profiles p on p.user_id = u.id and p.game_id = 'gta6' where u.id = app_uid()`)).rows[0];
    const prefs = (await c.query('select * from alert_preferences where user_id = app_uid()')).rows[0];
    const all = await listFindingsTx(c, { scope: 'GTA_VI', limit: 200 });
    const corrections = (await listFindingsTx(c, { scope: 'GTA_VI', filters: ['patched'], limit: 50 }));
    const todos = (await c.query(`select text from user_tasks where user_id = app_uid() and not done order by sort limit 5`)).rows.map((r) => r.text);
    return { user, prefs, all, corrections, todos };
  });
  if (!data.user) throw new Error('profile missing');
  const chapter: number = data.user.chapter;

  // Second, independent spoiler gate before anything is rendered.
  assertAllVisible(data.all, chapter);
  assertAllVisible(data.corrections, chapter);

  const fresh = (f: FindingRow) => new Date(f.published_at ?? f.first_seen_at).getTime() > since48 || new Date(f.updated_at).getTime() > since48;
  const actionable = data.all.filter((f) => isRecommendable(f.verification as Verification) && f.hunt_status !== 'found' && f.hunt_status !== 'skipped');
  const top3 = [...actionable].sort((a, b) => score(b) - score(a)).slice(0, 3).map((f) => toItem(f, !fresh(f)));

  const enabled = new Set<string>(data.prefs?.sections ?? []);
  const sections: BriefSection[] = SECTION_DEFS.filter((s) => enabled.size === 0 || enabled.has(s.key)).map((s) => {
    const items = s.key === 'corrections'
      ? data.corrections.filter((f) => new Date(f.updated_at).getTime() > since48)
      : data.all.filter((f) => fresh(f) && s.scouts!.some((sc) => f.scouts.includes(sc as never)) && isRecommendable(f.verification as Verification));
    // Dedupe: an item already in Top 3 is not repeated below.
    const topIds = new Set(top3.map((t) => t.id));
    return { key: s.key, title: s.title, empty: s.empty, items: items.filter((f) => !topIds.has(f.id)).slice(0, 5).map((f) => toItem(f)) };
  });
  const newVerified24 = data.all.filter((f) => isRecommendable(f.verification as Verification) && new Date(f.published_at ?? f.first_seen_at).getTime() > since24);

  // Health: claims about scouts come ONLY from logged runs.
  const health = await asService(async (c) => {
    const job = opts.jobId
      ? (await c.query('select * from ingestion_jobs where id = $1', [opts.jobId])).rows[0]
      : (await c.query(`select * from ingestion_jobs where kind in ('daily_scan','manual_refresh') order by started_at desc limit 1`)).rows[0];
    const runs = job ? (await c.query('select scout_id, status from scout_runs where ingestion_job_id = $1', [job.id])).rows : [];
    const lastOk = (await c.query(`select max(finished_at) t from ingestion_jobs where status in ('succeeded','partial')`)).rows[0]?.t;
    const srcs = (await c.query(`select name, status, enabled, last_success_at from sources`)).rows;
    const nameOf = (id: string) => SCOUTS.find((s) => s.id === id)?.name ?? id;
    const ran = runs.filter((r) => ['succeeded', 'partial'].includes(r.status)).map((r) => nameOf(r.scout_id));
    return {
      scanStatus: job ? job.status : 'no scan has run yet',
      lastSuccessfulScan: lastOk ? new Date(lastOk).toLocaleString('en-US', { timeZone: config.timezone }) + ' ET' : null,
      scoutsRan: ran,
      scoutsNotRun: SCOUTS.filter((s) => !ran.includes(s.name)).map((s) => s.name),
      failedSources: srcs.filter((s) => s.enabled && s.status === 'failing').map((s) => s.name),
      staleSources: srcs.filter((s) => s.enabled && s.last_success_at && now.getTime() - new Date(s.last_success_at).getTime() > 72 * 3600_000).map((s) => s.name),
    };
  });

  const model: BriefModel = {
    displayName: data.user.display_name, chapter, localDate, baseUrl: config.appBaseUrl,
    top3, sections, savedTodos: data.todos, health, noNewVerified: newVerified24.length === 0,
  };
  const html = renderBriefEmail(model);
  const subject = subjectFor(chapter, localDate);
  return { model, html, subject, preheader: preheaderFor(model) };
}

function score(f: FindingRow) {
  let s = 0;
  if (f.verification === 'verified') s += 4; else if (f.verification === 'corroborated') s += 2;
  if (f.hunt_status === 'saved') s += 3;
  if (f.is_free) s += 2;
  if (f.pin_id) s += 1;
  if (['vehicle', 'weapon', 'cash_pickup', 'money_activity'].includes(f.category)) s += 1;
  return s;
}

/** Build + store (+ maybe deliver) briefs for every active user. One per user per local day. */
export async function runBriefStage(localDate: string, opts: { jobId?: string | null; now?: Date; onlyUserId?: string; forceDryRun?: boolean } = {}) {
  const users = await asService((c) => c.query(
    `select u.id, u.email from users u join user_game_profiles p on p.user_id = u.id and p.game_id = 'gta6'
     where u.status = 'active' ${opts.onlyUserId ? 'and u.id = $1' : ''}`, opts.onlyUserId ? [opts.onlyUserId] : [])).then((r) => r.rows);
  const out: { userId: string; status: string; delivery?: string }[] = [];
  for (const u of users) {
    const claim = await asService((c) => c.query(
      `insert into digest_runs(user_id, game_id, local_date, chapter, status, scout_job_id)
       select $1, 'gta6', $2, p.chapter, 'building', $3 from user_game_profiles p where p.user_id = $1 and p.game_id = 'gta6'
       on conflict (user_id, game_id, local_date) do nothing returning id`, [u.id, localDate, opts.jobId ?? null]));
    const digestId = claim.rows[0]?.id as string | undefined;
    if (!digestId) { out.push({ userId: u.id, status: 'already_built' }); continue; }
    try {
      const b = await buildBriefForUser(u.id, localDate, opts);
      await asService(async (c) => {
        await c.query(`update digest_runs set status = 'ready', subject = $2, preheader = $3, html = $4, summary = $5 where id = $1`,
          [digestId, b.subject, b.preheader, b.html, JSON.stringify({ top3: b.model.top3, health: b.model.health, noNewVerified: b.model.noNewVerified })]);
        await c.query(`insert into digest_sections(digest_id, section, sort, items) values ($1,'top3',0,$2)`, [digestId, JSON.stringify(b.model.top3)]);
        for (const [i, s] of b.model.sections.entries()) {
          await c.query(`insert into digest_sections(digest_id, section, sort, items) values ($1,$2,$3,$4)`, [digestId, s.key, i + 1, JSON.stringify(s.items)]);
        }
      });
      const d = await deliverBrief({ digestId, userId: u.id, userEmail: u.email, localDate, subject: b.subject, html: b.html, forceDryRun: opts.forceDryRun });
      out.push({ userId: u.id, status: 'ready', delivery: d.status });
    } catch (e) {
      await asService((c) => c.query(`update digest_runs set status = 'failed', summary = $2 where id = $1`, [digestId, JSON.stringify({ error: (e as Error).message.slice(0, 300) })]));
      out.push({ userId: u.id, status: 'failed' });
    }
  }
  return out;
}

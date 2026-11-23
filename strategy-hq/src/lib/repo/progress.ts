import { z } from 'zod';
import { asUser, type Tx, inOrder } from '../db';

/** Private progress: every query runs through asUser(), so RLS isolates users. */
const GAME = 'gta6';

export interface TaskRow { id: string; text: string; done: boolean; sort: number }
export interface CashRow { id: string; amount: number; label: string; entered_at: string }
export interface HuntItem {
  finding_id: string; status: 'saved' | 'found' | 'skipped'; note: string | null; updated_at: string;
  title: string; category: string; summary: string; verification: string; chapter_min: number | null;
}

export async function getPlaybook(userId: string) {
  return asUser(userId, async (c) => {
    const [prog, tasks, cash, hunts] = await inOrder([
      () => c.query(`select notes, updated_at from user_progress where user_id = app_uid() and game_id = $1`, [GAME]),
      () => c.query(`select id, text, done, sort from user_tasks where user_id = app_uid() and game_id = $1 order by done, sort, created_at`, [GAME]),
      () => c.query(`select id, amount::float8 as amount, label, entered_at from user_cash_entries where user_id = app_uid() and game_id = $1 order by entered_at desc limit 200`, [GAME]),
      // Inner join to findings: RLS hides future-chapter / unpublished findings, so they never appear.
      () => c.query(`select h.finding_id, h.status, h.note, h.updated_at, f.title, f.category, f.summary, f.verification, f.chapter_min
               from user_hunts h join findings f on f.id = h.finding_id where h.user_id = app_uid() and app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level) order by h.updated_at desc`),
    ]);
    const cashRows = cash.rows as CashRow[];
    return {
      notes: (prog.rows[0]?.notes ?? '') as string,
      tasks: tasks.rows as TaskRow[],
      cash: cashRows,
      cashTotal: cashRows.reduce((a, r) => a + Number(r.amount), 0),
      hunts: hunts.rows as HuntItem[],
    };
  });
}

export async function addTask(userId: string, text: string) {
  return asUser(userId, (c) => c.query(
    `insert into user_tasks(user_id, game_id, text, sort) values (app_uid(), $1, $2,
       coalesce((select max(sort)+1 from user_tasks where user_id = app_uid() and game_id = $1), 0))`, [GAME, text]));
}
export async function setTaskDone(userId: string, id: string, done: boolean) {
  return asUser(userId, (c) => c.query(`update user_tasks set done = $2 where id = $1 and user_id = app_uid()`, [id, done]));
}
export async function deleteTask(userId: string, id: string) {
  return asUser(userId, (c) => c.query(`delete from user_tasks where id = $1 and user_id = app_uid()`, [id]));
}
export async function moveTask(userId: string, id: string, dir: 'up' | 'down') {
  return asUser(userId, async (c) => {
    const rows = (await c.query(`select id from user_tasks where user_id = app_uid() and game_id = $1 order by sort, created_at`, [GAME])).rows.map((r) => r.id as string);
    const i = rows.indexOf(id); const j = dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (let k = 0; k < rows.length; k++) await c.query(`update user_tasks set sort = $2 where id = $1 and user_id = app_uid()`, [rows[k], k]);
  });
}
export async function saveNotes(userId: string, notes: string) {
  if (notes.length > 20000) throw new Error('Notes are limited to 20,000 characters.');
  return asUser(userId, (c) => c.query(
    `insert into user_progress(user_id, game_id, notes) values (app_uid(), $1, $2)
     on conflict (user_id, game_id) do update set notes = excluded.notes, updated_at = now()`, [GAME, notes]));
}
export async function addCash(userId: string, amount: number, label: string) {
  return asUser(userId, (c) => c.query(`insert into user_cash_entries(user_id, game_id, amount, label) values (app_uid(), $1, $2, $3)`, [GAME, amount, label]));
}
export async function deleteCash(userId: string, id: string) {
  return asUser(userId, (c) => c.query(`delete from user_cash_entries where id = $1 and user_id = app_uid()`, [id]));
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------
export async function buildExport(userId: string) {
  return asUser(userId, async (c) => {
    const [u, profile, device, alerts, prog, tasks, cash, hunts, pins, digests, consents] = await inOrder([
      () => c.query(`select email, display_name, created_at from users where id = app_uid()`),
      () => c.query(`select platform, chapter, spoiler_shield, timezone, saved_region from user_game_profiles where user_id = app_uid() and game_id = $1`, [GAME]),
      () => c.query(`select primary_device, other_devices, theme, reduced_motion from player_device_preferences where user_id = app_uid()`),
      () => c.query(`select email_enabled, send_local_time::text as send_local_time, sections, include_private_screenshots from alert_preferences where user_id = app_uid()`),
      () => c.query(`select notes from user_progress where user_id = app_uid() and game_id = $1`, [GAME]),
      () => c.query(`select text, done, sort from user_tasks where user_id = app_uid() and game_id = $1 order by sort, created_at`, [GAME]),
      () => c.query(`select amount::float8 as amount, label, entered_at from user_cash_entries where user_id = app_uid() and game_id = $1 order by entered_at`, [GAME]),
      () => c.query(`select h.finding_id, h.status, h.note, h.updated_at, case when app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level) then f.title end as title from user_hunts h left join findings f on f.id = h.finding_id where h.user_id = app_uid() order by h.updated_at`),
      () => c.query(`select label, note, x::float8 as x, y::float8 as y, finding_id, created_at from user_private_pins where user_id = app_uid() and game_id = $1 order by created_at`, [GAME]),
      () => c.query(`select local_date::text as local_date, status, subject, chapter from digest_runs where user_id = app_uid() and game_id = $1 order by local_date`, [GAME]),
      () => c.query(`select consent, granted, granted_at from privacy_consents where user_id = app_uid() order by consent`),
    ]);
    return {
      app: 'GTA VI Strategy HQ', format_version: 1, exported_at: new Date().toISOString(),
      account: u.rows[0] ?? null,
      profile: profile.rows[0] ?? null,
      preferences: { device: device.rows[0] ?? null, morning_email: alerts.rows[0] ?? null, consents: consents.rows },
      notes: (prog.rows[0]?.notes ?? '') as string,
      tasks: tasks.rows,
      cash_entries: cash.rows,
      hunts: hunts.rows,
      private_pins: pins.rows,
      digests: digests.rows,
    };
  });
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function exportToCsv(d: Awaited<ReturnType<typeof buildExport>>): string {
  const lines = ['type,title_or_label,status_or_done,amount,when'];
  for (const h of d.hunts) lines.push(['hunt', h.title ?? h.finding_id, h.status, '', h.updated_at].map(csvCell).join(','));
  for (const t of d.tasks) lines.push(['task', t.text, t.done ? 'done' : 'open', '', ''].map(csvCell).join(','));
  for (const e of d.cash_entries) lines.push(['cash_entry', e.label, 'entered_by_user', e.amount, e.entered_at].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

export const BackupSchema = z.object({
  notes: z.string().max(20000).optional(),
  tasks: z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean().optional() })).max(300).optional(),
  cash_entries: z.array(z.object({ amount: z.number().int().min(-1e12).max(1e12), label: z.string().trim().min(1).max(120) })).max(1000).optional(),
  hunts: z.array(z.object({ finding_id: z.string().uuid(), status: z.enum(['saved', 'found', 'skipped']), note: z.string().max(500).nullish() })).max(2000).optional(),
}); // unknown keys (user_id, account, ...) are stripped by zod

export type ImportResult = { ok: true; tasks: number; cash: number; hunts: number; skippedHunts: number; notes: boolean } | { ok: false; error: string };

export async function importBackup(userId: string, raw: unknown): Promise<ImportResult> {
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'That file is not a valid HQ backup: ' + parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'root'} ${i.message}`).join('; ') };
  const d = parsed.data;
  if (d.notes === undefined && !d.tasks && !d.cash_entries && !d.hunts) return { ok: false, error: 'The file has nothing to restore (no notes, tasks, cash entries or hunts).' };
  return asUser(userId, async (c: Tx) => {
    let hunts = 0; let skipped = 0;
    if (d.notes !== undefined) {
      await c.query(`insert into user_progress(user_id, game_id, notes) values (app_uid(), $1, $2)
                     on conflict (user_id, game_id) do update set notes = excluded.notes, updated_at = now()`, [GAME, d.notes]);
    }
    if (d.tasks) {
      await c.query(`delete from user_tasks where user_id = app_uid() and game_id = $1`, [GAME]);
      for (let i = 0; i < d.tasks.length; i++) {
        await c.query(`insert into user_tasks(user_id, game_id, text, done, sort) values (app_uid(), $1, $2, $3, $4)`, [GAME, d.tasks[i].text, d.tasks[i].done ?? false, i]);
      }
    }
    if (d.cash_entries) {
      await c.query(`delete from user_cash_entries where user_id = app_uid() and game_id = $1`, [GAME]);
      for (const e of d.cash_entries) await c.query(`insert into user_cash_entries(user_id, game_id, amount, label) values (app_uid(), $1, $2, $3)`, [GAME, e.amount, e.label]);
    }
    if (d.hunts) {
      // RLS on findings = the spoiler gate: ids this user may not see are skipped.
      const ids = [...new Set(d.hunts.map((h) => h.finding_id))];
      const visible = new Set((await c.query(`select f.id from findings f where f.id = any($1::uuid[]) and app_finding_visible(f.game_id, f.publication_status, f.chapter_min, f.spoiler_level)`, [ids])).rows.map((r) => r.id as string));
      for (const h of d.hunts) {
        if (!visible.has(h.finding_id)) { skipped++; continue; }
        await c.query(`insert into user_hunts(user_id, finding_id, status, note) values (app_uid(), $1, $2, $3)
                       on conflict (user_id, finding_id) do update set status = excluded.status, note = excluded.note, updated_at = now()`, [h.finding_id, h.status, h.note ?? null]);
        hunts++;
      }
    }
    return { ok: true as const, tasks: d.tasks?.length ?? 0, cash: d.cash_entries?.length ?? 0, hunts, skippedHunts: skipped, notes: d.notes !== undefined };
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function getSettings(userId: string) {
  return asUser(userId, async (c) => {
    const [profile, device, alerts, game, flag, ent, sub, consent] = await inOrder([
      () => c.query(`select platform, chapter, spoiler_shield, timezone, saved_region from user_game_profiles where user_id = app_uid() and game_id = $1`, [GAME]),
      () => c.query(`select primary_device, other_devices, theme, reduced_motion from player_device_preferences where user_id = app_uid()`),
      () => c.query(`select email_enabled, to_char(send_local_time,'HH24:MI') as send_local_time, sections from alert_preferences where user_id = app_uid()`),
      () => c.query(`select max_chapter from games where id = $1`, [GAME]),
      () => c.query(`select enabled from feature_flags where key = 'email_delivery'`),
      () => c.query(`select feature, limit_value from entitlements where user_id = app_uid()`),
      () => c.query(`select s.plan_id, s.status, p.label, p.description, p.features from subscriptions s join plan_catalog p on p.id = s.plan_id
               where s.user_id = app_uid() and s.status in ('grandfathered','active','trialing','past_due') limit 1`),
      () => c.query(`select consent, granted from privacy_consents where user_id = app_uid()`),
    ]);
    const consents = Object.fromEntries(consent.rows.map((r) => [r.consent, r.granted])) as Record<string, boolean>;
    return {
      profile: profile.rows[0] ?? { platform: 'PS5', chapter: 1, spoiler_shield: true, timezone: 'America/New_York', saved_region: null },
      device: device.rows[0] ?? { primary_device: 'iPhone', other_devices: [] as string[], theme: 'neon', reduced_motion: false },
      alerts: alerts.rows[0] ?? { email_enabled: false, send_local_time: '08:30', sections: [] as string[] },
      maxChapter: (game.rows[0]?.max_chapter ?? 1) as number,
      emailFlag: flag.rows[0]?.enabled === true,
      hasMorningEmail: ent.rows.some((r) => r.feature === 'morning_email'),
      plan: sub.rows[0] ?? null,
      consents,
    };
  });
}

export const PLATFORMS = ['PS5', 'XBOX_SERIES', 'PC', 'OTHER'] as const;
export const THEMES = ['neon', 'subtle', 'velvet'] as const;
export const EMAIL_SECTIONS = ['top3', 'vehicles', 'weapons', 'money', 'secrets', 'missions', 'rewards', 'corrections', 'health'] as const;

export async function saveProfile(userId: string, v: { platform: string; chapter: number; spoiler_shield: boolean; timezone: string; saved_region: string | null }) {
  return asUser(userId, async (c) => {
    const max = (await c.query(`select max_chapter from games where id = $1`, [GAME])).rows[0]?.max_chapter ?? 1;
    if (v.chapter < 1 || v.chapter > max) throw new Error(`Chapter must be between 1 and ${max}.`);
    await c.query(`insert into user_game_profiles(user_id, game_id, platform, chapter, spoiler_shield, timezone, saved_region)
      values (app_uid(), $1, $2, $3, $4, $5, $6)
      on conflict (user_id, game_id) do update set platform = excluded.platform, chapter = excluded.chapter,
        spoiler_shield = excluded.spoiler_shield, timezone = excluded.timezone, saved_region = excluded.saved_region`,
      [GAME, v.platform, v.chapter, v.spoiler_shield, v.timezone, v.saved_region]);
  });
}
export async function saveDevice(userId: string, v: { theme: string; reduced_motion: boolean; primary_device: string; other_devices: string[] }) {
  return asUser(userId, (c) => c.query(`insert into player_device_preferences(user_id, theme, reduced_motion, primary_device, other_devices)
    values (app_uid(), $1, $2, $3, $4)
    on conflict (user_id) do update set theme = excluded.theme, reduced_motion = excluded.reduced_motion,
      primary_device = excluded.primary_device, other_devices = excluded.other_devices, updated_at = now()`,
    [v.theme, v.reduced_motion, v.primary_device, v.other_devices]));
}
export async function saveAlerts(userId: string, v: { email_enabled: boolean; send_local_time: string; sections: string[] }) {
  return asUser(userId, async (c) => {
    await c.query(`insert into alert_preferences(user_id, email_enabled, send_local_time, sections) values (app_uid(), $1, $2, $3)
      on conflict (user_id) do update set email_enabled = excluded.email_enabled, send_local_time = excluded.send_local_time,
        sections = excluded.sections, updated_at = now()`, [v.email_enabled, v.send_local_time, v.sections]);
    await c.query(`insert into privacy_consents(user_id, consent, granted) values (app_uid(), 'email_briefing', $1)
      on conflict (user_id, consent) do update set granted = excluded.granted, granted_at = now()`, [v.email_enabled]);
  });
}
export async function setConsent(userId: string, consent: 'screenshot_analysis', granted: boolean) {
  return asUser(userId, (c) => c.query(`insert into privacy_consents(user_id, consent, granted) values (app_uid(), $1, $2)
    on conflict (user_id, consent) do update set granted = excluded.granted, granted_at = now()`, [consent, granted]));
}


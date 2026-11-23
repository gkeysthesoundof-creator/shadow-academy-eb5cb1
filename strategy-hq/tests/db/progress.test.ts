import { describe, it, expect, beforeAll } from 'vitest';
import { asUser, asService } from '@/lib/db';
import { resetDb, makeUser, makeFinding } from './helpers';
import { addTask, addCash, saveNotes, buildExport, exportToCsv, importBackup, saveProfile, getSettings, getPlaybook } from '@/lib/repo/progress';

let A = ''; let B = ''; let visible = ''; let future = '';

beforeAll(async () => {
  await resetDb();
  A = await makeUser('prog-a'); B = await makeUser('prog-b');
  visible = await makeFinding({ title: 'Visible car', chapter_min: 1, spoiler: 'none', category: 'vehicle' });
  future = await makeFinding({ title: 'Future gun', chapter_min: 5, spoiler: 'story', category: 'weapon', scouts: ['weapons_scout'] });
  await addTask(B, 'B private task'); await addCash(B, 999, 'B cash'); await saveNotes(B, 'B notes');
  await asUser(B, (c) => c.query(`insert into user_hunts(user_id, finding_id, status) values (app_uid(), $1, 'found')`, [visible]));
});

describe('progress import/export', () => {
  it('import for A cannot write rows owned by B, even with B user_id in the file', async () => {
    const r = await importBackup(A, {
      user_id: B, notes: 'A notes',
      tasks: [{ user_id: B, text: 'A task', done: true }],
      cash_entries: [{ user_id: B, amount: 500, label: 'A cash' }],
      hunts: [{ user_id: B, finding_id: visible, status: 'saved' }, { finding_id: future, status: 'found' }],
    });
    expect(r).toMatchObject({ ok: true, tasks: 1, cash: 1, hunts: 1, skippedHunts: 1 });
    const b = await getPlaybook(B);
    expect(b.tasks.map((t) => t.text)).toContain('B private task');
    expect(b.tasks.map((t) => t.text)).not.toContain('A task');
    expect(b.cash.map((c) => c.label)).toEqual(['B cash']);
    expect(b.notes).toBe('B notes');
    expect(b.hunts[0].status).toBe('found');
    const a = await getPlaybook(A);
    expect(a.tasks.map((t) => t.text)).toEqual(['A task']); // import replaces seeded starter tasks
    expect(a.hunts.map((h) => h.finding_id)).toEqual([visible]);
    const rows = await asService((c) => c.query(`select user_id from user_hunts where finding_id = $1 order by user_id`, [future]));
    expect(rows.rowCount).toBe(0);
  });

  it('rejects malformed backups', async () => {
    expect((await importBackup(A, { tasks: [{ text: '' }] })).ok).toBe(false);
    expect((await importBackup(A, { hunts: [{ finding_id: 'nope', status: 'found' }] })).ok).toBe(false);
    expect((await importBackup(A, {})).ok).toBe(false);
  });

  it('export contains only A data', async () => {
    const ex = await buildExport(A);
    const s = JSON.stringify(ex);
    expect(s).toContain('A task'); expect(s).toContain('A cash');
    expect(s).not.toContain('B private task'); expect(s).not.toContain('B cash'); expect(s).not.toContain('B notes');
    expect(exportToCsv(ex)).toContain('A cash');
    // round trip
    const again = await importBackup(A, JSON.parse(s));
    expect(again.ok).toBe(true);
  });
});

describe('settings and deletion', () => {
  it('chapter update persists and is bounded by games.max_chapter', async () => {
    const base = { platform: 'PS5', spoiler_shield: true, timezone: 'America/New_York', saved_region: null };
    await saveProfile(A, { ...base, chapter: 1, saved_region: 'Vice City' });
    expect((await getSettings(A)).profile).toMatchObject({ chapter: 1, saved_region: 'Vice City' });
    await expect(saveProfile(A, { ...base, chapter: 2 })).rejects.toThrow(/between 1 and/);
    await asService((c) => c.query(`update games set max_chapter = 3 where id = 'gta6'`));
    await saveProfile(A, { ...base, chapter: 2 });
    expect((await getSettings(A)).profile.chapter).toBe(2);
    await asService((c) => c.query(`update games set max_chapter = 1 where id = 'gta6'`));
  });

  it('account deletion cascades', async () => {
    await asService((c) => c.query('delete from users where id = $1', [A]));
    const r = await asService((c) => c.query(`select
      (select count(*)::int from user_tasks where user_id = $1) t, (select count(*)::int from user_cash_entries where user_id = $1) c,
      (select count(*)::int from user_hunts where user_id = $1) h, (select count(*)::int from user_progress where user_id = $1) p,
      (select count(*)::int from user_game_profiles where user_id = $1) g`, [A]));
    expect(Object.values(r.rows[0])).toEqual([0, 0, 0, 0, 0]);
    expect((await getPlaybook(B)).tasks.map((t) => t.text)).toContain('B private task');
  });
});

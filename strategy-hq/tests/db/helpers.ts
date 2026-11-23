import { asService } from '@/lib/db';
import { provisionUser } from '@/lib/auth/core';
import { seedReferenceData } from '@/lib/seed';

export async function resetDb() {
  await asService(async (c) => {
    await c.query(`truncate users, sessions, findings, places, map_assets, raw_posts, ingestion_jobs, source_runs, scout_runs,
      corrections, admin_review_log, digest_runs, billing_webhook_events, platform_budget, rate_limits, content_takedowns cascade`);
    await c.query(`delete from workspaces where kind <> 'platform'`);
    await seedReferenceData(c);
  });
}

export async function makeUser(name: string, role: 'owner' | 'admin' | 'moderator' | 'customer' = 'customer', chapter = 1) {
  return asService(async (c) => {
    const id = await provisionUser(c, { email: `${name}@test.local`, password: 'test-password-123', displayName: name, role, plan: role === 'owner' ? 'founder' : 'free' });
    await c.query('update user_game_profiles set chapter = $2 where user_id = $1', [id, chapter]);
    return id;
  });
}

export async function makeFinding(opts: { title: string; chapter_min: number | null; spoiler?: 'none' | 'mild' | 'story'; category?: string; scouts?: string[]; status?: string; verification?: string; scope?: string; place_id?: string | null }) {
  return asService(async (c) => {
    const r = await c.query(
      `insert into findings(game_id, game_scope, category, title, summary, chapter_min, spoiler_level, publication_status, verification, dedupe_key, place_id, published_at)
       values ('gta6',$1,$2,$3,'test summary',$4,$5,$6,$7,$8,$9, now()) returning id`,
      [opts.scope ?? 'GTA_VI', opts.category ?? 'vehicle', opts.title, opts.chapter_min, opts.spoiler ?? 'story', opts.status ?? 'published',
       opts.verification ?? 'verified', `test-${opts.title}-${Math.random()}`, opts.place_id ?? null]);
    for (const s of opts.scouts ?? ['vehicle_scout']) await c.query('insert into scout_finding_links values ($1,$2)', [s, r.rows[0].id]);
    await c.query(`insert into evidence(finding_id, url, title, paraphrase, evidence_type, independent_origin)
                   values ($1,'https://example.com/e','Fixture evidence','fixture','guide','example.com')`, [r.rows[0].id]);
    return r.rows[0].id as string;
  });
}

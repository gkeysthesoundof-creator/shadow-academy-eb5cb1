import { NextResponse } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/lib/auth/session';
import { rateLimit } from '@/lib/auth/core';
import { asUser } from '@/lib/db';
import { config } from '@/lib/config';
import { localParts } from '@/lib/domain/schedule';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX = 8 * 1024 * 1024;
const noStore = { 'Cache-Control': 'private, no-store' };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

/** Identify the image type from magic bytes only. The filename and client MIME are never trusted. */
function sniffImage(b: Uint8Array): { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp' } | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return fail('Sign in required.', 401);
  if (Number(req.headers.get('content-length') ?? 0) > MAX + 64 * 1024) return fail('Image is larger than 8 MB.', 413);
  if (!(await rateLimit(`shot:${user.id}`, 20, 60))) return fail('Too many uploads. Wait a minute.', 429);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail('Expected a multipart upload with a "file" field.', 400); }
  const file = form.get('file');
  if (!(file instanceof File)) return fail('Choose an image file.', 400);
  if (file.size <= 0) return fail('That file is empty.', 400);
  if (file.size > MAX) return fail('Image is larger than 8 MB.', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) return fail('Only PNG, JPEG or WEBP images are accepted.', 415);
  const qRaw = form.get('question');
  const question = typeof qRaw === 'string' && qRaw.trim() ? qRaw.trim().slice(0, 500) : null;

  // Entitlement + daily meter (as the user; missing entitlement = not included).
  const day = localParts(new Date(), config.timezone).date;
  const ent = await asUser(user.id, (c) => c.query(`select limit_value from entitlements where feature = 'screenshot_uploads_daily'`));
  if (!ent.rowCount) return fail('Your plan does not include screenshot uploads.', 403);
  const ok = await asUser(user.id, (c) => c.query(`select consume_usage('screenshot_uploads_daily', $1, $2) ok`, [ent.rows[0].limit_value, day]));
  if (!ok.rows[0].ok) return fail('You have used your screenshot uploads for today.', 429);

  const id = randomUUID();
  const key = `${user.id}/shots/${id}.${kind.ext}`;
  const abs = path.resolve(config.uploadDir, key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes, { mode: 0o600 });
  const sha = createHash('sha256').update(bytes).digest('hex');
  const row = await asUser(user.id, (c) => c.query(
    `insert into user_screenshots(id, user_id, storage_key, mime, bytes, sha256, consent_analysis, question)
     values ($1, app_uid(), $2, $3, $4, $5,
       coalesce((select granted from privacy_consents where user_id = app_uid() and consent = 'screenshot_analysis'), false), $6)
     returning id, consent_analysis, created_at`,
    [id, key, kind.mime, bytes.length, sha, question]));
  return NextResponse.json({
    id: row.rows[0].id,
    saved: true,
    analysis: 'not_connected',
    consent_analysis: row.rows[0].consent_analysis,
    message: 'Saved privately. Image analysis is not connected yet — nothing was sent anywhere.',
  }, { status: 201, headers: noStore });
}

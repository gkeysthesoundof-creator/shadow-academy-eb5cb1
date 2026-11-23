import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response('Sign in required', { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  // Owner-only: RLS plus an explicit user filter (admins are NOT given other users' images).
  const r = await asUser(user.id, (c) => c.query(`select storage_key, mime from user_screenshots where id = $1 and user_id = app_uid()`, [id]));
  if (!r.rowCount) return notFound();
  const root = path.resolve(config.uploadDir);
  const abs = path.resolve(root, r.rows[0].storage_key);
  if (!abs.startsWith(root + path.sep)) return notFound();
  let buf: Buffer;
  try { buf = await readFile(abs); } catch { return notFound(); }
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': r.rows[0].mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

import { NextResponse } from 'next/server';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { deleteUserMapAsset, getReadableAsset } from '@/lib/repo/map';

export const runtime = 'nodejs';
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });

/** Resolve a storage key strictly inside the upload directory. */
function safePath(key: string): string | null {
  const root = path.resolve(config.uploadDir);
  const abs = path.resolve(root, key);
  return abs.startsWith(root + path.sep) ? abs : null;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await ctx.params;
  const asset = await getReadableAsset(user.id, id);
  if (!asset) return notFound();
  const abs = safePath(asset.storage_key);
  if (!abs) return notFound();
  let data: Buffer;
  try { data = await readFile(abs); } catch { return notFound(); }
  return new NextResponse(new Uint8Array(data), {
    headers: { 'Content-Type': asset.mime, 'Content-Length': String(data.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const { id } = await ctx.params;
  const key = await deleteUserMapAsset(user.id, id);
  if (!key) return notFound();
  const abs = safePath(key);
  if (abs) await rm(abs, { force: true });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
}

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { currentUser } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { MAX_MAP_BYTES, createUserMapAsset, pngSize, validateMapUpload } from '@/lib/repo/map';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_MAP_BYTES + 64 * 1024) return NextResponse.json({ error: 'The file is larger than 8 MB.' }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Expected a multipart form upload.' }, { status: 400 }); }
  if (String(form.get('purpose') ?? 'map') !== 'map') return NextResponse.json({ error: 'Unsupported upload purpose.' }, { status: 400 });
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
  if (file.size > MAX_MAP_BYTES) return NextResponse.json({ error: 'The file is larger than 8 MB.' }, { status: 413 });
  const buf = new Uint8Array(await file.arrayBuffer());
  const v = validateMapUpload(buf);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 415 });

  const rel = `${user.id}/${randomUUID()}.${v.type.ext}`;
  const root = path.resolve(config.uploadDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return NextResponse.json({ error: 'Invalid path.' }, { status: 400 });
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf, { mode: 0o600 });
  const dims = v.type.mime === 'image/png' ? pngSize(buf) : null;
  try {
    const asset = await createUserMapAsset(user.id, { storage_key: rel, mime: v.type.mime, width: dims?.width ?? null, height: dims?.height ?? null });
    return NextResponse.json({ id: asset.id, mime: asset.mime, width: asset.width, height: asset.height, calibrated: false, url: `/api/uploads/${asset.id}` }, { status: 201 });
  } catch (e) {
    const { rm } = await import('node:fs/promises');
    await rm(abs, { force: true });
    throw e;
  }
}

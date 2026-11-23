import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { config } from '@/lib/config';
import { tick } from '@/lib/workers/scheduler';

export const maxDuration = 300;

function authorized(req: Request) {
  const secret = config.cronSecret;
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!secret || !got) return false;
  const a = Buffer.from(secret); const b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called every 15 minutes (UTC) by Vercel Cron, Supabase pg_cron or GitHub Actions. */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await tick());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
export const POST = GET;

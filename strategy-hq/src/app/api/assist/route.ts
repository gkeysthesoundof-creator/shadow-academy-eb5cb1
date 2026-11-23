import { NextResponse } from 'next/server';
import { z } from 'zod';
import { currentUser, currentProfile } from '@/lib/auth/session';
import { rateLimit } from '@/lib/auth/core';
import { answerQuestion } from '@/lib/assistant/llm';

export const dynamic = 'force-dynamic';

const Body = z.object({ question: z.string().trim().min(1).max(1000), noVideo: z.boolean().optional() });
const noStore = { 'Cache-Control': 'private, no-store' };

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: noStore });
  if (Number(req.headers.get('content-length') ?? 0) > 8_000) return NextResponse.json({ error: 'Request too large.' }, { status: 413, headers: noStore });
  if (!(await rateLimit(`assist:${user.id}`, 30, 60))) {
    return NextResponse.json({ error: 'Too many questions. Wait a minute and try again.' }, { status: 429, headers: noStore });
  }
  let json: unknown;
  try { json = JSON.parse(await req.text()); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400, headers: noStore }); }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'Ask a question of 1 to 1000 characters.' }, { status: 400, headers: noStore });
  const profile = await currentProfile(user.id);
  try {
    const out = await answerQuestion({ userId: user.id, chapter: profile.chapter, question: parsed.data.question, noVideo: parsed.data.noVideo });
    return NextResponse.json(out, { headers: noStore });
  } catch (e) {
    console.error('assist failed', (e as Error).message);
    return NextResponse.json({ error: 'The assistant hit an error. Nothing was guessed.' }, { status: 500, headers: noStore });
  }
}

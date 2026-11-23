import { NextResponse } from 'next/server';
import { config } from '@/lib/config';
import { verifySignature, normalize, applyEvent } from '@/lib/billing/adapter';

export async function POST(req: Request) {
  if (config.billingProvider === 'none' || !config.billingWebhookSecret) {
    return NextResponse.json({ error: 'billing not configured' }, { status: 503 });
  }
  const body = await req.text();
  if (body.length > 256_000) return NextResponse.json({ error: 'too large' }, { status: 413 });
  if (!verifySignature(config.billingWebhookSecret, req.headers.get('x-gsq-signature'), body)) {
    return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const ev = normalize(parsed);
  if (!ev) return NextResponse.json({ error: 'unrecognized event' }, { status: 400 });
  const outcome = await applyEvent(config.billingProvider, ev, body);
  return NextResponse.json({ received: true, outcome });
}

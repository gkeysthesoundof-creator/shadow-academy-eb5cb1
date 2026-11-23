import { NextResponse } from 'next/server';
import { asService } from '@/lib/db';

/** Liveness + data freshness. No secrets, no user data. */
export async function GET() {
  try {
    const r = await asService((c) => c.query(`select max(finished_at) last_scan from ingestion_jobs where status in ('succeeded','partial')`));
    return NextResponse.json({ ok: true, db: 'up', last_scan: r.rows[0].last_scan }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false, db: 'down' }, { status: 503 });
  }
}

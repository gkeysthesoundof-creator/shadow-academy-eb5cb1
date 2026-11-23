import Link from 'next/link';
import { VERIFICATION_LABEL, type Verification } from '@/lib/domain/evidence';
import { CATEGORY_LABELS, scoutById, type FindingCategory } from '@/lib/domain/scouts';
import { formatPayout } from '@/lib/domain/money';
import type { FindingRow, ScoutState } from '@/lib/repo/intel';

export function VerificationTag({ v }: { v: string }) {
  return <span className={`tag v-${v}`}>{VERIFICATION_LABEL[v as Verification] ?? v}</span>;
}

export function Unknown({ children = 'UNKNOWN' }: { children?: React.ReactNode }) {
  return <span className="unknown">{children}</span>;
}

export function isNew(f: Pick<FindingRow, 'published_at'>, now = Date.now()) {
  return !!f.published_at && now - new Date(f.published_at).getTime() < 24 * 3600_000;
}

export function FindingCard({ f, href }: { f: FindingRow; href?: string }) {
  const payoutKnown = f.payout_min != null || f.payout_max != null;
  return (
    <Link href={href ?? `/intel/${f.id}`} className="fcard">
      <div className="tags">
        <VerificationTag v={f.verification} />
        <span className="tag">{CATEGORY_LABELS[f.category as FindingCategory] ?? f.category}</span>
        <span className="tag">{f.chapter_min ? `CH ${f.chapter_min}+` : 'ANY CHAPTER'}</span>
        {f.game_scope === 'GTA_ONLINE' ? <span className="tag v-expired">GTA ONLINE</span> : null}
        {isNew(f) ? <span className="tag new">NEW</span> : null}
        {f.lifecycle === 'corrected' ? <span className="tag v-expired">CORRECTED</span> : null}
        {f.hunt_status === 'found' ? <span className="tag found">FOUND</span> : f.hunt_status === 'saved' ? <span className="tag saved">SAVED</span> : null}
      </div>
      <div className="title">{f.title}</div>
      <p>{f.summary}</p>
      <div className="row small muted" style={{ marginTop: 8 }}>
        <span>📍 {f.landmark ?? 'Landmark not verified'}</span>
        {payoutKnown ? <span>· 💵 {formatPayout(f.payout_min, f.payout_max)}</span> : null}
        <span>· {f.evidence_count} source{f.evidence_count === 1 ? '' : 's'}</span>
      </div>
    </Link>
  );
}

export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>;
}

export function ScoutStatePill({ state }: { state: ScoutState }) {
  const cls = state === 'CONNECTED' ? 'green' : state === 'PARTIAL' ? 'gold' : state === 'FAILING' ? 'red' : state === 'STALE' ? 'gold' : 'muted';
  return <span className={`pill ${cls}`}><span className="dot" aria-hidden="true" />{state}</span>;
}

export function ScoutTitle({ id }: { id: string }) {
  const s = scoutById(id);
  return <>{s?.icon} {s?.name}</>;
}

export function timeAgo(d: string | Date | null | undefined): string {
  if (!d) return 'never';
  const ms = Date.now() - new Date(d).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function fmtDate(d: string | Date | null | undefined, tz = 'America/New_York') {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

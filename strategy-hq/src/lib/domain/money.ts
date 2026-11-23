/**
 * Cash Trail ranking. Cash-per-hour is computed ONLY when both payout and time
 * are evidenced; otherwise it is UNKNOWN and the item ranks by simpler evidence.
 */
export interface MoneyItem {
  id: string;
  money_kind: 'world_pickup' | 'one_time_loot' | 'repeatable_activity';
  payout_min: number | null;
  payout_max: number | null;
  time_minutes_min: number | null;
  time_minutes_max: number | null;
  verification: string;
  risk: 'low' | 'medium' | 'high' | 'unknown';
  patched: boolean;
}

export function cashPerHour(m: MoneyItem): { low: number; high: number } | 'UNKNOWN' {
  if (m.payout_min == null || m.payout_max == null || m.time_minutes_min == null || m.time_minutes_max == null) return 'UNKNOWN';
  if (m.time_minutes_min <= 0 || m.time_minutes_max <= 0) return 'UNKNOWN';
  return {
    low: Math.round((m.payout_min / m.time_minutes_max) * 60),
    high: Math.round((m.payout_max / m.time_minutes_min) * 60),
  };
}

const VER_RANK: Record<string, number> = { verified: 4, corroborated: 3, single_report: 2, unverified: 1, debunked: -9, expired: -9 };
const RISK_RANK: Record<string, number> = { low: 3, medium: 2, high: 1, unknown: 0 };

/** Sort: patched/debunked last → evidence strength → known rate (desc) → risk (lower first). */
export function rankMoney(items: MoneyItem[]): MoneyItem[] {
  return [...items].sort((a, b) => {
    if (a.patched !== b.patched) return a.patched ? 1 : -1;
    const v = (VER_RANK[b.verification] ?? 0) - (VER_RANK[a.verification] ?? 0);
    if (v) return v;
    const ra = cashPerHour(a); const rb = cashPerHour(b);
    if (ra !== 'UNKNOWN' && rb !== 'UNKNOWN') return rb.low - ra.low;
    if (ra !== 'UNKNOWN') return -1;
    if (rb !== 'UNKNOWN') return 1;
    return (RISK_RANK[b.risk] ?? 0) - (RISK_RANK[a.risk] ?? 0);
  });
}

export function formatCash(n: number | null | undefined): string {
  if (n == null) return 'UNKNOWN';
  return '$' + n.toLocaleString('en-US');
}

export function formatPayout(min: number | null, max: number | null): string {
  if (min == null && max == null) return 'UNKNOWN';
  if (min != null && max != null && min !== max) return `${formatCash(min)}–${formatCash(max)}`;
  return formatCash(min ?? max);
}

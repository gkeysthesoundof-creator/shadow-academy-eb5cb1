/**
 * Evidence tiers and lifecycle. Pure functions so the rules are unit-tested
 * and identical in the worker, the admin UI and the email.
 */
export type Verification = 'verified' | 'corroborated' | 'single_report' | 'unverified' | 'debunked' | 'expired';

export interface EvidenceItem {
  evidence_type: 'official' | 'guide' | 'community' | 'user_report' | 'founder_observation';
  independent_origin: string;     // domain/author bucket
  contradicts: boolean;
  /** true when THIS system fetched/observed it (not merely seeded from a hand-off document). */
  system_observed: boolean;
}

export interface TierInput {
  evidence: EvidenceItem[];
  expired?: boolean;
  patched?: boolean;
  moderatorDebunked?: boolean;
}

/**
 * - debunked: a moderator debunked it, or contradicting evidence outweighs support
 * - expired: past deadline / patched out
 * - verified: an official source the system itself observed, OR founder in-game observation + 1 independent report
 * - corroborated: ≥2 independent origins agree, none contradict
 * - single_report: exactly one supporting origin
 * - unverified: nothing usable
 */
export function computeVerification(input: TierInput): Verification {
  if (input.moderatorDebunked) return 'debunked';
  const support = input.evidence.filter((e) => !e.contradicts);
  const contra = input.evidence.filter((e) => e.contradicts);
  const supportOrigins = new Set(support.map((e) => e.independent_origin.toLowerCase()));
  const contraOrigins = new Set(contra.map((e) => e.independent_origin.toLowerCase()));
  if (contraOrigins.size > 0 && contraOrigins.size >= supportOrigins.size) return 'debunked';
  if (input.expired || input.patched) return 'expired';
  if (support.some((e) => e.evidence_type === 'official' && e.system_observed)) return 'verified';
  const founderSeen = support.some((e) => e.evidence_type === 'founder_observation');
  if (founderSeen && supportOrigins.size >= 2) return 'verified';
  if (supportOrigins.size >= 2 && contraOrigins.size === 0) return 'corroborated';
  if (supportOrigins.size >= 1) return 'single_report';
  return 'unverified';
}

export const VERIFICATION_LABEL: Record<Verification, string> = {
  verified: 'VERIFIED', corroborated: 'CORROBORATED', single_report: 'SINGLE REPORT',
  unverified: 'UNVERIFIED', debunked: 'DEBUNKED', expired: 'EXPIRED',
};

/** Only these tiers may become actionable recommendations (Top 3, email). */
export function isRecommendable(v: Verification) { return v === 'verified' || v === 'corroborated'; }

/** Normalize a landmark/title into a stable dedupe key so scouts never duplicate a place. */
export function normalizeKey(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/\b(the|a|an|near|by|at|on|in|of)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Origin bucket for corroboration: same site/author never counts twice. */
export function originOf(url: string, author?: string | null): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^old\./, '');
    if (host.endsWith('reddit.com') && author) return `reddit:u/${author.toLowerCase()}`;
    return host;
  } catch {
    return 'invalid';
  }
}

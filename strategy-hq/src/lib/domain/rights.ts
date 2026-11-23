import type { AppMode } from '../config';

/**
 * Data-licensing gate. Each source/media item carries allowed uses. What may be
 * displayed depends on the product mode: the founder's private alpha is NOT a
 * licence to redistribute anything commercially.
 */
export type Use = 'private' | 'closed_beta' | 'commercial';
export type RightsStatus = 'unreviewed' | 'link_out_only' | 'personal_use' | 'licensed' | 'owned' | 'denied';

export function intendedUseForMode(mode: AppMode): Use {
  return mode === 'founder_private' ? 'private' : mode === 'closed_beta' ? 'closed_beta' : 'commercial';
}

export interface RightsRecord {
  rights_status: RightsStatus;
  allowed_uses: string[];
  expires_at: string | Date | null;
}

export type DisplayLevel = 'full_media' | 'summary_and_link' | 'link_only' | 'hidden';

/**
 * - denied / expired rights → hidden
 * - no record or unreviewed → link-out only (factual paraphrase allowed only from approved records)
 * - link_out_only → paraphrase + link, never embedded media
 * - personal_use → media only in private mode
 * - licensed/owned → media when the mode is in allowed_uses
 */
export function displayLevel(r: RightsRecord | null | undefined, mode: AppMode, now = new Date()): DisplayLevel {
  if (!r) return 'link_only';
  if (r.rights_status === 'denied') return 'hidden';
  if (r.expires_at && new Date(r.expires_at) < now) return 'hidden';
  const use = intendedUseForMode(mode);
  switch (r.rights_status) {
    case 'unreviewed': return 'link_only';
    case 'link_out_only': return 'summary_and_link';
    case 'personal_use': return use === 'private' ? 'full_media' : 'summary_and_link';
    case 'licensed':
    case 'owned':
      return r.allowed_uses.includes(use) ? 'full_media' : 'summary_and_link';
  }
}

export function mediaPublishable(
  media: { kind: 'real_gameplay' | 'user_owned' | 'illustrative'; license?: RightsRecord | null },
  mode: AppMode,
): boolean {
  if (media.kind === 'illustrative') return false; // never shown as evidence
  return displayLevel(media.license ?? null, mode) === 'full_media';
}

/** Can ingestion even collect from a source in this mode? (e.g. Reddit commercial use needs an agreement) */
export function ingestionAllowed(source: { kind: string; rights?: RightsRecord | null }, mode: AppMode): { ok: boolean; reason?: string } {
  if (source.rights?.rights_status === 'denied') return { ok: false, reason: 'rights denied' };
  if (source.kind === 'reddit' && mode === 'commercial') {
    const r = source.rights;
    if (!r || !(r.rights_status === 'licensed' && r.allowed_uses.includes('commercial'))) {
      return { ok: false, reason: 'Reddit commercial data use requires a separate agreement with Reddit' };
    }
  }
  return { ok: true };
}

import { asUser } from '../db';
import { listFindingsTx, type FindingRow } from '../repo/intel';
import { VERIFICATION_LABEL, type Verification } from '../domain/evidence';

/**
 * Local retrieval. ALWAYS available, no network, no model. It searches only the
 * findings the signed-in user may see (database spoiler gate + publication rules,
 * because it goes through asUser) and never invents an answer.
 */
export const NO_MATCH_MESSAGE = "I can't verify an answer for that yet. Nothing is guessed.";

const FILLER = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'be', 'i', 'im', 'me', 'my', 'we', 'you', 'it', 'its', 'to', 'of', 'in', 'on', 'at', 'for', 'and', 'or',
  'where', 'what', 'whats', 'how', 'can', 'do', 'does', 'find', 'get', 'got', 'now', 'near', 'right', 'please', 'tell', 'show', 'stuck', 'there',
]);

/** Strip filler words so "Where can I find money?" searches for "money". Falls back to the raw text when nothing is left. */
export function keywordQuery(q: string): string {
  const words = q.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !FILLER.has(w));
  return kept.join(' ');
}

export interface Citation {
  id: string; title: string; verification: string; verification_label: string; category: string;
  landmark: string | null; chapter_min: number | null; summary: string; steps: string[]; href: string; is_free: boolean | null;
}

export function toCitation(f: FindingRow): Citation {
  return {
    id: f.id, title: f.title, verification: f.verification,
    verification_label: VERIFICATION_LABEL[f.verification as Verification] ?? f.verification,
    category: f.category, landmark: f.landmark, chapter_min: f.chapter_min, summary: f.summary,
    steps: Array.isArray(f.how_to) ? f.how_to.slice(0, 6) : [], href: `/intel/${f.id}`, is_free: f.is_free,
  };
}

/** Top matches among the user's chapter-visible published GTA VI findings. */
export async function retrieveFindings(userId: string, question: string, limit = 5): Promise<FindingRow[]> {
  const raw = question.trim().slice(0, 1000);
  if (!raw) return [];
  const kw = keywordQuery(raw);
  return asUser(userId, async (c) => {
    if (kw) {
      const hit = await listFindingsTx(c, { q: kw, scope: 'GTA_VI', limit });
      if (hit.length) return hit;
    }
    if (kw === raw.toLowerCase()) return [];
    return listFindingsTx(c, { q: raw, scope: 'GTA_VI', limit });
  });
}

export interface LocalAnswer {
  text: string;
  citations: Citation[];
  noMatch: boolean;
}

export function buildLocalAnswer(rows: FindingRow[]): LocalAnswer {
  if (!rows.length) return { text: NO_MATCH_MESSAGE, citations: [], noMatch: true };
  const verified = rows.filter((r) => r.verification === 'verified' || r.verification === 'corroborated').length;
  const text = `Found ${rows.length} matching finding${rows.length === 1 ? '' : 's'} you can see at your chapter (${verified} verified or corroborated). `
    + 'Each card shows its verification tier; open one for the evidence.';
  return { text, citations: rows.map(toCitation), noMatch: false };
}

import { SCOUTS, type ScoutId } from './scouts';

/**
 * Deterministic topic router: decides which scout lenses should look at a raw
 * source item. Zero model cost. Ambiguous items go to the review queue, never
 * straight to publication.
 */
export function routeText(title: string, body = ''): ScoutId[] {
  const text = ` ${title} ${body} `.toLowerCase();
  const hits: ScoutId[] = [];
  for (const s of SCOUTS) {
    if (!s.keywords.length) continue;
    if (s.keywords.some((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text))) {
      hits.push(s.id);
    }
  }
  return hits;
}

/** Rough spoiler sniffing for raw community text → forces review + story-level tag. */
export function looksLikeStorySpoiler(text: string): boolean {
  return /\b(ending|final mission|dies|death of|betray|twist|chapter (\d{1,2})|epilogue|spoiler)\b/i.test(text);
}

export function chapterMentioned(text: string): number | null {
  const m = /\bchapter\s+(\d{1,2})\b/i.exec(text);
  return m ? Number(m[1]) : null;
}

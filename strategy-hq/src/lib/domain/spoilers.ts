/**
 * Application-side mirror of the database spoiler gate (app_finding_visible).
 * The database is the primary enforcement; this mirror is used for content that
 * leaves the database (email HTML, preheaders, alt text, assistant answers) so a
 * second independent check runs before anything is rendered.
 */
export interface Gateable {
  publication_status: string;
  chapter_min: number | null;
  spoiler_level: 'none' | 'mild' | 'story';
}

export function visibleAtChapter(f: Gateable, chapter: number): boolean {
  if (f.publication_status !== 'published') return false;
  if (f.chapter_min === null) return f.spoiler_level === 'none';
  return f.chapter_min <= chapter;
}

export function assertAllVisible<T extends Gateable & { id: string }>(items: T[], chapter: number): T[] {
  const leaked = items.filter((i) => !visibleAtChapter(i, chapter));
  if (leaked.length) {
    throw new Error(`spoiler gate violation: ${leaked.length} item(s) above chapter ${chapter}`);
  }
  return items;
}

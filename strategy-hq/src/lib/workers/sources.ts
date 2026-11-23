import { createHash } from 'node:crypto';

/**
 * Source adapters. Rules: respect robots.txt, identify ourselves, short timeouts,
 * store only title + short excerpt + link (never mirror full posts), never bypass
 * logins/paywalls/rate limits, never scrape Reddit (approved API only).
 */
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export const USER_AGENT = 'GameScoutHQ-OfficialWatch/0.2 (private fan companion; change detection only)';

export interface FetchedItem {
  original_id: string | null; url: string; title: string; excerpt: string | null; published_at: string | null; content_hash: string;
}
export interface AdapterResult {
  outcome: 'success' | 'partial' | 'failed' | 'blocked' | 'not_configured' | 'skipped';
  items: FetchedItem[]; coverage_note: string; error?: string;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Minimal robots.txt evaluation for User-agent: * (and our own token). */
export function robotsAllows(robotsTxt: string, path: string, agentToken = 'gamescouthq'): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null; let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(); const val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase()); lastWasAgent = true;
    } else if ((key === 'disallow' || key === 'allow') && cur) {
      lastWasAgent = false;
      if (key === 'disallow' && val === '') continue;
      cur.rules.push({ allow: key === 'allow', path: val });
    } else lastWasAgent = false;
  }
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && agentToken.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable) for (const r of g.rules) {
    const pattern = '^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    if (new RegExp(pattern).test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) {
      best = { allow: r.allow, len: r.path.length };
    }
  }
  return best ? best.allow : true;
}

function decode(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i');
  const m = re.exec(html);
  return m ? decode(m[1] ?? m[2] ?? '') : null;
}

/** Official page change watch: robots check → GET → title/description/date → content hash. */
export async function officialChangeWatch(url: string, fetcher: Fetcher): Promise<AdapterResult> {
  const u = new URL(url);
  try {
    const robots = await fetcher(`${u.origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (robots.ok && !robotsAllows(await robots.text(), u.pathname + u.search)) {
      return { outcome: 'blocked', items: [], coverage_note: 'robots.txt disallows this path; not fetched.' };
    }
    const res = await fetcher(url, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) return { outcome: 'failed', items: [], coverage_note: 'Rate limited by source; will retry next window.', error: 'HTTP 429' };
    if (!res.ok) return { outcome: 'failed', items: [], coverage_note: `HTTP ${res.status}`, error: `HTTP ${res.status}` };
    const html = (await res.text()).slice(0, 2_000_000);
    const title = meta(html, 'og:title') ?? decode(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '') ?? url;
    const description = meta(html, 'og:description') ?? meta(html, 'description');
    const published = meta(html, 'article:published_time');
    // Hash visible text only (scripts/styles stripped) so cosmetic churn is less noisy.
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const scriptRendered = text.trim().length < 400;
    return {
      outcome: scriptRendered ? 'partial' : 'success',
      items: [{
        original_id: null, url, title: title || url, excerpt: description ? description.slice(0, 280) : null,
        published_at: published, content_hash: hash(text),
      }],
      coverage_note: scriptRendered
        ? 'Page is script-rendered; only title/metadata observed. Individual articles may be missed.'
        : 'Page fetched; change detection by visible-text hash.',
    };
  } catch (e) {
    const msg = (e as Error).message;
    return { outcome: 'failed', items: [], coverage_note: 'Source unreachable from the server.', error: msg.slice(0, 300) };
  }
}

/** Reddit via the official Data API only (OAuth client credentials). Never scraped. */
export async function redditNew(subreddit: string, creds: { id?: string; secret?: string; ua?: string }, fetcher: Fetcher): Promise<AdapterResult> {
  if (!creds.id || !creds.secret || !creds.ua) {
    return { outcome: 'not_configured', items: [], coverage_note: 'Reddit Data API credentials not configured. Nothing fetched.' };
  }
  try {
    const tok = await fetcher('https://www.reddit.com/api/v1/access_token', {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { authorization: 'Basic ' + Buffer.from(`${creds.id}:${creds.secret}`).toString('base64'), 'user-agent': creds.ua, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!tok.ok) return { outcome: 'failed', items: [], coverage_note: 'Reddit token request rejected.', error: `HTTP ${tok.status}` };
    const { access_token } = (await tok.json()) as { access_token: string };
    const res = await fetcher(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=50&raw_json=1`, {
      headers: { authorization: `Bearer ${access_token}`, 'user-agent': creds.ua }, signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404 || res.status === 403) return { outcome: 'failed', items: [], coverage_note: `Community not accessible (HTTP ${res.status}).`, error: `HTTP ${res.status}` };
    if (!res.ok) return { outcome: 'failed', items: [], coverage_note: `HTTP ${res.status}`, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { data?: { children?: { data: Record<string, unknown> }[] } };
    const items: FetchedItem[] = (body.data?.children ?? []).map(({ data: d }) => ({
      original_id: String(d.name ?? d.id ?? ''),
      url: `https://www.reddit.com${String(d.permalink ?? '')}`,
      title: String(d.title ?? '').slice(0, 300),
      excerpt: d.selftext ? String(d.selftext).slice(0, 280) : null,      // short excerpt only
      published_at: d.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
      content_hash: hash(`${d.name}|${d.title}|${d.edited ?? ''}`),
    }));
    return { outcome: 'success', items, coverage_note: `Newest ${items.length} posts only (API page of 50). Not a complete review of the community.` };
  } catch (e) {
    return { outcome: 'failed', items: [], coverage_note: 'Reddit API unreachable.', error: (e as Error).message.slice(0, 300) };
  }
}

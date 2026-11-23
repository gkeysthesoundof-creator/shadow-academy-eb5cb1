import { formatLocalDate } from '../domain/schedule';
import { VERIFICATION_LABEL, type Verification } from '../domain/evidence';
import { formatPayout } from '../domain/money';

/**
 * Email-client-safe HTML (tables + inline styles). Mirrors the dashboard's
 * midnight/coral/cyan palette. Every CTA deep-links to the authenticated app
 * with finding/pin focus; links survive login via ?next=.
 */
export interface BriefItem {
  id: string; title: string; category: string; verification: string; chapter_min: number | null;
  landmark: string | null; why: string | null; payout_min: number | null; payout_max: number | null;
  pin_id: string | null; previously_known?: boolean; label?: string;
}
export interface BriefSection { key: string; title: string; items: BriefItem[]; empty: string; }
export interface BriefModel {
  displayName: string; chapter: number; localDate: string; baseUrl: string;
  top3: BriefItem[]; sections: BriefSection[]; savedTodos: string[];
  health: { scoutsRan: string[]; scoutsNotRun: string[]; staleSources: string[]; failedSources: string[]; lastSuccessfulScan: string | null; scanStatus: string };
  noNewVerified: boolean;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const C = { bg: '#080B19', panel: '#151434', text: '#FAF6FF', muted: '#B8B3D6', pink: '#FD3B97', coral: '#FF8864', cyan: '#40E3EB', gold: '#FFD568', border: '#2A2852' };

export function subjectFor(chapter: number, localDate: string) {
  return `🎮 GTA VI Strategy HQ | Chapter ${chapter} Morning Brief — ${formatLocalDate(localDate)}`;
}
export function preheaderFor(m: BriefModel) {
  if (m.top3.length) return `${m.top3.length} verified Chapter ${m.chapter} move${m.top3.length > 1 ? 's' : ''} ready. Spoiler shield on.`;
  return `No new verified finds today. Your Chapter ${m.chapter} to-dos and source health inside.`;
}

export function deepLink(base: string, path: string) {
  const u = new URL(path, base);
  u.searchParams.set('from', 'brief');
  return u.toString();
}

function itemBlock(m: BriefModel, it: BriefItem) {
  const ver = VERIFICATION_LABEL[it.verification as Verification] ?? it.verification.toUpperCase();
  const mapHref = it.pin_id ? deepLink(m.baseUrl, `/map?pin=${it.pin_id}&finding=${it.id}`) : deepLink(m.baseUrl, `/map?finding=${it.id}`);
  const payout = it.payout_min != null || it.payout_max != null ? ` · Payout ${formatPayout(it.payout_min, it.payout_max)}` : '';
  return `
  <tr><td style="padding:14px 16px;border:1px solid ${C.border};border-radius:12px;background:${C.panel}">
    <div style="font:700 11px/1.4 Arial,sans-serif;letter-spacing:.08em;color:${C.cyan}">${esc(ver)} · CH ${it.chapter_min ?? 'ANY'}${it.previously_known ? ' · PREVIOUSLY KNOWN' : ''}${esc(payout)}</div>
    <div style="font:700 16px/1.35 Arial,sans-serif;color:${C.text};margin:4px 0">${esc(it.title)}</div>
    ${it.why ? `<div style="font:14px/1.5 Arial,sans-serif;color:${C.muted}">${esc(it.why)}</div>` : ''}
    <div style="font:13px/1.5 Arial,sans-serif;color:${C.muted};margin-top:4px">Landmark: ${it.landmark ? esc(it.landmark) : 'Not yet verified — text guidance only'}</div>
    <div style="margin-top:10px;font:700 12px Arial,sans-serif">
      <a href="${esc(mapHref)}" style="color:${C.pink};text-decoration:none;margin-right:14px">Locate on map →</a>
      <a href="${esc(deepLink(m.baseUrl, `/intel/${it.id}?focus=visual`))}" style="color:${C.cyan};text-decoration:none;margin-right:14px">See visual guide →</a>
      <a href="${esc(deepLink(m.baseUrl, `/intel/${it.id}`))}" style="color:${C.gold};text-decoration:none">Read full intel →</a>
    </div>
  </td></tr><tr><td style="height:10px"></td></tr>`;
}

function section(m: BriefModel, title: string, body: string, anchor: string) {
  return `<tr><td style="padding:18px 0 8px"><a name="${anchor}"></a>
    <div style="font:800 18px Arial,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:${C.text}">${esc(title)}</div></td></tr>${body}`;
}

export function renderBriefEmail(m: BriefModel): string {
  const todayUrl = deepLink(m.baseUrl, `/brief/${m.localDate}`);
  const top = m.top3.length
    ? m.top3.map((i) => itemBlock(m, i)).join('')
    : `<tr><td style="font:14px/1.5 Arial,sans-serif;color:${C.muted};padding:4px 0 10px">No verified Chapter ${m.chapter} actions are available yet. Nothing is invented to fill this space.</td></tr>
       ${m.savedTodos.length ? `<tr><td style="font:13px/1.6 Arial,sans-serif;color:${C.text}"><b>Your saved to-dos (previously known):</b><br>${m.savedTodos.map((t) => '• ' + esc(t)).join('<br>')}</td></tr>` : ''}`;
  const secs = m.sections.map((s) => section(m, s.title,
    s.items.length ? s.items.map((i) => itemBlock(m, i)).join('')
      : `<tr><td style="font:13px/1.5 Arial,sans-serif;color:${C.muted}">${esc(s.empty)}</td></tr>`, s.key)).join('');
  const h = m.health;
  const health = `<tr><td style="font:13px/1.6 Arial,sans-serif;color:${C.muted}">
    Scan status: <b style="color:${C.text}">${esc(h.scanStatus)}</b>. Last successful scan: ${h.lastSuccessfulScan ? esc(h.lastSuccessfulScan) : 'none yet'}.<br>
    Scouts with logged runs: ${h.scoutsRan.length ? esc(h.scoutsRan.join(', ')) : 'none'}.<br>
    ${h.scoutsNotRun.length ? `Not run / not configured: ${esc(h.scoutsNotRun.join(', '))}.<br>` : ''}
    ${h.failedSources.length ? `Unreachable sources: ${esc(h.failedSources.join(', '))}.<br>` : ''}
    ${h.staleSources.length ? `Stale sources: ${esc(h.staleSources.join(', '))}.` : ''}
  </td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subjectFor(m.chapter, m.localDate))}</title></head>
<body style="margin:0;background:${C.bg}">
<div style="display:none;max-height:0;overflow:hidden">${esc(preheaderFor(m))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
  <tr><td style="font:800 12px Arial,sans-serif;letter-spacing:.2em;color:${C.cyan}">GTA VI STRATEGY HQ · CHAPTER ${m.chapter} · SPOILER SHIELD ON</td></tr>
  <tr><td style="font:900 30px/1.05 Arial,sans-serif;color:${C.text};padding:8px 0 4px">Good morning, ${esc(m.displayName)}.</td></tr>
  <tr><td style="font:14px Arial,sans-serif;color:${C.muted};padding-bottom:12px">${esc(formatLocalDate(m.localDate))}</td></tr>
  <tr><td style="padding-bottom:14px"><a href="${esc(todayUrl)}" style="display:inline-block;background:${C.pink};color:#1a0b24;font:800 14px Arial,sans-serif;padding:12px 18px;border-radius:10px;text-decoration:none">Open today's full HQ brief →</a></td></tr>
  ${m.noNewVerified ? `<tr><td style="font:14px/1.5 Arial,sans-serif;color:${C.gold};padding-bottom:8px">No new verified discoveries in the last 24 hours.</td></tr>` : ''}
  ${section(m, 'Top 3 actions now', top, 'top3')}
  ${secs}
  ${section(m, 'Source health', health, 'health')}
  <tr><td style="font:11px/1.6 Arial,sans-serif;color:${C.muted};padding-top:22px;border-top:1px solid ${C.border}">
    Independent, unofficial game guide. Not affiliated with, licensed or endorsed by Rockstar Games, Take-Two Interactive or Reddit.
    Facts are paraphrased with links to the original sources. <a href="${esc(deepLink(m.baseUrl, '/settings#email'))}" style="color:${C.cyan}">Email settings / turn off</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

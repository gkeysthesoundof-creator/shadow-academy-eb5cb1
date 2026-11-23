import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { listFindings, scoutStatus, lockedCounts, rewardsList, FILTERS, FILTER_LABELS, type FilterKey } from '@/lib/repo/intel';
import { scoutBySlug } from '@/lib/domain/scouts';
import { radarBucket, effectiveStatus, type RadarFilter } from '@/lib/domain/rewards';
import { rankMoney, cashPerHour } from '@/lib/domain/money';
import { FindingCard, EmptyState, ScoutStatePill, timeAgo, VerificationTag } from '@/components/ui';

const RADAR: [RadarFilter | 'all', string][] = [['all', 'All'], ['free_today', 'Free today'], ['with_purchase', 'If purchased'], ['gta_plus', 'GTA+'], ['paid', 'Paid'], ['expired', 'Expired'], ['unknown', 'Unknown']];

export default async function Workbench({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ f?: string | string[]; q?: string; kind?: string; r?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const scout = scoutBySlug(slug);
  if (!scout) notFound();
  const user = await requireUser();
  const p = await currentProfile(user.id);
  const active = new Set((Array.isArray(sp.f) ? sp.f : sp.f ? sp.f.split(',') : []).filter((x): x is FilterKey => (FILTERS as readonly string[]).includes(x)));
  const status = (await scoutStatus(user.id)).find((s) => s.scout_id === scout.id)!;
  const locked = (await lockedCounts(user.id))[scout.id] ?? 0;
  const q = (sp.q ?? '').slice(0, 100);

  const qs = (f: Set<string>, extra: Record<string, string> = {}) => {
    const u = new URLSearchParams();
    if (f.size) u.set('f', [...f].join(','));
    if (q) u.set('q', q);
    for (const [k, v] of Object.entries(extra)) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : '';
  };
  const toggle = (k: FilterKey) => { const n = new Set(active); if (n.has(k)) n.delete(k); else n.add(k); return `/scouts/${slug}${qs(n, { kind: sp.kind ?? '' })}`; };

  const header = (
    <div>
      <p className="eyebrow">Scout workbench</p>
      <h1 className="page-title">{scout.icon} {scout.name}</h1>
      <p className="lede">{scout.description}</p>
      <div className="row" style={{ marginBottom: 14 }}>
        <ScoutStatePill state={status.state} />
        <span className="pill muted">Last success {timeAgo(status.last_success_at)}</span>
        <span className="pill pink">Chapter {p.chapter} shield</span>
      </div>
    </div>
  );

  if (scout.id === 'rewards_scout') {
    const rows = (await rewardsList(user.id));
    const gta6 = rows.filter((r) => r.game_scope === 'GTA_VI');
    const filter = (sp.r ?? 'all') as RadarFilter | 'all';
    const shown = gta6.filter((r) => filter === 'all' || radarBucket(r) === filter);
    return (
      <div className="stack">
        {header}
        <section className="card">
          <div className="section-head"><div><h2>Rewards radar</h2><p className="subtitle">GTA VI only. GTA Online gifts are excluded by rule. GTA+ is a subscription, never &ldquo;free&rdquo;.</p></div></div>
          <div className="chips" role="toolbar" aria-label="Reward filters">
            {RADAR.map(([k, label]) => <Link key={k} className={`chip${filter === k ? ' on' : ''}`} href={`/scouts/rewards${k === 'all' ? '' : `?r=${k}`}`} aria-pressed={filter === k}>{label}</Link>)}
          </div>
          <div className="flist" style={{ marginTop: 12 }}>
            {shown.length ? shown.map((r) => (
              <Link key={r.id} href={`/intel/${r.finding_id}`} className="fcard">
                <div className="tags">
                  <VerificationTag v={r.verification} />
                  <span className="tag">{radarBucket(r).replace('_', ' ')}</span>
                  <span className="tag">{effectiveStatus(r).toUpperCase()}</span>
                  <span className="tag">{r.platforms.length ? r.platforms.join(' / ') : 'Platforms not stated'}</span>
                </div>
                <div className="title">{r.title}</div>
                <p>{r.summary}</p>
                <p className="small" style={{ marginTop: 6 }}>Deadline: {r.ends_at ? new Date(r.ends_at).toLocaleString('en-US', { timeZone: p.timezone }) : (r.attributes?.ended_on ? `ended ${r.attributes.ended_on} (time of day not confirmed)` : 'not stated')}</p>
              </Link>
            )) : <EmptyState title="Nothing in this bucket">No verified GTA VI rewards match. Nothing is listed as free unless the official source says it is free without purchase or subscription.</EmptyState>}
          </div>
        </section>
      </div>
    );
  }

  if (!scout.workbench) {
    return (
      <div className="stack">
        {header}
        <section className="card">
          <h2>How this scout works</h2>
          <p className="subtitle">{scout.id === 'community_scout'
            ? 'Community Discovery only collects through approved access (Reddit Data API with credentials, and a commercial agreement before any paid launch). It keeps dated link-outs and coverage gaps and never claims complete coverage. Its raw items go to the review queue, never straight to your feed.'
            : 'This operational scout works behind the others: it reconciles evidence, expires deadlines, records corrections, and reports health. Its log is visible in Source Monitor.'}</p>
          <div className="row" style={{ marginTop: 12 }}><Link className="btn cyan" href="/sources">Open source monitor</Link><Link className="btn" href="/intel?f=patched">Corrections & patched</Link></div>
        </section>
      </div>
    );
  }

  let items = await listFindings(user.id, { scout: scout.id, filters: [...active], q, scope: 'GTA_VI' });
  const isCash = scout.id === 'money_scout';
  const kind = isCash ? (sp.kind === 'world' || sp.kind === 'activity' ? sp.kind : 'all') : 'all';
  if (isCash && kind !== 'all') items = items.filter((f) => (kind === 'world' ? f.category === 'cash_pickup' : f.category === 'money_activity'));
  if (isCash) {
    const ranked = rankMoney(items.map((f) => ({
      id: f.id, money_kind: f.category === 'cash_pickup' ? 'world_pickup' : 'repeatable_activity', payout_min: f.payout_min, payout_max: f.payout_max,
      time_minutes_min: (f.attributes?.time_minutes_min as number) ?? null, time_minutes_max: (f.attributes?.time_minutes_max as number) ?? null,
      verification: f.verification, risk: f.risk as 'low', patched: f.attributes?.patched === true,
    })));
    const order = new Map(ranked.map((r, i) => [r.id, i]));
    items = [...items].sort((a, b) => (order.get(a.id)! - order.get(b.id)!));
    void cashPerHour;
  }

  return (
    <div className="stack">
      {header}
      <section className="card">
        <form className="row" action={`/scouts/${slug}`} role="search" style={{ marginBottom: 12 }}>
          {active.size ? <input type="hidden" name="f" value={[...active].join(',')} /> : null}
          <label className="sr-only" htmlFor="q">Search {scout.shortName}</label>
          <input id="q" className="input" name="q" defaultValue={q} placeholder={`Search ${scout.shortName.toLowerCase()} by name or landmark…`} style={{ flex: 1, minWidth: 0 }} />
          <button className="btn">Search</button>
        </form>
        {isCash ? (
          <div className="chips" style={{ marginBottom: 8 }} aria-label="Money type">
            {[['all', 'All money'], ['world', '💵 Lying in the world'], ['activity', '🏦 Income activities']].map(([k, l]) => (
              <Link key={k} className={`chip${kind === k ? ' on' : ''}`} href={`/scouts/cash${qs(active, { kind: k === 'all' ? '' : k })}`}>{l}</Link>
            ))}
          </div>
        ) : null}
        <div className="chips" role="toolbar" aria-label="Filters">
          {FILTERS.map((k) => k === 'chapter'
            ? <span key={k} className="chip on" title="Always on: the database only returns items for your chapter">✓ Chapter {p.chapter} available</span>
            : <Link key={k} className={`chip${active.has(k) ? ' on' : ''}`} href={toggle(k)} aria-pressed={active.has(k)}>{FILTER_LABELS[k]}</Link>)}
          {p.saved_region ? <span className="chip">Near {p.saved_region} (your stated area)</span> : null}
        </div>
        {isCash ? <p className="notice gold" style={{ marginTop: 12 }}>Cash-per-hour is shown only when both payout AND time are evidenced. Otherwise it reads UNKNOWN — no guessed rates.</p> : null}
        <div className="flist" style={{ marginTop: 12 }}>
          {items.length ? items.map((f) => <FindingCard key={f.id} f={f} />) : (
            <EmptyState title={`No ${active.size || q ? 'matching ' : ''}${scout.shortName.toLowerCase()} intel yet`}>
              {status.state === 'PARTIAL' || status.state === 'NOT CONFIGURED' || status.state === 'PREVIEW — NO SCANS RUN'
                ? 'This scout’s community feed is not connected yet, and nothing is invented to fill the list. Verified finds appear here after evidence review.'
                : 'Nothing matches these filters right now.'}
              {locked ? ` ${locked} later-chapter item${locked > 1 ? 's are' : ' is'} hidden by your spoiler shield.` : ''}
            </EmptyState>
          )}
        </div>
      </section>
      <section className="card">
        <h2>What every {scout.shortName.toLowerCase()} record must show</h2>
        <p className="subtitle">Fields without evidence are displayed as UNKNOWN on the detail page — never filled in.</p>
        <div className="tags" style={{ marginTop: 10 }}>{scout.recordFields.map((r) => <span key={r.key} className="tag">{r.label}</span>)}</div>
      </section>
    </div>
  );
}

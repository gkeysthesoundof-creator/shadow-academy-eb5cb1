import Link from 'next/link';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { listFindings, FILTERS, FILTER_LABELS, type FilterKey } from '@/lib/repo/intel';
import { FindingCard, EmptyState } from '@/components/ui';

export const metadata = { title: 'Intel · Strategy HQ' };

const TABS: [string, string, string[]][] = [
  ['all', 'All intel', []], ['cash', '💵 Hidden cash', ['cash_pickup']], ['money', '🏦 Fast money', ['money_activity']],
  ['vehicles', '🚗 Rare vehicles', ['vehicle']], ['weapons', '🔫 Weapons/items', ['weapon']], ['secrets', '💎 Secrets', ['secret', 'collectible']],
  ['missions', '🎮 Missions', ['mission_tip']], ['rewards', '🎁 Rockstar rewards', ['reward']], ['updates', '📢 Updates', ['update']],
];

export default async function Intel({ searchParams }: { searchParams: Promise<{ tab?: string; f?: string; q?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const p = await currentProfile(user.id);
  const tab = TABS.find((t) => t[0] === sp.tab) ?? TABS[0];
  const active = new Set((sp.f ?? '').split(',').filter((x): x is FilterKey => (FILTERS as readonly string[]).includes(x)));
  const q = (sp.q ?? '').slice(0, 100);
  const items = await listFindings(user.id, { categories: tab[2], filters: [...active], q, scope: 'GTA_VI' });
  const href = (t: string, f: Set<string>) => {
    const u = new URLSearchParams(); if (t !== 'all') u.set('tab', t); if (f.size) u.set('f', [...f].join(',')); if (q) u.set('q', q);
    const s = u.toString(); return `/intel${s ? `?${s}` : ''}`;
  };
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">02 / The intelligence desk</p>
        <h1 className="page-title">Community intel</h1>
        <p className="lede">Stashes, money, vehicles, weapons, secrets and official bonuses — only items your Chapter {p.chapter} shield allows. Badges show evidence strength, never rumor as fact.</p>
      </div>
      <section className="card">
        <form className="row" action="/intel" role="search" style={{ marginBottom: 12 }}>
          {tab[0] !== 'all' ? <input type="hidden" name="tab" value={tab[0]} /> : null}
          <label className="sr-only" htmlFor="iq">Search intel</label>
          <input id="iq" className="input" name="q" defaultValue={q} placeholder="Search stash, mission, landmark, weapon…" style={{ flex: 1, minWidth: 0 }} />
          <button className="btn">Search</button>
        </form>
        <div className="chips" aria-label="Categories">{TABS.map(([k, l]) => <Link key={k} className={`chip${tab[0] === k ? ' on' : ''}`} href={href(k, active)}>{l}</Link>)}</div>
        <div className="chips" aria-label="Filters" style={{ marginTop: 8 }}>
          {FILTERS.filter((k) => k !== 'chapter').map((k) => {
            const n = new Set(active); if (n.has(k)) n.delete(k); else n.add(k);
            return <Link key={k} className={`chip${active.has(k) ? ' on' : ''}`} href={href(tab[0], n)} aria-pressed={active.has(k)}>{FILTER_LABELS[k]}</Link>;
          })}
        </div>
        <div className="flist" style={{ marginTop: 14 }}>
          {items.length ? items.map((f) => <FindingCard key={f.id} f={f} />) : (
            <EmptyState title="No verified findings in this view yet">The desk deliberately shows no made-up stash coordinates, weapon spawns, screenshots or payout rates. Verified discoveries appear here with map links once evidence is reviewed.</EmptyState>
          )}
        </div>
      </section>
      <section className="card">
        <div className="section-head"><div><h2>Discovery source network</h2><p className="subtitle">Candidate sources and their real connection state — not a claim that every post was read.</p></div></div>
        <Link className="btn cyan" href="/sources">Open source monitor →</Link>
      </section>
    </div>
  );
}

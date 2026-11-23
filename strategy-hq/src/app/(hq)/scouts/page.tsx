import Link from 'next/link';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { scoutStatus } from '@/lib/repo/intel';
import { SCOUTS, PRIORITY_SCOUTS } from '@/lib/domain/scouts';
import { ScoutStatePill, timeAgo } from '@/components/ui';

export const metadata = { title: 'Scout Center · Strategy HQ' };

export default async function ScoutCenter() {
  const user = await requireUser();
  const p = await currentProfile(user.id);
  const status = await scoutStatus(user.id);
  const byId = new Map(status.map((s) => [s.scout_id, s]));
  const anyRun = status.some((s) => s.last_run_at);
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">01 / The scout network</p>
        <h1 className="page-title">Scout Center</h1>
        <p className="lede">Ten specialist scouts, one shared evidence database. Each scout is a lens with its own rules — not a separate AI running up costs. States below come from logged runs only.</p>
      </div>
      <section className="card">
        <div className="section-head">
          <div><h2>Your Chapter {p.chapter} hunt team</h2><p className="subtitle">Priority scouts first: Vehicle Hunter, Weapons Scout, Cash Trail.</p></div>
          <span className={`pill ${anyRun ? 'cyan' : 'gold'}`}>{anyRun ? `Last scan ${timeAgo(status.map((s) => s.last_run_at).filter(Boolean).sort().at(-1))}` : 'Preview — no scans run'}</span>
        </div>
        <div className="flist">
          {SCOUTS.map((s) => {
            const st = byId.get(s.id)!;
            return (
              <article key={s.id} className={`fcard accent-bar c-${s.color}`} aria-labelledby={`sc-${s.id}`}>
                <div className="row between">
                  <h3 id={`sc-${s.id}`} style={{ fontSize: 16, margin: 0 }}>{s.icon} {s.name}{PRIORITY_SCOUTS.includes(s.id) ? <span className="tag new" style={{ marginLeft: 8 }}>PRIORITY</span> : null}</h3>
                  <ScoutStatePill state={st.state} />
                </div>
                <p style={{ margin: '8px 0' }}>{s.description}</p>
                <div className="row small muted">
                  <span>Last run: {timeAgo(st.last_run_at)}</span><span>· Last success: {timeAgo(st.last_success_at)}</span>
                  <span>· {st.visible_count} visible</span>{st.locked_count ? <span>· {st.locked_count} locked (later chapters)</span> : null}
                </div>
                {st.last_run_at ? (
                  <div className="row small muted" style={{ marginTop: 4 }}>
                    <span>Examined {st.items_examined}</span><span>· Added {st.findings_added}</span><span>· Updated {st.findings_updated}</span><span>· Corrected {st.findings_corrected}</span>
                  </div>
                ) : null}
                {st.last_note ? <p className="small" style={{ marginTop: 6 }}>{st.last_note}</p> : null}
                {st.error ? <p className="small" style={{ color: '#ffb0b0' }}>Error: {st.error}</p> : null}
                <div className="row" style={{ marginTop: 10 }}>
                  <Link className="btn sm cyan" href={s.id === 'strategy_scout' ? '/assist' : s.id === 'map_scout' ? '/map' : s.id === 'briefing_scout' ? '/brief' : `/scouts/${s.slug}`}>
                    {s.id === 'strategy_scout' ? 'Ask your coach' : s.id === 'map_scout' ? 'Open map room' : s.id === 'briefing_scout' ? 'Brief archive' : `Open ${s.shortName}`}
                  </Link>
                  {s.workbench && s.id !== 'rewards_scout' ? <Link className="btn sm" href={`/map?layer=${s.slug}`}>{s.shortName} map</Link> : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <p className="notice">States: <b>CONNECTED</b> all feeds healthy · <b>PARTIAL</b> ran, but a feed (e.g. Reddit API) is not configured · <b>STALE</b> no success in 36h · <b>NOT CONFIGURED</b> required access missing · <b>PREVIEW — NO SCANS RUN</b> nothing has run yet. A scout is never shown as running unless a run is logged.</p>
    </div>
  );
}

import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db';
import { config } from '@/lib/config';
import { localParts } from '@/lib/domain/schedule';
import { sourceHealth } from '@/lib/repo/intel';
import { fmtDate, timeAgo } from '@/components/ui';
import { RefreshPanel } from './RefreshPanel';

export const metadata = { title: 'Source Monitor · Strategy HQ' };
export const dynamic = 'force-dynamic';

const pillFor = (s: string) => (s === 'ok' || s === 'success' || s === 'succeeded' ? 'green' : s === 'failing' || s === 'failed' ? 'red'
  : s === 'partial' || s === 'blocked' || s === 'stale' ? 'gold' : 'muted');

export default async function SourceMonitor() {
  const user = await requireUser();
  const day = localParts(new Date(), config.timezone).date;
  const [sources, extra] = await Promise.all([
    sourceHealth(user.id),
    asUser(user.id, async (c) => {
      const scoutRuns = (await c.query(`
        select r.id, r.started_at, r.status, r.items_examined, r.findings_added, r.findings_updated, r.findings_corrected, r.note, r.error, coalesce(s.name, r.scout_id) as scout_name
        from scout_runs r left join scout_categories s on s.scout_id = r.scout_id order by r.started_at desc limit 30`)).rows;
      const jobs = (await c.query(`select id, kind, status, started_at, finished_at from ingestion_jobs order by started_at desc limit 10`)).rows;
      const ent = (await c.query(`select limit_value from entitlements where feature = 'manual_refresh_daily'`)).rows[0];
      const used = (await c.query(`select count from usage_meter where user_id = app_uid() and meter = 'manual_refresh_daily' and day = $1`, [day])).rows[0]?.count ?? 0;
      const review = user.is_moderator
        ? Number((await c.query(`select count(*) n from findings where publication_status = 'in_review'`)).rows[0].n) : null;
      return { scoutRuns, jobs, ent, used: Number(used), review };
    }),
  ]);
  const limit: number | null | undefined = extra.ent ? extra.ent.limit_value : undefined;
  let allowed = true; let why: string | null = null;
  if (limit === undefined || (limit !== null && limit <= 0)) { allowed = false; why = 'Manual refresh is not included in your plan. The scheduled daily scan still runs.'; }
  else if (limit !== null && extra.used >= limit) { allowed = false; why = `You have used all ${limit} manual refresh${limit === 1 ? '' : 'es'} for today.`; }
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Transparency</p>
        <h1 className="page-title">Source Monitor</h1>
        <p className="lede">Exactly what each source did on its last check. Failures are shown as failures.</p>
      </div>
      <p className="notice gold"><b>Reachable ≠ retrieved ≠ parsed ≠ verified.</b> HQ never claims complete coverage of any community. A source can respond and still give us nothing usable.</p>

      <section className="card">
        <h2>Manual refresh</h2>
        <p className="subtitle" style={{ marginBottom: 10 }}>Runs one scan across all enabled, rights-cleared sources now. {limit === null ? 'Unlimited today.' : limit !== undefined ? `${extra.used}/${limit} used today.` : ''}</p>
        <RefreshPanel allowed={allowed} why={why} />
        <p className="small muted" style={{ marginTop: 8 }}>In this environment Rockstar and Reddit may be unreachable or not configured. A &quot;failed&quot; or &quot;not_configured&quot; result is the honest output.</p>
      </section>

      {extra.review !== null ? (
        <section className="card"><h2>Review queue</h2><p>{extra.review} finding{extra.review === 1 ? '' : 's'} waiting for moderator review. <span className="small muted">Drafts are never published automatically.</span></p></section>
      ) : null}

      <section className="card">
        <h2>Sources ({sources.length})</h2>
        {sources.length === 0 ? <div className="empty"><strong>No sources registered</strong>Nothing is being monitored.</div> : (
          <div className="flist" style={{ marginTop: 10 }}>
            {sources.map((s) => {
              const r = s.last_run as null | { outcome: string; items_fetched: number; items_new: number; coverage_note: string | null; error: string | null; started_at: string };
              return (
                <article key={s.id} className="fcard">
                  <div className="row between">
                    <h3 style={{ fontSize: 15, margin: 0 }}>{s.name}</h3>
                    <span className={`pill ${pillFor(s.status)}`}>{s.status}</span>
                  </div>
                  <div className="row small muted" style={{ margin: '6px 0' }}>
                    <span>Kind: {s.kind}</span><span>· Access: {s.access_method}</span><span>· {s.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  <dl className="kv">
                    <dt>Last check</dt><dd>{timeAgo(s.last_check_at)}</dd>
                    <dt>Last success</dt><dd>{timeAgo(s.last_success_at)}</dd>
                    <dt>Last run</dt>
                    <dd>{r ? <><span className={`pill ${pillFor(r.outcome)}`}>{r.outcome}</span> · fetched {r.items_fetched} · new {r.items_new} · {timeAgo(r.started_at)}</> : 'No run logged'}</dd>
                    {r?.coverage_note ? <><dt>Coverage</dt><dd>{r.coverage_note}</dd></> : null}
                    {r?.error || s.last_error ? <><dt>Error</dt><dd style={{ color: '#ffb0b0' }}>{r?.error ?? s.last_error}</dd></> : null}
                    {s.access_notes ? <><dt>Access notes</dt><dd>{s.access_notes}</dd></> : null}
                  </dl>
                  <div className="row" style={{ marginTop: 8 }}>
                    {s.terms_url ? <a className="btn sm" href={s.terms_url} target="_blank" rel="noopener noreferrer">Terms</a> : <span className="small muted">No terms link on file</span>}
                    {s.canonical_url ? <a className="btn sm" href={s.canonical_url} target="_blank" rel="noopener noreferrer">Source site</a> : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Scout run log (last 30)</h2>
        {extra.scoutRuns.length === 0 ? <div className="empty"><strong>No scout runs logged</strong>Nothing has run yet, so no scout is shown as running.</div> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>When</th><th>Scout</th><th>Status</th><th>Examined</th><th>Added</th><th>Updated</th><th>Corrected</th><th>Note / error</th></tr></thead>
            <tbody>{extra.scoutRuns.map((r) => (
              <tr key={r.id}>
                <td>{fmtDate(r.started_at)}</td><td>{r.scout_name}</td><td><span className={`pill ${pillFor(r.status)}`}>{r.status}</span></td>
                <td>{r.items_examined}</td><td>{r.findings_added}</td><td>{r.findings_updated}</td><td>{r.findings_corrected}</td>
                <td className="small">{r.error ? <span style={{ color: '#ffb0b0' }}>{r.error}</span> : r.note ?? ''}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <h2>Ingestion jobs (last 10)</h2>
        {extra.jobs.length === 0 ? <div className="empty"><strong>No ingestion jobs</strong></div> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Started</th><th>Kind</th><th>Status</th><th>Finished</th></tr></thead>
            <tbody>{extra.jobs.map((j) => (
              <tr key={j.id}><td>{fmtDate(j.started_at)}</td><td>{j.kind}</td><td><span className={`pill ${pillFor(j.status)}`}>{j.status}</span></td><td>{j.finished_at ? fmtDate(j.finished_at) : '—'}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
      <p className="small muted"><Link href="/scouts">Back to Scout Center</Link></p>
    </div>
  );
}

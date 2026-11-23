import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db';
import { config } from '@/lib/config';
import { localParts } from '@/lib/domain/schedule';
import { buildTodayBriefAction } from '@/lib/actions/brief';
import { BuildButton } from './BuildButton';
import { deliveryWords } from './delivery';

export const metadata = { title: 'Morning Brief Archive · Strategy HQ' };
export const dynamic = 'force-dynamic';

export default async function BriefArchive() {
  const user = await requireUser();
  const today = localParts(new Date(), config.timezone).date;
  const rows = await asUser(user.id, (c) => c.query(`
    select d.id, to_char(d.local_date, 'YYYY-MM-DD') as local_date, d.chapter, d.status, d.subject,
      (select a.status from delivery_attempts a where a.digest_id = d.id order by a.at desc limit 1) as delivery_status,
      (select a.error from delivery_attempts a where a.digest_id = d.id order by a.at desc limit 1) as delivery_error
    from digest_runs d where d.user_id = app_uid() and d.game_id = 'gta6' order by d.local_date desc limit 60`)).then((r) => r.rows);
  const todays = rows.find((r) => r.local_date === today);
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Briefing scout</p>
        <h1 className="page-title">Morning Brief archive</h1>
        <p className="lede">One brief per day, built from what you were allowed to see at your chapter. Delivery status is shown in exact words.</p>
      </div>
      <section className="card">
        <div className="section-head">
          <div><h2>Today · {today}</h2><p className="subtitle">{todays ? 'Today’s brief already exists. It is built once per day.' : 'No brief has been built for today yet.'}</p></div>
        </div>
        {todays ? <Link className="btn primary" href={`/brief/${today}`}>Open today&apos;s brief</Link> : (
          <form action={buildTodayBriefAction}><BuildButton /></form>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>Building stores the brief here. Email only goes out if every delivery gate is open; otherwise it is recorded as a dry run or blocked.</p>
      </section>
      <section className="card">
        <h2>Past briefs</h2>
        {rows.length === 0 ? <div className="empty"><strong>No briefs yet</strong>Nothing has been built for your account. Build today&apos;s brief above, or wait for the scheduled one.</div> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Date</th><th>Chapter</th><th>Status</th><th>Delivery</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const d = deliveryWords(r.delivery_status, r.delivery_error);
                  return (
                    <tr key={r.id}>
                      <td>{r.local_date}</td><td>{r.chapter}</td>
                      <td><span className={`pill ${r.status === 'ready' ? 'green' : r.status === 'failed' ? 'red' : 'gold'}`}>{r.status}</span></td>
                      <td><span className={`pill ${d.cls}`} style={{ textTransform: 'none' }}>{d.label}</span></td>
                      <td><Link className="btn sm" href={`/brief/${r.local_date}`}>Open</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

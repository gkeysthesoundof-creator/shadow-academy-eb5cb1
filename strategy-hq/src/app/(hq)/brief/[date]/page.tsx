import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { asUser } from '@/lib/db';
import { VerificationTag, fmtDate } from '@/components/ui';
import { deliveryWords } from '../delivery';
import styles from '../brief.module.css';

export const dynamic = 'force-dynamic';

const TITLES: Record<string, string> = {
  top3: 'Top 3 today', vehicles: 'Rare vehicles', weapons: 'Weapons & items', money: 'Money: stashes & fast cash', secrets: 'Secrets & collectibles',
  missions: 'Missions & strategies', rewards: 'Rockstar free rewards & deadlines', corrections: 'Patches + corrections',
};

interface Item {
  id: string; title: string; verification: string; chapter_min: number | null; landmark: string | null; why: string | null;
  previously_known?: boolean;
}
interface Health {
  scanStatus?: string; lastSuccessfulScan?: string | null; scoutsRan?: string[]; scoutsNotRun?: string[]; failedSources?: string[]; staleSources?: string[];
}

function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  return { title: `Brief ${validDate(date) ? date : ''} · Strategy HQ` };
}

export default async function BriefDay({ params }: { params: Promise<{ date: string }> }) {
  const user = await requireUser();
  const { date } = await params;
  if (!validDate(date)) notFound();
  const data = await asUser(user.id, async (c) => {
    const d = (await c.query(
      `select id, to_char(local_date,'YYYY-MM-DD') as local_date, chapter, status, subject, html, summary, created_at
       from digest_runs where user_id = app_uid() and game_id = 'gta6' and local_date = $1`, [date])).rows[0];
    if (!d) return null;
    const sections = (await c.query(`select section, sort, items from digest_sections where digest_id = $1 order by sort`, [d.id])).rows;
    const attempts = (await c.query(`select status, error, provider, at from delivery_attempts where digest_id = $1 order by at desc`, [d.id])).rows;
    return { d, sections, attempts };
  });
  if (!data) notFound();
  const { d, sections, attempts } = data;
  const health: Health = d.summary?.health ?? {};
  const latest = attempts[0];
  const dw = deliveryWords(latest?.status ?? null, latest?.error ?? null);
  return (
    <div className="stack">
      <div>
        <p className="eyebrow"><Link href="/brief">Brief archive</Link> / {d.local_date}</p>
        <h1 className="page-title">{d.subject ?? `Brief for ${d.local_date}`}</h1>
        <div className="row" style={{ marginTop: 8 }}>
          <span className="pill pink">Chapter {d.chapter}</span>
          <span className={`pill ${d.status === 'ready' ? 'green' : d.status === 'failed' ? 'red' : 'gold'}`}>{d.status}</span>
          <span className={`pill ${dw.cls}`} style={{ textTransform: 'none' }}>{dw.label}</span>
        </div>
      </div>
      {d.status !== 'ready' ? (
        <div className="notice pink">This brief is {d.status}. {d.status === 'failed' && d.summary?.error ? `Reason: ${d.summary.error}` : 'Nothing is shown because it was not completed.'}</div>
      ) : (
        <>
          <nav className={styles.toc} aria-label="Sections">
            {sections.map((s) => <a key={s.section} className="chip" href={`#${s.section}`}>{TITLES[s.section] ?? s.section}</a>)}
            <a className="chip" href="#health">Scan health</a>
          </nav>
          {d.summary?.noNewVerified ? <p className="notice gold">No new verified finds in the last 24 hours. Nothing is padded or guessed.</p> : null}
          {sections.map((s) => {
            const items = (s.items ?? []) as Item[];
            return (
              <section key={s.section} id={s.section} className="card" aria-labelledby={`h-${s.section}`}>
                <h2 id={`h-${s.section}`}>{TITLES[s.section] ?? s.section}</h2>
                {items.length === 0 ? <div className="empty"><strong>Nothing new</strong>No verified items for this section.</div> : (
                  <div className="stack" style={{ marginTop: 10 }}>
                    {items.map((it) => (
                      <div key={it.id} className={styles.item}>
                        <div className="tags">
                          <VerificationTag v={it.verification} />
                          <span className="tag">{it.chapter_min ? `CH ${it.chapter_min}+` : 'ANY CHAPTER'}</span>
                          {it.previously_known ? <span className="tag">Previously known</span> : null}
                        </div>
                        <h4>{it.title}</h4>
                        <p>📍 {it.landmark ?? 'Landmark not verified'}</p>
                        {it.why ? <p style={{ marginTop: 4 }}>{it.why}</p> : null}
                        <div className="row" style={{ marginTop: 8 }}>
                          <Link className="btn sm cyan" href={`/intel/${it.id}`}>Open intel</Link>
                          <Link className="btn sm" href={`/map?finding=${it.id}`}>Show on map</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
          <section id="health" className="card" aria-labelledby="h-health">
            <h2 id="h-health">Scan health</h2>
            <dl className="kv" style={{ marginTop: 10 }}>
              <dt>Scan status</dt><dd>{health.scanStatus ?? 'unknown'}</dd>
              <dt>Last successful scan</dt><dd>{health.lastSuccessfulScan ?? 'none recorded'}</dd>
              <dt>Scouts that ran</dt><dd>{health.scoutsRan?.length ? health.scoutsRan.join(', ') : 'none logged'}</dd>
              <dt>Sources failing</dt><dd>{health.failedSources?.length ? health.failedSources.join(', ') : 'none flagged'}</dd>
              <dt>Sources stale</dt><dd>{health.staleSources?.length ? health.staleSources.join(', ') : 'none flagged'}</dd>
            </dl>
          </section>
        </>
      )}
      <section className="card">
        <h2>Delivery log</h2>
        {attempts.length === 0 ? <p className="small muted">No delivery attempt recorded.</p> : (
          <ul className="small" style={{ paddingLeft: 18 }}>
            {attempts.map((a, i) => { const w = deliveryWords(a.status, a.error); return <li key={i}>{fmtDate(a.at)} · {w.label} · provider: {a.provider}</li>; })}
          </ul>
        )}
      </section>
      {d.html ? (
        <details className={`card ${styles.disclosure}`}>
          <summary>Preview email HTML</summary>
          <p className="small muted" style={{ margin: '8px 0' }}>Rendered in a locked sandbox: no scripts, no links followed, no network storage.</p>
          <iframe className={styles.frame} sandbox="" srcDoc={d.html} title="Email preview" referrerPolicy="no-referrer" />
        </details>
      ) : null}
    </div>
  );
}

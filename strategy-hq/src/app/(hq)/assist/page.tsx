import { requireUser, currentProfile } from '@/lib/auth/session';
import { asUser } from '@/lib/db';
import { fmtDate } from '@/components/ui';
import { AssistClient } from './AssistClient';
import { ScreenshotUpload } from './ScreenshotUpload';
import styles from './assist.module.css';

export const metadata = { title: 'Game Assistant · Strategy HQ' };
export const dynamic = 'force-dynamic';

export default async function AssistPage() {
  const user = await requireUser();
  const p = await currentProfile(user.id);
  const shots = await asUser(user.id, (c) => c.query(
    `select id, question, consent_analysis, created_at from user_screenshots where user_id = app_uid() order by created_at desc limit 8`)).then((r) => r.rows);
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Coach</p>
        <h1 className="page-title">I&apos;m stuck</h1>
        <p className="lede">Ask in plain words. The coach searches your chapter-visible, evidence-backed findings and cites them. It never guesses.</p>
      </div>
      <p className="notice gold">Spoiler shield: you are at Chapter {p.chapter}. Nothing from later chapters is searched or shown. Platform: {p.platform}.</p>
      <AssistClient chapter={p.chapter} />
      <section className="card" id="screenshot" aria-labelledby="shot-h">
        <h2 id="shot-h">Am I in the right place?</h2>
        <p className="subtitle">Keep a screenshot of where you are, privately.</p>
        <p className="notice" style={{ margin: '10px 0' }}>Saved privately. Image analysis is not connected yet — nothing is sent anywhere. Only you can open your images.</p>
        <ScreenshotUpload />
        <h3 style={{ marginTop: 18 }}>Your recent screenshots</h3>
        {shots.length === 0 ? <div className="empty"><strong>No screenshots yet</strong>Uploads appear here, visible only to you.</div> : (
          <div className={styles.shots}>
            {shots.map((s) => (
              <figure key={s.id} className={styles.shot} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/screenshots/${s.id}`} alt={s.question ? `Your screenshot: ${s.question}` : 'Your screenshot'} loading="lazy" />
                <figcaption><b>Your own image — private</b><br />{fmtDate(s.created_at, p.timezone)}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

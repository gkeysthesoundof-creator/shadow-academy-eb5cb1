'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { VerificationTag } from '@/components/ui';
import styles from './assist.module.css';

interface Citation {
  id: string; title: string; verification: string; category: string; landmark: string | null; chapter_min: number | null;
  summary: string; steps: string[]; href: string;
}
interface Reply {
  mode: 'local' | 'llm'; modeLabel: string; reason?: string; answer: string; noMatch: boolean; citations: Citation[]; matches: Citation[];
}
interface Turn { q: string; reply?: Reply; error?: string }

const CHIPS = ["I'm stuck on a mission", 'Where can I find money?', 'Rare cars near me', 'Best weapon now', "What's free right now?"];

function Card({ c, steps }: { c: Citation; steps: boolean }) {
  return (
    <Link href={c.href} className={styles.cite}>
      <div className="tags"><VerificationTag v={c.verification} /><span className="tag">{c.chapter_min ? `CH ${c.chapter_min}+` : 'ANY CHAPTER'}</span></div>
      <h4>{c.title}</h4>
      <p>📍 {c.landmark ?? 'Landmark not verified'}</p>
      {steps && c.steps.length ? <ol>{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p style={{ marginTop: 6 }}>{c.summary}</p>}
    </Link>
  );
}

export function AssistClient({ chapter }: { chapter: number }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [noVideo, setNoVideo] = useState(true);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true); setText('');
    setTurns((t) => [...t, { q: question }]);
    try {
      const res = await fetch('/api/assist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, noVideo }) });
      const body = await res.json().catch(() => ({}));
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? (res.ok ? { ...x, reply: body as Reply } : { ...x, error: body.error ?? 'Something went wrong.' }) : x)));
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: 'Could not reach the server.' } : x)));
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ block: 'nearest' }), 50);
    }
  }

  return (
    <section className="card" aria-labelledby="ask-h">
      <h2 id="ask-h">Ask your coach</h2>
      <p className="subtitle">Answers come only from findings visible at Chapter {chapter}. Later-chapter content is never searched.</p>
      <div className="chips" role="group" aria-label="Quick prompts" style={{ margin: '10px 0' }}>
        {CHIPS.map((c) => <button key={c} type="button" className="chip" disabled={busy} onClick={() => ask(c)}>{c}</button>)}
      </div>
      <div className="chat" aria-live="polite" style={{ margin: '12px 0' }}>
        {turns.length === 0 ? <div className="empty"><strong>Nothing asked yet</strong>Pick a prompt or type a question. If nothing verified matches, you will be told plainly.</div> : null}
        {turns.map((t, i) => (
          <div key={i} className="stack">
            <div className="bubble me">{t.q}</div>
            {t.error ? <div className="notice pink">{t.error}</div> : null}
            {!t.error && !t.reply ? <div className="bubble">Searching your findings…</div> : null}
            {t.reply ? (
              <div className="bubble" style={{ maxWidth: '100%' }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className={`pill ${t.reply.mode === 'llm' ? 'cyan' : 'muted'}`}>{t.reply.modeLabel}</span>
                </div>
                <div className={styles.answer}>{t.reply.answer}</div>
                {t.reply.reason ? <p className="small muted" style={{ marginTop: 6 }}>{t.reply.reason}</p> : null}
                {t.reply.mode === 'llm' && t.reply.citations.length ? (
                  <><p className="eyebrow" style={{ marginTop: 10 }}>Cited</p><div className={styles.cites}>{t.reply.citations.map((c) => <Card key={c.id} c={c} steps={noVideo} />)}</div></>
                ) : null}
                {t.reply.matches.length ? (
                  <><p className="eyebrow" style={{ marginTop: 10 }}>{t.reply.mode === 'llm' ? 'All matching findings' : 'Matching findings'}</p>
                    <div className={styles.cites}>{t.reply.matches.map((c) => <Card key={c.id} c={c} steps={noVideo} />)}</div></>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className={styles.askRow} onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
        <label className="field">Your question
          <textarea className="input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="e.g. where is the leonida map" style={{ minHeight: 70 }} />
        </label>
        <label className={styles.toggle}><input type="checkbox" checked={noVideo} onChange={(e) => setNoVideo(e.target.checked)} /> No video needed — show written steps</label>
        <button className="btn primary block" type="submit" disabled={busy || !text.trim()}>{busy ? 'Searching…' : 'Ask'}</button>
      </form>
    </section>
  );
}

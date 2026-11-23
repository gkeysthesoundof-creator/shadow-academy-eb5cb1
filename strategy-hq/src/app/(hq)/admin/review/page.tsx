import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/session';
import { reviewQueue } from '@/lib/repo/admin';
import { SCOUTS, CATEGORY_LABELS, type FindingCategory } from '@/lib/domain/scouts';
import { intakeAction, evidenceAction, publishAction, editAction, correctAction, resolveCorrectionAction } from '@/lib/actions/admin';
import { VerificationTag, fmtDate } from '@/components/ui';
import { AdminNav } from '../AdminNav';

const CATS = Object.keys(CATEGORY_LABELS) as FindingCategory[];

export default async function Review({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const u = await requireUser();
  if (!u.is_moderator) redirect('/?denied=moderator');
  const q = await reviewQueue(u.id);
  const fields = [...new Map(SCOUTS.flatMap((s) => s.recordFields).map((f) => [f.key, f])).values()];
  return (
    <div className="stack">
      <AdminNav ok={sp.ok} err={sp.err} />

      <section className="card">
        <h2>Add intel (evidence required)</h2>
        <p className="subtitle">Write a factual paraphrase in your own words and link the source. Never paste full posts, never upload screenshots you do not have rights to, never guess coordinates or payouts — leave unknowns blank. The evidence tier is computed, not chosen.</p>
        <form action={intakeAction} className="stack" style={{ marginTop: 12 }}>
          <div className="grid2">
            <label className="field">Category<select name="category" className="input">{CATS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select></label>
            <label className="field">Game<select name="game_scope" className="input"><option value="GTA_VI">GTA VI (story)</option><option value="GTA_ONLINE">GTA Online</option></select></label>
          </div>
          <label className="field">Title (spoiler-safe)<input name="title" className="input" required maxLength={200} /></label>
          <label className="field">What it is (paraphrase)<textarea name="summary" className="input" required minLength={10} maxLength={1200} /></label>
          <label className="field">Why it matters<input name="why_it_matters" className="input" /></label>
          <label className="field">How to get it (one step per line)<textarea name="how_to" className="input" /></label>
          <div className="grid2">
            <label className="field">Chapter it becomes available<input name="chapter_min" className="input" type="number" min={1} max={99} placeholder="blank = unknown" /></label>
            <label className="field">Story content<select name="spoiler_level" className="input"><option value="story">Contains story content</option><option value="mild">Mild</option><option value="none">No story content</option></select></label>
            <label className="field">Verified landmark (one sentence)<input name="landmark" className="input" placeholder="blank = not verified" /></label>
            <label className="field">Region<input name="region" className="input" /></label>
            <label className="field">Risk<select name="risk" className="input"><option>unknown</option><option>low</option><option>medium</option><option>high</option></select></label>
            <label className="field">Free?<select name="is_free" className="input"><option value="">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="field">Payout min ($)<input name="payout_min" className="input" type="number" min={0} /></label>
            <label className="field">Payout max ($)<input name="payout_max" className="input" type="number" min={0} /></label>
            <label className="field">Price ($)<input name="price" className="input" type="number" min={0} /></label>
            <label className="field">Availability<input name="availability" className="input" placeholder="one-time / respawns / limited-time" /></label>
            <label className="field">Prerequisites<input name="prerequisites" className="input" /></label>
            <label className="field">Hazards<input name="hazards" className="input" /></label>
          </div>
          <details><summary className="small">Scout-specific fields (leave blank if unknown)</summary>
            <div className="grid2" style={{ marginTop: 8 }}>{fields.map((f) => <label key={f.key} className="field">{f.label}<input name={`attr_${f.key}`} className="input" /></label>)}</div>
          </details>
          <h3>Evidence</h3>
          <div className="grid2">
            <label className="field">Source URL (https)<input name="evidence_url" className="input" type="url" required /></label>
            <label className="field">Source title<input name="evidence_title" className="input" required /></label>
            <label className="field">Type<select name="evidence_type" className="input"><option value="community">Community</option><option value="guide">Guide</option><option value="official">Official</option><option value="founder_observation">My own in-game observation</option><option value="user_report">User report</option></select></label>
            <label className="field">Published date<input name="evidence_date" className="input" type="date" /></label>
            <label className="field">Author / handle (for corroboration counting)<input name="evidence_author" className="input" /></label>
          </div>
          <label className="field">Short paraphrase of what the source says<textarea name="evidence_paraphrase" className="input" required minLength={10} maxLength={600} /></label>
          <button className="btn primary">Create draft</button>
        </form>
      </section>

      <section className="card">
        <h2>Review queue ({q.drafts.length})</h2>
        {q.drafts.length ? <div className="flist" style={{ marginTop: 10 }}>{q.drafts.map((f) => (
          <article key={f.id} className="fcard">
            <div className="tags"><VerificationTag v={f.verification} /><span className="tag">{CATEGORY_LABELS[f.category as FindingCategory]}</span><span className="tag">{f.publication_status}</span><span className="tag">{f.chapter_min ? `CH ${f.chapter_min}` : 'chapter unknown'}</span><span className="tag">{f.spoiler_level}</span><span className="tag">{f.ev} source(s)</span></div>
            <form action={editAction} className="stack" style={{ marginTop: 8, gap: 8 }}>
              <input type="hidden" name="finding_id" value={f.id} />
              <input name="title" className="input" defaultValue={f.title} aria-label="Title" />
              <textarea name="summary" className="input" defaultValue={f.summary} aria-label="Summary" />
              <input name="why_it_matters" className="input" defaultValue={f.why_it_matters ?? ''} placeholder="Why it matters" aria-label="Why it matters" />
              <textarea name="how_to" className="input" defaultValue={(f.how_to ?? []).join('\n')} placeholder="Steps, one per line" aria-label="Steps" />
              <div className="row"><input name="chapter_min" className="input" type="number" min={1} defaultValue={f.chapter_min ?? ''} placeholder="Chapter" style={{ width: 110 }} aria-label="Chapter" />
                <select name="spoiler_level" className="input" defaultValue={f.spoiler_level} style={{ width: 170 }} aria-label="Story content"><option value="story">story</option><option value="mild">mild</option><option value="none">none</option></select>
                <button className="btn sm">Save edits</button></div>
            </form>
            <ul className="small">{(f.evidence_list ?? []).map((e: { url: string; title: string; type: string; contradicts: boolean }) => <li key={e.url}><a href={e.url} target="_blank" rel="noopener noreferrer nofollow">{e.title}</a> · {e.type}{e.contradicts ? ' · contradicts' : ''}</li>)}</ul>
            <details><summary className="small">Add evidence</summary>
              <form action={evidenceAction} className="stack" style={{ gap: 8, marginTop: 8 }}>
                <input type="hidden" name="finding_id" value={f.id} />
                <input name="url" className="input" type="url" placeholder="https://…" required /><input name="title" className="input" placeholder="Source title" />
                <input name="author" className="input" placeholder="Author / handle" />
                <select name="evidence_type" className="input"><option value="community">community</option><option value="guide">guide</option><option value="official">official</option><option value="founder_observation">my observation</option></select>
                <textarea name="paraphrase" className="input" placeholder="Short paraphrase" required minLength={10} />
                <label className="check"><input type="checkbox" name="contradicts" /><span>This source contradicts the claim</span></label>
                <button className="btn sm">Add evidence</button>
              </form>
            </details>
            <form action={publishAction} style={{ marginTop: 8 }}><input type="hidden" name="finding_id" value={f.id} /><button className="btn sm primary">Publish</button></form>
          </article>))}</div> : <p className="subtitle">Queue empty. Auto-intake drafts from sources appear here; nothing is published without review.</p>}
      </section>

      <section className="card">
        <h2>Open corrections ({q.corrections.length})</h2>
        {q.corrections.map((c) => (
          <div key={c.id} className="fcard" style={{ marginTop: 8 }}>
            <b>{c.title}</b> — {c.kind}<p>{c.details}</p>
            <div className="row">{(['accepted', 'rejected'] as const).map((st) => <form key={st} action={resolveCorrectionAction}><input type="hidden" name="correction_id" value={c.id} /><input type="hidden" name="status" value={st} /><button className="btn sm">{st === 'accepted' ? 'Accept' : 'Reject'}</button></form>)}</div>
          </div>))}
        {!q.corrections.length ? <p className="subtitle">No open corrections.</p> : null}
      </section>

      <section className="card">
        <h2>Published ({q.published.length})</h2>
        <div className="flist" style={{ marginTop: 10 }}>{q.published.map((f) => (
          <div key={f.id} className="fcard">
            <div className="row between"><Link href={`/intel/${f.id}`}>{f.title}</Link><VerificationTag v={f.verification} /></div>
            <form action={correctAction} className="row" style={{ marginTop: 8 }}>
              <input type="hidden" name="finding_id" value={f.id} />
              <input name="note" className="input" placeholder="Correction note" style={{ flex: 1, minWidth: 0 }} required />
              <select name="which" className="input" style={{ width: 140 }}><option value="patched">Patched</option><option value="debunked">Debunked</option><option value="retract">Retract</option></select>
              <button className="btn sm">Apply</button>
            </form>
          </div>))}</div>
      </section>

      <section className="card">
        <h2>Change log</h2>
        <div className="table-wrap"><table className="t"><tbody>{q.changes.map((l) => <tr key={l.id}><td>{fmtDate(l.at)}</td><td>{l.action}</td><td className="small">{l.target_type} {String(l.target_id ?? '').slice(0, 8)}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

import Link from 'next/link';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { getPlaybook, type HuntItem } from '@/lib/repo/progress';
import { addTaskAction, toggleTaskAction, deleteTaskAction, moveTaskAction, deleteCashAction } from '@/lib/actions/progress';
import { CATEGORY_LABELS, type FindingCategory } from '@/lib/domain/scouts';
import { EmptyState, VerificationTag } from '@/components/ui';
import { NotesForm, CashForm, ImportForm } from './PlaybookForms';
import s from './playbook.module.css';

export const metadata = { title: 'Playbook · Strategy HQ' };

function HuntList({ items, empty }: { items: HuntItem[]; empty: string }) {
  if (!items.length) return <EmptyState title="Nothing here yet">{empty}</EmptyState>;
  return (
    <div>
      {items.map((h) => (
        <Link key={h.finding_id} href={`/intel/${h.finding_id}`} className={s.huntLink}>
          <span><span className={s.huntTitle}>{h.title}</span><br /><span className="small muted">{CATEGORY_LABELS[h.category as FindingCategory] ?? h.category}</span></span>
          <VerificationTag v={h.verification} />
        </Link>
      ))}
    </div>
  );
}

export default async function Playbook() {
  const user = await requireUser();
  const [p, pb] = await Promise.all([currentProfile(user.id), getPlaybook(user.id)]);
  const by = (st: string) => pb.hunts.filter((h) => h.status === st);
  const collected = by('found').filter((h) => h.category === 'vehicle' || h.category === 'weapon');
  const open = pb.tasks.filter((t) => !t.done).length;
  const money = new Intl.NumberFormat('en-US');
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Your private progress</p>
        <h1 className="page-title">Playbook</h1>
        <p className="lede">Missions, notes, hunts and earnings you track yourself. Only you can see this.</p>
      </div>

      <div className="notice gold" role="note">
        <strong>Save reminder.</strong> HQ cannot read your game or your save. Keep your in-game save safe (cloud save, manual backup) and use the export below to back up this playbook.
      </div>

      <section className="card row between" aria-label="Chapter">
        <div><div className="eyebrow">Current chapter</div><div className="page-title" style={{ fontSize: 34 }}>Chapter {p.chapter} · {p.platform}</div></div>
        <Link href="/settings" className="btn sm cyan">Change chapter</Link>
      </section>

      <div className="grid2">
        <section className="card stack" aria-labelledby="tasks-h">
          <div className="between row"><h2 id="tasks-h">Mission checklist</h2><span className="pill cyan">{open} open</span></div>
          <form action={addTaskAction} className="row" style={{ flexWrap: 'nowrap' }}>
            <label className="sr-only" htmlFor="newtask" style={{ position: 'absolute', left: -9999 }}>New task</label>
            <input id="newtask" name="text" className="input" maxLength={300} placeholder="Add a mission or goal" required />
            <button className="btn primary sm">Add</button>
          </form>
          {pb.tasks.length ? (
            <div className="stack" style={{ gap: 8 }}>
              {pb.tasks.map((t) => (
                <div key={t.id} className={s.taskRow}>
                  <form action={toggleTaskAction} style={{ flex: 1 }}>
                    <input type="hidden" name="id" value={t.id} /><input type="hidden" name="done" value={String(!t.done)} />
                    <div className={`check${t.done ? ' done' : ''}`}>
                      <button className={s.taskBtn} aria-pressed={t.done} aria-label={`${t.done ? 'Mark not done' : 'Mark done'}: ${t.text}`}>
                        <span className={s.box} aria-hidden="true">{t.done ? '✓' : ''}</span><span>{t.text}</span>
                      </button>
                    </div>
                  </form>
                  <form action={moveTaskAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="dir" value="up" /><button className={`btn sm ghost ${s.mini}`} aria-label={`Move up: ${t.text}`}>↑</button></form>
                  <form action={moveTaskAction}><input type="hidden" name="id" value={t.id} /><input type="hidden" name="dir" value="down" /><button className={`btn sm ghost ${s.mini}`} aria-label={`Move down: ${t.text}`}>↓</button></form>
                  <form action={deleteTaskAction}><input type="hidden" name="id" value={t.id} /><button className={`btn sm ghost ${s.mini}`} aria-label={`Delete: ${t.text}`}>✕</button></form>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No tasks yet">Add the missions or goals you want to track. HQ does not know your in-game progress.</EmptyState>}
        </section>

        <section className="card" aria-labelledby="notes-h">
          <h2 id="notes-h" style={{ marginBottom: 10 }}>Notes</h2>
          <NotesForm initial={pb.notes} />
        </section>
      </div>

      <section className="card stack" aria-labelledby="hunt-h">
        <div><h2 id="hunt-h">Hunt list</h2><p className="subtitle">Findings you saved, found or skipped. Later-chapter items stay hidden by your spoiler shield.</p></div>
        <div className="grid2">
          <div><h3>Saved ({by('saved').length})</h3><HuntList items={by('saved')} empty="Save a find from its intel page and it appears here." /></div>
          <div><h3>Found ({by('found').length})</h3><HuntList items={by('found')} empty="Nothing marked found yet." /></div>
        </div>
        <div><h3>Skipped ({by('skipped').length})</h3><HuntList items={by('skipped')} empty="You have not skipped anything." /></div>
      </section>

      <section className="card stack" aria-labelledby="coll-h">
        <div><h2 id="coll-h">Collected weapons &amp; cars</h2><p className="subtitle">Found items in the vehicle and weapon categories.</p></div>
        <HuntList items={collected} empty="No vehicles or weapons marked found yet." />
      </section>

      <section className="card stack" aria-labelledby="cash-h">
        <div className="between row">
          <div><h2 id="cash-h">Manual earnings tracker</h2><p className="subtitle">Entered by you — HQ never reads your in-game balance.</p></div>
          <div style={{ textAlign: 'right' }}><div className="eyebrow">Total entered</div><div className={s.total}>${money.format(pb.cashTotal)}</div></div>
        </div>
        <CashForm />
        {pb.cash.length ? (
          <div>
            {pb.cash.map((e) => (
              <div key={e.id} className={s.cashRow}>
                <span>{e.label}<br /><span className="small muted">{new Date(e.entered_at).toLocaleDateString('en-US', { timeZone: p.timezone })}</span></span>
                <span className="row" style={{ flexWrap: 'nowrap' }}>
                  <span className={s.amount}>{e.amount < 0 ? '-' : ''}${money.format(Math.abs(e.amount))}</span>
                  <form action={deleteCashAction}><input type="hidden" name="id" value={e.id} /><button className="btn sm ghost" aria-label={`Delete entry: ${e.label}`}>✕</button></form>
                </span>
              </div>
            ))}
          </div>
        ) : <EmptyState title="No entries">Log what you earn so you can see your own totals. Nothing here is verified against the game.</EmptyState>}
      </section>

      <section className="card stack" aria-labelledby="exp-h">
        <div><h2 id="exp-h">Export &amp; restore</h2><p className="subtitle">Your data is yours. Download it any time.</p></div>
        <div className="row">
          <a className="btn cyan sm" href="/api/export" download>Export JSON</a>
          <a className="btn sm" href="/api/export?format=csv" download>Export CSV</a>
        </div>
        <ImportForm />
      </section>
    </div>
  );
}

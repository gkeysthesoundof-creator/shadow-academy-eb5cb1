'use client';
import { useActionState, useRef, useEffect } from 'react';
import { saveNotesAction, addCashAction, importAction, type NotesState, type CashState, type ImportState } from '@/lib/actions/progress';

export function NotesForm({ initial }: { initial: string }) {
  const [s, action, pending] = useActionState<NotesState, FormData>(saveNotesAction, {});
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <label className="field" htmlFor="notes">Private notes (only you can see these)
        <textarea id="notes" name="notes" className="input" defaultValue={initial} maxLength={20000} rows={8} placeholder="Stash spots, plans, reminders…" />
      </label>
      <div className="row between">
        <button className="btn primary sm" disabled={pending}>{pending ? 'Saving…' : 'Save notes'}</button>
        <span className="small muted" role="status">{s.error ?? (s.ok ? 'Notes saved.' : 'Max 20,000 characters.')}</span>
      </div>
    </form>
  );
}

export function CashForm() {
  const [s, action, pending] = useActionState<CashState, FormData>(addCashAction, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (s.ok) ref.current?.reset(); }, [s]);
  return (
    <form ref={ref} action={action} className="stack" style={{ gap: 10 }}>
      <div className="grid2">
        <label className="field" htmlFor="amount">Amount
          <input id="amount" name="amount" className="input" inputMode="numeric" placeholder="25000 (negative for spending)" required />
        </label>
        <label className="field" htmlFor="label">Label
          <input id="label" name="label" className="input" maxLength={120} placeholder="e.g. Store job payout" required />
        </label>
      </div>
      <div className="row between">
        <button className="btn cyan sm" disabled={pending}>{pending ? 'Adding…' : 'Add entry'}</button>
        <span className="small" role="status" style={{ color: s.error ? 'var(--pink)' : undefined }}>{s.error ?? ''}</span>
      </div>
    </form>
  );
}

export function ImportForm() {
  const [s, action, pending] = useActionState<ImportState, FormData>(importAction, {});
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <label className="field" htmlFor="file">Restore from HQ JSON backup
        <input id="file" name="file" type="file" accept="application/json,.json" className="input" required />
      </label>
      <label className="check"><input type="checkbox" name="confirm" /><span className="small">Replace my current tasks, notes and cash entries with the file. Hunts are merged.</span></label>
      <p className="small muted">Only data for your account is restored. Any user id inside the file is ignored, and hunt items for findings you cannot see are skipped.</p>
      <div className="row between">
        <button className="btn sm" disabled={pending}>{pending ? 'Restoring…' : 'Restore backup'}</button>
        <span className="small" role="status" style={{ color: s.error ? 'var(--pink)' : 'var(--cyan)' }}>{s.error ?? s.message ?? ''}</span>
      </div>
    </form>
  );
}

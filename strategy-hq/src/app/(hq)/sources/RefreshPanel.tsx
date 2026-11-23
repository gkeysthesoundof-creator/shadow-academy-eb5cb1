'use client';
import { useActionState } from 'react';
import { manualRefreshAction, type RefreshState } from '@/lib/actions/sources';

export function RefreshPanel({ allowed, why }: { allowed: boolean; why: string | null }) {
  const [state, action, pending] = useActionState<RefreshState | null, FormData>(manualRefreshAction, null);
  return (
    <div className="stack">
      <form action={action}>
        <button className="btn primary" type="submit" disabled={!allowed || pending}>{pending ? 'Refreshing sources… (can take a minute)' : 'Run manual refresh'}</button>
      </form>
      {!allowed && why ? <p className="notice gold">{why}</p> : null}
      {state ? (
        <div role="status" className={`notice ${state.ok ? '' : 'pink'}`}>
          <b>{state.message}</b>
          {state.sources?.length ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {state.sources.map((s, i) => <li key={i}><b>{s.name}</b>: {s.outcome} · fetched {s.items} · new {s.new}{s.note ? ` · ${s.note}` : ''}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

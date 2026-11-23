import Link from 'next/link';
export function AdminNav({ ok, err }: { ok?: string; err?: string }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div><p className="eyebrow">Owner console</p><h1 className="page-title">Admin</h1></div>
      <div className="chips"><Link className="chip" href="/admin">Operations</Link><Link className="chip" href="/admin/review">Review & intake</Link><Link className="chip" href="/admin/rights">Rights registry</Link><Link className="chip" href="/sources">Source monitor</Link></div>
      {ok ? <p className="notice" role="status">{ok}</p> : null}
      {err ? <p className="notice pink" role="alert">{err}</p> : null}
    </div>
  );
}

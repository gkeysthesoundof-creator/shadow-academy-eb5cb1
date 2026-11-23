import { requireAdmin } from '@/lib/auth/session';
import { adminOverview } from '@/lib/repo/admin';
import { config } from '@/lib/config';
import { rightsAction } from '@/lib/actions/admin';
import { fmtDate } from '@/components/ui';
import { AdminNav } from '../AdminNav';

export default async function RightsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  const o = await adminOverview(admin.id);
  return (
    <div className="stack">
      <AdminNav ok={sp.ok} err={sp.err} />
      <section className="card">
        <h2>Rights registry</h2>
        <p className="subtitle">Mode <b>{config.appMode}</b>. Every source and media item is shown only as far as its rights allow in the current mode: unreviewed → link only; link-out-only → paraphrase + link; personal use → private mode only; licensed/owned → only for the uses listed. Commercial use requires an agreement reference.</p>
        <div className="flist" style={{ marginTop: 12 }}>
          {o.rights.map((r) => (
            <form key={r.id} action={rightsAction} className="fcard stack" style={{ gap: 8 }}>
              <input type="hidden" name="rights_id" value={r.id} />
              <div className="row between"><b>{r.label}</b><span className="pill muted">{r.sources} source(s)</span></div>
              <label className="field">Status<select name="rights_status" className="input" defaultValue={r.rights_status}>{['unreviewed', 'link_out_only', 'personal_use', 'licensed', 'owned', 'denied'].map((x) => <option key={x}>{x}</option>)}</select></label>
              <div className="row">{['private', 'closed_beta', 'commercial'].map((u) => <label key={u} className="check"><input type="checkbox" name="uses" value={u} defaultChecked={r.allowed_uses.includes(u)} /><span>{u}</span></label>)}</div>
              <label className="field">Agreement / licence reference<input className="input" name="agreement_ref" defaultValue={r.agreement_ref ?? ''} placeholder="Required for commercial use" /></label>
              <label className="field">Notes<textarea className="input" name="notes" defaultValue={r.notes ?? ''} /></label>
              <div className="row between"><span className="small muted">Reviewed {fmtDate(r.reviewed_at)}</span><button className="btn sm">Save</button></div>
            </form>
          ))}
        </div>
      </section>
      <section className="card">
        <h2>Takedowns</h2>
        {o.takedowns.length ? <ul>{o.takedowns.map((t) => <li key={t.id}>{t.target_type} {t.target_id} — {t.status} — {t.reason}</li>)}</ul> : <p className="subtitle">No takedown requests recorded.</p>}
      </section>
    </div>
  );
}

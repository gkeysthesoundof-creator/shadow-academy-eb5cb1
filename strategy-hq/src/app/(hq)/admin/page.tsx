import { requireAdmin } from '@/lib/auth/session';
import { adminOverview, usageToday } from '@/lib/repo/admin';
import { scoutStatus, sourceHealth } from '@/lib/repo/intel';
import { config, integrationStatus } from '@/lib/config';
import { localParts } from '@/lib/domain/schedule';
import { SCOUTS } from '@/lib/domain/scouts';
import { flagAction, sourceAction, planAction, runScoutsAction } from '@/lib/actions/admin';
import { ScoutStatePill, timeAgo, fmtDate } from '@/components/ui';
import { Fragment } from 'react';
import { AdminNav } from './AdminNav';

export const metadata = { title: 'Admin · Strategy HQ' };

const PHASES = [
  ['0', 'Founder-only private alpha', 'founder_private'],
  ['1', 'Invited closed beta (5–20 accounts, rights-cleared sources)', 'closed_beta'],
  ['2', 'Payment test mode + isolation/security/load/cost testing', '—'],
  ['3', 'Authorized public release (after legal, licensing, trademark, map/media and API review)', 'commercial'],
];

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  const day = localParts(new Date(), config.timezone).date;
  const [o, usage, scouts, sources] = await Promise.all([adminOverview(admin.id), usageToday(day), scoutStatus(admin.id), sourceHealth(admin.id)]);
  const integ = integrationStatus();
  const llmSpend = usage.budget.find((b) => b.meter === 'llm');
  return (
    <div className="stack">
      <AdminNav ok={sp.ok} err={sp.err} />

      <section className="card">
        <div className="section-head"><div><h2>Launch phase</h2><p className="subtitle">Current mode: <b>{config.appMode}</b>. Moving phases is an owner decision; nothing here opens registration, billing or email to others.</p></div></div>
        <ol className="steps">{PHASES.map(([n, label, mode]) => <li key={n} style={{ opacity: mode === config.appMode ? 1 : .6 }}>{mode === config.appMode ? <b>{label} ← you are here</b> : label}</li>)}</ol>
      </section>

      <section className="card">
        <div className="section-head"><div><h2>Integrations</h2><p className="subtitle">Variable names only — values are never displayed.</p></div></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>Integration</th><th>State</th><th>Variables</th></tr></thead><tbody>
          {Object.entries(integ).map(([k, v]) => <tr key={k}><td>{k}</td><td><span className={`pill ${v.state === 'configured' ? 'green' : v.state === 'disabled_by_owner' ? 'gold' : 'muted'}`}>{v.state.replace(/_/g, ' ')}</span></td><td className="small">{v.vars.join(', ')}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="card">
        <div className="section-head"><div><h2>Scout operations</h2><p className="subtitle">Logged runs only. Daily scan {config.scanLocalTime}, brief {config.briefLocalTime} ({config.timezone}).</p></div>
          <form action={runScoutsAction}><button className="btn primary sm">Run scouts now</button></form></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>Scout</th><th>State</th><th>Last run</th><th>Examined</th><th>Added</th><th>Updated</th><th>Corrected</th><th>Note</th></tr></thead><tbody>
          {scouts.map((s) => <tr key={s.scout_id}><td>{SCOUTS.find((x) => x.id === s.scout_id)?.name}</td><td><ScoutStatePill state={s.state} /></td><td>{timeAgo(s.last_run_at)}</td><td>{s.items_examined}</td><td>{s.findings_added}</td><td>{s.findings_updated}</td><td>{s.findings_corrected}</td><td className="small">{s.error ?? s.last_note ?? ''}</td></tr>)}
        </tbody></table></div>
        <p className="small muted" style={{ marginTop: 8 }}>LLM tokens/cost per scout: 0 — scouts are deterministic; the only model spend is the optional coach (below).</p>
      </section>

      <section className="card">
        <h2>Feature flags</h2>
        <p className="subtitle">Locked flags (public registration, live billing, beta invites) cannot be switched from the app. They require your explicit decision and a code/database change.</p>
        <div className="flist" style={{ marginTop: 12 }}>
          {o.flags.map((f) => (
            <div key={f.key} className="fcard">
              <div className="row between"><b>{f.key}</b><span className={`pill ${f.enabled ? 'green' : 'muted'}`}>{f.enabled ? 'ON' : 'OFF'}{f.locked ? ' · LOCKED' : ''}</span></div>
              <p className="small" style={{ margin: '6px 0' }}>{f.description}</p>
              {!f.locked ? <form action={flagAction}><input type="hidden" name="key" value={f.key} /><input type="hidden" name="enabled" value={String(!f.enabled)} /><button className="btn sm">{f.enabled ? 'Turn off' : 'Turn on'}</button></form> : null}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Sources</h2>
        <div className="table-wrap"><table className="t"><thead><tr><th>Source</th><th>Status</th><th>Last success</th><th></th></tr></thead><tbody>
          {sources.map((s) => <tr key={s.id}><td>{s.name}<div className="small muted">{s.access_method}</div></td><td>{s.status}{s.last_error ? <div className="small muted">{String(s.last_error).slice(0, 80)}</div> : null}</td><td>{timeAgo(s.last_success_at)}</td>
            <td><form action={sourceAction}><input type="hidden" name="source_id" value={s.id} /><input type="hidden" name="enabled" value={String(!s.enabled)} /><button className="btn sm">{s.enabled ? 'Disable' : 'Enable'}</button></form></td></tr>)}
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Accounts & plans</h2>
        <p className="subtitle">Billing is staging-only. Plan changes here are manual grants recorded in the audit log; no payment is taken and no checkout exists.</p>
        <div className="table-wrap"><table className="t"><thead><tr><th>Account</th><th>Role</th><th>Plan</th><th>Last login</th><th>Change plan</th></tr></thead><tbody>
          {o.users.map((u) => <tr key={u.id}><td>{u.display_name}<div className="small muted">{u.email}</div></td><td>{u.platform_role ?? 'customer'}</td><td>{u.plan ?? 'free'}</td><td>{fmtDate(u.last_login_at)}</td>
            <td><form action={planAction} className="row"><input type="hidden" name="user_id" value={u.id} /><select name="plan" className="input" defaultValue={u.plan ?? 'free'} style={{ minHeight: 36, width: 110 }}>{o.plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select><button className="btn sm">Set</button></form></td></tr>)}
        </tbody></table></div>
        <h3 style={{ marginTop: 16 }}>Plan catalogue (labels only — prices not set)</h3>
        <div className="table-wrap"><table className="t"><thead><tr><th>Plan</th><th>Monthly</th><th>Yearly</th><th>Limits</th></tr></thead><tbody>
          {o.plans.map((p) => <tr key={p.id}><td>{p.label}{p.public ? '' : ' (private)'}</td><td>{p.monthly_price_cents ?? 'not set'}</td><td>{p.yearly_price_cents ?? 'not set'}</td><td className="small">{Object.entries(p.features).map(([k, v]) => `${k}: ${v === null || v === true ? '∞' : v === false ? '—' : v}`).join(' · ')}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Usage & cost today ({day})</h2>
        <dl className="kv" style={{ marginTop: 10 }}>
          <dt>LLM spend</dt><dd>${((Number(llmSpend?.cost_micros ?? 0)) / 1e6).toFixed(4)} of ${(config.llmDailyBudgetMicros / 1e6).toFixed(2)} daily ceiling · {llmSpend?.calls ?? 0} calls</dd>
          {usage.meters.map((m) => <Fragment key={m.meter}><dt>{m.meter}</dt><dd>{m.calls} uses by {m.users} account(s)</dd></Fragment>)}
        </dl>
        <h3 style={{ marginTop: 14 }}>Recent jobs</h3>
        <div className="table-wrap"><table className="t"><tbody>{usage.jobs.map((j) => <tr key={j.idempotency_key}><td>{j.kind}</td><td>{j.status}</td><td>{fmtDate(j.started_at)}</td></tr>)}</tbody></table></div>
        <h3 style={{ marginTop: 14 }}>Billing webhooks (test mode)</h3>
        {usage.webhooks.length ? <div className="table-wrap"><table className="t"><tbody>{usage.webhooks.map((w, i) => <tr key={i}><td>{w.provider}</td><td>{w.event_type}</td><td>{w.status}</td><td>{fmtDate(w.received_at)}</td></tr>)}</tbody></table></div> : <p className="subtitle">None received. The webhook endpoint returns 503 until a provider is configured and the test-mode flag is on.</p>}
      </section>
    </div>
  );
}

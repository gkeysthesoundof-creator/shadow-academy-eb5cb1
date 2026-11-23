import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { getSettings, EMAIL_SECTIONS } from '@/lib/repo/progress';
import { PLAN_CATALOG, type PlanId } from '@/lib/domain/plans';
import { config } from '@/lib/config';
import { logoutAction } from '@/lib/actions/auth';
import { ProfileForm, DeviceForm, AlertsForm, ConsentForm, DeleteForm } from './SettingsForms';

export const metadata = { title: 'Settings · Strategy HQ' };

function limitText(v: unknown) {
  return v === false ? 'not included' : v === true ? 'included' : v === null ? 'unlimited' : String(v);
}

export default async function Settings() {
  const user = await requireUser();
  const s = await getSettings(user.id);
  const planId = (s.plan?.plan_id ?? 'free') as PlanId;
  const features = (s.plan?.features ?? PLAN_CATALOG[planId]?.features ?? PLAN_CATALOG.free.features) as Record<string, unknown>;
  const label = s.plan?.label ?? PLAN_CATALOG[planId].label;
  const FEATURE_LABELS: Record<string, string> = {
    assistant_queries_daily: 'Assistant questions / day', manual_refresh_daily: 'Manual refreshes / day', screenshot_uploads_daily: 'Screenshot uploads / day',
    private_pins_total: 'Private map pins', morning_email: 'Morning email', map_import: 'Map import', data_export: 'Data export',
  };
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Account · {user.email}</p>
        <h1 className="page-title">Settings</h1>
        <p className="lede">Your player profile, display, morning email and privacy.</p>
      </div>

      <section className="card stack" aria-labelledby="prof-h">
        <h2 id="prof-h">Player profile</h2>
        <ProfileForm platform={s.profile.platform} chapter={s.profile.chapter} maxChapter={s.maxChapter} spoiler={s.profile.spoiler_shield} timezone={s.profile.timezone} region={s.profile.saved_region ?? ''} />
      </section>

      <section className="card stack" aria-labelledby="dev-h">
        <h2 id="dev-h">Device &amp; display</h2>
        <DeviceForm theme={s.device.theme} reduced={s.device.reduced_motion} primary={s.device.primary_device} others={(s.device.other_devices ?? []).join(', ')} />
      </section>

      <section id="email" className="card stack" aria-labelledby="mail-h">
        <h2 id="mail-h">Morning email</h2>
        <div className="notice gold" role="status">
          <strong>Email delivery is {s.emailFlag && config.reportEnabled ? 'enabled by the owner' : 'OFF'}.</strong>{' '}
          Opting in saves your preference only. Nothing is sent unless every gate is open: the owner flag <code>email_delivery</code>, the server setting <code>REPORT_ENABLED=true</code> with a verified sender,
          your opt-in, and a plan that includes morning email. While in founder-private mode only the owner address can receive it. The brief is always available in the app.
        </div>
        <div className="stats">
          <div className="stat"><div className="k">Owner flag</div><div className="v" style={{ fontSize: 22 }}>{s.emailFlag ? 'ON' : 'OFF'}</div><div className="n">email_delivery</div></div>
          <div className="stat"><div className="k">Server</div><div className="v" style={{ fontSize: 22 }}>{config.reportEnabled ? 'ON' : 'OFF'}</div><div className="n">REPORT_ENABLED</div></div>
          <div className="stat"><div className="k">Your plan</div><div className="v" style={{ fontSize: 22 }}>{s.hasMorningEmail ? 'YES' : 'NO'}</div><div className="n">includes morning email</div></div>
        </div>
        <p className="small">Your plan includes morning email: <strong>{s.hasMorningEmail ? 'yes' : 'no'}</strong> · Your opt-in: <strong>{s.alerts.email_enabled ? 'on' : 'off'}</strong></p>
        <AlertsForm enabled={s.alerts.email_enabled} time={s.alerts.send_local_time} sections={s.alerts.sections} all={[...EMAIL_SECTIONS]} />
      </section>

      <section className="card stack" aria-labelledby="plan-h">
        <div className="between row"><h2 id="plan-h">Plan</h2><span className="pill pink">{label}</span></div>
        <p className="small">{s.plan?.description ?? PLAN_CATALOG[planId].description}{s.plan ? ` Status: ${s.plan.status}.` : ''}</p>
        <div className="kv">
          {Object.entries(FEATURE_LABELS).map(([k, l]) => (
            <div key={k} className="row between small"><span className="muted">{l}</span><strong>{limitText(features[k])}</strong></div>
          ))}
        </div>
        <div className="notice">Billing is not active. No charges can be made.</div>
      </section>

      <section className="card stack" aria-labelledby="priv-h">
        <h2 id="priv-h">Privacy</h2>
        <ConsentForm granted={s.consents.screenshot_analysis === true} />
        <div className="row">
          <a className="btn cyan sm" href="/api/export" download>Export my data</a>
          <Link className="btn sm" href="/playbook">Playbook</Link>
          <Link className="btn sm ghost" href="/legal">Terms &amp; sources</Link>
        </div>
      </section>

      <section className="card stack" aria-labelledby="out-h">
        <h2 id="out-h">Session</h2>
        <form action={logoutAction}><button className="btn sm">Sign out</button></form>
      </section>

      <section className="card stack" aria-labelledby="del-h">
        <h2 id="del-h">Delete account</h2>
        <DeleteForm />
      </section>
    </div>
  );
}

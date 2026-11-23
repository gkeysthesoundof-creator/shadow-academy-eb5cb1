'use client';
import { useActionState, useState } from 'react';
import {
  saveProfileAction, saveDeviceAction, saveAlertsAction, setScreenshotConsentAction, deleteAccountAction, type FormState,
} from '@/lib/actions/settings';

function Status({ s }: { s: FormState }) {
  return <span className="small" role="status" style={{ color: s.error ? 'var(--pink)' : 'var(--cyan)' }}>{s.error ?? s.message ?? ''}</span>;
}
type A = (p: FormState, f: FormData) => Promise<FormState>;
const useForm = (a: A) => useActionState<FormState, FormData>(a, {});

export function ProfileForm(p: { platform: string; chapter: number; maxChapter: number; spoiler: boolean; timezone: string; region: string }) {
  const [s, action, pending] = useForm(saveProfileAction);
  const [ch, setCh] = useState(p.chapter);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <div className="grid2">
        <label className="field">Platform
          <select name="platform" className="input" defaultValue={p.platform}>
            <option value="PS5">PS5</option><option value="XBOX_SERIES">Xbox Series X|S</option><option value="PC">PC</option><option value="OTHER">Other</option>
          </select>
        </label>
        <label className="field">Chapter (1–{p.maxChapter})
          <select name="chapter" className="input" value={ch} onChange={(e) => setCh(Number(e.target.value))}>
            {Array.from({ length: Math.max(p.maxChapter, p.chapter) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Chapter {n}</option>)}
          </select>
        </label>
      </div>
      {ch > p.chapter ? (
        <label className="check"><input type="checkbox" name="confirm_chapter" /><span className="small">I understand this reveals later-chapter content</span></label>
      ) : null}
      <label className="check"><input type="checkbox" name="spoiler_shield" defaultChecked={p.spoiler} /><span>Spoiler shield (hide content from chapters above yours)</span></label>
      <div className="grid2">
        <label className="field">Timezone
          <input name="timezone" className="input" defaultValue={p.timezone} placeholder="America/New_York" />
        </label>
        <label className="field">Saved region (optional label)
          <input name="saved_region" className="input" defaultValue={p.region} maxLength={80} placeholder="e.g. Vice City" />
        </label>
      </div>
      <p className="small muted">The region is only a filter label you type. HQ never uses GPS or your location.</p>
      <div className="row between"><button className="btn primary sm" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button><Status s={s} /></div>
    </form>
  );
}

export function DeviceForm(p: { theme: string; reduced: boolean; primary: string; others: string }) {
  const [s, action, pending] = useForm(saveDeviceAction);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <label className="field">Theme
        <select name="theme" className="input" defaultValue={p.theme}>
          <option value="neon">Neon (default)</option><option value="subtle">Subtle (battery saver)</option><option value="velvet">Velvet (red / black / white)</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" name="reduced_motion" defaultChecked={p.reduced} /><span>Reduced motion</span></label>
      <div className="grid2">
        <label className="field">Primary device
          <input name="primary_device" className="input" defaultValue={p.primary} maxLength={60} />
        </label>
        <label className="field">Other devices (comma separated)
          <input name="other_devices" className="input" defaultValue={p.others} />
        </label>
      </div>
      <p className="small muted">Note: ROG Xbox Ally plays GTA VI only via PS5 Remote Play — not natively offline.</p>
      <div className="row between"><button className="btn primary sm" disabled={pending}>{pending ? 'Saving…' : 'Save display'}</button><Status s={s} /></div>
    </form>
  );
}

export const SECTION_LABELS: Record<string, string> = {
  top3: 'Top 3', vehicles: 'Vehicles', weapons: 'Weapons', money: 'Money', secrets: 'Secrets', missions: 'Missions', rewards: 'Rewards', corrections: 'Corrections', health: 'Scout health',
};

export function AlertsForm(p: { enabled: boolean; time: string; sections: string[]; all: string[] }) {
  const [s, action, pending] = useForm(saveAlertsAction);
  return (
    <form action={action} className="stack" style={{ gap: 12 }}>
      <label className="check"><input type="checkbox" name="email_enabled" defaultChecked={p.enabled} /><span>I want the morning email when delivery is available</span></label>
      <label className="field" style={{ maxWidth: 220 }}>Send time (your timezone)
        <input type="time" name="send_local_time" className="input" defaultValue={p.time} required />
      </label>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small muted" style={{ marginBottom: 6 }}>Sections</legend>
        <div className="grid2">
          {p.all.map((k) => (
            <label key={k} className="check"><input type="checkbox" name="sections" value={k} defaultChecked={p.sections.includes(k)} /><span>{SECTION_LABELS[k] ?? k}</span></label>
          ))}
        </div>
      </fieldset>
      <div className="row between"><button className="btn primary sm" disabled={pending}>{pending ? 'Saving…' : 'Save email preferences'}</button><Status s={s} /></div>
    </form>
  );
}

export function ConsentForm({ granted }: { granted: boolean }) {
  const [s, action, pending] = useForm(setScreenshotConsentAction);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <label className="check"><input type="checkbox" name="screenshot_analysis" defaultChecked={granted} /><span>Allow analysis of screenshots I upload (private to me)</span></label>
      <div className="row between"><button className="btn sm" disabled={pending}>{pending ? 'Saving…' : 'Save privacy choice'}</button><Status s={s} /></div>
    </form>
  );
}

export function DeleteForm() {
  const [s, action, pending] = useForm(deleteAccountAction);
  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <p className="small">Deleting your account permanently removes your profile, tasks, notes, cash entries, hunts, pins, digests and uploaded screenshots. This cannot be undone. Export first if you want a copy.</p>
      <label className="field">Type DELETE to confirm
        <input name="confirm" className="input" autoComplete="off" placeholder="DELETE" />
      </label>
      <div className="row between"><button className="btn sm" style={{ borderColor: 'var(--pink)', color: 'var(--pink)' }} disabled={pending}>{pending ? 'Deleting…' : 'Delete my account'}</button><Status s={s} /></div>
    </form>
  );
}

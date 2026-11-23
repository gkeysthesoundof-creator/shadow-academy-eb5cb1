'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ScreenshotUpload() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get('file');
    if (!(file instanceof File) || file.size === 0) { setMsg({ ok: false, text: 'Choose a PNG, JPEG or WEBP image first.' }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/screenshots', { method: 'POST', body: data });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { setMsg({ ok: true, text: body.message }); form.reset(); router.refresh(); }
      else setMsg({ ok: false, text: body.error ?? 'Upload failed.' });
    } catch { setMsg({ ok: false, text: 'Could not reach the server.' }); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="stack">
      <label className="field">Screenshot (PNG, JPEG or WEBP, max 8 MB)
        <input className="input" type="file" name="file" accept="image/png,image/jpeg,image/webp" />
      </label>
      <label className="field">What are you trying to confirm? (optional)
        <input className="input" type="text" name="question" maxLength={500} placeholder="e.g. Is this the right dock?" />
      </label>
      <button className="btn cyan block" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save privately'}</button>
      {msg ? <div role="status" className={`notice ${msg.ok ? '' : 'pink'}`}>{msg.text}</div> : null}
    </form>
  );
}

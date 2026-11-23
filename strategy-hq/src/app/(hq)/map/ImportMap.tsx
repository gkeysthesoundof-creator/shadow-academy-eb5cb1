'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from './map.module.css';

export interface MapListItem { id: string; mime: string; created_at: string; active: boolean }

export default function ImportMap({ maps }: { maps: MapListItem[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setBusy(true); setMsg(null);
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('The file is larger than 8 MB.');
      const fd = new FormData(); fd.set('purpose', 'map'); fd.set('file', file);
      const res = await fetch('/api/uploads', { method: 'POST', body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? 'Upload failed.');
      setMsg({ ok: true, text: 'Map imported. It is private to your account.' });
      router.replace('/map'); router.refresh();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this imported map and its private pins?')) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/uploads/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: 'Could not delete that map.' }); return; }
    router.replace('/map'); router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <label className={`btn cyan block ${styles.fileLabel}`} style={{ cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Working…' : 'Import my map'}
        <input ref={input} type="file" name="file" accept="image/png,image/jpeg,image/webp" disabled={busy} className={styles.fileHidden}
          aria-label="Import my map (PNG, JPEG or WEBP, up to 8 MB)" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
      </label>
      <p className="small muted">PNG, JPEG or WEBP, up to 8 MB. Stored privately; only your account can open it.</p>
      {msg ? <div className={`notice${msg.ok ? '' : ' pink'}`} role="status">{msg.text}</div> : null}
      {maps.length ? (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {maps.map((m, i) => (
            <li key={m.id} className="row between" style={{ gap: 8 }}>
              <span className="small">{m.active ? <strong>Active · </strong> : null}Imported {new Date(m.created_at).toLocaleDateString('en-US')} ({m.mime.replace('image/', '').toUpperCase()}){i === 0 ? ' · newest' : ''}</span>
              <span className="row" style={{ gap: 6 }}>
                {!m.active ? <Link className="btn sm" style={{ minHeight: 44 }} href={`/map?asset=${m.id}`}>Use</Link> : null}
                <button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={() => remove(m.id)} disabled={busy} aria-label={`Delete map imported ${new Date(m.created_at).toLocaleDateString('en-US')}`}>Delete</button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

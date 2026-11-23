'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addPinAction, renamePinAction, deletePinAction } from '@/lib/actions/map';
import styles from './map.module.css';

export interface BoardPin { id: string; label: string; x: number; y: number }
export interface BoardVerifiedPin { id: string; findingId: string; title: string; x: number; y: number; precision: string; focus: boolean }

interface Props {
  mode: 'planning' | 'platform' | 'user';
  imageUrl: string | null;
  assetId: string | null;
  naturalAspect: number | null; // width / height when known
  privatePins: BoardPin[];
  verifiedPins: BoardVerifiedPin[];
  used: number;
  cap: number | null;
}

const BOARD_ASPECT = 4 / 3;
const MIN_Z = 1, MAX_Z = 6;
const PERSONAL = 'Personal note — not fact-checked';

export default function MapBoard({ mode, imageUrl, assetId, naturalAspect, privatePins, verifiedPins, used, cap }: Props) {
  const router = useRouter();
  const boardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const [aspect, setAspect] = useState<number | null>(naturalAspect);
  const drag = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const canAdd = mode === 'user' && !!assetId;
  const atCap = cap !== null && used >= cap;

  // Frame = the displayed image box inside the 4:3 board.
  const a = aspect ?? BOARD_ASPECT;
  const frame = a >= BOARD_ASPECT
    ? { left: 0, top: (1 - BOARD_ASPECT / a) / 2, width: 1, height: BOARD_ASPECT / a }
    : { left: (1 - a / BOARD_ASPECT) / 2, top: 0, width: a / BOARD_ASPECT, height: 1 };

  const clampView = useCallback((v: { z: number; x: number; y: number }) => {
    const el = boardRef.current; if (!el) return v;
    const w = el.clientWidth, h = el.clientHeight;
    const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z));
    return { z, x: Math.min(0, Math.max(w - w * z, v.x)), y: Math.min(0, Math.max(h - h * z, v.y)) };
  }, []);

  const zoomBy = (f: number) => {
    const el = boardRef.current; if (!el) return;
    const cx = el.clientWidth / 2, cy = el.clientHeight / 2;
    setView((v) => { const z = Math.min(MAX_Z, Math.max(MIN_Z, v.z * f)); const k = z / v.z; return clampView({ z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }); });
  };

  // Centre a focused verified pin on load.
  const focusPin = verifiedPins.find((p) => p.focus);
  useEffect(() => {
    const el = boardRef.current; if (!el || !focusPin) return;
    const w = el.clientWidth, h = el.clientHeight, z = 3;
    const px = (frame.left + frame.width * focusPin.x) * w, py = (frame.top + frame.height * focusPin.y) * h;
    setView(clampView({ z, x: w / 2 - px * z, y: h / 2 - py * z }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPin?.id]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, input, form')) return;
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false };
    boardRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    setView((v) => clampView({ ...v, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    boardRef.current?.releasePointerCapture?.(e.pointerId);
    if (d.moved || !canAdd || (e.target as HTMLElement).closest('button, input, form')) return;
    const r = frameRef.current?.getBoundingClientRect(); if (!r) return;
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setError(null);
    if (atCap) { setError(`You have reached your private pin limit (${cap}).`); return; }
    setDraft({ x, y }); setDraftLabel('');
  };

  const submitDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !assetId) return;
    const label = draftLabel.trim();
    if (!label) { setError('Enter a label for the pin.'); return; }
    start(async () => {
      const r = await addPinAction({ assetId, x: draft.x, y: draft.y, label });
      if (r.ok) { setDraft(null); setDraftLabel(''); setError(null); } else setError(r.error);
    });
  };
  const submitRename = (e: React.FormEvent, id: string) => {
    e.preventDefault();
    start(async () => { const r = await renamePinAction(id, editLabel); if (r.ok) { setEditing(null); setError(null); } else setError(r.error); });
  };
  const remove = (id: string) => start(async () => { const r = await deletePinAction(id); if (!r.ok) setError(r.error); });

  const px = (n: number, axis: 'x' | 'y') => `${((axis === 'x' ? frame.left : frame.top) + n * (axis === 'x' ? frame.width : frame.height)) * 100}%`;

  return (
    <div className="stack">
      <div
        ref={boardRef}
        className={`board ${styles.board}${canAdd ? ` ${styles.adding}` : ''}`}
        role="group"
        aria-label={mode === 'planning' ? 'Non-geographic planning board' : mode === 'platform' ? 'Calibrated map' : 'Your imported map (private, uncalibrated)'}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { drag.current = null; }}
      >
        {mode === 'planning' ? <div className="radar" aria-hidden="true" /> : null}
        <div className={styles.badge}>
          {mode === 'planning' ? <span>Non-geographic planning board</span> : null}
          {mode === 'user' ? <><span className="cyan">Your imported map · private</span><span>Not calibrated</span></> : null}
          {mode === 'platform' ? <span className="cyan">Calibrated platform map</span> : null}
        </div>
        {mode === 'planning' ? (
          <div className={styles.center}><p>Positions on this board mean nothing. It is a planning surface, not a map of Leonida.</p></div>
        ) : null}
        {mode !== 'planning' && imageUrl ? (
          <div className={styles.stage} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, ['--z' as string]: view.z }}>
            <div ref={frameRef} className={styles.frame} style={{ left: `${frame.left * 100}%`, top: `${frame.top * 100}%`, width: `${frame.width * 100}%`, height: `${frame.height * 100}%` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt={mode === 'user' ? 'Your imported map' : 'Platform map'} draggable={false}
                onLoad={(e) => { const i = e.currentTarget; if (i.naturalWidth && i.naturalHeight) setAspect(i.naturalWidth / i.naturalHeight); }} />
            </div>
            {mode === 'platform' ? verifiedPins.map((p) => (
              <div key={p.id} className={styles.anchor} style={{ left: px(p.x, 'x'), top: px(p.y, 'y') }}>
                <button type="button" onClick={() => router.push(`/intel/${p.findingId}?focus=visual`)} className={`pin${p.focus ? ' focus' : ''}`} aria-label={`Verified pin: ${p.title} (${p.precision} location). Opens the finding.`}><span>✓</span></button>
              </div>
            )) : null}
            {mode === 'user' ? privatePins.map((p, i) => (
              <div key={p.id} className={styles.anchor} style={{ left: px(p.x, 'x'), top: px(p.y, 'y') }}>
                <button type="button" className={`pin mine${selected === p.id ? ' focus' : ''}`} aria-label={`Private pin ${i + 1}: ${p.label}. ${PERSONAL}`}
                  onClick={() => setSelected(selected === p.id ? null : p.id)}><span>{i + 1}</span></button>
              </div>
            )) : null}
            {draft ? (
              <div className={styles.anchor} style={{ left: px(draft.x, 'x'), top: px(draft.y, 'y') }}>
                <span className={`pin focus ${styles.draft}`} aria-hidden="true"><span>+</span></span>
              </div>
            ) : null}
          </div>
        ) : null}
        {mode !== 'planning' ? (
          <div className={styles.ctrls}>
            <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.5)} disabled={view.z <= MIN_Z}>−</button>
            <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.5)} disabled={view.z >= MAX_Z}>+</button>
            <button type="button" className={styles.txt} aria-label="Reset zoom and position" onClick={() => setView({ z: 1, x: 0, y: 0 })}>Reset</button>
          </div>
        ) : null}
      </div>

      {mode === 'user' ? (
        <div className="stack" style={{ gap: 8 }}>
          <p className={`muted ${styles.hint}`}>Tap or click the map to drop a private pin; drag to pan. {cap === null ? `${used} pins (unlimited).` : `${used} of ${cap} pins used.`}</p>
          {draft ? (
            <form className={styles.inline} onSubmit={submitDraft} aria-label="Label for new pin">
              <label className="small muted" style={{ flexBasis: '100%' }} htmlFor="pin-label">Label for the new pin ({PERSONAL})</label>
              <input id="pin-label" className="input" value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} maxLength={80} autoFocus placeholder="e.g. Possible stash near the pier" />
              <button className="btn primary" type="submit" disabled={pending}>Save pin</button>
              <button className="btn" type="button" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
            </form>
          ) : null}
          {error ? <div className="notice pink" role="alert">{error}</div> : null}
        </div>
      ) : null}

      {mode === 'user' ? (
        <section aria-labelledby="pins-h">
          <h3 id="pins-h" style={{ margin: '4px 0 8px' }}>Your private pins</h3>
          {privatePins.length ? (
            <ol className={styles.plist}>
              {privatePins.map((p, i) => (
                <li key={p.id} className={selected === p.id ? styles.sel : undefined}>
                  {editing === p.id ? (
                    <form className={styles.inline} onSubmit={(e) => submitRename(e, p.id)}>
                      <label className="small muted" style={{ flexBasis: '100%' }} htmlFor={`rn-${p.id}`}>Rename pin {i + 1}</label>
                      <input id={`rn-${p.id}`} className="input" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} maxLength={80} autoFocus />
                      <button className="btn primary" type="submit" disabled={pending}>Save</button>
                      <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <div><strong>{i + 1}. {p.label}</strong><div className="small muted">{PERSONAL} · position {(p.x * 100).toFixed(1)}% across, {(p.y * 100).toFixed(1)}% down</div></div>
                      <div className="btns">
                        <button className="btn sm" type="button" onClick={() => setSelected(selected === p.id ? null : p.id)} aria-pressed={selected === p.id}>Highlight</button>
                        <button className="btn sm" type="button" onClick={() => { setEditing(p.id); setEditLabel(p.label); }} aria-label={`Rename pin ${p.label}`}>Rename</button>
                        <button className="btn sm" type="button" disabled={pending} onClick={() => remove(p.id)} aria-label={`Delete pin ${p.label}`}>Delete</button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ol>
          ) : <p className="muted small">No private pins yet. Tap the map to add one.</p>}
        </section>
      ) : null}
    </div>
  );
}

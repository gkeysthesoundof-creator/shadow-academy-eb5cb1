import Link from 'next/link';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { listFindings, getFinding, type FindingRow } from '@/lib/repo/intel';
import { getPlatformMap, listUserMaps, listPrivatePins, listVerifiedPins, pinAllowance, isUuid } from '@/lib/repo/map';
import { FindingCard, EmptyState, VerificationTag } from '@/components/ui';
import MapBoard, { type BoardVerifiedPin } from './MapBoard';
import ImportMap from './ImportMap';
import styles from './map.module.css';

export const metadata = { title: 'Map Room' };

const LAYERS = [
  { key: 'cash', label: 'Cash / Stashes', test: (f: FindingRow) => f.category === 'cash_pickup' || f.category === 'money_activity' },
  { key: 'weapons', label: 'Weapons', test: (f: FindingRow) => f.category === 'weapon' },
  { key: 'vehicles', label: 'Rare vehicles', test: (f: FindingRow) => f.category === 'vehicle' },
  { key: 'secrets', label: 'Secrets', test: (f: FindingRow) => f.category === 'secret' },
  { key: 'missions', label: 'Missions', test: (f: FindingRow) => f.category === 'mission_tip' },
  { key: 'collectibles', label: 'Collectibles', test: (f: FindingRow) => f.category === 'collectible' },
  { key: 'events', label: 'Free events', test: (f: FindingRow) => f.category === 'reward' || f.is_free === true },
] as const;
type LayerKey = (typeof LAYERS)[number]['key'];
const LAYER_ALIAS: Record<string, LayerKey> = { rewards: 'events', reward: 'events', vehicle: 'vehicles', weapon: 'weapons', secret: 'secrets', mission: 'missions' };

type SP = { pin?: string; finding?: string; layer?: string; asset?: string; v?: string; found?: string; bm?: string };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function MapRoom({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp: SP = { pin: one(raw.pin), finding: one(raw.finding), layer: one(raw.layer), asset: one(raw.asset), v: one(raw.v), found: one(raw.found), bm: one(raw.bm) };
  const user = await requireUser('/map');
  const profile = await currentProfile(user.id);

  const layerRaw = (sp.layer ?? '').toLowerCase();
  const layer: LayerKey | null = LAYERS.some((l) => l.key === layerRaw) ? (layerRaw as LayerKey) : (LAYER_ALIAS[layerRaw] ?? null);
  const on = { v: sp.v === '1', found: sp.found === '1', bm: sp.bm === '1' };

  const [platform, userMaps, allFindings] = await Promise.all([getPlatformMap(user.id), listUserMaps(user.id), listFindings(user.id, { limit: 200 })]);
  const chosenUser = sp.asset && isUuid(sp.asset) ? userMaps.find((m) => m.id === sp.asset) : undefined;
  const activeUser = chosenUser ?? (platform ? null : userMaps[0] ?? null);
  const mode: 'planning' | 'platform' | 'user' = activeUser ? 'user' : platform ? 'platform' : 'planning';
  const board = mode === 'user' ? activeUser! : mode === 'platform' ? platform! : null;

  // Filters apply to the verified-pin layer and the landmark list.
  const filtered = allFindings.filter((f) =>
    (!layer || LAYERS.find((l) => l.key === layer)!.test(f)) &&
    (!on.v || f.verification === 'verified' || f.verification === 'corroborated') &&
    (!on.found || f.hunt_status === 'found') && (!on.bm || f.hunt_status === 'saved'));
  const withLandmark = filtered.filter((f) => !!f.landmark);

  // Deep link.
  const findingId = sp.finding && isUuid(sp.finding) ? sp.finding : allFindings.find((f) => sp.pin && f.pin_id === sp.pin)?.id ?? null;
  const detail = findingId ? await getFinding(user.id, findingId) : null;
  const platformPin = detail && platform ? detail.pins.find((p) => p.map_asset_id === platform.id && p.calibrated) : undefined;
  const pinMatches = !sp.pin || (platformPin && platformPin.id === sp.pin);
  const focusPinId = platformPin && pinMatches ? (platformPin.id as string) : null;

  // Verified pins: only on a calibrated platform map; coordinates come straight from map_pins.
  let verified: BoardVerifiedPin[] = [];
  if (mode === 'platform' && platform) {
    const pool = new Map(filtered.filter((f) => f.place_id && f.pin_id).map((f) => [f.place_id as string, f]));
    if (detail?.finding.place_id && focusPinId) pool.set(detail.finding.place_id, { ...detail.finding });
    const pins = await listVerifiedPins(user.id, [...pool.keys()]);
    verified = pins.flatMap((p) => {
      const f = pool.get(p.place_id);
      return f && p.map_asset_id === platform.id ? [{ id: p.id, findingId: f.id, title: f.title, x: p.x, y: p.y, precision: p.precision, focus: p.id === focusPinId }] : [];
    });
  }

  const [pins, allowance] = await Promise.all([
    mode === 'user' && board ? listPrivatePins(user.id, board.id) : Promise.resolve([]),
    pinAllowance(user.id),
  ]);

  const href = (over: Partial<Record<keyof SP, string | null>>) => {
    const next: Record<string, string | undefined> = { layer: sp.layer, asset: sp.asset, v: sp.v, found: sp.found, bm: sp.bm, finding: sp.finding, pin: sp.pin, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, v ?? undefined])) };
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) u.set(k, v);
    const s = u.toString();
    return `/map${s ? `?${s}` : ''}`;
  };

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Map Room</p>
        <h1 className="page-title">Map Room</h1>
        <p className="lede">Plan routes and keep private notes. Pins on the official map appear only when a finding has a verified, evidence-backed location. Chapter {profile.chapter} shield is on.</p>
      </div>

      {detail ? (
        <section className={`card ${styles.focusCard}`} aria-label="Linked finding">
          <p className="eyebrow">{focusPinId ? 'Verified pin highlighted' : 'No precise pin for this finding'}</p>
          <div className="tags" style={{ margin: '6px 0' }}><VerificationTag v={detail.finding.verification} /></div>
          <h2 style={{ margin: '0 0 6px' }}>{detail.finding.title}</h2>
          <p className="small">📍 {detail.finding.landmark ?? 'Landmark not verified — text guidance only'}</p>
          {!focusPinId ? <p className="subtitle" style={{ marginTop: 8 }}>No verified map pin exists for this finding{platform ? '' : ', and no calibrated platform map is configured'}. HQ will not guess coordinates. Use the written guidance and your own copy of the map.</p> : null}
          <div className="row" style={{ marginTop: 10 }}><Link className="btn gold" style={{ minHeight: 44 }} href={`/intel/${detail.finding.id}?focus=visual`}>Open finding &amp; visual guidance</Link></div>
        </section>
      ) : null}

      <section className="card">
        <div className="section-head"><div><h2>Board</h2>
          <p className="subtitle">{mode === 'planning' ? 'No map is loaded. This is a planning surface only.' : mode === 'user' ? 'Your own imported map. Private to your account and not calibrated, so verified pins are never drawn on it.' : 'Calibrated platform map with verified pins only.'}</p></div></div>
        <MapBoard
          key={`${mode}:${board?.id ?? 'none'}:${focusPinId ?? ''}`}
          mode={mode} imageUrl={board ? `/api/uploads/${board.id}` : null} assetId={mode === 'user' ? board!.id : null}
          naturalAspect={board?.width && board?.height ? board.width / board.height : null}
          privatePins={pins.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y }))}
          verifiedPins={verified} used={allowance.used} cap={allowance.cap}
        />
        {mode === 'platform' && !verified.length ? <p className="small muted" style={{ marginTop: 8 }}>No verified pins match the current filters.</p> : null}
        {mode === 'platform' && verified.length ? (
          <ul className="small" style={{ marginTop: 10 }} aria-label="Verified pins (text list)">
            {verified.map((p) => <li key={p.id}><Link href={`/intel/${p.findingId}?focus=visual`}>{p.title}</Link> — {p.precision} location, verified</li>)}
          </ul>
        ) : null}
      </section>

      {mode !== 'platform' ? (
        <section className="card">
          <h2>Map asset required</h2>
          <p className="subtitle" style={{ margin: '6px 0 10px' }}>
            {platform ? '' : 'HQ has no licensed map configured, so it cannot show verified pins. '}
            Rockstar&apos;s official Leonida map may be downloaded for personal use. HQ does not redistribute or embed it. Import your own copy and it stays private to your account: only you can open it, and the pins you add are labelled as personal notes, not fact-checked.
          </p>
          <ImportMap maps={userMaps.map((m) => ({ id: m.id, mime: m.mime, created_at: m.created_at, active: board?.id === m.id }))} />
        </section>
      ) : (
        <section className="card">
          <h2>Your own map</h2>
          <p className="subtitle" style={{ margin: '6px 0 10px' }}>Want private pins? Import your own copy; it stays private to your account.</p>
          <ImportMap maps={userMaps.map((m) => ({ id: m.id, mime: m.mime, created_at: m.created_at, active: false }))} />
        </section>
      )}

      <section className="card">
        <div className="section-head"><div><h2>Layers &amp; filters</h2></div></div>
        <div className="chips" role="toolbar" aria-label="Map layers">
          <Link className={`chip${!layer ? ' on' : ''}`} href={href({ layer: null })} aria-pressed={!layer}>All</Link>
          {LAYERS.map((l) => <Link key={l.key} className={`chip${layer === l.key ? ' on' : ''}`} href={href({ layer: layer === l.key ? null : l.key })} aria-pressed={layer === l.key}>{l.label}</Link>)}
        </div>
        <div className="chips" role="toolbar" aria-label="Map toggles" style={{ marginTop: 8 }}>
          <Link className={`chip${on.v ? ' on' : ''}`} href={href({ v: on.v ? null : '1' })} aria-pressed={on.v}>Verified only</Link>
          <Link className={`chip${on.found ? ' on' : ''}`} href={href({ found: on.found ? null : '1' })} aria-pressed={on.found}>Found</Link>
          <Link className={`chip${on.bm ? ' on' : ''}`} href={href({ bm: on.bm ? null : '1' })} aria-pressed={on.bm}>Bookmarked</Link>
        </div>
      </section>

      <section className="card">
        <div className="section-head"><div><h2>Findings with landmarks</h2><p className="subtitle">Text locations from sources, visible at your chapter. A landmark is guidance, not a map coordinate.</p></div></div>
        <div className="flist">
          {withLandmark.length ? withLandmark.map((f) => <FindingCard key={f.id} f={f} />) : (
            <EmptyState title="No findings with a verified landmark">{allFindings.length ? 'Nothing visible at your chapter matches these filters and names a landmark.' : 'Nothing has been published yet at your chapter.'} HQ will not invent locations.</EmptyState>
          )}
        </div>
      </section>
    </div>
  );
}

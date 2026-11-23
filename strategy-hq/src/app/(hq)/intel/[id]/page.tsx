import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { getFinding } from '@/lib/repo/intel';
import { config } from '@/lib/config';
import { SCOUTS, CATEGORY_LABELS, type FindingCategory } from '@/lib/domain/scouts';
import { displayLevel, mediaPublishable } from '@/lib/domain/rights';
import { formatPayout, formatCash, cashPerHour } from '@/lib/domain/money';
import { huntAction, correctionAction } from '@/lib/actions/hunt';
import { VerificationTag, Unknown, fmtDate } from '@/components/ui';

export default async function FindingDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { id } = await params;
  const { focus } = await searchParams;
  const user = await requireUser();
  const p = await currentProfile(user.id);
  const d = await getFinding(user.id, id);
  if (!d) notFound();   // also covers items above the user's chapter: indistinguishable from "does not exist"
  const f = d.finding;
  const scoutDefs = SCOUTS.filter((s) => f.scouts.includes(s.id));
  const attrs = f.attributes ?? {};
  const known = (v: unknown) => v !== undefined && v !== null && v !== '';
  const pin = d.pins.find((x) => x.calibrated);
  const publishableMedia = d.media.filter((m) => mediaPublishable({ kind: m.kind, license: m.license_type ? { rights_status: m.license_type === 'user_owned' ? 'owned' : m.license_type === 'licensed' || m.license_type === 'permission_granted' ? 'licensed' : 'unreviewed', allowed_uses: m.allowed_uses ?? [], expires_at: m.expires_at } : null }, config.appMode));
  const rate = d.money ? cashPerHour({ id: f.id, money_kind: d.money.money_kind, payout_min: f.payout_min, payout_max: f.payout_max, time_minutes_min: d.money.time_minutes_min, time_minutes_max: d.money.time_minutes_max, verification: f.verification, risk: f.risk as 'low', patched: d.money.patched }) : 'UNKNOWN';

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">{scoutDefs.map((s) => `${s.icon} ${s.name}`).join(' · ') || 'Intel'}</p>
        <h1 className="page-title" style={{ fontSize: 'clamp(30px,8vw,46px)' }}>{f.title}</h1>
        <div className="tags">
          <VerificationTag v={f.verification} />
          <span className="tag">{CATEGORY_LABELS[f.category as FindingCategory] ?? f.category}</span>
          <span className="tag">{f.game_scope === 'GTA_VI' ? 'GTA VI' : 'GTA ONLINE'}</span>
          <span className="tag">{f.lifecycle.toUpperCase()}</span>
          {f.hunt_status ? <span className={`tag ${f.hunt_status}`}>{f.hunt_status.toUpperCase()}</span> : null}
        </div>
      </div>

      <section className="card" aria-label="Hunt actions">
        <div className="row">
          {(['saved', 'found', 'skipped'] as const).map((s) => (
            <form key={s} action={huntAction}>
              <input type="hidden" name="finding_id" value={f.id} />
              <input type="hidden" name="status" value={f.hunt_status === s ? '' : s} />
              <button className={`btn sm ${s === 'found' ? 'primary' : s === 'saved' ? 'cyan' : ''}`} aria-pressed={f.hunt_status === s}>
                {f.hunt_status === s ? `✓ ${s === 'saved' ? 'On hunt list' : s === 'found' ? 'Found' : 'Skipped'}` : s === 'saved' ? 'Save to hunt list' : s === 'found' ? 'Mark found' : 'Skip'}
              </button>
            </form>
          ))}
          <Link className="btn sm gold" href={pin ? `/map?pin=${pin.id}&finding=${f.id}` : `/map?finding=${f.id}`}>View map</Link>
        </div>
      </section>

      <div className="grid2">
        <div className="stack">
          <section className="card"><h2>What it is</h2><p className="lede" style={{ marginTop: 8, marginBottom: 0 }}>{f.summary}</p></section>
          <section className="card"><h2>Why it matters</h2><p className="lede" style={{ marginTop: 8, marginBottom: 0 }}>{f.why_it_matters ?? <Unknown>NOT YET WRITTEN</Unknown>}</p></section>
          <section className="card">
            <h2>How to get it</h2>
            {f.how_to.length ? <ol className="steps" style={{ marginTop: 10 }}>{f.how_to.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p className="subtitle"><Unknown>NO VERIFIED STEPS YET</Unknown> — HQ will not guess directions.</p>}
            {f.prerequisites ? <p className="subtitle"><b>Prerequisites:</b> {f.prerequisites}</p> : null}
          </section>
          <section className="card" id="visual" style={focus === 'visual' ? { borderColor: 'var(--gold)' } : undefined}>
            <h2>Where to look</h2>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Verified landmark</dt><dd>{f.landmark ?? <Unknown>NOT VERIFIED</Unknown>}</dd>
              <dt>Region</dt><dd>{f.region ?? <Unknown />}</dd>
              <dt>Map pin</dt><dd>{pin ? `${pin.precision} pin on a calibrated map` : <Unknown>NO VERIFIED PIN — text guidance only</Unknown>}</dd>
            </dl>
            <hr className="sep" />
            {publishableMedia.length ? publishableMedia.map((m) => (
              <figure key={m.id} style={{ margin: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.external_url ?? `/api/media/${m.id}`} alt={p.spoiler_shield ? m.alt_text : m.alt_text} style={{ width: '100%', borderRadius: 12 }} />
                <figcaption className="small muted">{m.kind === 'real_gameplay' ? 'Real gameplay screenshot' : 'User-owned image'} · {m.attribution ?? 'licensed'}</figcaption>
              </figure>
            )) : <p className="subtitle">Image not yet available. No rights-cleared screenshot exists for this find, and HQ never generates fake “in-game proof”.</p>}
            <Link className="btn sm" href="/assist#screenshot" style={{ marginTop: 10 }}>Am I in the right place? (private screenshot)</Link>
          </section>
        </div>
        <div className="stack">
          <section className="card">
            <h2>Facts</h2>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Chapter</dt><dd>{f.chapter_min ? `Chapter ${f.chapter_min}+` : f.spoiler_level === 'none' ? 'Any (no story content)' : <Unknown />}</dd>
              <dt>Risk</dt><dd>{f.risk === 'unknown' ? <Unknown /> : f.risk}</dd>
              <dt>Hazards</dt><dd>{f.hazards ?? <Unknown />}</dd>
              <dt>Payout</dt><dd>{f.payout_min != null || f.payout_max != null ? formatPayout(f.payout_min, f.payout_max) : <Unknown />}</dd>
              <dt>Price</dt><dd>{f.price != null ? formatCash(f.price) : <Unknown />}</dd>
              <dt>Free?</dt><dd>{f.is_free === null ? <Unknown /> : f.is_free ? 'Yes' : 'No'}</dd>
              <dt>Availability</dt><dd>{f.availability ?? <Unknown />}</dd>
              <dt>Patch</dt><dd>{f.patch_version ?? <Unknown />}</dd>
              {d.money ? <><dt>Money type</dt><dd>{d.money.money_kind.replace(/_/g, ' ')}</dd>
                <dt>Cash / hour</dt><dd>{rate === 'UNKNOWN' ? <Unknown /> : `${formatCash(rate.low)}–${formatCash(rate.high)}`}</dd>
                <dt>Wanted risk</dt><dd>{d.money.wanted_level_risk}</dd><dt>Carries across chapters</dt><dd>{d.money.transfers_across_chapters}</dd></> : null}
              {scoutDefs.flatMap((s) => s.recordFields).map((r) => (
                <FragmentKV key={r.key} label={r.label} value={known(attrs[r.key]) ? String(attrs[r.key]) : null} />
              ))}
            </dl>
          </section>
          <section className="card">
            <h2>Evidence + last checked</h2>
            <p className="subtitle">First seen {fmtDate(f.first_seen_at, p.timezone)} · Last confirmed {fmtDate(f.last_confirmed_at, p.timezone)} · Last checked {fmtDate(f.last_checked_at, p.timezone)}</p>
            {attrs.seed_note ? <p className="notice gold" style={{ marginTop: 10 }}>{String(attrs.seed_note)}</p> : null}
            <div className="evidence" style={{ marginTop: 10 }}>
              {d.evidence.map((e) => {
                const level = displayLevel(e.rights_status ? { rights_status: e.rights_status, allowed_uses: e.allowed_uses ?? [], expires_at: e.rights_expires } : null, config.appMode);
                if (level === 'hidden') return null;
                return (
                  <div key={e.id} className="fcard">
                    <div className="tags"><span className="tag">{e.evidence_type}</span>{e.contradicts ? <span className="tag v-debunked">CONTRADICTS</span> : null}<span className="tag">{e.independent_origin}</span></div>
                    {level !== 'link_only' ? <p style={{ marginTop: 6 }}>{e.paraphrase}</p> : null}
                    <a href={e.url} target="_blank" rel="noopener noreferrer nofollow" className="small">{e.title} ↗</a>
                    <div className="small muted">Published {fmtDate(e.published_at, p.timezone)} · captured {fmtDate(e.captured_at, p.timezone)}</div>
                  </div>
                );
              })}
            </div>
          </section>
          <section className="card">
            <h2>Report a correction</h2>
            <form action={correctionAction} className="stack" style={{ marginTop: 10 }}>
              <input type="hidden" name="finding_id" value={f.id} />
              <label className="field">What is wrong?
                <select name="kind" className="input"><option value="wrong_location">Wrong location</option><option value="patched">Patched / no longer works</option><option value="wrong_chapter">Wrong chapter</option><option value="spoiler">Contains a spoiler</option><option value="rights">Rights / takedown concern</option><option value="other">Other</option></select>
              </label>
              <label className="field">Details<textarea name="details" className="input" required minLength={3} maxLength={2000} placeholder="What you saw in your game" /></label>
              <button className="btn">Send to review</button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function FragmentKV({ label, value }: { label: string; value: string | null }) {
  return <><dt>{label}</dt><dd>{value ?? <Unknown />}</dd></>;
}

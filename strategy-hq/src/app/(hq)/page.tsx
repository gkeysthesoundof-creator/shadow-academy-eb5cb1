import Link from 'next/link';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { listFindings, scoutStatus, lockedCounts, rewardsList } from '@/lib/repo/intel';
import { asUser } from '@/lib/db';
import { isRecommendable, type Verification } from '@/lib/domain/evidence';
import { radarBucket, gta6Rewards } from '@/lib/domain/rewards';
import { FindingCard, EmptyState, timeAgo, VerificationTag } from '@/components/ui';

export default async function Home() {
  const user = await requireUser();
  const p = await currentProfile(user.id);
  const [findings, status, locked, rewards, counts] = await Promise.all([
    listFindings(user.id, { scope: 'GTA_VI' }), scoutStatus(user.id), lockedCounts(user.id), rewardsList(user.id),
    asUser(user.id, (c) => c.query(`select
        (select count(*)::int from user_private_pins where user_id = app_uid()) pins,
        (select count(*)::int from user_hunts where user_id = app_uid() and status = 'found') found,
        (select count(*)::int from user_hunts where user_id = app_uid() and status = 'saved') saved,
        (select max(finished_at) from ingestion_jobs where status in ('succeeded','partial')) last_scan`).then((r) => r.rows[0])),
  ]);
  const top3 = findings.filter((f) => isRecommendable(f.verification as Verification) && f.hunt_status !== 'found' && !['update', 'reward'].includes(f.category)).slice(0, 3);
  const totalLocked = Object.values(locked).reduce((a, b) => a + b, 0);
  const anyScan = status.some((s) => s.last_run_at);
  const official = findings.filter((f) => f.category === 'update').slice(0, 2);
  const gta6 = gta6Rewards(rewards.map((r) => ({ ...r })));
  const tile = (slug: string, icon: string, t: string, s: string, color: string, prio = false) => (
    <Link href={`/scouts/${slug}`} className={`tile c-${color}${prio ? ' priority' : ''}`}>
      <span className="ico" aria-hidden="true">{icon}</span>
      <span><span className="t">{t}</span><br /><span className="s">{s}</span></span>
    </Link>
  );
  const vis = (id: string) => status.find((s) => s.scout_id === id)?.visible_count ?? 0;
  return (
    <div className="stack">
      <section className="hero" aria-labelledby="hero-h">
        <span className="hero-tag">LEONIDA // STRATEGY NETWORK</span>
        <div className="city" aria-hidden="true"><div className="sun" /><div className="skyline" /><div className="palm" /></div>
        <p className="eyebrow"><span className="dot" style={{ color: 'var(--cyan)' }} /> {anyScan ? 'Scouts reporting' : 'Scouts standing by'} · Private mode</p>
        <h1 id="hero-h">Own the<span>game.</span></h1>
        <p>Chapter {p.chapter} intel for {p.platform}. Verified finds, honest gaps, and one place to plan your next big score.</p>
        <Link className="btn primary" href="/scouts">Open Scout Center →</Link>
      </section>

      <section className="card" aria-labelledby="next-h">
        <div className="section-head">
          <div><h2 id="next-h">Your next move</h2><p className="subtitle">Tap a scout. Everything respects your Chapter {p.chapter} spoiler shield.</p></div>
          <span className="pill pink">{p.platform}</span>
        </div>
        <div className="tiles">
          {tile('vehicles', '🚗', 'Vehicles', `${vis('vehicle_scout')} chapter-safe finds`, 'coral', true)}
          {tile('weapons', '🔫', 'Special weapons', `${vis('weapons_scout')} chapter-safe finds`, 'cyan', true)}
          {tile('cash', '💰', 'Hidden cash', `${vis('money_scout')} chapter-safe finds`, 'gold', true)}
          {tile('secrets', '💎', 'Secrets', `${vis('secrets_scout')} chapter-safe finds`, 'purple')}
          <Link href="/assist" className="tile c-pink"><span className="ico" aria-hidden="true">🎮</span><span><span className="t">I&apos;m stuck</span><br /><span className="s">Mission coach</span></span></Link>
          {tile('rewards', '🎁', 'Free rewards', 'GTA VI only', 'gold')}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn sm" href="/scouts/cash?f=verified">Make money</Link>
          <Link className="btn sm" href="/scouts/weapons">Find weapons</Link>
          <Link className="btn sm" href="/scouts/cash">Hidden stashes</Link>
          <Link className="btn sm cyan" href="/map">Locate on map</Link>
        </div>
      </section>

      <div className="grid2">
        <section className="card" aria-labelledby="top3-h">
          <div className="section-head">
            <div><h2 id="top3-h">Top 3 for Chapter {p.chapter}</h2><p className="subtitle">Only verified or corroborated finds you have not marked found.</p></div>
            <span className={`pill ${anyScan ? 'cyan' : 'gold'}`}>{anyScan ? `Scan ${timeAgo(counts.last_scan)}` : 'No scans yet'}</span>
          </div>
          {top3.length ? <div className="flist">{top3.map((f) => <FindingCard key={f.id} f={f} />)}</div> : (
            <EmptyState title={`No verified Chapter ${p.chapter} actions yet`}>
              HQ will not invent stash coordinates, spawns, screenshots or payouts to fill this space. Verified finds appear here
              once sources are connected and evidence is reviewed. {totalLocked ? `${totalLocked} later-chapter item${totalLocked > 1 ? 's are' : ' is'} locked behind your spoiler shield.` : ''}
            </EmptyState>
          )}
        </section>
        <div className="stack">
          <section className="stats" aria-label="Your progress">
            <div className="stat"><div className="k">Chapter</div><div className="v">{String(p.chapter).padStart(2, '0')}</div><div className="n">Spoiler shield {p.spoiler_shield ? 'on' : 'off'}</div></div>
            <div className="stat"><div className="k">Found</div><div className="v">{String(counts.found).padStart(2, '0')}</div><div className="n">{counts.saved} on hunt list</div></div>
            <div className="stat"><div className="k">Private pins</div><div className="v">{String(counts.pins).padStart(2, '0')}</div><div className="n">Only you can see them</div></div>
            <div className="stat"><div className="k">Locked</div><div className="v">{String(totalLocked).padStart(2, '0')}</div><div className="n">Later-chapter items</div></div>
          </section>
          <section className="card" aria-labelledby="rw-h">
            <div className="section-head"><h2 id="rw-h">Free rewards radar</h2><Link className="pill gold" href="/scouts/rewards">Open</Link></div>
            {gta6.length ? gta6.slice(0, 2).map((r) => (
              <div key={r.id} className="fcard" style={{ marginBottom: 8 }}>
                <div className="tags"><VerificationTag v={r.verification} /><span className="tag">{radarBucket(r).replace('_', ' ')}</span></div>
                <div className="title">{r.title}</div>
              </div>
            )) : <EmptyState title="No GTA VI rewards tracked">GTA Online offers are never shown here.</EmptyState>}
          </section>
        </div>
      </div>

      <section className="card" aria-labelledby="off-h">
        <div className="section-head"><div><h2 id="off-h">Official signals</h2><p className="subtitle">Link-outs to Rockstar. Paraphrased, never copied.</p></div><span className="pill cyan">Official links</span></div>
        <div className="flist">{official.map((f) => <FindingCard key={f.id} f={f} />)}</div>
      </section>
    </div>
  );
}

import Link from 'next/link';
import { VERIFICATION_LABEL } from '@/lib/domain/evidence';

export const metadata = { title: 'Terms & Sources · Strategy HQ' };

const TIERS: [string, string][] = [
  ['verified', 'An official source that HQ itself observed, or the founder saw it in game plus at least one independent report.'],
  ['corroborated', 'Two or more independent origins agree and none contradict. Not officially confirmed.'],
  ['single_report', 'Exactly one supporting origin. Treat it as a lead, not a fact.'],
  ['unverified', 'Nothing usable yet. HQ will not recommend it as an action.'],
  ['debunked', 'A moderator debunked it, or contradicting evidence outweighs the support.'],
  ['expired', 'Past its deadline or patched out.'],
];

export default function Legal() {
  return (
    <div className="stack">
      <div>
        <p className="eyebrow">Terms &amp; sources</p>
        <h1 className="page-title">Legal &amp; sources</h1>
        <p className="lede">How this guide works, what it is not, and how it treats your data.</p>
      </div>

      <section className="card stack" aria-labelledby="disc">
        <h2 id="disc">Independent, unofficial guide</h2>
        <p>GTA VI Strategy HQ is an independent, unofficial fan guide. It is not affiliated with, licensed by or endorsed by Rockstar Games, Take-Two Interactive or Reddit. All trademarks belong to their owners. HQ does not embed official logos, artwork, screenshots or maps.</p>
      </section>

      <section className="card stack" aria-labelledby="src">
        <h2 id="src">Sources policy</h2>
        <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
          <li>Content is paraphrased and linked out to the original source. Only short excerpts are quoted.</li>
          <li>Each website&apos;s robots.txt is respected.</li>
          <li>Reddit content is read only through the approved Reddit Data API, never by scraping.</li>
          <li>Commercial use of any source requires the appropriate agreements first.</li>
        </ul>
        <div className="row">
          <a className="btn sm cyan" href="https://redditinc.com/policies/data-api-terms" target="_blank" rel="noopener noreferrer">Reddit Data API Terms ↗</a>
          <a className="btn sm cyan" href="https://www.rockstargames.com/legal" target="_blank" rel="noopener noreferrer">Rockstar Games legal ↗</a>
        </div>
      </section>

      <section className="card stack" aria-labelledby="tiers">
        <h2 id="tiers">Evidence tiers</h2>
        <div className="kv">
          {TIERS.map(([k, d]) => (
            <div key={k} style={{ padding: '6px 0' }}><span className={`tag v-${k}`}>{(VERIFICATION_LABEL as Record<string, string>)[k] ?? k}</span> <span className="small">{d}</span></div>
          ))}
        </div>
      </section>

      <section className="card stack" aria-labelledby="spoil">
        <h2 id="spoil">Spoiler shield</h2>
        <p>Your chapter setting decides what you can see. Content for later chapters is hidden by the database itself, so it does not appear in lists, search, the map, the assistant or emails. Raising your chapter requires an explicit confirmation in <Link href="/settings">Settings</Link>.</p>
      </section>

      <section className="card stack" aria-labelledby="priv">
        <h2 id="priv">Privacy</h2>
        <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.7 }}>
          <li>Your uploads (such as screenshots) are private to your account.</li>
          <li>There is no advertising tracking.</li>
          <li>You can <a href="/api/export" download>export your data</a> and <Link href="/settings">delete your account</Link> at any time.</li>
          <li>HQ never reads your game, your save or your in-game balance. Earnings are numbers you type yourself.</li>
        </ul>
      </section>

      <div className="notice gold"><strong>Commercial release requires legal review.</strong> This page describes current private-alpha behaviour and is not legal advice or a finished terms of service.</div>
    </div>
  );
}

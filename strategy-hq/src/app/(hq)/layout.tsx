import Link from 'next/link';
import { requireUser, currentProfile } from '@/lib/auth/session';
import { config } from '@/lib/config';
import { NavBar } from '@/components/NavBar';
import { SwRegister } from '@/components/SwRegister';

export default async function HqLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const p = await currentProfile(user.id);
  const modeLabel = config.appMode === 'founder_private' ? 'Private alpha' : config.appMode === 'closed_beta' ? 'Closed beta' : 'Live';
  return (
    <div data-theme={p.theme} data-motion={p.reduced_motion ? 'reduced' : 'full'} className="theme-root">
      <style>{`body{background-color:var(--bg)}`}</style>
      <a className="skip" href="#main">Skip to content</a>
      <div className="shell">
        <header className="head">
          <Link href="/" className="brand" aria-label="Strategy HQ home">
            <span className="mark" aria-hidden="true">VI</span>
            <span>
              <span className="brand-title">STRATEGY HQ <i>•</i></span><br />
              <span className="brand-sub">PRIVATE GAMING COMMAND CENTER</span>
            </span>
          </Link>
          <div className="head-right">
            <Link href="/settings" className="pill pink" aria-label={`Chapter ${p.chapter}, ${p.platform}. Change in settings`}>CH {String(p.chapter).padStart(2, '0')} · {p.platform}</Link>
            <span className="pill muted">{modeLabel}</span>
          </div>
        </header>
        <main id="main">{children}</main>
        <p className="footer">
          INDEPENDENT, UNOFFICIAL GAME GUIDE · NOT AFFILIATED WITH, LICENSED OR ENDORSED BY ROCKSTAR GAMES, TAKE-TWO OR REDDIT ·{' '}
          <Link href="/legal">TERMS &amp; SOURCES</Link>
          {user.is_admin ? <> · <Link href="/admin">ADMIN</Link></> : null}
        </p>
      </div>
      <NavBar />
      <SwRegister />
    </div>
  );
}

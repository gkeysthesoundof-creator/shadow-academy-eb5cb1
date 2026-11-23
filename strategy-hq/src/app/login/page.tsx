import { redirect } from 'next/navigation';
import { currentUser, safeNext } from '@/lib/auth/session';
import { LoginForm } from './LoginForm';
import { ClearPrivateCache } from './ClearPrivateCache';

export const metadata = { title: 'Sign in · Strategy HQ' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await currentUser()) redirect(safeNext(next));
  return (
    <div className="shell" style={{ maxWidth: 460, paddingTop: 48 }}>
      <div className="brand" style={{ marginBottom: 22 }}>
        <span className="mark" aria-hidden="true">VI</span>
        <span><span className="brand-title">STRATEGY HQ <i>•</i></span><br /><span className="brand-sub">PRIVATE GAMING COMMAND CENTER</span></span>
      </div>
      <div className="card">
        <p className="eyebrow">Invite-only · Private alpha</p>
        <h1 className="page-title" style={{ fontSize: 40 }}>Sign in</h1>
        <p className="lede">Accounts are created by the owner. Public registration is switched off.</p>
        <LoginForm next={safeNext(next)} />
        <ClearPrivateCache />
      </div>
      <p className="footer">Independent, unofficial game guide. Not affiliated with Rockstar Games, Take-Two or Reddit.</p>
    </div>
  );
}

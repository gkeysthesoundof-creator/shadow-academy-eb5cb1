'use client';
import { useActionState } from 'react';
import { loginAction, type LoginState } from '@/lib/actions/auth';

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <label className="field">Email<input className="input" type="email" name="email" autoComplete="username" required /></label>
      <label className="field">Password<input className="input" type="password" name="password" autoComplete="current-password" required minLength={12} /></label>
      {state.error ? <p role="alert" className="notice pink">{state.error}</p> : null}
      <button className="btn primary block" disabled={pending}>{pending ? 'Signing in…' : 'Enter HQ →'}</button>
    </form>
  );
}

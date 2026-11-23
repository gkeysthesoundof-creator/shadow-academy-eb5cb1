'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, createSession, rateLimit, rateLimited, revokeSession } from '../auth/core';
import { SESSION_COOKIE, cookieOptions, safeNext } from '../auth/session';

export interface LoginState { error?: string }

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 200);
  const password = String(form.get('password') ?? '').slice(0, 200);
  const next = safeNext(String(form.get('next') ?? '/'));
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  // Lockout after 8 FAILED attempts / 15 min per IP or per email. Successful sign-ins never count.
  const ipKey = `login-fail:ip:${ip}`; const emailKey = `login-fail:email:${email}`;
  if ((await rateLimited(ipKey, 8, 900)) || (await rateLimited(emailKey, 8, 900))) {
    return { error: 'Too many failed attempts. Wait 15 minutes and try again.' };
  }
  if (!email || !password) return { error: 'Enter your email and password.' };
  const user = await authenticate(email, password);
  if (!user) {
    await rateLimit(ipKey, 8, 900);
    await rateLimit(emailKey, 8, 900);
    return { error: 'Those details did not match an active account.' };
  }
  const s = await createSession(user.id);
  (await cookies()).set(SESSION_COOKIE, s.token, cookieOptions(s.expires));
  redirect(next);
}

export async function logoutAction() {
  const jar = await cookies();
  await revokeSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

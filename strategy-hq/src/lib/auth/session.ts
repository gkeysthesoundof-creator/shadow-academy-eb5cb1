import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { userForToken, type SessionUser } from './core';
import { asUser } from '../db';
import { config } from '../config';

export const SESSION_COOKIE = 'gsq_session';

export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return userForToken(jar.get(SESSION_COOKIE)?.value);
});

/** Guard for every private page. Preserves the deep link so email links survive login. */
export async function requireUser(nextPath?: string): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) {
    const h = await headers();
    const next = nextPath ?? h.get('x-gsq-path') ?? '/';
    redirect(`/login?next=${encodeURIComponent(safeNext(next))}`);
  }
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!u.is_admin) redirect('/?denied=admin');
  return u;
}

/** Only same-site relative paths are allowed as post-login redirects (no open redirect). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  return next.slice(0, 500);
}

export interface Profile {
  chapter: number; platform: string; spoiler_shield: boolean; timezone: string; saved_region: string | null;
  theme: string; reduced_motion: boolean; primary_device: string; plan: string;
}

export const currentProfile = cache(async (userId: string): Promise<Profile> => {
  return asUser(userId, async (c) => {
    const r = await c.query(`
      select p.chapter, p.platform, p.spoiler_shield, p.timezone, p.saved_region,
        coalesce(d.theme,'neon') theme, coalesce(d.reduced_motion,false) reduced_motion, coalesce(d.primary_device,'iPhone') primary_device,
        coalesce((select plan_id from subscriptions s where s.user_id = app_uid() and s.status in ('grandfathered','active','trialing','past_due') limit 1),'free') plan
      from user_game_profiles p left join player_device_preferences d on d.user_id = p.user_id
      where p.user_id = app_uid() and p.game_id = 'gta6'`);
    return r.rows[0] ?? { chapter: 1, platform: 'PS5', spoiler_shield: true, timezone: config.timezone, saved_region: null, theme: 'neon', reduced_motion: false, primary_device: 'iPhone', plan: 'free' };
  });
});

export function cookieOptions(expires: Date) {
  return { httpOnly: true, secure: config.isProduction, sameSite: 'lax' as const, path: '/', expires };
}

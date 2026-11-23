'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireUser, SESSION_COOKIE } from '../auth/session';
import { revokeSession } from '../auth/core';
import { asService } from '../db';
import { config } from '../config';
import { getSettings, saveProfile, saveDevice, saveAlerts, setConsent, PLATFORMS, THEMES, EMAIL_SECTIONS } from '../repo/progress';

export interface FormState { ok?: boolean; error?: string; message?: string }
const saved = (message = 'Saved.'): FormState => { revalidatePath('/', 'layout'); return { ok: true, message }; };

function validTimezone(tz: string) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz.length <= 64; } catch { return false; }
}

export async function saveProfileAction(_p: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const s = await getSettings(user.id);
  const platform = String(form.get('platform') ?? '');
  const chapter = Number(form.get('chapter'));
  const tz = String(form.get('timezone') ?? '').trim() || 'America/New_York';
  const region = String(form.get('saved_region') ?? '').trim().slice(0, 80);
  if (!(PLATFORMS as readonly string[]).includes(platform)) return { error: 'Choose a platform.' };
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > s.maxChapter) return { error: `Chapter must be between 1 and ${s.maxChapter}.` };
  if (!validTimezone(tz)) return { error: 'Unknown timezone. Use an IANA name like America/New_York.' };
  if (chapter > s.profile.chapter && form.get('confirm_chapter') !== 'on') {
    return { error: 'To raise your chapter, tick "I understand this reveals later-chapter content".' };
  }
  await saveProfile(user.id, { platform, chapter, spoiler_shield: form.get('spoiler_shield') === 'on', timezone: tz, saved_region: region || null });
  return saved('Profile saved.');
}

export async function saveDeviceAction(_p: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const theme = String(form.get('theme') ?? '');
  if (!(THEMES as readonly string[]).includes(theme)) return { error: 'Choose a theme.' };
  const primary = String(form.get('primary_device') ?? '').trim().slice(0, 60) || 'iPhone';
  const others = String(form.get('other_devices') ?? '').split(',').map((x) => x.trim().slice(0, 60)).filter(Boolean).slice(0, 10);
  await saveDevice(user.id, { theme, reduced_motion: form.get('reduced_motion') === 'on', primary_device: primary, other_devices: others });
  return saved('Display preferences saved.');
}

export async function saveAlertsAction(_p: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const time = String(form.get('send_local_time') ?? '08:30');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { error: 'Send time must look like 08:30.' };
  const sections = form.getAll('sections').map(String).filter((x) => (EMAIL_SECTIONS as readonly string[]).includes(x));
  await saveAlerts(user.id, { email_enabled: form.get('email_enabled') === 'on', send_local_time: time, sections });
  return saved('Morning email preferences saved. This does not turn delivery on by itself.');
}

export async function setScreenshotConsentAction(_p: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  await setConsent(user.id, 'screenshot_analysis', form.get('screenshot_analysis') === 'on');
  return saved('Privacy choice saved.');
}

/** Permanent. Verifies the session user, deletes the users row (cascades), removes uploads, clears the cookie. */
export async function deleteAccountAction(_p: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (String(form.get('confirm') ?? '').trim() !== 'DELETE') return { error: 'Type DELETE (capital letters) to confirm.' };
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await revokeSession(token);
  await asService((c) => c.query('delete from users where id = $1', [user.id]));
  await fs.rm(path.resolve(config.uploadDir, user.id), { recursive: true, force: true }).catch(() => {});
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

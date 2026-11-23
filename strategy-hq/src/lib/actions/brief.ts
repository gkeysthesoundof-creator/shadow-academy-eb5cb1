'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../auth/session';
import { asUser } from '../db';
import { config } from '../config';
import { localParts } from '../domain/schedule';
import { runBriefStage } from '../workers/briefing';

/**
 * Build today's brief for the signed-in user only. There is one brief per user per
 * local day (unique key): if today's already exists it is shown, never rebuilt.
 * Delivery still goes through the normal gates, so with email off this is a dry run.
 */
export async function buildTodayBriefAction() {
  const user = await requireUser('/brief');
  const date = localParts(new Date(), config.timezone).date;
  const existing = await asUser(user.id, (c) => c.query(
    `select 1 from digest_runs where user_id = app_uid() and game_id = 'gta6' and local_date = $1`, [date]));
  if (!existing.rowCount) await runBriefStage(date, { onlyUserId: user.id, forceDryRun: true });
  revalidatePath('/brief');
  redirect(`/brief/${date}`);
}

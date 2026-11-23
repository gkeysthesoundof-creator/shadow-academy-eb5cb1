'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin, requireUser } from '../auth/session';
import { rateLimit } from '../auth/core';
import * as A from '../repo/admin';
import { runScoutPipeline } from '../workers/pipeline';
import type { PlanId } from '../domain/plans';

async function requireModerator() {
  const u = await requireUser();
  if (!u.is_moderator) redirect('/?denied=moderator');
  return u;
}
const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const n = (f: FormData, k: string) => { const v = s(f, k); return v === '' ? null : Number(v); };
const back = (path: string, msg: string, ok = true) => redirect(`${path}?${ok ? 'ok' : 'err'}=${encodeURIComponent(msg.slice(0, 200))}`);

const Intake = z.object({
  category: z.enum(['vehicle', 'weapon', 'cash_pickup', 'money_activity', 'secret', 'collectible', 'mission_tip', 'map_location', 'reward', 'update', 'community']),
  game_scope: z.enum(['GTA_VI', 'GTA_ONLINE']),
  title: z.string().min(3).max(200), summary: z.string().min(10).max(1200),
  risk: z.enum(['low', 'medium', 'high', 'unknown']), spoiler_level: z.enum(['none', 'mild', 'story']),
  evidence_type: z.enum(['official', 'guide', 'community', 'user_report', 'founder_observation']),
  evidence_url: z.string().url().startsWith('https://'), evidence_title: z.string().min(3).max(300), evidence_paraphrase: z.string().min(10).max(600),
});

export async function intakeAction(form: FormData) {
  const u = await requireModerator();
  const parsed = Intake.safeParse(Object.fromEntries(['category', 'game_scope', 'title', 'summary', 'risk', 'spoiler_level', 'evidence_type', 'evidence_url', 'evidence_title', 'evidence_paraphrase'].map((k) => [k, s(form, k)])));
  if (!parsed.success) back('/admin/review', `Fix the form: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`, false);
  const d = parsed.data!;
  const attributes: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith('attr_') && String(v).trim()) attributes[k.slice(5)] = String(v).trim().slice(0, 200);
  let id = '';
  try {
    id = await A.createDraft(u.id, {
      category: d.category, game_scope: d.game_scope, title: d.title, summary: d.summary, why_it_matters: s(form, 'why_it_matters'),
      how_to: s(form, 'how_to').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 15), prerequisites: s(form, 'prerequisites'), hazards: s(form, 'hazards'),
      risk: d.risk, chapter_min: n(form, 'chapter_min'), spoiler_level: d.spoiler_level, landmark: s(form, 'landmark'), region: s(form, 'region'),
      is_free: s(form, 'is_free') === 'yes' ? true : s(form, 'is_free') === 'no' ? false : null,
      payout_min: n(form, 'payout_min'), payout_max: n(form, 'payout_max'), price: n(form, 'price'), availability: s(form, 'availability'), attributes,
      evidence: [{ url: d.evidence_url, title: d.evidence_title, paraphrase: d.evidence_paraphrase, evidence_type: d.evidence_type, published_at: s(form, 'evidence_date') || null, author: s(form, 'evidence_author') || null }],
    });
  } catch (e) { back('/admin/review', (e as Error).message, false); }
  revalidatePath('/admin/review');
  back('/admin/review', `Draft created (${id}). Review, then publish.`);
}

export async function evidenceAction(form: FormData) {
  const u = await requireModerator();
  const id = s(form, 'finding_id');
  try {
    await A.addEvidence(u.id, id, { url: s(form, 'url'), title: s(form, 'title') || s(form, 'url'), paraphrase: s(form, 'paraphrase'),
      evidence_type: (s(form, 'evidence_type') || 'community') as 'community', contradicts: s(form, 'contradicts') === 'on', author: s(form, 'author') || null });
  } catch (e) { back('/admin/review', (e as Error).message, false); }
  back('/admin/review', 'Evidence added; tier recomputed.');
}

export async function publishAction(form: FormData) {
  const u = await requireModerator();
  try { await A.publish(u.id, s(form, 'finding_id')); } catch (e) { back('/admin/review', (e as Error).message, false); }
  revalidatePath('/', 'layout');
  back('/admin/review', 'Published.');
}

export async function editAction(form: FormData) {
  const u = await requireModerator();
  try {
    await A.updateDraftText(u.id, s(form, 'finding_id'), { title: s(form, 'title'), summary: s(form, 'summary'), why_it_matters: s(form, 'why_it_matters'),
      chapter_min: n(form, 'chapter_min'), spoiler_level: s(form, 'spoiler_level') || 'story', how_to: s(form, 'how_to').split('\n').map((x) => x.trim()).filter(Boolean) });
  } catch (e) { back('/admin/review', (e as Error).message, false); }
  back('/admin/review', 'Saved.');
}

export async function correctAction(form: FormData) {
  const u = await requireModerator();
  const which = s(form, 'which');
  try {
    if (which === 'retract') await A.retract(u.id, s(form, 'finding_id'), s(form, 'note'));
    else await A.markPatchedOrDebunked(u.id, s(form, 'finding_id'), which === 'debunked' ? 'debunked' : 'patched', s(form, 'note'));
  } catch (e) { back('/admin/review', (e as Error).message, false); }
  revalidatePath('/', 'layout');
  back('/admin/review', `Marked ${which}.`);
}

export async function resolveCorrectionAction(form: FormData) {
  const u = await requireModerator();
  await A.resolveCorrection(u.id, s(form, 'correction_id'), s(form, 'status') === 'accepted' ? 'accepted' : 'rejected');
  back('/admin/review', 'Correction resolved.');
}

export async function flagAction(form: FormData) {
  const u = await requireAdmin();
  try { await A.setFlag(u.id, s(form, 'key'), s(form, 'enabled') === 'true'); } catch (e) { back('/admin', (e as Error).message, false); }
  back('/admin', 'Flag updated.');
}

export async function sourceAction(form: FormData) {
  const u = await requireAdmin();
  await A.setSourceEnabled(u.id, s(form, 'source_id'), s(form, 'enabled') === 'true');
  back('/admin', 'Source updated.');
}

export async function rightsAction(form: FormData) {
  const u = await requireAdmin();
  const status = s(form, 'rights_status');
  const allowed = ['unreviewed', 'link_out_only', 'personal_use', 'licensed', 'owned', 'denied'];
  const uses = form.getAll('uses').map(String).filter((x) => ['private', 'closed_beta', 'commercial'].includes(x));
  if (!allowed.includes(status)) back('/admin/rights', 'Unknown status', false);
  if (uses.includes('commercial') && !s(form, 'agreement_ref')) back('/admin/rights', 'Commercial use requires an agreement/licence reference.', false);
  await A.setRights(u.id, s(form, 'rights_id'), status, uses, s(form, 'notes'), s(form, 'agreement_ref'));
  back('/admin/rights', 'Rights record updated.');
}

export async function planAction(form: FormData) {
  const u = await requireAdmin();
  const plan = s(form, 'plan') as PlanId;
  if (!['free', 'plus', 'pro', 'founder'].includes(plan)) back('/admin', 'Unknown plan', false);
  await A.grantPlan(u.id, s(form, 'user_id'), plan);
  back('/admin', 'Plan updated (manual grant, no payment taken).');
}

export async function runScoutsAction() {
  const u = await requireAdmin();
  if (!(await rateLimit(`admin-run:${u.id}`, 1, 300))) back('/admin', 'One manual run per 5 minutes.', false);
  const r = await runScoutPipeline({ kind: 'manual_refresh', idempotencyKey: `manual:admin:${u.id}:${Date.now()}`, requestedBy: u.id });
  revalidatePath('/', 'layout');
  back('/admin', `Scout run ${r.status}: ${r.sources.filter((x) => x.outcome === 'success' || x.outcome === 'partial').length}/${r.sources.length} sources reached.`, r.status !== 'failed');
}

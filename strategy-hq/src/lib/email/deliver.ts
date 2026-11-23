import { asService } from '../db';
import { config } from '../config';

/**
 * Delivery is BLOCKED by default and records why. It only sends when ALL hold:
 *  - owner flag `email_delivery` on,
 *  - REPORT_ENABLED=true and RESEND_API_KEY + REPORT_FROM_EMAIL configured (server-only env),
 *  - the user opted in AND their plan includes morning_email,
 *  - in founder_private mode the recipient is REPORT_TO_EMAIL only (no emailing other users).
 * Statuses never conflate: provider_accepted ≠ delivered.
 */
export type DeliveryStatus = 'dry_run' | 'blocked' | 'provider_accepted' | 'failed';

export async function deliverBrief(opts: {
  digestId: string; userId: string; userEmail: string; localDate: string; subject: string; html: string; forceDryRun?: boolean;
  sendFn?: (args: { to: string; subject: string; html: string; idempotencyKey: string }) => Promise<{ ok: boolean; id?: string; error?: string; transient?: boolean }>;
}): Promise<{ status: DeliveryStatus; reason: string }> {
  const idem = `brief:${opts.userId}:${opts.localDate}`;
  const gate = await asService(async (c) => {
    const flag = (await c.query(`select enabled from feature_flags where key = 'email_delivery'`)).rows[0]?.enabled === true;
    const pref = (await c.query(`select email_enabled from alert_preferences where user_id = $1`, [opts.userId])).rows[0]?.email_enabled === true;
    const ent = (await c.query(`select 1 from entitlements where user_id = $1 and feature = 'morning_email'`, [opts.userId])).rowCount! > 0;
    const already = (await c.query(`select status from delivery_attempts where idempotency_key like $1 and status = 'provider_accepted'`, [idem + '%'])).rowCount! > 0;
    return { flag, pref, ent, already };
  });
  let reason = '';
  if (gate.already) reason = 'already accepted by provider today (idempotent)';
  else if (opts.forceDryRun) reason = 'dry run requested';
  else if (!gate.flag) reason = 'owner flag email_delivery is off';
  else if (!config.reportEnabled) reason = 'REPORT_ENABLED is not true';
  else if (!config.resendApiKey || !config.reportFromEmail) reason = 'sender not configured (RESEND_API_KEY / REPORT_FROM_EMAIL)';
  else if (!gate.pref) reason = 'user has not opted in to email';
  else if (!gate.ent) reason = 'plan does not include morning email';
  else if (config.appMode === 'founder_private' && (!config.reportToEmail || config.reportToEmail.toLowerCase() !== opts.userEmail.toLowerCase())) {
    reason = 'founder-private mode: only REPORT_TO_EMAIL may receive email';
  }
  if (reason) {
    const status: DeliveryStatus = opts.forceDryRun || !gate.flag || !config.reportEnabled ? 'dry_run' : 'blocked';
    if (!gate.already) {
      await asService((c) => c.query(
        `insert into delivery_attempts(digest_id, idempotency_key, provider, status, error) values ($1,$2,'none',$3,$4)
         on conflict (idempotency_key) do update set status = excluded.status, error = excluded.error, at = now()`,
        [opts.digestId, `${idem}:${status}`, status, reason]));
    }
    return { status: gate.already ? 'provider_accepted' : status, reason };
  }

  const send = opts.sendFn ?? resendSend;
  let last: { ok: boolean; id?: string; error?: string; transient?: boolean } = { ok: false };
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await send({ to: opts.userEmail, subject: opts.subject, html: opts.html, idempotencyKey: idem });
    await asService((c) => c.query(
      `insert into delivery_attempts(digest_id, idempotency_key, attempt, provider, status, provider_message_id, error)
       values ($1,$2,$3,'resend',$4,$5,$6) on conflict (idempotency_key) do nothing`,
      [opts.digestId, `${idem}:attempt${attempt}`, attempt, last.ok ? 'provider_accepted' : 'failed', last.id ?? null, last.error ?? null]));
    if (last.ok || !last.transient) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return last.ok ? { status: 'provider_accepted', reason: 'accepted by provider (not proof of inbox delivery)' } : { status: 'failed', reason: last.error ?? 'send failed' };
}

async function resendSend(a: { to: string; subject: string; html: string; idempotencyKey: string }) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json', 'idempotency-key': a.idempotencyKey },
      body: JSON.stringify({ from: config.reportFromEmail, to: [a.to], subject: a.subject, html: a.html }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (res.ok && body.id) return { ok: true, id: body.id };
    return { ok: false, error: `HTTP ${res.status}: ${body.message ?? 'rejected'}`.slice(0, 300), transient: res.status >= 500 || res.status === 429 };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300), transient: true };
  }
}

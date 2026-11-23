'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../auth/session';
import { setHunt, fileCorrection, type HuntStatus } from '../repo/intel';

const UUID = /^[0-9a-f-]{36}$/i;

export async function huntAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('finding_id') ?? '');
  const raw = String(form.get('status') ?? '');
  if (!UUID.test(id)) return;
  const status: HuntStatus | null = raw === 'saved' || raw === 'found' || raw === 'skipped' ? raw : null;
  await setHunt(user.id, id, status);
  revalidatePath(`/intel/${id}`);
  revalidatePath('/', 'layout');
}

export async function correctionAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('finding_id') ?? '');
  const kind = String(form.get('kind') ?? 'other');
  const details = String(form.get('details') ?? '').trim();
  if (!UUID.test(id) || details.length < 3) return;
  const allowed = ['wrong_location', 'patched', 'wrong_chapter', 'spoiler', 'rights', 'other'];
  await fileCorrection(user.id, id, allowed.includes(kind) ? kind : 'other', details);
  revalidatePath(`/intel/${id}`);
}

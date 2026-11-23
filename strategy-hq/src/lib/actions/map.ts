'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../auth/session';
import { addPrivatePin, renamePrivatePin, deletePrivatePin, type PrivatePin } from '../repo/map';

export type PinActionState = { ok: true; pin?: PrivatePin } | { ok: false; error: string };

export async function addPinAction(input: { assetId: string; x: number; y: number; label: string }): Promise<PinActionState> {
  const user = await requireUser('/map');
  const r = await addPrivatePin(user.id, { assetId: String(input.assetId), x: Number(input.x), y: Number(input.y), label: String(input.label ?? '') });
  if (!r.ok) {
    return { ok: false, error: r.error === 'cap' ? `You have reached your private pin limit (${r.cap}).` : r.error === 'no_map' ? 'That map is not available.' : 'Enter a label (1–80 characters) and tap inside the map.' };
  }
  revalidatePath('/map');
  return { ok: true, pin: r.pin };
}

export async function renamePinAction(id: string, label: string): Promise<PinActionState> {
  const user = await requireUser('/map');
  const ok = await renamePrivatePin(user.id, String(id), String(label ?? ''));
  if (!ok) return { ok: false, error: 'Could not rename that pin.' };
  revalidatePath('/map');
  return { ok: true };
}

export async function deletePinAction(id: string): Promise<PinActionState> {
  const user = await requireUser('/map');
  const ok = await deletePrivatePin(user.id, String(id));
  if (!ok) return { ok: false, error: 'Could not delete that pin.' };
  revalidatePath('/map');
  return { ok: true };
}

'use server';
import { revalidatePath } from 'next/cache';
import { requireUser } from '../auth/session';
import { addTask, setTaskDone, deleteTask, moveTask, saveNotes, addCash, deleteCash, importBackup } from '../repo/progress';

const UUID = /^[0-9a-f-]{36}$/i;
const done = () => revalidatePath('/playbook');

export async function addTaskAction(form: FormData) {
  const user = await requireUser();
  const text = String(form.get('text') ?? '').trim().slice(0, 300);
  if (!text) return;
  await addTask(user.id, text);
  done();
}
export async function toggleTaskAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('id') ?? '');
  if (!UUID.test(id)) return;
  await setTaskDone(user.id, id, form.get('done') === 'true');
  done();
}
export async function deleteTaskAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('id') ?? '');
  if (!UUID.test(id)) return;
  await deleteTask(user.id, id);
  done();
}
export async function moveTaskAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('id') ?? '');
  const dir = form.get('dir') === 'up' ? 'up' : 'down';
  if (!UUID.test(id)) return;
  await moveTask(user.id, id, dir);
  done();
}

export interface NotesState { ok?: boolean; error?: string; savedAt?: string }
export async function saveNotesAction(_p: NotesState, form: FormData): Promise<NotesState> {
  const user = await requireUser();
  const notes = String(form.get('notes') ?? '');
  if (notes.length > 20000) return { error: 'Notes are limited to 20,000 characters.' };
  await saveNotes(user.id, notes.replace(/\r\n/g, '\n'));
  done();
  return { ok: true, savedAt: new Date().toISOString() };
}

export interface CashState { ok?: boolean; error?: string }
export async function addCashAction(_p: CashState, form: FormData): Promise<CashState> {
  const user = await requireUser();
  const label = String(form.get('label') ?? '').trim().slice(0, 120);
  const raw = String(form.get('amount') ?? '').replace(/[,$\s]/g, '');
  const amount = Number(raw);
  if (!label) return { error: 'Add a short label (what was this for?).' };
  if (!raw || !Number.isInteger(amount) || Math.abs(amount) > 1e12) return { error: 'Amount must be a whole number.' };
  await addCash(user.id, amount, label);
  done();
  return { ok: true };
}
export async function deleteCashAction(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('id') ?? '');
  if (!UUID.test(id)) return;
  await deleteCash(user.id, id);
  done();
}

export interface ImportState { ok?: boolean; message?: string; error?: string }
export async function importAction(_p: ImportState, form: FormData): Promise<ImportState> {
  const user = await requireUser();
  if (form.get('confirm') !== 'on') return { error: 'Tick the box to confirm that restoring replaces your current tasks, notes and cash entries.' };
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a JSON backup file.' };
  if (file.size > 2_000_000) return { error: 'Backup file is too large (2 MB max).' };
  let json: unknown;
  try { json = JSON.parse(await file.text()); } catch { return { error: 'That file is not valid JSON.' }; }
  const r = await importBackup(user.id, json);
  if (!r.ok) return { error: r.error };
  revalidatePath('/playbook'); revalidatePath('/', 'layout');
  return { ok: true, message: `Restored ${r.tasks} task(s), ${r.cash} cash entr${r.cash === 1 ? 'y' : 'ies'}, ${r.hunts} hunt item(s)${r.notes ? ' and your notes' : ''}.${r.skippedHunts ? ` ${r.skippedHunts} hunt item(s) were skipped because those findings are not available to you.` : ''}` };
}

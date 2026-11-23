import { asUser, type Tx } from '../db';

/** Pure magic-byte sniffing. SVG, text, HTML, GIF etc. are all rejected. */
export const MAX_MAP_BYTES = 8 * 1024 * 1024;
export type SniffedImage = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp' };

export function sniffImage(buf: Uint8Array): SniffedImage | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

export type ImageValidation = { ok: true; type: SniffedImage } | { ok: false; error: string };
export function validateMapUpload(buf: Uint8Array): ImageValidation {
  if (buf.length === 0) return { ok: false, error: 'The file is empty.' };
  if (buf.length > MAX_MAP_BYTES) return { ok: false, error: 'The file is larger than 8 MB.' };
  const type = sniffImage(buf);
  if (!type) return { ok: false, error: 'Only PNG, JPEG or WEBP images are accepted.' };
  return { ok: true, type };
}

/** PNG dimensions from IHDR (other formats: unknown, stored as null). */
export function pngSize(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = dv.getUint32(16), height = dv.getUint32(20);
  return width > 0 && height > 0 && width < 100000 && height < 100000 ? { width, height } : null;
}

const UUID = /^[0-9a-f-]{36}$/i;
export const isUuid = (s: string) => UUID.test(s);

export interface MapAsset {
  id: string; owner_user_id: string | null; kind: string; storage_key: string; mime: string;
  width: number | null; height: number | null; calibrated: boolean; provenance: string; created_at: string;
}
const ASSET_COLS = 'id, owner_user_id, kind, storage_key, mime, width, height, calibrated, provenance, created_at';

export async function createUserMapAsset(userId: string, a: { storage_key: string; mime: string; width: number | null; height: number | null }): Promise<MapAsset> {
  return asUser(userId, async (c) => {
    const r = await c.query(
      `insert into map_assets(game_id, owner_user_id, kind, storage_key, mime, width, height, calibrated, provenance)
       values ('gta6', app_uid(), 'user_uploaded', $1, $2, $3, $4, false, 'Imported by the user for personal reference')
       returning ${ASSET_COLS}`, [a.storage_key, a.mime, a.width, a.height]);
    return r.rows[0];
  });
}

/** The platform's calibrated map, if any (none is configured today). */
export async function getPlatformMap(userId: string): Promise<MapAsset | null> {
  return asUser(userId, async (c) => {
    const r = await c.query(`select ${ASSET_COLS} from map_assets where game_id='gta6' and owner_user_id is null and calibrated order by created_at desc limit 1`);
    return r.rows[0] ?? null;
  });
}

/** The caller's own uploaded maps, newest first. RLS limits rows to the owner. */
export async function listUserMaps(userId: string): Promise<MapAsset[]> {
  return asUser(userId, async (c) => {
    const r = await c.query(`select ${ASSET_COLS} from map_assets where owner_user_id = app_uid() and kind = 'user_uploaded' order by created_at desc`);
    return r.rows;
  });
}

/** Asset the caller may stream: their own upload, or a calibrated platform asset. Null otherwise (RLS hides others). */
export async function getReadableAsset(userId: string, id: string): Promise<MapAsset | null> {
  if (!isUuid(id)) return null;
  return asUser(userId, async (c) => {
    const r = await c.query(`select ${ASSET_COLS} from map_assets where id = $1 and (owner_user_id = app_uid() or (owner_user_id is null and calibrated))`, [id]);
    return r.rows[0] ?? null;
  });
}

/** Deletes the row and returns the storage_key so the caller can remove the file. Null if not owned. */
export async function deleteUserMapAsset(userId: string, id: string): Promise<string | null> {
  if (!isUuid(id)) return null;
  return asUser(userId, async (c) => {
    const r = await c.query(`delete from map_assets where id = $1 and owner_user_id = app_uid() and kind = 'user_uploaded' returning storage_key`, [id]);
    return r.rows[0]?.storage_key ?? null;
  });
}

// ---------------------------------------------------------------- private pins
export interface PrivatePin { id: string; map_asset_id: string | null; x: number; y: number; label: string; created_at: string }

export const DEFAULT_PIN_CAP = 25; // free-plan default when no entitlement row exists

async function pinCap(c: Tx): Promise<number | null> {
  const r = await c.query(`select limit_value from entitlements where user_id = app_uid() and feature = 'private_pins_total'`);
  if (!r.rowCount) return DEFAULT_PIN_CAP;
  return r.rows[0].limit_value === null ? null : Number(r.rows[0].limit_value);
}

export async function pinAllowance(userId: string): Promise<{ used: number; cap: number | null }> {
  return asUser(userId, async (c) => {
    const used = Number((await c.query(`select count(*) n from user_private_pins where user_id = app_uid() and game_id = 'gta6'`)).rows[0].n);
    return { used, cap: await pinCap(c) };
  });
}

export async function listPrivatePins(userId: string, assetId: string | null): Promise<PrivatePin[]> {
  if (!assetId || !isUuid(assetId)) return [];
  return asUser(userId, async (c) => {
    const r = await c.query(`select id, map_asset_id, x::float8 x, y::float8 y, label, created_at from user_private_pins
      where user_id = app_uid() and game_id = 'gta6' and map_asset_id = $1 order by created_at`, [assetId]);
    return r.rows;
  });
}

export type PinResult = { ok: true; pin: PrivatePin } | { ok: false; error: 'cap' | 'invalid' | 'no_map'; cap?: number };

export function cleanLabel(raw: string): string | null {
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 80);
  return s.length ? s : null;
}

export async function addPrivatePin(userId: string, p: { assetId: string; x: number; y: number; label: string }): Promise<PinResult> {
  const label = cleanLabel(p.label);
  if (!label || !isUuid(p.assetId) || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return { ok: false, error: 'invalid' };
  return asUser(userId, async (c) => {
    // Serialise per user so concurrent adds cannot slip past the cap.
    await c.query(`select pg_advisory_xact_lock(hashtext('pins:' || app_uid()::text))`);
    const asset = await c.query(`select 1 from map_assets where id = $1 and owner_user_id = app_uid()`, [p.assetId]);
    if (!asset.rowCount) return { ok: false as const, error: 'no_map' as const };
    const cap = await pinCap(c);
    if (cap !== null) {
      const used = Number((await c.query(`select count(*) n from user_private_pins where user_id = app_uid() and game_id = 'gta6'`)).rows[0].n);
      if (used >= cap) return { ok: false as const, error: 'cap' as const, cap };
    }
    const r = await c.query(`insert into user_private_pins(user_id, game_id, map_asset_id, x, y, label) values (app_uid(), 'gta6', $1, $2, $3, $4)
      returning id, map_asset_id, x::float8 x, y::float8 y, label, created_at`, [p.assetId, p.x.toFixed(6), p.y.toFixed(6), label]);
    return { ok: true as const, pin: r.rows[0] };
  });
}

export async function renamePrivatePin(userId: string, id: string, label: string): Promise<boolean> {
  const l = cleanLabel(label);
  if (!l || !isUuid(id)) return false;
  return asUser(userId, async (c) => (await c.query(`update user_private_pins set label = $2 where id = $1 and user_id = app_uid()`, [id, l])).rowCount === 1);
}

export async function deletePrivatePin(userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return asUser(userId, async (c) => (await c.query(`delete from user_private_pins where id = $1 and user_id = app_uid()`, [id])).rowCount === 1);
}

// ---------------------------------------------------------------- verified pins
export interface VerifiedPin { id: string; place_id: string; map_asset_id: string; x: number; y: number; precision: string }

/** Verified pins on the calibrated platform map only. Never fabricated: empty when no such map exists. */
export async function listVerifiedPins(userId: string, placeIds: string[]): Promise<VerifiedPin[]> {
  const ids = placeIds.filter(isUuid);
  if (!ids.length) return [];
  return asUser(userId, async (c) => {
    const r = await c.query(`select mp.id, mp.place_id, mp.map_asset_id, mp.x::float8 x, mp.y::float8 y, mp.precision
      from map_pins mp join map_assets ma on ma.id = mp.map_asset_id
      where ma.owner_user_id is null and ma.calibrated and mp.place_id = any($1::uuid[])`, [ids]);
    return r.rows;
  });
}

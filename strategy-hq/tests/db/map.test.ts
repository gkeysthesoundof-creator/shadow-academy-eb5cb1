import { beforeAll, describe, expect, it } from 'vitest';
import { asService, asUser } from '@/lib/db';
import { resetDb, makeUser } from './helpers';
import {
  validateMapUpload, sniffImage, createUserMapAsset, getReadableAsset, deleteUserMapAsset, listUserMaps,
  addPrivatePin, listPrivatePins, renamePrivatePin, deletePrivatePin, pinAllowance, MAX_MAP_BYTES,
} from '@/lib/repo/map';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 4, 0, 0, 0, 3]);
const enc = (s: string) => new TextEncoder().encode(s);

describe('upload validator', () => {
  it('accepts PNG/JPEG/WEBP by magic bytes', () => {
    expect(sniffImage(PNG)?.mime).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))?.mime).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([...enc('RIFF'), 1, 2, 3, 4, ...enc('WEBP')]))?.mime).toBe('image/webp');
  });
  it('rejects SVG, text, HTML, GIF, empty and oversize', () => {
    expect(validateMapUpload(enc('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).ok).toBe(false);
    expect(validateMapUpload(enc('hello world, not an image')).ok).toBe(false);
    expect(validateMapUpload(enc('<html><script>alert(1)</script>')).ok).toBe(false);
    expect(validateMapUpload(enc('GIF89a....')).ok).toBe(false);
    expect(validateMapUpload(new Uint8Array(0)).ok).toBe(false);
    const big = new Uint8Array(MAX_MAP_BYTES + 1); big.set(PNG);
    expect(validateMapUpload(big).ok).toBe(false);
    expect(validateMapUpload(PNG).ok).toBe(true);
  });
});

describe('private maps and pins (RLS)', () => {
  let a: string, b: string, assetA: string, pinA: string;
  beforeAll(async () => {
    await resetDb();
    a = await makeUser('map-a'); b = await makeUser('map-b');
    assetA = (await createUserMapAsset(a, { storage_key: `${a}/x.png`, mime: 'image/png', width: 4, height: 3 })).id;
    const r = await addPrivatePin(a, { assetId: assetA, x: 0.25, y: 0.5, label: 'Mine' });
    if (!r.ok) throw new Error('setup');
    pinA = r.pin.id;
  });

  it('owner can read their asset; other user gets nothing', async () => {
    expect((await getReadableAsset(a, assetA))?.id).toBe(assetA);
    expect(await getReadableAsset(b, assetA)).toBeNull();
    expect(await listUserMaps(b)).toHaveLength(0);
    expect(await listUserMaps(a)).toHaveLength(1);
  });

  it('other user cannot delete the asset', async () => {
    expect(await deleteUserMapAsset(b, assetA)).toBeNull();
    expect(await getReadableAsset(a, assetA)).not.toBeNull();
  });

  it('assets are always uncalibrated user uploads', async () => {
    const r = await asService((c) => c.query('select kind, calibrated from map_assets where id = $1', [assetA]));
    expect(r.rows[0]).toEqual({ kind: 'user_uploaded', calibrated: false });
    await expect(asUser(a, (c) => c.query(`insert into map_assets(game_id, owner_user_id, kind, storage_key, mime, calibrated, provenance) values ('gta6', app_uid(), 'user_uploaded','k','image/png', true,'x')`))).rejects.toThrow();
  });

  it('pins are isolated: B cannot see, rename, delete, or pin on A map', async () => {
    expect(await listPrivatePins(b, assetA)).toHaveLength(0);
    expect(await renamePrivatePin(b, pinA, 'hacked')).toBe(false);
    expect(await deletePrivatePin(b, pinA)).toBe(false);
    const r = await addPrivatePin(b, { assetId: assetA, x: 0.1, y: 0.1, label: 'sneaky' });
    expect(r).toMatchObject({ ok: false, error: 'no_map' });
    const mine = await listPrivatePins(a, assetA);
    expect(mine).toHaveLength(1);
    expect(mine[0].label).toBe('Mine');
  });

  it('owner can rename and delete', async () => {
    expect(await renamePrivatePin(a, pinA, 'Renamed')).toBe(true);
    expect((await listPrivatePins(a, assetA))[0].label).toBe('Renamed');
    expect(await deletePrivatePin(a, pinA)).toBe(true);
    expect(await listPrivatePins(a, assetA)).toHaveLength(0);
  });

  it('rejects out-of-range coordinates and empty labels', async () => {
    expect(await addPrivatePin(a, { assetId: assetA, x: 1.5, y: 0.5, label: 'x' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await addPrivatePin(a, { assetId: assetA, x: 0.5, y: 0.5, label: '   ' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('enforces private_pins_total entitlement (and null = unlimited)', async () => {
    await asService((c) => c.query(`insert into entitlements(user_id, feature, limit_value, source) values ($1,'private_pins_total',2,'plan')
      on conflict (user_id, feature) do update set limit_value = 2`, [a]));
    expect((await addPrivatePin(a, { assetId: assetA, x: 0.1, y: 0.1, label: 'one' })).ok).toBe(true);
    expect((await addPrivatePin(a, { assetId: assetA, x: 0.2, y: 0.2, label: 'two' })).ok).toBe(true);
    expect(await addPrivatePin(a, { assetId: assetA, x: 0.3, y: 0.3, label: 'three' })).toMatchObject({ ok: false, error: 'cap', cap: 2 });
    expect(await pinAllowance(a)).toEqual({ used: 2, cap: 2 });
    await asService((c) => c.query(`update entitlements set limit_value = null where user_id = $1 and feature = 'private_pins_total'`, [a]));
    expect((await addPrivatePin(a, { assetId: assetA, x: 0.3, y: 0.3, label: 'three' })).ok).toBe(true);
    expect((await pinAllowance(a)).cap).toBeNull();
  });

  it('concurrent adds cannot exceed the cap', async () => {
    await asService((c) => c.query(`update entitlements set limit_value = 5 where user_id = $1 and feature = 'private_pins_total'`, [a]));
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => addPrivatePin(a, { assetId: assetA, x: 0.5, y: 0.5, label: `c${i}` })));
    expect((await pinAllowance(a)).used).toBe(5); // 3 existing + exactly 2 of 6 racing adds
    expect(rs.filter((r) => r.ok)).toHaveLength(2);
  });

  it('deleting the asset removes its pins; owner only', async () => {
    expect(await deleteUserMapAsset(a, assetA)).toBe(`${a}/x.png`);
    expect(await listPrivatePins(a, assetA)).toHaveLength(0);
  });
});

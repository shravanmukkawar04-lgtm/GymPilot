import { Db, one, q } from '../db';
import { bad } from '../api/router';

export type PhotoKind = 'member' | 'user' | 'gym';

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_BYTES = 500_000;

/**
 * Saves, replaces or removes a photo. The browser shrinks photos before sending them,
 * so they are small enough to keep in the database.
 * undefined = leave as is, null or '' = remove, data URL = save.
 */
export async function savePhoto(db: Db | undefined, kind: PhotoKind, refId: number, value: string | null | undefined, gymId?: number) {
  if (value === undefined) return;
  if (value === null || value === '') {
    await q('DELETE FROM photos WHERE kind=$1 AND ref_id=$2', [kind, refId], db);
    return;
  }
  const m = value.match(DATA_URL);
  if (!m) throw bad('Photo must be a JPG, PNG or WebP image');
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_BYTES) throw bad('Photo is too large. Please use a smaller photo.');
  await q(
    `INSERT INTO photos (gym_id, kind, ref_id, mime, data) VALUES (COALESCE($5::int, app_gym()), $1, $2, $3, $4)
     ON CONFLICT (gym_id, kind, ref_id) DO UPDATE SET mime=EXCLUDED.mime, data=EXCLUDED.data, updated_at=now()`,
    [kind, refId, m[1], data, gymId ?? null], db);
}

/** Returns the photo as an image response. Member photos follow branch access, because the member must be visible. */
export async function photoResponse(kind: PhotoKind, refId: number) {
  const visible: Record<PhotoKind, string> = {
    member: 'EXISTS (SELECT 1 FROM members x WHERE x.id = p.ref_id)',
    user: 'EXISTS (SELECT 1 FROM users x WHERE x.id = p.ref_id)',
    gym: 'p.ref_id = app_gym()',
  };
  const row = await one<{ mime: string; data: Buffer }>(`SELECT p.mime, p.data FROM photos p WHERE p.kind=$1 AND p.ref_id=$2 AND ${visible[kind]}`, [kind, refId]);
  if (!row) return new Response('Not found', { status: 404 });
  // Image URLs carry ?v=<last change>, so a cached copy is replaced as soon as the photo changes.
  return new Response(new Uint8Array(row.data), { headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=604800' } });
}

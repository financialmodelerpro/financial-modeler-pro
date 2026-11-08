/**
 * Live-course session materials (mig 251). Pure rules + the database writes
 * shared by the admin editor and the sync script, so both behave identically.
 *
 * RELEASE: a file is visible to enrolled students only after its session's
 * CURRENT scheduled end (start + duration). A reschedule moves the release.
 * VERSIONS: a changed file is uploaded as a NEW object (earlier objects stay in
 * storage, listed in `versions`); the row keeps the same id, so the student's
 * link (/api/training/live-sessions/<id>/materials/<materialId>) never changes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { joinWindowFor } from './joinWindow';

export const MATERIALS_BUCKET = 'live-course-materials';

export interface MaterialRow {
  id: string;
  session_id: string;
  file_name: string;
  storage_path: string;
  sha256: string;
  size_bytes: number | null;
  mime_type: string | null;
  version: number;
  versions: { version: number; storage_path: string; sha256: string; replaced_at: string }[];
  updated_at: string;
}

/** Released once the session's current scheduled end has passed. */
export function materialsReleased(
  s: { scheduled_datetime?: string | null; duration_minutes?: number | null },
  now: number = Date.now(),
): boolean {
  const w = joinWindowFor(s, 0);
  return !!w && now > new Date(w.closesAt).getTime();
}

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function mimeFor(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  return ext === 'pdf' ? 'application/pdf'
    : ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : ext === 'xlsm' ? 'application/vnd.ms-excel.sheet.macroEnabled.12'
    : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : ext === 'pptx' ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : ext === 'txt' ? 'text/plain; charset=utf-8'
    : ext === 'zip' ? 'application/zip'
    : 'application/octet-stream';
}

export type SyncAction = { kind: 'new' | 'changed' | 'unchanged'; fileName: string; sha: string; existing?: MaterialRow };

/** What a sync would do for one session: new and changed files only, matched by file name. Pure. */
export function planMaterialSync(local: { fileName: string; sha: string }[], existing: MaterialRow[]): SyncAction[] {
  const byName = new Map(existing.map((r) => [r.file_name, r]));
  return local.map(({ fileName, sha }) => {
    const row = byName.get(fileName);
    if (!row) return { kind: 'new', fileName, sha };
    return { kind: row.sha256 === sha ? 'unchanged' : 'changed', fileName, sha, existing: row };
  });
}

const safe = (n: string) => n.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);

/**
 * Store a file on a session: insert (new name) or replace (same name; the
 * previous object is kept and listed). Returns what happened. An unchanged
 * file (same hash) is a no-op.
 */
export async function putMaterial(
  sb: SupabaseClient,
  p: { sessionId: string; fileName: string; bytes: Buffer; by: string | null },
  now: Date = new Date(),
): Promise<{ action: 'new' | 'changed' | 'unchanged'; row: MaterialRow | null; error?: string }> {
  const fileName = p.fileName.trim();
  if (!fileName) return { action: 'unchanged', row: null, error: 'A file name is required.' };
  const sha = sha256(p.bytes);
  const { data: existing } = await sb.from('live_session_materials').select('*').eq('session_id', p.sessionId).eq('file_name', fileName).maybeSingle();
  const row = existing as MaterialRow | null;
  if (row && row.sha256 === sha) return { action: 'unchanged', row };

  const version = (row?.version ?? 0) + 1;
  const path = `${p.sessionId}/${safe(fileName)}/v${version}-${sha.slice(0, 8)}-${safe(fileName)}`;
  const { error: upErr } = await sb.storage.from(MATERIALS_BUCKET).upload(path, p.bytes, { contentType: mimeFor(fileName), upsert: false });
  if (upErr && !/exists/i.test(upErr.message)) return { action: row ? 'changed' : 'new', row: null, error: upErr.message };

  if (row) {
    const versions = [...(row.versions ?? []), { version: row.version, storage_path: row.storage_path, sha256: row.sha256, replaced_at: now.toISOString() }];
    const { data, error } = await sb.from('live_session_materials')
      .update({ storage_path: path, sha256: sha, size_bytes: p.bytes.length, mime_type: mimeFor(fileName), version, versions, uploaded_by: p.by, updated_at: now.toISOString() })
      .eq('id', row.id).select('*').maybeSingle();
    if (error) return { action: 'changed', row: null, error: error.message };
    return { action: 'changed', row: data as MaterialRow };
  }
  const { data, error } = await sb.from('live_session_materials')
    .insert({ session_id: p.sessionId, file_name: fileName, storage_path: path, sha256: sha, size_bytes: p.bytes.length, mime_type: mimeFor(fileName), version, uploaded_by: p.by })
    .select('*').maybeSingle();
  if (error) return { action: 'new', row: null, error: error.message };
  return { action: 'new', row: data as MaterialRow };
}

/** Remove a file from a session. Stored objects are kept (history); only the listing goes. */
export async function removeMaterial(sb: SupabaseClient, materialId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from('live_session_materials').delete().eq('id', materialId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function listMaterials(sb: SupabaseClient, sessionIds: string[]): Promise<MaterialRow[]> {
  if (!sessionIds.length) return [];
  const { data, error } = await sb.from('live_session_materials').select('*').in('session_id', sessionIds).order('file_name');
  if (error) return []; // before mig 251: no materials
  return (data ?? []) as MaterialRow[];
}

/** A materials folder name to its session number: "Session_03" -> 3. */
export function sessionNumberOf(folder: string): number | null {
  const m = /^session[_\s-]?0*(\d{1,2})$/i.exec(folder.trim());
  return m ? Number(m[1]) : null;
}

/** The stable student link for a material. */
export function materialPath(sessionId: string, materialId: string): string {
  return `/api/training/live-sessions/${encodeURIComponent(sessionId)}/materials/${encodeURIComponent(materialId)}`;
}

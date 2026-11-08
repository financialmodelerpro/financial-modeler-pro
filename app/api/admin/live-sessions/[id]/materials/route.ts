import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { adminEmail } from '@/src/hubs/training/lib/liveCourse/adminGuard';
import { listMaterials, putMaterial, removeMaterial } from '@/src/hubs/training/lib/liveCourse/materials';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BYTES = 50 * 1024 * 1024;

/** GET: the session's materials (latest version of each file). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  return NextResponse.json({ materials: await listMaterials(getServerClient(), [id]) });
}

/**
 * POST FormData: file, replaceId?
 *   Add      a new file (its own name)
 *   Replace  `replaceId` set: stored under THAT file's name, so the student link
 *            stays the same; the previous version is kept in storage.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const by = await adminEmail();
  if (!by) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !file.size) return NextResponse.json({ error: 'Choose a file.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Files must be 50 MB or smaller.' }, { status: 400 });
  const sb = getServerClient();
  let name = file.name;
  const replaceId = String(form?.get('replaceId') ?? '');
  if (replaceId) {
    const { data: row } = await sb.from('live_session_materials').select('file_name, session_id').eq('id', replaceId).maybeSingle();
    if (!row || row.session_id !== id) return NextResponse.json({ error: 'That file is not on this session.' }, { status: 400 });
    name = row.file_name as string;
  }
  const r = await putMaterial(sb, { sessionId: id, fileName: name, bytes: Buffer.from(await file.arrayBuffer()), by });
  if (r.error) {
    const hint = /does not exist|schema cache|bucket/i.test(r.error) ? ' (apply migration 251)' : '';
    return NextResponse.json({ error: `${r.error}${hint}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: r.action, material: r.row });
}

/** DELETE ?materialId=: remove from the session (stored versions are kept). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await adminEmail()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await params;
  const materialId = req.nextUrl.searchParams.get('materialId') ?? '';
  const sb = getServerClient();
  const { data: row } = await sb.from('live_session_materials').select('session_id').eq('id', materialId).maybeSingle();
  if (!row || row.session_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const r = await removeMaterial(sb, materialId);
  return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 500 });
}

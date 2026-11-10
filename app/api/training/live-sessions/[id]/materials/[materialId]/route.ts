import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { studentHasSessionAccess, type SessionForAccess } from '@/src/hubs/training/lib/liveCourse/sessionAccess';
import { materialsReleased, MATERIALS_BUCKET } from '@/src/hubs/training/lib/liveCourse/materials';
import { loadRecordingUnlock } from '@/src/hubs/training/lib/liveCourse/recordingAccess';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/live-sessions/[id]/materials/[materialId]
 * The ONE door to a session file. Checks the signed student has access
 * (enrolled in the course, or registered), and that the session's CURRENT end
 * time has passed (a reschedule moves the release), then redirects to a
 * short-lived signed URL of the LATEST version. The link never changes.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; materialId: string }> }) {
  const { id, materialId } = await params;
  const sess = await getTrainingCookieSession();
  if (!sess) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const sb = getServerClient();
  const [{ data: session }, { data: mat }] = await Promise.all([
    sb.from('live_sessions').select('id, scheduled_datetime, duration_minutes, course_code').eq('id', id).maybeSingle(),
    sb.from('live_session_materials').select('file_name, storage_path, session_id').eq('id', materialId).maybeSingle(),
  ]);
  if (!session || !mat || mat.session_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!await studentHasSessionAccess(sb, sess, session as SessionForAccess)) return NextResponse.json({ error: 'Enrol in the course to download its materials.' }, { status: 403 });
  if (!materialsReleased(session)) return NextResponse.json({ error: 'Materials are released after the session ends.' }, { status: 403 });
  // The same unlock as the recording (recordingAccess.ts): attended live, or every earlier session complete.
  const unlock = await loadRecordingUnlock(sb, sess, session as SessionForAccess);
  if (!unlock.unlocked) return NextResponse.json({ error: unlock.message ?? 'These materials are locked.' }, { status: 403 });
  const { data, error } = await sb.storage.from(MATERIALS_BUCKET).createSignedUrl(mat.storage_path as string, 120, { download: mat.file_name as string });
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'The file could not be opened.' }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, 302);
}

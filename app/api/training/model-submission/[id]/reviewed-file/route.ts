import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import type { ModelSubmissionRow } from '@/src/hubs/training/lib/modelSubmission/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/training/model-submission/[id]/reviewed-file
 *
 * Student download for the admin-RETURNED reviewed model (mig 185). Mirrors the
 * admin file proxy: the `model-submissions` bucket is private, so bytes are
 * streamed through this route (no signed URL leaks the path).
 *
 * AUTH: the training_session cookie AND ownership: the submission's email must
 * match the signed-in student, so a student can only download their OWN reviewed
 * model (no id-probing another student's file). Returns 404 when the submission
 * has no reviewed file (approved without one), so old / file-less approvals are a
 * clean no-op, not an error.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getTrainingCookieSession();
  if (!session?.email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Submission id required' }, { status: 400 });

  const sb = getServerClient();
  const { data: row, error: readErr } = await sb
    .from('model_submissions')
    .select('email, reviewed_file_path, reviewed_file_name, reviewed_file_mime')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[training/reviewed-file] row read failed:', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

  const sub = row as Pick<ModelSubmissionRow, 'email' | 'reviewed_file_path' | 'reviewed_file_name' | 'reviewed_file_mime'>;

  // Ownership: only the student who submitted it can download the reviewed model.
  if (sub.email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!sub.reviewed_file_path) {
    return NextResponse.json({ error: 'No reviewed model is available for this submission.' }, { status: 404 });
  }

  const { data: blob, error: dlErr } = await sb.storage
    .from('model-submissions')
    .download(sub.reviewed_file_path);
  if (dlErr || !blob) {
    console.error('[training/reviewed-file] download failed:', dlErr);
    return NextResponse.json({ error: 'Failed to load the reviewed model from storage' }, { status: 500 });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const name = sub.reviewed_file_name || 'reviewed-model';
  const asciiName = name.replace(/[^\x20-\x7E]+/g, '_');
  const encodedName = encodeURIComponent(name);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': sub.reviewed_file_mime || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}

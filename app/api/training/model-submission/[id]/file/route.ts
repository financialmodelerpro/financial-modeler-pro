import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import type { ModelSubmissionRow } from '@/src/hubs/training/lib/modelSubmission/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/training/model-submission/[id]/file
 *
 * Student download for their OWN originally-submitted model. Sibling of
 * .../reviewed-file (which serves the admin-returned marked-up copy) and an
 * exact mirror of its auth + streaming behaviour: the `model-submissions`
 * bucket is private, so bytes stream through this route and no signed URL ever
 * exposes the storage path.
 *
 * Added for the My Model view, which shows both halves of each attempt side by
 * side: what the student sent, and what came back. Before this the student
 * could re-download the reviewer's copy but not their own submission.
 *
 * AUTH: the training_session cookie AND ownership: the submission's email must
 * match the signed-in student, so a student cannot probe another student's id.
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
    .select('email, storage_path, file_name, mime_type')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[training/own-file] row read failed:', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

  const sub = row as Pick<ModelSubmissionRow, 'email' | 'storage_path' | 'file_name' | 'mime_type'>;

  // Ownership: only the student who submitted it can download it back.
  if (sub.email.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!sub.storage_path) {
    return NextResponse.json({ error: 'No file is stored for this submission.' }, { status: 404 });
  }

  const { data: blob, error: dlErr } = await sb.storage
    .from('model-submissions')
    .download(sub.storage_path);
  if (dlErr || !blob) {
    console.error('[training/own-file] download failed:', dlErr);
    return NextResponse.json({ error: 'Failed to load your model from storage' }, { status: 500 });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const name = sub.file_name || 'model';
  const asciiName = name.replace(/[^\x20-\x7E]+/g, '_');
  const encodedName = encodeURIComponent(name);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': sub.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import type { ModelSubmissionRow } from '@/src/hubs/training/lib/modelSubmission/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/admin/model-submissions/[id]/file?inline=1
 *
 * Admin-gated proxy for the private `model-submissions` bucket. The bucket
 * is intentionally private (no public-read policy in migration 148), so
 * direct getPublicUrl() returns an unreachable link for these objects.
 *
 * This route:
 *   1. Verifies the caller is an admin via NextAuth.
 *   2. Looks up the row, reads `storage_path`.
 *   3. Streams the bytes back through the admin's authenticated request
 *      using the service-role client to download from storage.
 *
 * Two modes:
 *   - default: Content-Disposition: attachment - browser saves to disk.
 *     Used by the "Download" button on the review queue.
 *   - ?inline=1: Content-Disposition: inline - browser tries to render. PDFs
 *     open in the built-in viewer; xlsx etc. fall back to download anyway
 *     because no browser renders Excel inline.
 *
 * No signed URL is ever issued, so the file path never leaks to the
 * browser's URL bar, referrers, or proxy logs. The route doubles as the
 * audit-friendly choke point - every admin file access goes through this
 * single function.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Submission id required' }, { status: 400 });

  const inline = req.nextUrl.searchParams.get('inline') === '1';

  const sb = getServerClient();
  const { data: row, error: readErr } = await sb
    .from('model_submissions')
    .select('storage_path, file_name, mime_type')
    .eq('id', id)
    .maybeSingle();

  if (readErr) {
    console.error('[admin/model-submissions file] row read failed:', readErr);
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) return NextResponse.json({ error: 'Submission not found' }, { status: 404 });

  const submission = row as Pick<ModelSubmissionRow, 'storage_path' | 'file_name' | 'mime_type'>;

  const { data: blob, error: dlErr } = await sb.storage
    .from('model-submissions')
    .download(submission.storage_path);

  if (dlErr || !blob) {
    console.error('[admin/model-submissions file] download failed:', dlErr);
    return NextResponse.json({
      error: 'Failed to load file from storage',
      message: dlErr?.message ?? 'unknown',
    }, { status: 500 });
  }

  const buffer = Buffer.from(await blob.arrayBuffer());

  // RFC 5987 filename* encoding so non-ASCII filenames survive. Falls back
  // to a plain ASCII subset for the legacy `filename=`.
  const asciiName = submission.file_name.replace(/[^\x20-\x7E]+/g, '_');
  const encodedName = encodeURIComponent(submission.file_name);
  const disposition = `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': submission.mime_type || 'application/octet-stream',
      'Content-Disposition': disposition,
      'Content-Length': String(buffer.length),
      // Bytes are sensitive student work product - never let an intermediate
      // proxy or the browser cache them across sessions.
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}

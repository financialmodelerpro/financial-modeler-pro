import { NextRequest, NextResponse } from 'next/server';
import { buildPdfBuffer, type ExportPayload } from '@modeling/lib/exporters/pdf';
import { assertExportAllowed, payloadHasActiveProject } from '@/src/shared/entitlements/exportGuard';
import { resolveWatermarkForSession } from '@/src/shared/entitlements/watermarkServer';

/**
 * REFM Module 1 PDF export.
 *
 * Thin wrapper around `buildPdfBuffer()` from `@modeling/lib/exporters/pdf`.
 * The builder is extracted so a fixture script can call it directly without
 * spinning up the Next.js dev server (see `scripts/pdf-export-fixture.ts`).
 *
 * Lapse guard: export is denied for a read-only GRACE / LAPSED user (defense in
 * depth, the live app generates the file client-side and gates there too). Admin
 * and active plans pass. Returns null when allowed.
 */
export async function POST(req: NextRequest) {
  const denied = await assertExportAllowed();
  if (denied) return denied;

  // WATERMARK: REFUSED, NOT STAMPED.
  //
  // This is the one PDF path that is not pdf-lib. It renders through
  // @react-pdf/renderer, so the shared stamp cannot be applied to it, and
  // writing a second watermark implementation for a second PDF stack is
  // exactly the duplicated rule that goes out of step later. Nothing in the
  // app calls this endpoint (the live Module 1 export is client side), so the
  // honest resolution is that a plan which must be watermarked does not get an
  // export here at all rather than an unmarked one.
  const spec = await resolveWatermarkForSession();
  if (spec) {
    return NextResponse.json({
      error: 'This export route is not available on your plan. Use Export from inside the project.',
      code: 'WATERMARK_REQUIRED',
    }, { status: 403 });
  }

  const payload: ExportPayload = await req.json();
  // No active project: never emit an empty, numberless file.
  if (!payloadHasActiveProject(payload)) {
    return NextResponse.json({ error: 'No active project. Open a project before exporting.' }, { status: 400 });
  }
  const pdf = await buildPdfBuffer(payload);
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="REFM_Report.pdf"',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { buildPdfBuffer, type ExportPayload } from '@modeling/lib/exporters/pdf';
import { assertExportAllowed, payloadHasActiveProject } from '@/src/shared/entitlements/exportGuard';

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

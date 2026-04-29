import { NextRequest, NextResponse } from 'next/server';
import { buildPdfBuffer, type ExportPayload } from '@modeling/lib/exporters/pdf';

/**
 * REFM Module 1 PDF export.
 *
 * Thin wrapper around `buildPdfBuffer()` from `@modeling/lib/exporters/pdf`.
 * The builder is extracted so a fixture script can call it directly without
 * spinning up the Next.js dev server (see `scripts/pdf-export-fixture.ts`).
 */
export async function POST(req: NextRequest) {
  const payload: ExportPayload = await req.json();
  const pdf = await buildPdfBuffer(payload);
  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="REFM_Report.pdf"',
    },
  });
}

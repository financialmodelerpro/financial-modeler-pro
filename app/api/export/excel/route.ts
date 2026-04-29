import { NextRequest, NextResponse } from 'next/server';
import { buildWorkbook, type ExportPayload } from '@modeling/lib/exporters/excel';

/**
 * REFM Module 1 Excel export.
 *
 * Thin wrapper around `buildWorkbook()` from `@modeling/lib/exporters/excel`.
 * The builder is extracted so a fixture script can call it directly without
 * spinning up the Next.js dev server (see `scripts/excel-export-fixture.ts`).
 */
export async function POST(req: NextRequest) {
  const payload: ExportPayload = await req.json();
  const wb = buildWorkbook(payload);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="REFM_Export.xlsx"',
    },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { buildWorkbook, type ExportPayload } from '@modeling/lib/exporters/excel';
import { assertExportAllowed, payloadHasActiveProject } from '@/src/shared/entitlements/exportGuard';

/**
 * REFM Module 1 Excel export.
 *
 * Thin wrapper around `buildWorkbook()` from `@modeling/lib/exporters/excel`.
 * The builder is extracted so a fixture script can call it directly without
 * spinning up the Next.js dev server (see `scripts/excel-export-fixture.ts`).
 *
 * Lapse guard: export is denied for a read-only GRACE / LAPSED user (defense in
 * depth, the live app generates the file client-side and gates there too). Admin
 * and active plans pass.
 */
export async function POST(req: NextRequest) {
  const denied = await assertExportAllowed();
  if (denied) return denied;
  const payload: ExportPayload = await req.json();
  // No active project: never emit an empty, numberless file.
  if (!payloadHasActiveProject(payload)) {
    return NextResponse.json({ error: 'No active project. Open a project before exporting.' }, { status: 400 });
  }
  const wb = buildWorkbook(payload);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="REFM_Export.xlsx"',
    },
  });
}

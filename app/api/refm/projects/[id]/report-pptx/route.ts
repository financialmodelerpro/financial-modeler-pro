/**
 * /api/refm/projects/[id]/report-pptx (Module 7 Reports, Phase 3a)
 *
 * POST -> generate an editable .pptx for one report type and stream it back.
 *
 * Generated SERVER-SIDE because pptxgenjs imports node: built-ins (node:fs /
 * node:https) that cannot bundle into the browser. The client posts the
 * ALREADY-ASSEMBLED report model + report inputs + display scale (NO recompute:
 * the model is exactly what the preview renders); this route reconstructs the
 * same currency formatter (makeFmt) and hands the model to the shared
 * buildReportPptx exporter, so the deck mirrors the preview.
 *
 * Auth: NextAuth session required; ownership enforced via getProject. Snapshot
 * read-only, no engine call here.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { buildReportPptx } from '@/src/hubs/modeling/platforms/refm/lib/pptx/buildReportPptx';
import { makeFmt } from '@/src/hubs/modeling/platforms/refm/components/modules/_shared/numberFmt';
import type { DisplayScale, DisplayDecimals } from '@/src/core/formatters';
import { defaultReportInputs, normalizeAllSectionConfigs, type ReportType, type ReportInputs } from '@/src/hubs/modeling/platforms/refm/lib/reportInputs';

export const runtime = 'nodejs';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const VALID: ReportType[] = ['ic', 'lender', 'onepager'];

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const userId = await getRefmUserId();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { row, error } = await getProject(userId, id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const reportType = body.reportType as ReportType;
  if (!VALID.includes(reportType)) return NextResponse.json({ error: 'Invalid reportType' }, { status: 400 });

  const scale = (body.scale ?? 'thousands') as DisplayScale;
  const decimals = (Number.isFinite(body.decimals) ? body.decimals : 0) as DisplayDecimals;
  const fmt = makeFmt(scale, decimals);

  // Normalize inputs defensively (the section config drives which slides appear).
  const posted = (body.inputs ?? {}) as Partial<ReportInputs>;
  const inputs: ReportInputs = { ...defaultReportInputs(), ...posted, sectionConfig: normalizeAllSectionConfigs(posted.sectionConfig) };

  try {
    const pptx = buildReportPptx({
      reportType,
      projectName: typeof body.projectName === 'string' ? body.projectName : 'Report',
      inputs, fmt, currency: typeof body.currency === 'string' ? body.currency : 'SAR',
      asOf: typeof body.asOf === 'string' ? body.asOf : new Date().toISOString().slice(0, 10),
      ic: body.ic, lender: body.lender, onePager: body.onePager, scenarios: body.scenarios ?? null,
    });
    const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    const safe = (typeof body.projectName === 'string' ? body.projectName : 'Report').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'Report';
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': PPTX_MIME,
        'Content-Disposition': `attachment; filename="${safe}_${reportType}.pptx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

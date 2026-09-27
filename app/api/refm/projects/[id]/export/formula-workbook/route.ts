/**
 * /api/refm/projects/[id]/export/formula-workbook (2026-09-27)
 *
 * THE FORMULA-LINKED WORKBOOK, BUILT ON THE SERVER, FOR ONE ACCOUNT WHILE IT
 * IS BEING BUILT (founder's decision). See lib/excel/formulaExportAccess.ts.
 *
 *   GET  -> { allowed }: whether the Export dialog shows the option. Answers
 *           false for everybody but the preview account, and reveals nothing
 *           about the project.
 *   POST -> the .xlsx for a SAVED version (the latest when none is named).
 *           Refused (404, the same answer as a project that is not there)
 *           for any other account BEFORE any project data is read.
 *
 * Then the ordinary export rules: signed in, a member who may export the
 * project, not read-only or lapsed, the sensitivity grid only where the plan
 * opens it. A working draft cannot be exported this way: the preview builds
 * what is saved, which is what the proof measures.
 *
 * No em dashes in this file.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRefmUserContext } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { getProjectForAction, getVersionById, getLatestVersion } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { listParties } from '@/src/hubs/modeling/platforms/refm/lib/persistence/parties-server';
import { formulaExportAllowed } from '@/src/hubs/modeling/platforms/refm/lib/excel/formulaExportAccess';
import { savedVersionInputs } from '@/src/hubs/modeling/platforms/refm/lib/excel/savedVersionInputs';
import { generateFormulaWorkbookBuffer } from '@/src/hubs/modeling/platforms/refm/lib/excel/formulaWorkbook';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';
import { writeBlockReason, featureAllowed } from '@/src/shared/entitlements/gate';

export const runtime = 'nodejs';
export const maxDuration = 120;

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 });

export async function GET() {
  let userId: string | null = null;
  try { ({ userId } = await getRefmUserContext()); } catch { userId = null; }
  return NextResponse.json({ allowed: await formulaExportAllowed(userId) });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let userId: string | null = null, isAdmin = false;
  try { ({ userId, isAdmin } = await getRefmUserContext()); } catch { userId = null; }
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // THE PREVIEW GATE COMES FIRST: nothing about the project is read for anyone else.
  if (!(await formulaExportAllowed(userId))) return notFound();

  const { id: projectId } = await ctx.params;
  const gate = await resolveUserGate(userId, { sessionIsAdmin: isAdmin });
  const block = writeBlockReason(gate);
  if (block) return NextResponse.json({ error: 'Your subscription does not allow exports right now.', code: block }, { status: 403 });

  const { row: project, error: pErr } = await getProjectForAction(userId, projectId, 'canExport');
  if (pErr) return NextResponse.json({ error: pErr }, { status: 500 });
  if (!project) return notFound();

  let body: { versionId?: string | null; caseId?: string | null; displayScale?: 'full' | 'thousands' | 'millions'; displayDecimals?: 0 | 1 | 2; parts?: { inputs?: boolean; outputs?: boolean; schedules?: boolean } } = {};
  try { body = await req.json(); } catch { body = {}; }

  const { row: version, error: vErr } = body.versionId ? await getVersionById(projectId, body.versionId) : await getLatestVersion(projectId);
  if (vErr) return NextResponse.json({ error: vErr }, { status: 500 });
  if (!version) return NextResponse.json({ error: 'Save the project first: the live workbook is built from a saved version.' }, { status: 400 });

  const inputs = savedVersionInputs(version.snapshot, body.caseId ?? null);
  const parties = (await listParties(projectId)).rows ?? [];
  const projectName = inputs.projectName || project.name || 'Project';
  const dateLabel = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  const scale = body.displayScale === 'thousands' || body.displayScale === 'millions' ? body.displayScale : 'full';
  const decimals = body.displayDecimals === 1 || body.displayDecimals === 2 ? body.displayDecimals : 0;
  const buf = await generateFormulaWorkbookBuffer({
    state: inputs.state as never, projectName, dateLabel, displayScale: scale, displayDecimals: decimals,
    parts: body.parts, caseComparison: inputs.caseComparison as never, parties,
    includeSensitivity: featureAllowed(gate, 'sensitivity'),
  });
  const base = (version.label || version.version_label || projectName).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80) || 'project';
  return new NextResponse(buf, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}_Live_Model.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}

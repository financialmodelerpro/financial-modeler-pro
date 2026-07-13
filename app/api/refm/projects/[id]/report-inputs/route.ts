/**
 * /api/refm/projects/[id]/report-inputs (Module 7 Reports, migration 191)
 *
 *   GET -> the project's report inputs, or defaults (null) when none saved.
 *   PUT -> upsert the report inputs { executiveSummary, keyRisks, recommendation,
 *          disclaimers, headerText, footerText, fontBody, fontHeading, sectionConfig }.
 *
 * Auth: NextAuth session required. Ownership is enforced by first loading the
 * project via getProject(userId, id); a non-owner sees 404. Presentation only,
 * the model engine never reads this table.
 *
 * No em dashes in this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/src/hubs/modeling/platforms/refm/lib/persistence/server';
import { getReportInputs, upsertReportInputs } from '@/src/hubs/modeling/platforms/refm/lib/persistence/reportInputs-server';
import { getRefmUserId } from '@/src/hubs/modeling/platforms/refm/lib/persistence/auth';
import { defaultReportInputs, normalizeAllSectionConfigs, coerceNarrativeExtras, coerceICDeckCase, coerceICMoneyScale, type ReportInputs } from '@/src/hubs/modeling/platforms/refm/lib/reportInputs';

function unauthorized() { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
function notFound() { return NextResponse.json({ error: 'Not found' }, { status: 404 }); }
function serverError(msg: string) { return NextResponse.json({ error: msg }, { status: 500 }); }

async function requireOwnedProject(id: string): Promise<{ userId: string } | NextResponse> {
  const userId = await getRefmUserId();
  if (!userId) return unauthorized();
  const { row, error } = await getProject(userId, id);
  if (error) return serverError(error);
  if (!row) return notFound();
  return { userId };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;
  const { inputs, error } = await getReportInputs(id);
  if (error) return serverError(error);
  return NextResponse.json({ inputs });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const owned = await requireOwnedProject(id);
  if (owned instanceof NextResponse) return owned;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const d = defaultReportInputs();
  const inputs: ReportInputs = {
    executiveSummary: str(body.executiveSummary),
    keyRisks: str(body.keyRisks),
    recommendation: str(body.recommendation),
    disclaimers: str(body.disclaimers),
    securityCollateral: str(body.securityCollateral),
    covenantCommentary: str(body.covenantCommentary),
    thesisLine: str(body.thesisLine),
    ...coerceNarrativeExtras(body),
    headerText: str(body.headerText),
    footerText: str(body.footerText),
    fontBody: str(body.fontBody) || d.fontBody,
    fontHeading: str(body.fontHeading) || d.fontHeading,
    icDeckCase: coerceICDeckCase(body.icDeckCase),
    icMoneyScale: coerceICMoneyScale(body.icMoneyScale),
    sectionConfig: normalizeAllSectionConfigs(body.sectionConfig),
  };
  const { error } = await upsertReportInputs(id, inputs);
  if (error) return serverError(error);
  return NextResponse.json({ inputs });
}

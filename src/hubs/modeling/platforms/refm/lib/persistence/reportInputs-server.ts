/**
 * reportInputs-server.ts (REFM Module 7 Reports, migs 191 + 192 + 193)
 *
 * Server-side get/upsert for `refm_report_inputs` via the service-role client.
 * One row per project. Ownership is enforced at the route boundary (the route
 * first calls getProject(userId, id)); these helpers query strictly by
 * project_id. Reads tolerate the table AND newer columns being absent
 * (pre-migration) so the Reports tab renders with defaults and never crashes.
 *
 * Tiered column sets so a partially-migrated prod (191 only, or 191+192) still
 * reads/writes what it has: try FULL (191+192+193); on a missing-column error
 * step down to 192, then to the base 191 set. Newer narrative simply defaults
 * to empty until its migration is applied.
 *
 * No em dashes in this file.
 */

import { getServerClient } from '@/src/core/db/supabase';
import { normalizeAllSectionConfigs, coerceNarrativeExtras, coerceICDeckCase, coerceICMoneyScale, type ReportInputs } from '../reportInputs';

const COLS_BASE = 'project_id, executive_summary, key_risks, recommendation, disclaimers, header_text, footer_text, font_body, font_heading, section_config';
const COLS_192 = COLS_BASE + ', security_collateral, covenant_commentary, thesis_line';
const COLS_193 = COLS_192 + ', development_concept, key_gates, returns_commentary, exit_commentary, scenario_takeaway, next_steps, market_context, risks, regulatory_tax, conditions_precedent, exec_points';
const COLS_197 = COLS_193 + ', ic_deck_case, ic_money_scale';

function isMissingTable(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .*refm_report_inputs.* does not exist/i.test(err.message ?? '');
}
// Any undefined-column error (42703) steps down a tier. Broadened from the
// name-matched Phase 2 check so mig-193 columns also trigger the fallback.
function isMissingColumn(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42703' || /column .* does not exist/i.test(err.message ?? '');
}

interface Row {
  executive_summary: string | null;
  key_risks: string | null;
  recommendation: string | null;
  disclaimers: string | null;
  security_collateral?: string | null;
  covenant_commentary?: string | null;
  thesis_line?: string | null;
  development_concept?: string | null;
  key_gates?: string | null;
  returns_commentary?: string | null;
  exit_commentary?: string | null;
  scenario_takeaway?: string | null;
  next_steps?: string | null;
  market_context?: unknown;
  risks?: unknown;
  regulatory_tax?: unknown;
  conditions_precedent?: unknown;
  exec_points?: unknown;
  header_text: string | null;
  footer_text: string | null;
  font_body: string | null;
  font_heading: string | null;
  ic_deck_case?: string | null;
  ic_money_scale?: string | null;
  section_config: unknown;
}

function rowToInputs(row: Row): ReportInputs {
  const extras = coerceNarrativeExtras({
    developmentConcept: row.development_concept ?? '',
    keyGates: row.key_gates ?? '',
    returnsCommentary: row.returns_commentary ?? '',
    exitCommentary: row.exit_commentary ?? '',
    scenarioTakeaway: row.scenario_takeaway ?? '',
    nextSteps: row.next_steps ?? '',
    marketContext: row.market_context,
    risks: row.risks,
    regulatoryTax: row.regulatory_tax,
    conditionsPrecedent: row.conditions_precedent,
    execPoints: row.exec_points,
  });
  return {
    executiveSummary: row.executive_summary ?? '',
    keyRisks: row.key_risks ?? '',
    recommendation: row.recommendation ?? '',
    disclaimers: row.disclaimers ?? '',
    securityCollateral: row.security_collateral ?? '',
    covenantCommentary: row.covenant_commentary ?? '',
    thesisLine: row.thesis_line ?? '',
    ...extras,
    headerText: row.header_text ?? '',
    footerText: row.footer_text ?? '',
    fontBody: row.font_body ?? 'Calibri',
    fontHeading: row.font_heading ?? 'Cambria',
    icDeckCase: coerceICDeckCase(row.ic_deck_case),
    icMoneyScale: coerceICMoneyScale(row.ic_money_scale),
    sectionConfig: normalizeAllSectionConfigs(row.section_config),
  };
}

type Tier = 197 | 193 | 192 | 191;

function inputsToRow(inputs: ReportInputs, tier: Tier): Record<string, unknown> {
  const base: Record<string, unknown> = {
    executive_summary: inputs.executiveSummary ?? '',
    key_risks: inputs.keyRisks ?? '',
    recommendation: inputs.recommendation ?? '',
    disclaimers: inputs.disclaimers ?? '',
    header_text: inputs.headerText ?? '',
    footer_text: inputs.footerText ?? '',
    font_body: inputs.fontBody || 'Calibri',
    font_heading: inputs.fontHeading || 'Cambria',
    section_config: normalizeAllSectionConfigs(inputs.sectionConfig),
  };
  if (tier >= 192) {
    base.security_collateral = inputs.securityCollateral ?? '';
    base.covenant_commentary = inputs.covenantCommentary ?? '';
    base.thesis_line = inputs.thesisLine ?? '';
  }
  if (tier >= 193) {
    base.development_concept = inputs.developmentConcept ?? '';
    base.key_gates = inputs.keyGates ?? '';
    base.returns_commentary = inputs.returnsCommentary ?? '';
    base.exit_commentary = inputs.exitCommentary ?? '';
    base.scenario_takeaway = inputs.scenarioTakeaway ?? '';
    base.next_steps = inputs.nextSteps ?? '';
    base.market_context = inputs.marketContext ?? {};
    base.risks = inputs.risks ?? [];
    base.regulatory_tax = inputs.regulatoryTax ?? [];
    base.conditions_precedent = inputs.conditionsPrecedent ?? [];
    base.exec_points = inputs.execPoints ?? [];
  }
  if (tier >= 197) {
    base.ic_deck_case = coerceICDeckCase(inputs.icDeckCase);
    base.ic_money_scale = coerceICMoneyScale(inputs.icMoneyScale);
  }
  return base;
}

/** Returns the stored inputs, or null when none exist yet / the table is absent. */
export async function getReportInputs(projectId: string): Promise<{ inputs: ReportInputs | null; error: string | null }> {
  const sb = getServerClient();
  const query = (cols: string) => sb.from('refm_report_inputs').select(cols).eq('project_id', projectId).maybeSingle();
  let { data, error } = await query(COLS_197);
  if (error && isMissingColumn(error)) ({ data, error } = await query(COLS_193)); // pre-mig-197
  if (error && isMissingColumn(error)) ({ data, error } = await query(COLS_192)); // pre-mig-193
  if (error && isMissingColumn(error)) ({ data, error } = await query(COLS_BASE)); // pre-mig-192
  if (error) {
    if (isMissingTable(error)) return { inputs: null, error: null }; // pre-migration: defaults, no crash
    return { inputs: null, error: error.message };
  }
  if (!data) return { inputs: null, error: null };
  return { inputs: rowToInputs(data as unknown as Row), error: null };
}

/** Upsert the single per-project row. */
export async function upsertReportInputs(projectId: string, inputs: ReportInputs): Promise<{ error: string | null }> {
  const sb = getServerClient();
  const write = async (tier: Tier) => {
    const row = { project_id: projectId, ...inputsToRow(inputs, tier), updated_at: new Date().toISOString() };
    return sb.from('refm_report_inputs').upsert(row, { onConflict: 'project_id' });
  };
  let { error } = await write(197);
  if (error && isMissingColumn(error)) ({ error } = await write(193)); // pre-mig-197
  if (error && isMissingColumn(error)) ({ error } = await write(192)); // pre-mig-193
  if (error && isMissingColumn(error)) ({ error } = await write(191)); // pre-mig-192
  if (error) {
    if (isMissingTable(error)) {
      return { error: 'Report inputs are not saved yet: migration 191 (refm_report_inputs) has not been applied. Ask an admin to apply it.' };
    }
    return { error: error.message };
  }
  return { error: null };
}

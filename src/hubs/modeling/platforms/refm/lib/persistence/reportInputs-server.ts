/**
 * reportInputs-server.ts (REFM Module 7 Reports, mig 191 + 192)
 *
 * Server-side get/upsert for `refm_report_inputs` via the service-role client.
 * One row per project. Ownership is enforced at the route boundary (the route
 * first calls getProject(userId, id)); these helpers query strictly by
 * project_id. Reads tolerate the table AND the Phase 2 columns being absent
 * (pre-migration) so the Reports tab renders with defaults and never crashes.
 *
 * No em dashes in this file.
 */

import { getServerClient } from '@/src/core/db/supabase';
import { normalizeAllSectionConfigs, type ReportInputs } from '../reportInputs';

// Phase 2 columns (security_collateral / covenant_commentary / thesis_line) are
// requested explicitly; if the table predates mig 192 the select errors with an
// undefined-column code and we retry with the base (mig 191) column set.
const COLS_FULL = 'project_id, executive_summary, key_risks, recommendation, disclaimers, security_collateral, covenant_commentary, thesis_line, header_text, footer_text, font_body, font_heading, section_config';
const COLS_BASE = 'project_id, executive_summary, key_risks, recommendation, disclaimers, header_text, footer_text, font_body, font_heading, section_config';

function isMissingTable(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .*refm_report_inputs.* does not exist/i.test(err.message ?? '');
}
function isMissingColumn(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42703' || /column .*(security_collateral|covenant_commentary|thesis_line).* does not exist/i.test(err.message ?? '');
}

interface Row {
  executive_summary: string | null;
  key_risks: string | null;
  recommendation: string | null;
  disclaimers: string | null;
  security_collateral?: string | null;
  covenant_commentary?: string | null;
  thesis_line?: string | null;
  header_text: string | null;
  footer_text: string | null;
  font_body: string | null;
  font_heading: string | null;
  section_config: unknown;
}

function rowToInputs(row: Row): ReportInputs {
  return {
    executiveSummary: row.executive_summary ?? '',
    keyRisks: row.key_risks ?? '',
    recommendation: row.recommendation ?? '',
    disclaimers: row.disclaimers ?? '',
    securityCollateral: row.security_collateral ?? '',
    covenantCommentary: row.covenant_commentary ?? '',
    thesisLine: row.thesis_line ?? '',
    headerText: row.header_text ?? '',
    footerText: row.footer_text ?? '',
    fontBody: row.font_body ?? 'Calibri',
    fontHeading: row.font_heading ?? 'Cambria',
    sectionConfig: normalizeAllSectionConfigs(row.section_config),
  };
}

function inputsToRow(inputs: ReportInputs, includePhase2: boolean): Record<string, unknown> {
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
  if (includePhase2) {
    base.security_collateral = inputs.securityCollateral ?? '';
    base.covenant_commentary = inputs.covenantCommentary ?? '';
    base.thesis_line = inputs.thesisLine ?? '';
  }
  return base;
}

/** Returns the stored inputs, or null when none exist yet / the table is absent. */
export async function getReportInputs(projectId: string): Promise<{ inputs: ReportInputs | null; error: string | null }> {
  const sb = getServerClient();
  const query = (cols: string) => sb.from('refm_report_inputs').select(cols).eq('project_id', projectId).maybeSingle();
  let { data, error } = await query(COLS_FULL);
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
  const write = async (includePhase2: boolean) => {
    const row = { project_id: projectId, ...inputsToRow(inputs, includePhase2), updated_at: new Date().toISOString() };
    return sb.from('refm_report_inputs').upsert(row, { onConflict: 'project_id' });
  };
  let { error } = await write(true);
  if (error && isMissingColumn(error)) ({ error } = await write(false)); // pre-mig-192: save shared fields, skip Phase 2 narrative
  if (error) {
    if (isMissingTable(error)) {
      return { error: 'Report inputs are not saved yet: migration 191 (refm_report_inputs) has not been applied. Ask an admin to apply it.' };
    }
    return { error: error.message };
  }
  return { error: null };
}

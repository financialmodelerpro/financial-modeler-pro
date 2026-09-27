/**
 * liveExportInputs.ts (2026-09-27)
 *
 * The live project's export inputs, assembled EXACTLY as the Export modal's
 * saved-version path assembles them: the latest saved version loaded through
 * the store (`loadStoredModel`), the version's own active case, the case
 * comparison bundle, and the parties from their own table. Shared by
 * regenerate-exports.ts and verify-formula-workbook.ts so both build the same
 * workbook from the same state.
 *
 * No em dashes in this file.
 */
import { createClient } from '@supabase/supabase-js';
import { loadStoredModel } from '../../src/hubs/modeling/platforms/refm/lib/state/loadStoredModel';
import { savedVersionInputs } from '../../src/hubs/modeling/platforms/refm/lib/excel/savedVersionInputs';
import type { computeFinancialsSnapshot } from '../../src/hubs/modeling/platforms/refm/lib/financials-resolvers';
import type { BuildModelOptions } from '../../src/hubs/modeling/platforms/refm/lib/excel/buildModelWorkbook';
import { LIVE_PROJECT_ID } from './liveProject';

export interface LiveExportInputs {
  projectName: string;
  versionLabel: string | null;
  versionComment: string | null;
  state: Parameters<typeof computeFinancialsSnapshot>[0];
  caseComparison: BuildModelOptions['caseComparison'];
  parties: BuildModelOptions['parties'];
  /** The migrated snapshot the state was made from, for a test that edits an input and re-runs the platform. */
  snapshot: ReturnType<typeof loadStoredModel>['snapshot'];
}

export async function loadLiveExportInputs(): Promise<LiveExportInputs> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('no credentials: run with --env-file=.env.local');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: projRows, error: projErr } = await sb.from('refm_projects').select('id, name').eq('id', LIVE_PROJECT_ID).limit(1);
  if (projErr) throw new Error(`project read: ${projErr.message}`);
  if (!projRows?.length) throw new Error('project not found (deleted or purged?)');
  const { data: verRows, error: verErr } = await sb.from('refm_project_versions').select('snapshot, label, comment')
    .eq('project_id', LIVE_PROJECT_ID).order('created_at', { ascending: false }).limit(1);
  if (verErr) throw new Error(`version read: ${verErr.message}`);
  if (!verRows?.length) throw new Error('no saved version');
  const v = verRows[0] as { snapshot: unknown; label: string | null; comment: string | null };
  // THE SAME ASSEMBLY the Export dialog and the live workbook's route use.
  const { migrated, state: st, caseComparison: cc } = savedVersionInputs(v.snapshot);
  const state = st as LiveExportInputs['state'];
  const caseComparison = cc as BuildModelOptions['caseComparison'];
  const { data: partyRows } = await sb.from('refm_parties').select('*').eq('project_id', LIVE_PROJECT_ID);
  return {
    projectName: (projRows[0] as { name: string }).name,
    versionLabel: v.label, versionComment: v.comment,
    state, caseComparison, parties: (partyRows ?? []) as BuildModelOptions['parties'], snapshot: migrated,
  };
}

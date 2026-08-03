/**
 * fundTerms-server.ts (REFM fund layer Step 2, migration 208)
 *
 * Server-side read/write for `refm_fund_terms` via the service-role client.
 * Ownership is enforced at the route boundary (the route calls
 * getProject(userId, id) first), matching the REFM convention that the
 * application layer is the access boundary; these helpers query strictly by
 * project_id.
 *
 * ONE ROW PER PROJECT, so a write is an upsert on the primary key rather than
 * an insert-or-update dance.
 *
 * SCHEMA TOLERANCE IS LOAD-BEARING HERE. Migration 208 is written but not yet
 * applied, and the platform convention is that prod lags the repo. A missing
 * table therefore reports `available: false` with the DEFAULT terms rather than
 * an error: the Fund Terms tab still renders and still edits the snapshot copy
 * that the engine will read, it simply cannot persist to the table yet and says
 * so. Nothing depends on the migration having been applied.
 *
 * No em dashes in this file.
 */

import { getServerClient } from '@/src/core/db/supabase';
import { DEFAULT_FUND_TERMS, fromRow, toRow, type FundTerms } from '../fundTerms';

const COLS = 'fund_enabled, management_fee_pct, fee_base, hurdle_rate_pct, carry_pct, committed_capital, fee_shares';

const MIGRATION_HINT =
  'Fund terms cannot be saved yet (migration 208_refm_fund_terms.sql has not been applied). Your entries stay with the project version you save.';

function isMissingTable(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .*refm_fund_terms.* does not exist/i.test(err.message ?? '');
}

/**
 * The project's saved fund terms.
 *
 * `saved: false` means the project has no row yet (never opened the tab), which
 * is every project that exists today, and the caller gets the standalone
 * defaults. `available: false` means migration 208 is outstanding.
 */
export async function getFundTerms(projectId: string): Promise<{
  terms: FundTerms; saved: boolean; available: boolean; error: string | null;
}> {
  const sb = getServerClient();
  const { data, error } = await sb.from('refm_fund_terms').select(COLS).eq('project_id', projectId).maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { terms: { ...DEFAULT_FUND_TERMS, feeShares: [] }, saved: false, available: false, error: null };
    return { terms: { ...DEFAULT_FUND_TERMS, feeShares: [] }, saved: false, available: true, error: error.message };
  }
  if (!data) return { terms: { ...DEFAULT_FUND_TERMS, feeShares: [] }, saved: false, available: true, error: null };
  return { terms: fromRow(data as never), saved: true, available: true, error: null };
}

/**
 * Write the project's fund terms. The caller passes ALREADY RESOLVED terms, so
 * every value has been range-clamped by `resolveFundTerms` before it reaches
 * the database and the CHECK constraints in migration 208 are a backstop rather
 * than the first line of defence.
 */
export async function upsertFundTerms(projectId: string, terms: FundTerms): Promise<{ error: string | null; available: boolean }> {
  const sb = getServerClient();
  const { error } = await sb
    .from('refm_fund_terms')
    .upsert({ project_id: projectId, ...toRow(terms), updated_at: new Date().toISOString() }, { onConflict: 'project_id' });

  if (error) {
    if (isMissingTable(error)) return { error: MIGRATION_HINT, available: false };
    return { error: error.message, available: true };
  }
  return { error: null, available: true };
}

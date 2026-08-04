/**
 * fundTerms-server.ts (REFM fund layer Step 2, migrations 208 + 209)
 *
 * Server-side read/write for `refm_fund_terms` via the service-role client.
 * Ownership is enforced at the route boundary (the route calls
 * getProject(userId, id) first), matching the REFM convention that the
 * application layer is the access boundary; these helpers query strictly by
 * project_id.
 *
 * ONE ROW PER PROJECT, so a write is an upsert on the primary key.
 *
 * TWO-TIER COLUMN PROBE, which is the part to understand before editing.
 * Migration 208 is applied; 209 (the extended fee set and the distribution
 * matrix) may not be. A fixed column list would therefore 42703 the moment the
 * repo moved ahead of prod, taking Module 1 down. So a read tries the FULL
 * column set first and falls back to the 208 set on "column does not exist",
 * caching the answer per process, exactly as server.ts does for the migration
 * 153 columns. A write mirrors it: the full row first, the legacy subset on
 * fallback.
 *
 * What that means for the user before 209 is applied: the new fields do not
 * persist to the TABLE, but they still ride in the version snapshot, which is
 * what the engine reads from Step 3. Nothing is lost and nothing breaks.
 *
 * A missing TABLE (neither migration applied) reports `available: false` with
 * the standalone defaults, so the tab renders and says it cannot persist yet.
 *
 * No em dashes in this file.
 */

import { getServerClient } from '@/src/core/db/supabase';
import { DEFAULT_FUND_TERMS, fromRow, toRow, toLegacyRow, type FundTerms } from '../fundTerms';

/** Migration 208 columns: the floor every applied database has. */
const COLS_BASE = 'fund_enabled, management_fee_pct, fee_base, hurdle_rate_pct, carry_pct, committed_capital, fee_shares';
/** Migration 209 additions. */
const COLS_209 = 'fund_size, facility_limit, fund_structure_fee_pct, fund_management_fee_pct, custody_admin_fee_pct, debt_arranging_fee_pct, other_expenses_per_annum, fee_distribution';
const COLS_FULL = `${COLS_BASE}, ${COLS_209}`;

/** Cached after the first successful query so each request does not re-probe.
 *  undefined = unknown, true = 209 applied, false = fall back to the 208 set. */
let extendedApplied: boolean | undefined;

/** Test seam: reset the cached probe. */
export function resetFundTermsSchemaProbe(): void { extendedApplied = undefined; }

function isMissingTable(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  return err.code === '42P01' || /relation .*refm_fund_terms.* does not exist/i.test(err.message ?? '');
}

function isMissingColumn(err: { code?: string | null; message?: string | null } | null): boolean {
  if (!err) return false;
  if (err.code === '42703' || err.code === 'PGRST204') return true;
  const m = err.message ?? '';
  if (/column .* does not exist/i.test(m)) return true;
  if (/could not find the .* column/i.test(m)) return true;
  return /(fund_size|facility_limit|fund_structure_fee_pct|fund_management_fee_pct|custody_admin_fee_pct|debt_arranging_fee_pct|other_expenses_per_annum|fee_distribution)/.test(m);
}

const defaults = (): FundTerms => ({ ...DEFAULT_FUND_TERMS, feeDistribution: [], feeShares: [] });

/**
 * The project's saved fund terms.
 *
 * `saved: false` means the project has no row yet, which is every project that
 * has never opened the tab, and the caller gets standalone defaults.
 * `available: false` means the TABLE is absent (migration 208 outstanding).
 * `extended: false` means 209 is outstanding, so the extended fee fields could
 * not be read from the table; the tab shows them from the snapshot instead.
 */
export async function getFundTerms(projectId: string): Promise<{
  terms: FundTerms; saved: boolean; available: boolean; extended: boolean; error: string | null;
}> {
  const sb = getServerClient();

  if (extendedApplied !== false) {
    const full = await sb.from('refm_fund_terms').select(COLS_FULL).eq('project_id', projectId).maybeSingle();
    if (!full.error) {
      extendedApplied = true;
      if (!full.data) return { terms: defaults(), saved: false, available: true, extended: true, error: null };
      return { terms: fromRow(full.data as never), saved: true, available: true, extended: true, error: null };
    }
    if (isMissingTable(full.error)) return { terms: defaults(), saved: false, available: false, extended: false, error: null };
    if (!isMissingColumn(full.error)) return { terms: defaults(), saved: false, available: true, extended: true, error: full.error.message };
    extendedApplied = false;   // 209 not applied: fall through to the 208 set
  }

  const base = await sb.from('refm_fund_terms').select(COLS_BASE).eq('project_id', projectId).maybeSingle();
  if (base.error) {
    if (isMissingTable(base.error)) return { terms: defaults(), saved: false, available: false, extended: false, error: null };
    return { terms: defaults(), saved: false, available: true, extended: false, error: base.error.message };
  }
  if (!base.data) return { terms: defaults(), saved: false, available: true, extended: false, error: null };
  return { terms: fromRow(base.data as never), saved: true, available: true, extended: false, error: null };
}

/**
 * Write the project's fund terms. The caller passes ALREADY RESOLVED terms, so
 * every value has been range-clamped before it reaches the database and the
 * CHECK constraints are a backstop rather than the first line of defence.
 */
export async function upsertFundTerms(projectId: string, terms: FundTerms): Promise<{
  error: string | null; available: boolean; extended: boolean;
}> {
  const sb = getServerClient();
  const stamp = new Date().toISOString();

  if (extendedApplied !== false) {
    const full = await sb
      .from('refm_fund_terms')
      .upsert({ project_id: projectId, ...toRow(terms), updated_at: stamp }, { onConflict: 'project_id' });
    if (!full.error) { extendedApplied = true; return { error: null, available: true, extended: true }; }
    if (isMissingTable(full.error)) {
      return { error: 'Fund terms cannot be saved yet (migration 208_refm_fund_terms.sql has not been applied). Your entries stay with the project version you save.', available: false, extended: false };
    }
    if (!isMissingColumn(full.error)) return { error: full.error.message, available: true, extended: true };
    extendedApplied = false;
  }

  // 209 outstanding: persist what the table can hold. The extended fields still
  // travel in the version snapshot, so nothing the user typed is lost.
  const base = await sb
    .from('refm_fund_terms')
    .upsert({ project_id: projectId, ...toLegacyRow(terms), updated_at: stamp }, { onConflict: 'project_id' });
  if (base.error) {
    if (isMissingTable(base.error)) {
      return { error: 'Fund terms cannot be saved yet (migration 208_refm_fund_terms.sql has not been applied). Your entries stay with the project version you save.', available: false, extended: false };
    }
    return { error: base.error.message, available: true, extended: false };
  }
  return { error: null, available: true, extended: false };
}

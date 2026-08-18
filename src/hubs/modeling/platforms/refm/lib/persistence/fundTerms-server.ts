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
import { DEFAULT_FUND_TERMS, fromRow, toRow, toRow211, toRow210, toRow209, toLegacyRow, type FundTerms } from '../fundTerms';

/** Migration 208 columns: the floor every applied database has. */
const COLS_BASE = 'fund_enabled, management_fee_pct, fee_base, hurdle_rate_pct, carry_pct, committed_capital, fee_shares';
/** Migration 209 additions. */
const COLS_209 = 'fund_size, facility_limit, fund_structure_fee_pct, fund_management_fee_pct, custody_admin_fee_pct, debt_arranging_fee_pct, other_expenses_per_annum, fee_distribution';
/** Migration 210 additions: the Fund Manager name + the facility-limit override. */
const COLS_210 = 'fund_manager_name, facility_limit_override';
/** Migration 211 addition: the fund-size override. */
const COLS_211 = 'fund_size_override';
/** Migration 215 addition: how the management fee is funded. */
const COLS_215 = 'management_fee_funding';
const COLS_FULL = `${COLS_BASE}, ${COLS_209}, ${COLS_210}, ${COLS_211}, ${COLS_215}`;
/** The 208 through 211 set, for a database where 215 is outstanding. */
const COLS_211_ONLY = `${COLS_BASE}, ${COLS_209}, ${COLS_210}, ${COLS_211}`;
/** The 208 + 209 + 210 set, for a database where 211 is outstanding. */
const COLS_210_ONLY = `${COLS_BASE}, ${COLS_209}, ${COLS_210}`;
/** The 208 + 209 set, for a database where 210 is outstanding. */
const COLS_209_ONLY = `${COLS_BASE}, ${COLS_209}`;

/**
 * Which column set this database actually has, cached after the first
 * successful query so each request does not re-probe. Four tiers now, because
 * 211 (the fund-size override) can lag 210 exactly as 210 lagged 209.
 *
 *   211 = everything, 210 = through the Fund Manager, 209 = through the
 *   distribution matrix, 208 = the original set. `undefined` = not yet probed;
 *   the read starts at the top and steps down on "column does not exist".
 *
 * Whatever a lower tier cannot hold still rides in the version snapshot, which
 * is what the ENGINE reads, so the fund size stays model-derived even on a
 * database where 211 is outstanding.
 */
type SchemaTier = 208 | 209 | 210 | 211 | 215;
let schemaTier: SchemaTier | undefined;

/** Test seam: reset the cached probe. */
export function resetFundTermsSchemaProbe(): void { schemaTier = undefined; }

const COLS_FOR: Record<SchemaTier, string> = { 215: COLS_FULL, 211: COLS_211_ONLY, 210: COLS_210_ONLY, 209: COLS_209_ONLY, 208: COLS_BASE };
const ROW_FOR: Record<SchemaTier, (t: FundTerms) => Record<string, unknown>> = {
  215: (t) => toRow(t) as unknown as Record<string, unknown>,
  211: (t) => toRow211(t) as unknown as Record<string, unknown>,
  210: (t) => toRow210(t) as unknown as Record<string, unknown>,
  209: (t) => toRow209(t) as unknown as Record<string, unknown>,
  208: (t) => toLegacyRow(t) as unknown as Record<string, unknown>,
};
/** Highest first: the read and the write both walk down this list. */
const TIERS: SchemaTier[] = [215, 211, 210, 209, 208];

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
  return /(fund_size|facility_limit|fund_structure_fee_pct|fund_management_fee_pct|custody_admin_fee_pct|debt_arranging_fee_pct|other_expenses_per_annum|fee_distribution|fund_manager_name|facility_limit_override|fund_size_override|management_fee_funding)/.test(m);
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
  // Start at the cached tier when known, else probe from the top down.
  const start = schemaTier ? TIERS.indexOf(schemaTier) : 0;

  for (let i = start; i < TIERS.length; i++) {
    const tier = TIERS[i];
    const res = await sb.from('refm_fund_terms').select(COLS_FOR[tier]).eq('project_id', projectId).maybeSingle();
    if (!res.error) {
      schemaTier = tier;
      const extended = tier >= 209;
      if (!res.data) return { terms: defaults(), saved: false, available: true, extended, error: null };
      return { terms: fromRow(res.data as never), saved: true, available: true, extended, error: null };
    }
    if (isMissingTable(res.error)) return { terms: defaults(), saved: false, available: false, extended: false, error: null };
    // A missing COLUMN means this tier is ahead of the database: step down.
    if (!isMissingColumn(res.error)) {
      return { terms: defaults(), saved: false, available: true, extended: tier >= 209, error: res.error.message };
    }
  }
  return { terms: defaults(), saved: false, available: true, extended: false, error: null };
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
  const MISSING_TABLE = 'Fund terms cannot be saved yet (migration 208_refm_fund_terms.sql has not been applied). Your entries stay with the project version you save.';
  const start = schemaTier ? TIERS.indexOf(schemaTier) : 0;

  // Walk down the tiers, writing the widest row the database will accept.
  // Whatever a lower tier cannot hold still travels in the version snapshot,
  // which is what the engine reads, so nothing the user typed is lost.
  for (let i = start; i < TIERS.length; i++) {
    const tier = TIERS[i];
    const res = await sb
      .from('refm_fund_terms')
      .upsert({ project_id: projectId, ...ROW_FOR[tier](terms), updated_at: stamp }, { onConflict: 'project_id' });
    if (!res.error) { schemaTier = tier; return { error: null, available: true, extended: tier >= 209 }; }
    if (isMissingTable(res.error)) return { error: MISSING_TABLE, available: false, extended: false };
    if (!isMissingColumn(res.error)) return { error: res.error.message, available: true, extended: tier >= 209 };
  }
  return { error: MISSING_TABLE, available: false, extended: false };
}

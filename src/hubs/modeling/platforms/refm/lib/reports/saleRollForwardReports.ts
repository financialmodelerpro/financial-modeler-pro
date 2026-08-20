/**
 * saleRollForwardReports.ts (2026-08-20, restructure Step 5)
 *
 * THREE ROLL-FORWARDS THE MODEL ALREADY COMPUTES AND NEVER SHOWED.
 *
 *   Inventory   opening unsold + sold = closing unsold
 *   Receivables opening + contracted - collected = closing
 *   Unearned    opening + contracted - recognised = closing
 *
 * The last two have existed in `src/core/calculations/revenue/` since the
 * engine was built and match the reference model formula for formula; they
 * simply had no dedicated presentation, so a reader could see the balance
 * sheet move without being able to see why. The first is the one quantity the
 * diagnosis found genuinely missing: nothing tracked unsold AREA as a balance.
 *
 * EACH CARRIES A CHECK ROW, because a roll-forward with no check is a set of
 * numbers a reader has to add up themselves, and the reference carries one on
 * every one of these.
 *
 * ── WHAT THIS FILE DOES NOT DO ───────────────────────────────────────────────
 *
 * It computes no schedule. Inventory is a running difference of series the
 * engine produced; receivables and unearned are read from the engine's own
 * results verbatim. The only arithmetic here is the check itself, which has to
 * be done here or it would be three separate opinions on the same identity.
 *
 * `totalIsBalance` is set on every opening and closing row. That flag exists
 * because a formatted total string cannot say whether it is a lifetime sum or
 * a point-in-time balance, and a closing balance printed under a heading that
 * says "Total" is how the balance sheet once contradicted the P&L in one
 * document.
 *
 * No em dashes in this file.
 */

import type { M4Row } from '../../components/modules/_shared/m4Table';

export interface RollForwardTable {
  title: string;
  /** One sentence stating the identity, so a reader can check it by eye. */
  caption: string;
  rows: M4Row[];
  /** Worst absolute residue across the horizon. Zero on a correct model. */
  worstResidue: number;
  ok: boolean;
}

/** A cent in model units. Below this is float noise, not a defect. */
const TOL = 0.005;

const zeros = (n: number): number[] => new Array<number>(n).fill(0);

/** Opening from closing: opening[0] = 0, opening[t] = closing[t-1]. */
function openingFrom(closing: readonly number[], n: number): number[] {
  const out = zeros(n);
  for (let t = 1; t < n; t++) out[t] = closing[t - 1] ?? 0;
  return out;
}

function finish(
  title: string, caption: string, rows: M4Row[], residues: number[],
): RollForwardTable {
  const worstResidue = residues.reduce((w, v) => (Math.abs(v) > Math.abs(w) ? v : w), 0);
  return {
    title,
    caption,
    rows: [...rows, {
      label: 'Check (must be zero)',
      values: residues,
      isSubtotal: true,
      totalOverride: Math.abs(worstResidue) < TOL ? '0.00' : worstResidue.toFixed(2),
      totalIsBalance: true,
    }],
    worstResidue,
    ok: Math.abs(worstResidue) < TOL,
  };
}

/**
 * CLOSING INVENTORY, the unsold balance.
 *
 * The one quantity the Module 2 diagnosis found genuinely missing: inventory
 * existed only as a VALUE (cumulative capex less cumulative cost of sales),
 * never as the area or unit count still unsold. Every ingredient was already
 * inside the sell engine.
 *
 * Identity: opening unsold - sold in the year = closing unsold.
 */
export function buildInventoryRollForward(
  totalInventory: number,
  soldPerPeriod: readonly number[],
  axisLength: number,
  unitLabel: string,
): RollForwardTable {
  const n = Math.max(0, axisLength);
  const sold = zeros(n);
  for (let t = 0; t < n; t++) sold[t] = soldPerPeriod[t] ?? 0;

  const closing = zeros(n);
  let running = totalInventory;
  for (let t = 0; t < n; t++) { running -= sold[t]; closing[t] = running; }
  const opening = zeros(n);
  for (let t = 0; t < n; t++) opening[t] = t === 0 ? totalInventory : closing[t - 1];

  const residues = zeros(n);
  for (let t = 0; t < n; t++) residues[t] = opening[t] - sold[t] - closing[t];

  return finish(
    `Inventory Roll-Forward (unsold ${unitLabel})`,
    `Opening unsold less sold in the year = closing unsold. Opening in the first year is the asset's total ${unitLabel}; closing in the last year is what remains unsold at the end of the model.`,
    [
      { label: 'Opening unsold', values: opening, totalIsBalance: true },
      { label: 'Sold in year', values: sold.map((v) => -v), indent: 1 },
      { label: 'Closing unsold', values: closing, isTotal: true, totalIsBalance: true },
    ],
    residues,
  );
}

/**
 * RECEIVABLES. Reads the engine's own `buildAccountsReceivable` verbatim.
 * Identity: opening + pre-sales contracted - cash received = closing.
 */
export function buildReceivablesRollForward(
  ar: {
    perPeriod?: number[];
    openingPerPeriod?: number[];
    contractedPerPeriod?: number[];
    cashPerPeriod?: number[];
  },
  contracted: readonly number[],
  collected: readonly number[],
  axisLength: number,
  /** Closing less opening, which drives the cash-flow working-capital delta.
   *  Optional so a surface that has no use for it can omit the row. */
  change?: readonly number[],
): RollForwardTable {
  const n = Math.max(0, axisLength);
  const closing = zeros(n);
  for (let t = 0; t < n; t++) closing[t] = (ar.perPeriod ?? [])[t] ?? 0;
  const opening = ar.openingPerPeriod && ar.openingPerPeriod.length === n
    ? ar.openingPerPeriod.slice()
    : openingFrom(closing, n);

  const add = zeros(n); const less = zeros(n); const residues = zeros(n);
  for (let t = 0; t < n; t++) {
    add[t] = contracted[t] ?? 0;
    less[t] = collected[t] ?? 0;
    residues[t] = opening[t] + add[t] - less[t] - closing[t];
  }

  return finish(
    'Receivables Roll-Forward (pre-sales)',
    'Opening plus sales contracted in the year less cash collected = closing. The closing balance is what buyers still owe on cohorts already sold.',
    [
      { label: 'Opening receivable', values: opening, totalIsBalance: true },
      { label: 'Add: sales contracted', values: add, indent: 1 },
      { label: 'Less: cash collected', values: less.map((v) => -v), indent: 1 },
      ...(change ? [{ label: 'Change in receivable (cash flow delta)', values: change.slice(0, n), isSubtotal: true }] : []),
      { label: 'Closing receivable', values: closing, isTotal: true, totalIsBalance: true },
    ],
    residues,
  );
}

/**
 * UNEARNED REVENUE. Reads the engine's own `buildUnearnedRevenue` verbatim.
 * Identity: opening + pre-sales contracted - revenue recognised = closing.
 *
 * Deliberately driven by the contracted OBLIGATION rather than by cash, which
 * is what lets this and receivables share one gross credit. That is the
 * engine's own long-standing decision, not a presentation choice made here.
 */
export function buildUnearnedRollForward(
  unearned: { perPeriod?: number[]; openingPerPeriod?: number[] },
  contracted: readonly number[],
  recognised: readonly number[],
  axisLength: number,
  change?: readonly number[],
): RollForwardTable {
  const n = Math.max(0, axisLength);
  const closing = zeros(n);
  for (let t = 0; t < n; t++) closing[t] = (unearned.perPeriod ?? [])[t] ?? 0;
  const opening = unearned.openingPerPeriod && unearned.openingPerPeriod.length === n
    ? unearned.openingPerPeriod.slice()
    : openingFrom(closing, n);

  const add = zeros(n); const less = zeros(n); const residues = zeros(n);
  for (let t = 0; t < n; t++) {
    add[t] = contracted[t] ?? 0;
    less[t] = recognised[t] ?? 0;
    residues[t] = opening[t] + add[t] - less[t] - closing[t];
  }

  return finish(
    'Unearned Revenue Roll-Forward (pre-sales)',
    'Opening plus sales contracted in the year less revenue recognised = closing. The closing balance is value sold but not yet earned.',
    [
      { label: 'Opening unearned', values: opening, totalIsBalance: true },
      { label: 'Add: sales contracted', values: add, indent: 1 },
      { label: 'Less: revenue recognised', values: less.map((v) => -v), indent: 1 },
      ...(change ? [{ label: 'Change in unearned (cash flow delta)', values: change.slice(0, n), isSubtotal: true }] : []),
      { label: 'Closing unearned', values: closing, isTotal: true, totalIsBalance: true },
    ],
    residues,
  );
}

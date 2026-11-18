/**
 * exitSettlement.ts (2026-11-18, founder): THE BALANCE SHEET CLOSES TO ZERO AT THE EXIT.
 *
 * In the exit year every working-capital balance is settled in cash: receivables (operating and residential)
 * are collected, payables are paid and the year's zakat or tax is paid, so the cash reaches the exit
 * distribution and nothing but equity is left after it. One rule for every balance:
 *
 *   balance'[t] = 0 from the exit year on (the original before it);
 *   change'[t]  = balance'[t] - balance'[t-1];
 *   cash'[t]    = cash[t] + change[t] - change'[t]
 *
 * which holds for an asset (cash received = flow - change) and a liability (cash paid = flow - change) alike,
 * so the direct and the indirect cash flows move by the same amount. No em dashes in this file.
 */
export interface SettledBalance { perPeriod: number[]; changePerPeriod: number[]; cash: number[] }

export function settleAtExit(
  balance: readonly number[],
  change: readonly number[],
  cash: readonly number[],
  exitIdx: number | undefined,
): SettledBalance {
  const n = balance.length;
  if (exitIdx === undefined || exitIdx < 0 || exitIdx >= n) {
    return { perPeriod: [...balance], changePerPeriod: [...change], cash: [...cash] };
  }
  const per = balance.map((v, t) => (t >= exitIdx ? 0 : v));
  const ch = per.map((v, t) => (t === exitIdx || t > exitIdx ? v - (per[t - 1] ?? 0) : (change[t] ?? 0)));
  const out = Array.from({ length: Math.max(n, cash.length) }, (_, t) => (cash[t] ?? 0) + (change[t] ?? 0) - (ch[t] ?? 0));
  return { perPeriod: per, changePerPeriod: ch, cash: out };
}

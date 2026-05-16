import type { WafiEscrowConfig } from './types';

export interface EscrowMovement {
  held: number[];
  released: number[];
  balance: number[];
  netAdjustment: number[];
}

/**
 * Wafi-style escrow movement matching MAAD Wafi Escrow rows 11-34.
 *
 * - Held per period = cashCollected[i] * heldPct (when enabled).
 * - Release year (absolute project period index): releases the FULL
 *   cumulative held INCLUDING that year's held. Matches MAAD row 24
 *   (T2 & T3 release = 101,593 at Y6, which equals sum of held Y2..Y6).
 * - Balance per period = running cumulative held minus running released.
 * - netAdjustment = -held + released. Net cash available = collected +
 *   netAdjustment.
 *
 * When release year is outside the axis or escrow is disabled, no
 * release is emitted (balance keeps growing). Reconciliation identity
 * sum(held) === sum(released) only holds when release year is inside
 * the axis.
 */
export function buildEscrowMovement(
  cashCollected: number[],
  config: WafiEscrowConfig,
  axisLength: number,
): EscrowMovement {
  const N = Math.max(0, axisLength);
  const held = new Array<number>(N).fill(0);
  const released = new Array<number>(N).fill(0);
  const balance = new Array<number>(N).fill(0);
  const netAdjustment = new Array<number>(N).fill(0);

  if (!config?.enabled || (config.heldPct ?? 0) <= 0) return { held, released, balance, netAdjustment };

  const pct = Math.max(0, Math.min(1, config.heldPct));
  let totalHeld = 0;
  for (let i = 0; i < N; i++) {
    const h = Math.max(0, cashCollected[i] ?? 0) * pct;
    held[i] = h;
    totalHeld += h;
  }

  const releaseYear = config.releaseYear;
  if (Number.isFinite(releaseYear) && releaseYear >= 0 && releaseYear < N) {
    released[releaseYear] = totalHeld;
  }

  let bal = 0;
  for (let i = 0; i < N; i++) {
    bal += held[i] - released[i];
    balance[i] = bal;
    netAdjustment[i] = released[i] - held[i];
  }

  return { held, released, balance, netAdjustment };
}

/**
 * Pre-sales Escrow engine (M2 Pass 9h, 2026-05-19).
 *
 * Re-introduces a dedicated escrow stream after the M2 Pass 7d removal
 * of the legacy escrow.ts. The new design is configurable per project /
 * per asset and lives in its own sub-tab so it doesn't pollute the
 * generic Revenue engine.
 *
 * Methodology (anchored to the reference Cashflow v1.16 Escrow tab):
 *   - A regulated authority withholds a percentage of every pre-sales
 *     inflow as Inaccessible Funds. The funds sit in escrow until a
 *     defined Release Year (typically project / asset completion),
 *     when the cumulative held balance is released to the developer
 *     in a single lump.
 *   - Held per period:    held[t]     = preSalesCash[t] x heldPct
 *   - Release per period: release[t]  = sum(held[s] for s <= t) if
 *                                       t === releaseYearIdx else 0.
 *                         All cumulative held funds released as one
 *                         lump on the release year.
 *   - Cumulative balance: balance[t]  = sum(held[s] - release[s])
 *                                       for s <= t, clamped >= 0.
 *   - CF adjustment:      adjust[t]   = release[t] - held[t]
 *                         (negative during accumulation,
 *                          positive lump on release year).
 *
 * Sign convention: `held` and `release` are non-negative; `adjust` is
 * the net change applied to developer-accessible cash (subtract held
 * during pre-sales years, add release on the release year).
 *
 * Defaults: heldPct = 0 means escrow is disabled and every output array
 * is all zeros. releaseYearIdx defaults to handoverYear when omitted
 * (matches the typical regulated-escrow release trigger).
 */

export interface EscrowConfig {
  /** Project-axis length. */
  axisLength: number;
  /** Held fraction as decimal (e.g. 0.04 = 4%). */
  heldPct: number;
  /** Project-axis index where cumulative held funds release. */
  releaseYearIdx: number;
  /** Pre-sales cash inflow per project-axis period (length = axisLength). */
  preSalesCashPerPeriod: number[];
}

export interface EscrowAssetResult {
  axisLength: number;
  heldPerPeriod: number[];
  releasePerPeriod: number[];
  cumulativeBalancePerPeriod: number[];
  netMovementPerPeriod: number[];
  /** -held[t] + release[t]; the value added to developer cash each period. */
  cashFlowAdjustmentPerPeriod: number[];
  /** Total held across the axis = total released (escrow is a wash). */
  totalHeld: number;
  totalReleased: number;
}

const EMPTY = (n: number): number[] => new Array<number>(Math.max(0, n)).fill(0);

export function computeEscrow(config: EscrowConfig): EscrowAssetResult {
  const N = Math.max(0, Math.floor(config.axisLength));
  const heldPct = Math.max(0, config.heldPct);
  const releaseIdx = clamp(Math.floor(config.releaseYearIdx), 0, Math.max(0, N - 1));

  const held = EMPTY(N);
  const release = EMPTY(N);
  const balance = EMPTY(N);
  const netMovement = EMPTY(N);
  const cfAdjust = EMPTY(N);

  if (N === 0 || heldPct === 0) {
    return {
      axisLength: N,
      heldPerPeriod: held,
      releasePerPeriod: release,
      cumulativeBalancePerPeriod: balance,
      netMovementPerPeriod: netMovement,
      cashFlowAdjustmentPerPeriod: cfAdjust,
      totalHeld: 0,
      totalReleased: 0,
    };
  }

  // Pass 1: compute per-period held off the pre-sales cash stream.
  let cumHeld = 0;
  for (let t = 0; t < N; t++) {
    const inflow = Math.max(0, config.preSalesCashPerPeriod[t] ?? 0);
    const h = inflow * heldPct;
    held[t] = h;
    cumHeld += h;
  }

  // Pass 2: full release lump at releaseIdx. The reference v1.16 model
  // releases the entire cumulative balance held up to (and including)
  // the release year in one lump on that year. If the cohort continues
  // to escrow funds AFTER the release year, those periods accumulate
  // a fresh balance that will sit on the books until exit (or another
  // release event, not modelled in Pass 1).
  const cumHeldThroughRelease = (() => {
    let s = 0;
    for (let t = 0; t <= releaseIdx && t < N; t++) s += held[t];
    return s;
  })();
  if (cumHeldThroughRelease > 0) release[releaseIdx] = cumHeldThroughRelease;

  // Pass 3: roll-forward.
  let running = 0;
  for (let t = 0; t < N; t++) {
    netMovement[t] = held[t] - release[t];
    running += netMovement[t];
    if (running < 0) running = 0;
    balance[t] = running;
    cfAdjust[t] = release[t] - held[t];
  }

  return {
    axisLength: N,
    heldPerPeriod: held,
    releasePerPeriod: release,
    cumulativeBalancePerPeriod: balance,
    netMovementPerPeriod: netMovement,
    cashFlowAdjustmentPerPeriod: cfAdjust,
    totalHeld: cumHeld,
    totalReleased: release.reduce((s, v) => s + v, 0),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

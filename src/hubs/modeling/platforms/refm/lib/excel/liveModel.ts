/**
 * liveModel.ts
 *
 * Pure TypeScript twin of the downstream Excel formulas. The formula-driven
 * model (buildModelWorkbook) emits LIVE Excel formulas; this module computes the
 * SAME arithmetic in TS so every `{ formula, result }` cell caches the value the
 * formula will produce. That makes the workbook open with correct numbers, stay
 * fully dynamic (recalculates on edit), and be self-consistent (the Balance Sheet
 * balances by construction, the Cash Flow ties, IRR is reproducible).
 *
 * It is a deliberately SIMPLE, auditable real-estate model (not a byte-for-byte
 * mirror of the platform's 2.4k-line engine): magnitudes are driven by the same
 * inputs (price x area, capex rate x quantity), timing is captured as editable
 * per-period profiles, and the financing uses a clean forward recurrence (interest
 * on the opening balance, deficit-funded drawdowns, surplus cash sweep) with no
 * fragile circularity. See the header comment in buildModelWorkbook for the tab
 * layout this feeds.
 */
import { irr, npv, moic } from '@core/calculations/returns/irr';

export type LiveGroup = 'Residential' | 'Hospitality' | 'Retail' | 'Other';

export interface LiveAssetInput {
  id: string;
  name: string;
  strategy: string;
  group: LiveGroup;
  /** phaseStartYear - projectStartYear (axis offset of the asset's phase). */
  offset: number;
  /** Construction periods (years) of the asset's phase. */
  cp: number;
  /** Operations periods of the asset's phase. */
  op: number;
  /** Useful life (years) for depreciation; 0 for Sell assets. */
  usefulLife: number;
  /** Revenue base: GDV for Sell (units x price), annual stabilised operating
   *  revenue for Operate / Lease. The downstream base CELL is a live formula. */
  revBaseCached: number;
  revKind: 'gdv' | 'annual';
  /** Per-period recognition / operating profile (cached engineRevenue / base). */
  revProfile: number[];
  /** Capex per period on the project axis (incl. all land / cash-only / construction-only). */
  inclPerPeriod: number[];
  exclInKindPerPeriod: number[];
  exclAllPerPeriod: number[];
  inclTotal: number;
  exclInKindTotal: number;
  exclAllTotal: number;
  landCashTotal: number;
  landInKindTotal: number;
  /** Cost-of-sales ratio (Sell only) = inclTotal / GDV; 0 otherwise. */
  cosRatioCached: number;
  /** Operating margin (decimal) for Operate / Lease; opex = revenue x (1 - margin). */
  opexMargin: number;
}

export interface LiveProjectInput {
  N: number;
  taxRate: number;
  debtPct: number;       // decimal (0..1)
  equityPct: number;     // decimal (0..1)
  debtRate: number;      // blended interest rate, decimal
  minCash: number;
  dsoDays: number;
  dpoDays: number;
  discountRate: number;
  exitOffset: number;    // 0-based axis index of the exit year
  exitMultiple: number;
  terminalMethod: string;
  perpetuityGrowth: number;
  /** Engine HQ opex per period (a base x profile cached row). */
  hqOpexCached: number[];
}

export interface LiveModel {
  N: number;
  exitOffset: number;
  // Revenue
  revByAsset: Map<string, number[]>;
  residentialRev: number[];
  hospitalityRev: number[];
  retailRev: number[];
  totalRev: number[];
  // Cost of sales
  cosByAsset: Map<string, number[]>;
  cosTotal: number[];
  // Opex
  opexByAsset: Map<string, number[]>;
  hospitalityOpex: number[];
  retailOpex: number[];
  hqOpex: number[];
  totalOpex: number[];
  // P&L
  ebitda: number[];
  daByAsset: Map<string, number[]>;
  da: number[];
  ebit: number[];
  interest: number[];
  pbt: number[];
  tax: number[];
  pat: number[];
  // Capex aggregates
  capexCash: number[];           // exclInKind total (the CFI cash basis)
  inKind: number[];              // inclAll - exclInKind (non-cash, = in-kind equity)
  sellIncl: number[];
  operateConstruction: number[];
  operateLand: number[];
  // Debt schedule
  debtOpen: number[];
  debtDraw: number[];
  principal: number[];
  debtClose: number[];
  equityCash: number[];
  equityInKind: number[];
  // Cash flow (direct)
  ar: number[];
  ap: number[];
  arDelta: number[];
  apDelta: number[];
  revReceived: number[];
  opexPaid: number[];
  taxPaid: number[];
  cfo: number[];
  cfi: number[];
  cff: number[];
  netCf: number[];
  openCash: number[];
  closeCash: number[];
  // Balance sheet
  inventory: number[];
  nbv: number[];
  land: number[];
  totalFA: number[];
  totalCA: number[];
  totalAssets: number[];
  totalLiab: number[];
  shareCapital: number[];
  retained: number[];
  totalEquity: number[];
  totalLE: number[];
  bsDiff: number[];
  // Returns
  noi: number[];
  stabilisedNOI: number;
  terminalEV: number;
  terminalEquity: number;
  fcff: number[];
  fcfe: number[];
  fcffStream: number[];
  fcfeStream: number[];
  fcffIrr: number | null;
  fcfeIrr: number | null;
  fcffNpv: number;
  fcfeNpv: number;
  fcffMoic: number;
  fcfeMoic: number;
}

const Z = (n: number): number[] => new Array<number>(n).fill(0);
const cumsum = (a: number[]): number[] => { const o = Z(a.length); let c = 0; for (let i = 0; i < a.length; i++) { c += a[i] ?? 0; o[i] = c; } return o; };
const sumAssets = (assets: LiveAssetInput[], N: number, pick: (a: LiveAssetInput) => number[]): number[] => {
  const o = Z(N);
  for (const a of assets) { const s = pick(a); for (let t = 0; t < N; t++) o[t] += s[t] ?? 0; }
  return o;
};

export function computeLiveModel(assets: LiveAssetInput[], p: LiveProjectInput): LiveModel {
  const N = p.N;
  const isSell = (a: LiveAssetInput): boolean => a.group === 'Residential';
  const isHosp = (a: LiveAssetInput): boolean => a.group === 'Hospitality';
  const isRetail = (a: LiveAssetInput): boolean => a.group === 'Retail';
  const isDepreciable = (a: LiveAssetInput): boolean => !isSell(a);

  // ── Revenue: revenue[t] = base x profile[t] (== engine revenue, since
  //    profile = engineRevenue / base). ──
  const revByAsset = new Map<string, number[]>();
  for (const a of assets) {
    const rv = Z(N);
    for (let t = 0; t < N; t++) rv[t] = a.revBaseCached * (a.revProfile[t] ?? 0);
    revByAsset.set(a.id, rv);
  }
  const residentialRev = sumAssets(assets.filter(isSell), N, (a) => revByAsset.get(a.id)!);
  const hospitalityRev = sumAssets(assets.filter(isHosp), N, (a) => revByAsset.get(a.id)!);
  const retailRev = sumAssets(assets.filter(isRetail), N, (a) => revByAsset.get(a.id)!);
  const totalRev = Z(N);
  for (let t = 0; t < N; t++) totalRev[t] = residentialRev[t] + hospitalityRev[t] + retailRev[t];

  // ── Cost of sales (Sell only): cos = revenue x cosRatio. ──
  const cosByAsset = new Map<string, number[]>();
  for (const a of assets) {
    const cos = Z(N);
    if (isSell(a)) { const rv = revByAsset.get(a.id)!; for (let t = 0; t < N; t++) cos[t] = rv[t] * a.cosRatioCached; }
    cosByAsset.set(a.id, cos);
  }
  const cosTotal = sumAssets(assets, N, (a) => cosByAsset.get(a.id)!);

  // ── Opex (Operate / Lease): opex = revenue x (1 - margin); + HQ. ──
  const opexByAsset = new Map<string, number[]>();
  for (const a of assets) {
    const ox = Z(N);
    if (isDepreciable(a)) { const rv = revByAsset.get(a.id)!; for (let t = 0; t < N; t++) ox[t] = rv[t] * (1 - a.opexMargin); }
    opexByAsset.set(a.id, ox);
  }
  const hospitalityOpex = sumAssets(assets.filter(isHosp), N, (a) => opexByAsset.get(a.id)!);
  const retailOpex = sumAssets(assets.filter(isRetail), N, (a) => opexByAsset.get(a.id)!);
  const hqOpex = p.hqOpexCached.slice(0, N); while (hqOpex.length < N) hqOpex.push(0);
  const totalOpex = Z(N);
  for (let t = 0; t < N; t++) totalOpex[t] = hospitalityOpex[t] + retailOpex[t] + hqOpex[t];

  // ── EBITDA. ──
  const ebitda = Z(N);
  for (let t = 0; t < N; t++) ebitda[t] = totalRev[t] - cosTotal[t] - totalOpex[t];

  // ── Depreciation: straight-line construction cost over useful life, starting
  //    the year after handover (handover = offset + cp - 1). ──
  const daByAsset = new Map<string, number[]>();
  for (const a of assets) {
    const dep = Z(N);
    if (isDepreciable(a) && a.usefulLife > 0 && a.exclAllTotal > 0) {
      const handover = Math.max(0, a.offset + a.cp - 1);
      const annual = a.exclAllTotal / a.usefulLife;
      for (let t = handover + 1; t <= handover + a.usefulLife && t < N; t++) dep[t] = annual;
    }
    daByAsset.set(a.id, dep);
  }
  const da = sumAssets(assets, N, (a) => daByAsset.get(a.id)!);
  const ebit = Z(N);
  for (let t = 0; t < N; t++) ebit[t] = ebitda[t] - da[t];

  // ── Capex aggregates. ──
  const capexCash = sumAssets(assets, N, (a) => a.exclInKindPerPeriod);          // CFI cash
  const inclTotalPer = sumAssets(assets, N, (a) => a.inclPerPeriod);
  const inKind = Z(N);
  for (let t = 0; t < N; t++) inKind[t] = inclTotalPer[t] - capexCash[t];
  const sellIncl = sumAssets(assets.filter(isSell), N, (a) => a.inclPerPeriod);
  const operateConstruction = sumAssets(assets.filter(isDepreciable), N, (a) => a.exclAllPerPeriod);
  const operateLand = sumAssets(assets.filter(isDepreciable), N, (a) => a.inclPerPeriod.map((v, i) => v - (a.exclAllPerPeriod[i] ?? 0)));

  // ── Working-capital balances (DSO / DPO). ──
  const ar = Z(N), ap = Z(N), arDelta = Z(N), apDelta = Z(N);
  for (let t = 0; t < N; t++) {
    ar[t] = totalRev[t] * (p.dsoDays / 365);
    ap[t] = totalOpex[t] * (p.dpoDays / 365);
    arDelta[t] = ar[t] - (t === 0 ? 0 : ar[t - 1]);
    apDelta[t] = ap[t] - (t === 0 ? 0 : ap[t - 1]);
  }

  // ── Debt schedule + cash flow (forward recurrence, no circularity). ──
  const debtOpen = Z(N), debtDraw = Z(N), principal = Z(N), debtClose = Z(N);
  const equityCash = Z(N), equityInKind = Z(N);
  const interest = Z(N), pbt = Z(N), tax = Z(N), pat = Z(N), taxPaid = Z(N);
  const revReceived = Z(N), opexPaid = Z(N), cfo = Z(N), cfi = Z(N), cff = Z(N), netCf = Z(N), openCash = Z(N), closeCash = Z(N);
  for (let t = 0; t < N; t++) {
    debtOpen[t] = t === 0 ? 0 : debtClose[t - 1];
    interest[t] = p.debtRate * debtOpen[t];
    pbt[t] = ebit[t] - interest[t];
    tax[t] = Math.max(0, pbt[t]) * p.taxRate;
    pat[t] = pbt[t] - tax[t];
    taxPaid[t] = tax[t];
    revReceived[t] = totalRev[t] - arDelta[t];
    opexPaid[t] = totalOpex[t] - apDelta[t];
    cfo[t] = revReceived[t] - opexPaid[t] - taxPaid[t];
    cfi[t] = -capexCash[t];
    openCash[t] = t === 0 ? 0 : closeCash[t - 1];
    const preFin = openCash[t] + cfo[t] + cfi[t] - interest[t];
    if (preFin < p.minCash) {
      const need = p.minCash - preFin;
      debtDraw[t] = need * p.debtPct;
      equityCash[t] = need * p.equityPct;
      principal[t] = 0;
    } else {
      principal[t] = Math.min(debtOpen[t], preFin - p.minCash);
      debtDraw[t] = 0;
      equityCash[t] = 0;
    }
    equityInKind[t] = inKind[t];
    debtClose[t] = debtOpen[t] + debtDraw[t] - principal[t];
    cff[t] = equityCash[t] + debtDraw[t] - principal[t] - interest[t];
    netCf[t] = cfo[t] + cfi[t] + cff[t];
    closeCash[t] = openCash[t] + netCf[t];
  }

  // ── Balance sheet. ──
  const inventory = Z(N), nbv = Z(N), land = Z(N);
  const cumSellIncl = cumsum(sellIncl), cumCos = cumsum(cosTotal);
  const cumConstruction = cumsum(operateConstruction), cumDa = cumsum(da), cumLand = cumsum(operateLand);
  for (let t = 0; t < N; t++) {
    inventory[t] = cumSellIncl[t] - cumCos[t];
    nbv[t] = cumConstruction[t] - cumDa[t];
    land[t] = cumLand[t];
  }
  const totalFA = Z(N), totalCA = Z(N), totalAssets = Z(N);
  for (let t = 0; t < N; t++) {
    totalFA[t] = nbv[t] + land[t];
    totalCA[t] = closeCash[t] + ar[t] + inventory[t];
    totalAssets[t] = totalFA[t] + totalCA[t];
  }
  const totalLiab = Z(N), shareCapital = Z(N), retained = Z(N), totalEquity = Z(N), totalLE = Z(N), bsDiff = Z(N);
  const cumEquity = cumsum(equityCash.map((v, i) => v + equityInKind[i]));
  const cumPat = cumsum(pat);
  for (let t = 0; t < N; t++) {
    totalLiab[t] = ap[t] + debtClose[t];
    shareCapital[t] = cumEquity[t];
    retained[t] = cumPat[t];
    totalEquity[t] = shareCapital[t] + retained[t];
    totalLE[t] = totalLiab[t] + totalEquity[t];
    bsDiff[t] = totalAssets[t] - totalLE[t];
  }

  // ── Returns: NOI, terminal value, FCFF / FCFE streams, IRR / NPV / MOIC. ──
  const noi = Z(N);
  for (let t = 0; t < N; t++) noi[t] = hospitalityRev[t] + retailRev[t] - hospitalityOpex[t] - retailOpex[t];
  const exit = Math.max(0, Math.min(N - 1, p.exitOffset));
  let stabilisedNOI = 0;
  for (let t = 0; t <= exit; t++) stabilisedNOI = Math.max(stabilisedNOI, noi[t]);
  let terminalEV: number;
  if (p.terminalMethod === 'perpetuity') {
    const exitFcff = cfo[exit] + cfi[exit];
    const spread = p.discountRate - p.perpetuityGrowth;
    terminalEV = spread > 1e-9 ? Math.max(0, (exitFcff * (1 + p.perpetuityGrowth)) / spread) : 0;
  } else {
    terminalEV = Math.max(0, stabilisedNOI) * Math.max(0, p.exitMultiple);
  }
  const terminalEquity = Math.max(0, terminalEV - Math.max(0, debtClose[exit]));

  const fcff = Z(N), fcfe = Z(N);
  for (let t = 0; t < N; t++) {
    fcff[t] = cfo[t] + cfi[t];
    fcfe[t] = cfo[t] + cfi[t] + debtDraw[t] - principal[t] - interest[t] - equityInKind[t];
  }
  fcff[exit] += terminalEV;
  fcfe[exit] += terminalEquity;

  // Streams for IRR: inception (0) + axis years through exit.
  const fcffStream = [0, ...fcff.slice(0, exit + 1)];
  const fcfeStream = [0, ...fcfe.slice(0, exit + 1)];

  return {
    N, exitOffset: exit,
    revByAsset, residentialRev, hospitalityRev, retailRev, totalRev,
    cosByAsset, cosTotal,
    opexByAsset, hospitalityOpex, retailOpex, hqOpex, totalOpex,
    ebitda, daByAsset, da, ebit, interest, pbt, tax, pat,
    capexCash, inKind, sellIncl, operateConstruction, operateLand,
    debtOpen, debtDraw, principal, debtClose, equityCash, equityInKind,
    ar, ap, arDelta, apDelta, revReceived, opexPaid, taxPaid, cfo, cfi, cff, netCf, openCash, closeCash,
    inventory, nbv, land, totalFA, totalCA, totalAssets, totalLiab, shareCapital, retained, totalEquity, totalLE, bsDiff,
    noi, stabilisedNOI, terminalEV, terminalEquity, fcff, fcfe, fcffStream, fcfeStream,
    fcffIrr: irr(fcffStream), fcfeIrr: irr(fcfeStream),
    fcffNpv: npv(p.discountRate, fcffStream), fcfeNpv: npv(p.discountRate, fcfeStream),
    fcffMoic: moic(fcffStream), fcfeMoic: moic(fcfeStream),
  };
}

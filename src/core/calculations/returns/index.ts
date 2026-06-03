/**
 * M5 Returns engine, public entry point.
 *
 * `computeReturns(input)` is the single pure function the refm resolver
 * calls. It summarises the three cash-flow streams (FCFF / FCFE /
 * Dividends) into IRR / MOIC / NPV / Payback and assembles the
 * real-estate metric block. No snapshot or store coupling lives here.
 */
import { npv, irr, moic, paybackPeriod, peakExposure } from './irr';
import {
  yieldOnCost, capRate, profitOnCost, profitMargin, loanToValue,
  equityMultiple, debtYield, dscrSeries, icrSeries, cashOnCashSeries,
} from './metrics';
import type {
  CashFlowStream, StreamReturns, ReturnsInput, ReturnsResult, RealEstateMetrics,
} from './types';

/** Summarise a single signed cash-flow stream. */
export function summariseStream(stream: CashFlowStream, discountRate: number): StreamReturns {
  const cf = stream.perPeriod;
  let totalInflow = 0;
  let totalOutflow = 0;
  for (const v of cf) {
    if (v > 0) totalInflow += v;
    else totalOutflow += -v;
  }
  return {
    irr: irr(cf),
    moic: moic(cf),
    npv: npv(discountRate, cf),
    discountRate,
    paybackPeriod: paybackPeriod(cf),
    totalInflow,
    totalOutflow,
    netProfit: totalInflow - totalOutflow,
    peakExposure: peakExposure(cf),
  };
}

function buildRealEstateMetrics(input: ReturnsInput): RealEstateMetrics {
  const m = input.metrics;
  const yoc = yieldOnCost(m.stabilisedNOI, m.totalDevelopmentCost);
  const cap = capRate(m.exitNOI, m.exitEnterpriseValue);
  const dscr = dscrSeries(m.cfadsPerPeriod, m.debtServicePerPeriod);
  const icr = icrSeries(m.ebitdaPerPeriod, m.interestPerPeriod);
  const coc = cashOnCashSeries(m.distributionPerPeriod, m.cumulativeEquityPerPeriod);
  const peakEquity = Math.max(0, ...m.cumulativeEquityPerPeriod, 0);
  return {
    yieldOnCost: yoc,
    capRateAtExit: cap,
    developmentSpread: yoc !== null && cap !== null ? yoc - cap : null,
    profitOnCost: profitOnCost(m.totalRevenue, m.totalCost),
    profitMargin: profitMargin(m.totalPAT, m.totalRevenue),
    cashOnCashAvg: coc.avg,
    ltvAtExit: loanToValue(m.debtOutstandingAtExit, m.exitEnterpriseValue),
    equityMultiple: equityMultiple(m.totalEquityDistributions, m.totalEquityInvested),
    debtYield: debtYield(m.stabilisedNOI, m.debtOutstandingAtExit),
    peakEquity,
    dscrPerPeriod: dscr.perPeriod,
    dscrMin: dscr.min,
    dscrAvg: dscr.avg,
    icrPerPeriod: icr.perPeriod,
    icrMin: icr.min,
    cashOnCashPerPeriod: coc.perPeriod,
  };
}

/** Compute the full M5 returns result from a resolved input. */
export function computeReturns(input: ReturnsInput): ReturnsResult {
  return {
    fcff: summariseStream(input.fcff, input.discountRate),
    fcfe: summariseStream(input.fcfe, input.discountRate),
    dividends: summariseStream(input.dividends, input.discountRate),
    realEstate: buildRealEstateMetrics(input),
  };
}

export { npv, irr, moic, paybackPeriod, peakExposure } from './irr';
export { terminalEnterpriseValue, terminalEquityValue } from './terminalValue';
export {
  developmentEconomics, exitAnalysis, sourcesUses, fundingMix,
  equityExposure, stabilizationMetrics, debtAnalytics,
} from './analytics';
export { computePartnerReturns } from './partners';
export type { PartnerInput, PartnerResult, PartnersSnapshot } from './partners';
export { buildSponsorStreamsForExit } from './streamBuild';
export type { SponsorStreamInputs, SponsorStreams, TerminalConfig } from './streamBuild';
export { exitYearAnalysis } from './exitYearAnalysis';
export type { ExitYearRow } from './exitYearAnalysis';
export { computePerAssetReturns } from './perAsset';
export type { AssetReturnInput, AssetReturnRow, PerAssetSnapshot } from './perAsset';
export { computeSensitivity, defaultSensitivityValues } from './sensitivity';
export type { SensitivityVariable, SensitivityAxis, SensitivityGrid } from './sensitivity';
export {
  yieldOnCost, capRate, profitOnCost, profitMargin, loanToValue,
  equityMultiple, debtYield, dscrSeries, icrSeries, cashOnCashSeries, safeRatio,
} from './metrics';
export type {
  CashFlowStream, StreamReturns, ReturnsInput, ReturnsResult, RealEstateMetrics,
  TerminalMethod, TerminalValueInput,
  DevelopmentEconomics, ExitAnalysis, SourcesUses, FundingMix,
  EquityExposureDetail, StabilizationMetrics, DebtAnalytics,
} from './types';

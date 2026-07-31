/**
 * refm/lib/ai/icModelGrounding.ts
 *
 * REFM's MODEL grounding adapter: turns the already-assembled ICReportModel
 * into the platform-agnostic grounding shape the AI client consumes.
 *
 * This file is the platform half of the grounding abstraction (AI foundation
 * Unit 4). It lives here, not in src/shared/ai/, because it is the only piece
 * that knows what a REFM project is. src/shared/ai/grounding/ must never import
 * it, or the foundation stops being platform-agnostic and ERM cannot reuse it.
 *
 * NO RECOMPUTE. It reads an ICReportModel the caller already built, exactly as
 * the deck export route does. The engine is never touched from an AI path, so
 * a generation cannot change or re-derive a single number.
 *
 * MONEY SCALING. Amounts are scaled with the SAME icMoneyScaleSpec the deck
 * uses, and the scaled figure is what is stored on the fact. That is
 * deliberate: the fact must be what the model was actually shown, so a narrative
 * figure ties to the slide beside it and the numeric audit compares like for
 * like.
 *
 * WHAT IS INCLUDED. The summary fact set: project frame, headline returns, the
 * ask, development economics, capital structure, financing, RE metrics, asset
 * mix, phasing, exit years, returns by basis, operating performance, and the
 * scenario matrix. The FULL year-by-year schedules are opt-in (includeSeries),
 * because they would multiply prompt size, and every AI call is metered spend.
 * The trade-off is explicit: a narrative citing a year value that was not
 * supplied comes back UNSUPPORTED from the audit, which is the correct
 * direction.
 *
 * No em dashes in this file.
 */

import {
  countFact,
  document,
  moneyFact,
  multipleFact,
  percentFact,
  section,
  seriesFact,
  textFact,
} from '@/src/shared/ai/grounding/facts';
import { registerGroundingProvider } from '@/src/shared/ai/grounding/providers';
import type { GroundingDocument, GroundingFact, GroundingInput, GroundingProvider } from '@/src/shared/ai/grounding/types';
import { icMoneyScaleSpec, type ICMoneyScale } from '../reportInputs';
import type { ICReportModel } from '../reports/icReport';

export interface IcGroundingOptions {
  /** Money scale, matching the deck setting so narrative and slides agree. */
  scale?: ICMoneyScale;
  currencyCode?: string;
  /** Include the full year-by-year schedules. Off by default: see the header. */
  includeSeries?: boolean;
  asOf?: string;
}

const PROVIDER_ID = 'refm.ic-model';

/** Scale an amount into display units, preserving null. */
const scaled = (v: number | null | undefined, divisor: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v / divisor : null;

/**
 * Build the model-grounding document for an IC narrative.
 *
 * Pure and synchronous: same model in, same document out, so a verifier can
 * assert fidelity without a database or an API key.
 */
export function buildIcModelGrounding(model: ICReportModel, opts: IcGroundingOptions = {}): GroundingDocument {
  const spec = icMoneyScaleSpec(opts.scale ?? 'millions', opts.currencyCode ?? 'SAR');
  const unit = spec.unit;
  const d = spec.divisor;
  const dec = spec.decimals;

  /** Money fact in display units. The scaled number is what lands on the fact. */
  const money = (key: string, label: string, v: number | null | undefined, note?: string): GroundingFact =>
    moneyFact(key, label, scaled(v, d), { unit, decimals: dec, ...(note ? { note } : {}) });

  const o = model.overview;
  const h = model.headline;
  const ask = model.ask;
  const de = model.devEconomics;
  const cap = model.capital;
  const fin = model.financing;
  const re = model.reMetrics;

  const sections = [
    section('project', 'Project', [
      textFact('project.name', 'Project', o.name),
      textFact('project.location', 'Location', [o.location, o.country].filter(Boolean).join(', ')),
      countFact('project.phaseCount', 'Number of phases', o.phaseCount),
      textFact('project.phaseNames', 'Phases', o.phaseNames.join(', ')),
      textFact('project.strategyMix', 'Strategy mix', o.strategyMix),
      countFact('project.startYear', 'First model year', o.startYear),
      countFact('project.exitYear', 'Exit year', o.exitYear),
      countFact('project.durationYears', 'Model horizon', o.durationYears, { unit: 'years' }),
      countFact('project.landAreaSqm', 'Land area', o.landAreaSqm, { unit: 'sqm' }),
      countFact('project.totalBua', 'Total built-up area', o.totalBua, { unit: 'sqm' }),
      textFact('project.fundingMethod', 'Funding method', o.fundingMethodLabel),
    ]),

    section('headline', 'Headline returns', [
      percentFact('headline.projectIrr', 'Project IRR (unlevered, FCFF)', h.projectIrr),
      multipleFact('headline.projectMoic', 'Project MOIC (FCFF)', h.projectMoic),
      percentFact('headline.equityIrr', 'Equity IRR (levered, FCFE)', h.equityIrr),
      multipleFact('headline.equityMoic', 'Equity MOIC (FCFE)', h.equityMoic),
      percentFact('headline.distributedEquityIrr', 'Distributed equity IRR (dividends)', h.distributedEquityIrr),
      multipleFact('headline.equityMultiple', 'Equity multiple', h.equityMultiple),
      money('headline.terminalEquity', 'Terminal equity value', h.terminalEquity),
    ]),

    section('ask', 'The ask', [
      money('ask.equityCommitment', 'Equity commitment required', ask.equityCommitment),
      money('ask.existingEquity', 'Existing equity', ask.existingEquity),
      money('ask.inKindEquity', 'In-kind equity', ask.inKindEquity),
      money('ask.peakDebt', 'Peak debt', ask.peakDebt),
      money('ask.existingDebt', 'Existing debt', ask.existingDebt),
      money('ask.newDebt', 'New debt', ask.newDebt),
      percentFact('ask.paydownPct', 'Debt paid down by exit', ask.paydownPct),
    ]),

    section('devEconomics', 'Development economics', [
      money('dev.gdv', 'Gross development value', de.gdv),
      money('dev.tdc', 'Total development cost', de.tdc),
      money('dev.financingCost', 'Total financing cost', de.financingCost),
      money('dev.profitBeforeFinancing', 'Profit before financing', de.profitBeforeFinancing),
      money('dev.profitAfterFinancing', 'Profit after financing', de.profitAfterFinancing),
      percentFact('dev.developmentMargin', 'Development margin', de.developmentMargin),
      percentFact('dev.costToValue', 'Cost to value', de.costToValue),
    ]),

    section('capital', 'Capital structure', [
      percentFact('capital.debtPct', 'Debt share of funding', cap.debtPct),
      percentFact('capital.cashEquityPct', 'Cash equity share', cap.cashEquityPct),
      percentFact('capital.inKindEquityPct', 'In-kind equity share', cap.inKindEquityPct),
      percentFact('capital.customerFundingPct', 'Customer funding share', cap.customerFundingPct),
      money('capital.peakEquity', 'Peak equity', cap.peakEquity),
      money('capital.totalEquity', 'Total equity', cap.totalEquity),
      money('capital.peakDebt', 'Peak debt', cap.peakDebt),
      money('capital.remainingDebtAtExit', 'Debt outstanding at exit', cap.remainingDebtAtExit),
      money('capital.totalSources', 'Total sources', cap.totalSources),
      money('capital.totalUses', 'Total uses', cap.totalUses),
    ]),

    section('financing', 'Financing', fin.hasDebt ? [
      textFact('financing.method', 'Funding method', fin.fundingMethodLabel),
      money('financing.existingDebt', 'Existing debt', fin.existingDebt),
      money('financing.newDebt', 'New debt', fin.newDebt),
      money('financing.peakDebt', 'Peak debt', fin.peakDebt),
      countFact('financing.tenorYears', 'Debt tenor', fin.tenorYears, { unit: 'years' }),
      percentFact('financing.paydownPct', 'Paid down by exit', fin.paydownPct),
      money('financing.remainingDebtAtExit', 'Outstanding at exit', fin.remainingDebtAtExit),
      money('financing.customerCollections', 'Customer collections', fin.customerCollections),
      money('financing.minCashReserve', 'Minimum cash reserve', fin.minCashReserve),
    ] : [
      textFact('financing.method', 'Funding method', fin.fundingMethodLabel),
      textFact('financing.hasDebt', 'Debt in the structure', 'none, the project is equity and customer funded'),
      money('financing.customerCollections', 'Customer collections', fin.customerCollections),
    ]),

    section('reMetrics', 'Real estate metrics', [
      percentFact('re.yieldOnCost', 'Yield on cost', re.yieldOnCost),
      percentFact('re.capRateAtExit', 'Cap rate at exit', re.capRateAtExit),
      percentFact('re.profitOnCost', 'Profit on cost', re.profitOnCost),
      percentFact('re.cashOnCashAvg', 'Average cash on cash', re.cashOnCashAvg),
      multipleFact('re.dscrMin', 'Minimum DSCR', re.dscrMin),
      percentFact('re.ltvAtExit', 'LTV at exit', re.ltvAtExit),
    ]),

    section('assetMix', 'Asset mix', [
      countFact('assetMix.totalBua', 'Total built-up area', model.assetMix.totalBua, { unit: 'sqm' }),
      countFact('assetMix.totalUnits', 'Total units', model.assetMix.totalUnits),
      ...model.assetMix.rows.map((a, i) => textFact(
        `assetMix.asset${i + 1}`,
        `Asset ${i + 1}`,
        `${a.name}, ${a.strategy}, ${a.phaseName}`,
      )),
      ...model.assetMix.rows.map((a, i) => countFact(`assetMix.asset${i + 1}.bua`, `${a.name} built-up area`, a.bua, { unit: 'sqm' })),
      ...model.assetMix.byStrategy.map((s, i) => percentFact(`assetMix.strategy${i + 1}.pct`, `${s.strategy} share of area`, s.pct)),
    ]),

    section('phasing', 'Phasing', model.phasing.flatMap((p, i) => [
      textFact(`phase${i + 1}.name`, `Phase ${i + 1}`, `${p.name}, ${p.strategies}, ${p.assetCount} assets`),
      countFact(`phase${i + 1}.startYear`, `${p.name} start year`, p.startYear),
      money(`phase${i + 1}.capex`, `${p.name} capex`, p.capex),
    ])),

    section('exit', 'Exit', [
      ...model.exitYears.filter((r) => r.selected).flatMap((r) => [
        countFact('exit.year', 'Selected exit year', r.year),
        money('exit.equityValue', 'Equity value at exit', r.equityValue),
        percentFact('exit.projectIrr', 'Project IRR at selected exit', r.projectIrr),
        percentFact('exit.equityIrr', 'Equity IRR at selected exit', r.equityIrr),
        multipleFact('exit.equityMoic', 'Equity MOIC at selected exit', r.equityMoic),
      ]),
      ...model.exitYears.filter((r) => !r.selected).map((r, i) => textFact(
        `exit.alt${i + 1}`,
        `Alternative exit ${r.year}`,
        `equity IRR ${r.equityIrr === null ? 'not available' : `${(r.equityIrr * 100).toFixed(1)}%`}, MOIC ${r.equityMoic.toFixed(2)}x`,
      )),
    ]),

    section('returnsBasis', 'Returns by cash flow basis',
      model.returnsBasis.hasData
        ? model.returnsBasis.rows.flatMap((r, i) => [
            percentFact(`basis${i + 1}.irr`, `${r.basis} IRR`, r.irr),
            multipleFact(`basis${i + 1}.moic`, `${r.basis} MOIC`, r.moic),
            money(`basis${i + 1}.invested`, `${r.basis} invested`, r.invested),
            money(`basis${i + 1}.returned`, `${r.basis} returned`, r.returned),
            money(`basis${i + 1}.netProfit`, `${r.basis} net profit`, r.netProfit),
          ])
        : []),

    section('operating', 'Operating performance',
      model.operating.hasData
        ? [
            money('operating.peakNoi', 'Peak NOI', model.operating.peakNoi),
            ...(opts.includeSeries ? [
              seriesFact('operating.years', 'Operating years', model.operating.yearLabels, { decimals: 0 }),
              seriesFact('operating.noi', `NOI by year (${unit})`, model.operating.noi.map((v) => v / d), { decimals: dec }),
              seriesFact('operating.ebitda', `EBITDA by year (${unit})`, model.operating.ebitda.map((v) => v / d), { decimals: dec }),
            ] : []),
          ]
        : []),

    section('scenarios', 'Scenario comparison', scenarioFacts(model, d, dec, unit)),
  ];

  if (opts.includeSeries) sections.push(...scheduleSections(model, d, dec, unit));

  return document('model', PROVIDER_ID, `REFM IC model for ${o.name}, figures in ${unit}`, sections, opts.asOf);
}

/** Scenario matrix as facts. Every case column contributes its KPI values under
 *  a key that names the case, so a narrative comparing cases can be audited. */
function scenarioFacts(model: ICReportModel, divisor: number, decimals: number, unit: string): GroundingFact[] {
  const sc = model.scenarios;
  if (!sc || sc.columns.length === 0) return [];

  const facts: GroundingFact[] = [countFact('scenarios.count', 'Cases compared', sc.columns.length)];

  sc.columns.forEach((col, ci) => {
    const p = `scenario${ci + 1}`;
    facts.push(textFact(`${p}.name`, `Case ${ci + 1}`, `${col.name}${col.id === sc.baseId ? ' (base)' : ''}`));
    for (const kpi of sc.kpis) {
      const v = col.values[kpi.label];
      const key = `${p}.${kpi.label.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
      const label = `${col.name}: ${kpi.label}`;
      if (kpi.kind === 'pct') facts.push(percentFact(key, label, v));
      else if (kpi.kind === 'mult') facts.push(multipleFact(key, label, v));
      else facts.push(moneyFact(key, label, scaled(v, divisor), { unit, decimals }));
    }
    // What actually differs in this case, so the narrative can attribute a
    // movement to a driver instead of guessing at one.
    col.drivers.slice(0, 8).forEach((drv, di) => {
      facts.push(textFact(`${p}.driver${di + 1}`, `${col.name} driver ${di + 1}`,
        `${drv.label}: base ${drv.base}, case ${drv.value}`));
    });
  });

  return facts;
}

/** Full year-by-year schedules, opt-in. One fact per line, values as a series. */
function scheduleSections(model: ICReportModel, divisor: number, decimals: number, unit: string) {
  const blocks: Array<[string, string, ICReportModel['schedules'][keyof ICReportModel['schedules']]]> = [
    ['is', 'Income statement by year', model.schedules.incomeStatement],
    ['cf', 'Cash flow by year', model.schedules.cashFlow],
    ['bs', 'Balance sheet by year', model.schedules.balanceSheet],
    ['fcff', 'FCFF build-up by period', model.schedules.fcff],
    ['fcfe', 'FCFE build-up by period', model.schedules.fcfe],
    ['ddm', 'Distributed equity by period', model.schedules.ddm],
  ];

  return blocks
    .filter(([, , b]) => b.hasData)
    .map(([id, title, b]) => section(`schedule.${id}`, `${title} (${unit})`, [
      seriesFact(`schedule.${id}.years`, 'Column years', b.years, { decimals: 0 }),
      ...b.rows.map((r, i) => seriesFact(
        `schedule.${id}.row${i + 1}`,
        r.label,
        r.values.map((v) => v / divisor),
        { decimals, ...(r.total !== null ? { note: `project-life total ${(r.total / divisor).toFixed(decimals)}` } : {}) },
      )),
    ]));
}

/**
 * The REFM model provider.
 *
 * `payload` must carry an already-built ICReportModel. Handed anything else it
 * returns an unavailable document rather than throwing, so a misconfigured
 * feature degrades to "no data" and the prompt says so, instead of failing the
 * request or, worse, letting the model fill the gap.
 */
export const icModelGroundingProvider: GroundingProvider = {
  id: PROVIDER_ID,
  type: 'model',
  describe: 'REFM IC report model: computed project figures, no recompute.',
  collect(input: GroundingInput): GroundingDocument {
    const payload = input.payload as { model?: unknown; options?: IcGroundingOptions } | undefined;
    const model = payload?.model as ICReportModel | undefined;

    if (!model || typeof model !== 'object' || !('headline' in model) || !('overview' in model)) {
      return {
        type: 'model',
        providerId: PROVIDER_ID,
        source: 'REFM IC model',
        available: false,
        unavailableReason: 'No assembled IC report model was supplied with this request.',
        sections: [],
      };
    }
    return buildIcModelGrounding(model, { asOf: input.asOf, ...(payload?.options ?? {}) });
  },
};

/** Register REFM's model provider. Idempotent; call from any REFM AI entry
 *  point. Kept out of the shared module so the foundation stays platform-free. */
export function registerRefmGroundingProviders(): void {
  registerGroundingProvider(icModelGroundingProvider);
}

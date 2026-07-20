/**
 * templates.ts (REFM Module 7, IC Presentation Builder: the slide library)
 *
 * The eighteen institutional slides a deck is seeded with, each composed from the
 * layout vocabulary and wired to the model through binding keys. A template is a
 * pure function of (model, seed) to a Slide, which buys three things:
 *
 *  - "Reset to layout" is just a re-run of the builder.
 *  - Auto-omit is honest: `available(model)` asks whether the model actually
 *    supports the slide, so a pure-Sell project never ships an empty Operating
 *    Performance slide, and a single-case project never ships a blank Scenario
 *    Comparison.
 *  - Seeding is non-destructive: narrative already written in the old report form
 *    (refm_report_inputs) flows into the matching text objects, so nobody loses
 *    the words they wrote before this rebuild.
 *
 * Numbers are NEVER baked in here. Every figure on every slide is a binding key
 * resolved at render time.
 *
 * No em dashes in this file.
 */

import type { ICReportModel } from '../icReport';
import type { ReportInputs } from '../../reportInputs';
import {
  MARGIN, CONTENT_W, SLIDE_W, deckId, resetDeckIds, rowSlots,
  type Deck, type DeckObject, type Slide, DECK_SCHEMA_VERSION,
} from './types';
import { DECK_THEME, TYPE_SCALE, textStyles, DEFAULT_BRANDING } from './theme';
import {
  CONTENT_Y, CONTENT_H, CONTENT_BOTTOM, GAP, bullets, captionBlock, chart, chartWithCaption,
  coverWash, gantt, heatmap, image, kpi, kpiRow, panelLabel, phaseCard, riskMatrix, shape, table,
  text, boundText, titleBlock,
} from './layout';
import type { MetricBindingKey } from './bindings';
import { PLACEHOLDER } from './placeholders';

/** What a template may read besides the model: narrative the user already wrote. */
export interface TemplateSeed {
  inputs: ReportInputs | null;
}

export interface SlideTemplate {
  id: string;
  title: string;
  /** Insert-menu grouping. */
  group: 'Opening' | 'The asset' | 'The numbers' | 'The case' | 'Closing';
  chrome: Slide['chrome'];
  /** Whether the model supports this slide at all. False = seeded deck omits it. */
  available: (m: ICReportModel, seed: TemplateSeed) => boolean;
  build: (m: ICReportModel, seed: TemplateSeed, num: string) => DeckObject[];
}

// ── Seed helpers ────────────────────────────────────────────────────────────

const nonEmpty = (s: string | undefined | null): boolean => !!s && !!s.trim();
/** Split a narrative paragraph into bullets, so a seeded blob becomes real points. */
const toPoints = (s: string | undefined | null, fallback: string[]): string[] => {
  if (!nonEmpty(s)) return fallback;
  const parts = String(s).split(/\r?\n+/).map((l) => l.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
  return parts.length ? parts : fallback;
};

// ── The library ─────────────────────────────────────────────────────────────

const T = (t: SlideTemplate): SlideTemplate => t;

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  // 1 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'cover', title: 'Cover', group: 'Opening', chrome: 'cover',
    available: () => true,
    build: (m) => {
      const tiles: MetricBindingKey[] = ['devEconomics.gdv', 'headline.projectIrr', 'headline.equityIrr', 'headline.equityMoic'];
      const slots = rowSlots(MARGIN, CONTENT_W, tiles.length, GAP);
      return [
        coverWash(),
        shape({ x: 0, y: 0, w: 6, h: 720 }, 'rect', { fill: DECK_THEME.green }, { name: 'Accent bar', locked: true }),
        boundText({ x: MARGIN, y: 150, w: 800, h: 70 }, 'cover.projectName', textStyles.coverTitle(), 'Project'),
        boundText({ x: MARGIN, y: 226, w: 800, h: 28 }, 'cover.location', textStyles.coverSub(), 'Location'),
        text({ x: MARGIN, y: 262, w: 800, h: 24 }, 'Investment Committee Presentation',
          { ...textStyles.coverSub(), size: 16, color: DECK_THEME.navyLight }),
        // KPI wall
        ...tiles.map((k, i) => kpi({ x: slots[i].x, y: 400, w: slots[i].w, h: 104 }, k, 'navy')),
        shape({ x: MARGIN, y: 540, w: CONTENT_W, h: 3 }, 'rect', { fill: DECK_THEME.green }),
        boundText({ x: MARGIN, y: 560, w: 600, h: 18 }, 'cover.preparedBy',
          { ...textStyles.kpiSub(), color: DECK_THEME.pale }, 'Prepared by'),
        boundText({ x: SLIDE_W - MARGIN - 300, y: 560, w: 300, h: 18 }, 'cover.asOf',
          { ...textStyles.kpiSub(), color: DECK_THEME.pale, align: 'right' }, 'As of'),
      ];
    },
  }),

  // 2 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'executive_summary', title: 'Executive Summary', group: 'Opening', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const leftW = Math.round(CONTENT_W * 0.56);
      const rightX = MARGIN + leftW + GAP * 2;
      const rightW = CONTENT_W - leftW - GAP * 2;
      const points = seed.inputs?.execPoints?.length
        ? seed.inputs.execPoints.map((p) => (typeof p === 'string' ? p : (p as { text?: string }).text ?? ''))
        : toPoints(seed.inputs?.executiveSummary, [PLACEHOLDER('the investment thesis, one point per line')]);
      const tiles: MetricBindingKey[] = [
        'devEconomics.gdv', 'devEconomics.tdc', 'headline.projectIrr',
        'headline.equityIrr', 'headline.equityMoic', 'devEconomics.developmentMargin',
      ];
      const slots = rowSlots(rightX, rightW, 2, GAP);
      return [
        ...titleBlock(num, 'Executive Summary'),
        bullets({ x: MARGIN, y: CONTENT_Y + 8, w: leftW, h: CONTENT_H - 8 }, points.filter(Boolean), textStyles.bullet(), { numbered: true }),
        ...tiles.map((k, i) => kpi(
          { x: slots[i % 2].x, y: CONTENT_Y + 8 + Math.floor(i / 2) * (84 + GAP), w: slots[i % 2].w, h: 84 },
          k, 'pale',
        )),
        ...captionBlock({ x: rightX, y: CONTENT_Y + 8 + 3 * (84 + GAP), w: rightW, h: CONTENT_BOTTOM - (CONTENT_Y + 8 + 3 * (84 + GAP)) },
          'Development economics',
          'Profit after financing and the margin it implies, read against the total development cost committed.',
          'navy'),
      ];
    },
  }),

  // 3 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'investment_highlights', title: 'Investment Highlights', group: 'Opening', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const points = toPoints(seed.inputs?.thesisLine, [
        PLACEHOLDER('highlight 1'), PLACEHOLDER('highlight 2'), PLACEHOLDER('highlight 3'), PLACEHOLDER('highlight 4'),
      ]);
      const slots = rowSlots(MARGIN, CONTENT_W, 2, GAP * 2);
      const cardH = 140;
      const out: DeckObject[] = [...titleBlock(num, 'Investment Highlights')];
      points.slice(0, 4).forEach((p, i) => {
        const b = { x: slots[i % 2].x, y: CONTENT_Y + 24 + Math.floor(i / 2) * (cardH + GAP * 2), w: slots[i % 2].w, h: cardH };
        out.push(shape(b, 'rect', { fill: DECK_THEME.paleWash, radius: 4 }));
        out.push(shape({ x: b.x + 16, y: b.y + 16, w: 34, h: 34 }, 'rect', { fill: DECK_THEME.navy, radius: 17 }, {
          text: String(i + 1), style: { ...textStyles.kpiValue(), size: 15, color: DECK_THEME.white, align: 'center', valign: 'middle' },
        }));
        out.push(text({ x: b.x + 62, y: b.y + 18, w: b.w - 78, h: b.h - 36 }, p, { ...textStyles.body(), size: 14, lineHeight: 1.45 }));
      });
      out.push(...kpiRow(['headline.projectIrr', 'headline.equityIrr', 'devEconomics.developmentMargin', 'financing.paydownPct'],
        CONTENT_Y + 24 + 2 * (cardH + GAP * 2) + GAP, { h: 82 }));
      return out;
    },
  }),

  // 4 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'project_overview', title: 'Project Overview', group: 'The asset', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const facts: MetricBindingKey[] = [
        'overview.landAreaSqm', 'overview.totalBua', 'overview.phaseCount',
        'overview.durationYears', 'assetMix.totalUnits', 'overview.exitYear',
      ];
      const concept = nonEmpty(seed.inputs?.developmentConcept) ? String(seed.inputs?.developmentConcept) : PLACEHOLDER('the development concept');
      const tileY = CONTENT_Y + 8;
      const blockY = tileY + 2 * (86 + GAP) + GAP;
      return [
        ...titleBlock(num, 'Project Overview'),
        ...kpiRow(facts, tileY, { perRow: 3, h: 86 }),
        ...captionBlock({ x: MARGIN, y: blockY, w: CONTENT_W, h: CONTENT_BOTTOM - blockY }, 'Development concept', concept, 'navy'),
      ];
    },
  }),

  // 5 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'location_analysis', title: 'Location Analysis', group: 'The asset', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const mapW = Math.round(CONTENT_W * 0.56);
      const rightX = MARGIN + mapW + GAP * 2;
      const rightW = CONTENT_W - mapW - GAP * 2;
      const mc = seed.inputs?.marketContext;
      const points = mc?.points?.length
        ? mc.points.map((p) => (typeof p === 'string' ? p : (p as { text?: string }).text ?? '')).filter(Boolean)
        : [PLACEHOLDER('a demand driver'), PLACEHOLDER('an accessibility note'), PLACEHOLDER('a catchment note')];
      return [
        ...titleBlock(num, 'Location Analysis'),
        image({ x: MARGIN, y: CONTENT_Y + 8, w: mapW, h: CONTENT_H - 8 }, null, { name: 'Map or site image', alt: 'Site location' }),
        panelLabel({ x: rightX, y: CONTENT_Y + 8, w: rightW, h: 14 }, 'Demand drivers'),
        bullets({ x: rightX, y: CONTENT_Y + 30, w: rightW, h: 200 }, points, textStyles.bullet(), { numbered: true }),
        ...captionBlock({ x: rightX, y: CONTENT_Y + 246, w: rightW, h: CONTENT_BOTTOM - (CONTENT_Y + 246) },
          'Why this location',
          nonEmpty(mc?.sourcesNote) ? String(mc?.sourcesNote) : PLACEHOLDER('the location rationale and sources'),
          'pale'),
      ];
    },
  }),

  // 6 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'development_programme', title: 'Development Programme', group: 'The asset', chrome: 'content',
    available: (m) => m.assetMix.rows.length > 0,
    build: (m, seed, num) => {
      const leftW = Math.round(CONTENT_W * 0.56);
      const rightX = MARGIN + leftW + GAP * 2;
      const rightW = CONTENT_W - leftW - GAP * 2;
      return [
        ...titleBlock(num, 'Development Programme'),
        table({ x: MARGIN, y: CONTENT_Y + 8, w: leftW, h: CONTENT_H - 8 }, 'table.assetMix'),
        chart({ x: rightX, y: CONTENT_Y + 8, w: rightW, h: 280 }, 'chart.assetMix', { title: 'BUA by strategy' }),
        ...captionBlock({ x: rightX, y: CONTENT_Y + 296, w: rightW, h: CONTENT_BOTTOM - (CONTENT_Y + 296) },
          'Reading the mix',
          'The strategy split drives how value is realised: sell-down converts to cash on handover, while operate and lease build a recurring NOI base that carries the exit value.',
          'pale'),
      ];
    },
  }),

  // 7 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'development_timeline', title: 'Development Timeline', group: 'The asset', chrome: 'content',
    available: (m) => m.programme.lanes.length > 0,
    build: (m, seed, num) => {
      const ganttH = 320;
      const capY = CONTENT_Y + 8 + ganttH + GAP;
      const gates = nonEmpty(seed.inputs?.keyGates) ? String(seed.inputs?.keyGates) : PLACEHOLDER('the key gates and approvals');
      return [
        ...titleBlock(num, 'Development Timeline'),
        gantt({ x: MARGIN, y: CONTENT_Y + 8, w: CONTENT_W, h: ganttH }),
        ...captionBlock({ x: MARGIN, y: capY, w: Math.round((CONTENT_W - GAP) * 0.5), h: CONTENT_BOTTOM - capY },
          'Key gates', gates, 'pale'),
        ...captionBlock({ x: MARGIN + Math.round((CONTENT_W - GAP) * 0.5) + GAP, y: capY, w: CONTENT_W - Math.round((CONTENT_W - GAP) * 0.5) - GAP, h: CONTENT_BOTTOM - capY },
          'Reading the programme',
          'Construction and operations windows are phased so capital is not committed all at once; the debt-repaid and exit markers show when the structure de-levers.',
          'navy'),
      ];
    },
  }),

  // 8 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'capex', title: 'Development Costs', group: 'The numbers', chrome: 'content',
    available: (m) => m.devEconomics.tdc > 0.5,
    build: (m, seed, num) => {
      const half = Math.round((CONTENT_W - GAP * 2) * 0.5);
      const rightX = MARGIN + half + GAP * 2;
      const rightW = CONTENT_W - half - GAP * 2;
      return [
        ...titleBlock(num, 'Development Costs'),
        ...kpiRow(['devEconomics.tdc', 'devEconomics.financingCost', 'reMetrics.profitOnCost', 'devEconomics.costToValue'], CONTENT_Y + 8, { h: 86 }),
        chart({ x: MARGIN, y: CONTENT_Y + 8 + 86 + GAP, w: half, h: CONTENT_BOTTOM - (CONTENT_Y + 8 + 86 + GAP) }, 'chart.costStack', { title: 'Cost stack' }),
        table({ x: rightX, y: CONTENT_Y + 8 + 86 + GAP, w: rightW, h: 230 }, 'table.costStack'),
        ...captionBlock({ x: rightX, y: CONTENT_Y + 8 + 86 + GAP + 246, w: rightW, h: CONTENT_BOTTOM - (CONTENT_Y + 8 + 86 + GAP + 246) },
          'Cost efficiency',
          'Profit on cost measures the return the programme earns on every unit of capital committed, before the capital structure is considered.',
          'navy'),
      ];
    },
  }),

  // 9 ────────────────────────────────────────────────────────────────────────
  T({
    id: 'revenue', title: 'Value & Revenue', group: 'The numbers', chrome: 'content',
    available: (m) => m.devEconomics.gdv > 0.5,
    build: (m, seed, num) => {
      const tileY = CONTENT_Y + 8;
      const bodyY = tileY + 86 + GAP;
      const leftW = Math.round(CONTENT_W * 0.4);
      const rightX = MARGIN + leftW + GAP * 2;
      const rightW = CONTENT_W - leftW - GAP * 2;
      return [
        ...titleBlock(num, 'Value & Revenue'),
        ...kpiRow(['devEconomics.gdv', 'devEconomics.profitBeforeFinancing', 'devEconomics.profitAfterFinancing', 'devEconomics.developmentMargin'], tileY, { h: 86 }),
        table({ x: MARGIN, y: bodyY, w: leftW, h: CONTENT_BOTTOM - bodyY }, 'table.valueBridge'),
        ...chartWithCaption({ x: rightX, y: bodyY, w: rightW, h: CONTENT_BOTTOM - bodyY }, 'chart.revenueRecognition',
          'Reading the recognition',
          'Revenue is recognised as handovers complete and recurring assets stabilise, not when cash is collected; the escrow and receivable profile bridges the two.',
          { split: 0.62, chartTitle: 'Revenue recognition by year' }),
      ];
    },
  }),

  // 10 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'operating_performance', title: 'Operating Performance', group: 'The numbers', chrome: 'content',
    available: (m) => m.operating.hasData,
    build: (m, seed, num) => {
      const tileY = CONTENT_Y + 8;
      const bodyY = tileY + 86 + GAP;
      return [
        ...titleBlock(num, 'Operating Performance'),
        ...kpiRow(['operating.peakNoi', 'reMetrics.yieldOnCost', 'reMetrics.capRateAtExit', 'reMetrics.cashOnCashAvg'], tileY, { h: 86 }),
        ...chartWithCaption({ x: MARGIN, y: bodyY, w: CONTENT_W, h: CONTENT_BOTTOM - bodyY }, 'chart.operatingNoi',
          'Reading operations',
          'NOI builds as assets stabilise and sets the exit value through the cap rate. The gap between NOI and EBITDA is the corporate and overhead load carried above asset level.',
          { split: 0.66, chartTitle: 'NOI and EBITDA by year' }),
      ];
    },
  }),

  // 11 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'funding_structure', title: 'Funding Structure', group: 'The numbers', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const half = Math.round((CONTENT_W - GAP * 2) * 0.5);
      const rightX = MARGIN + half + GAP * 2;
      const tableH = 300;
      const capY = CONTENT_Y + 8 + tableH + GAP;
      return [
        ...titleBlock(num, 'Sources & Uses'),
        panelLabel({ x: MARGIN, y: CONTENT_Y + 6, w: half, h: 14 }, 'Sources'),
        table({ x: MARGIN, y: CONTENT_Y + 26, w: half, h: tableH - 20 }, 'table.sources'),
        panelLabel({ x: rightX, y: CONTENT_Y + 6, w: half, h: 14 }, 'Uses'),
        table({ x: rightX, y: CONTENT_Y + 26, w: half, h: tableH - 20 }, 'table.uses'),
        ...captionBlock({ x: MARGIN, y: capY, w: CONTENT_W, h: CONTENT_BOTTOM - capY },
          'How the funding works',
          'Sources and uses balance by construction. Debt is drawn only against the cash deficit each period, so the peak drawn balance is materially lower than the facility that supports it, and customer collections fund a share of the build directly.',
          'navy'),
      ];
    },
  }),

  // 12 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'financing_structure', title: 'Financing Structure', group: 'The numbers', chrome: 'content',
    available: (m) => m.financing.hasDebt,
    build: (m, seed, num) => {
      const leftW = Math.round(CONTENT_W * 0.56);
      const rightX = MARGIN + leftW + GAP * 2;
      const rightW = CONTENT_W - leftW - GAP * 2;
      const bodyY = CONTENT_Y + 8 + 86 + GAP;
      return [
        ...titleBlock(num, 'Financing Structure'),
        ...kpiRow(['capital.peakDebt', 'capital.debtPct', 'financing.paydownPct', 'reMetrics.dscrMin'], CONTENT_Y + 8, { h: 86 }),
        chart({ x: MARGIN, y: bodyY, w: leftW, h: CONTENT_BOTTOM - bodyY }, 'chart.debtBalance', { title: 'Senior debt balance' }),
        table({ x: rightX, y: bodyY, w: rightW, h: 250 }, 'table.facilitySummary'),
        ...captionBlock({ x: rightX, y: bodyY + 266, w: rightW, h: CONTENT_BOTTOM - (bodyY + 266) },
          'De-levering profile',
          'The facility amortises out of operating cash and sell-down proceeds, clearing the balance ahead of exit so the equity carries no residual leverage.',
          'navy'),
      ];
    },
  }),

  // 13 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'returns', title: 'Returns Analysis', group: 'The case', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const rowH = 88;
      const capY = CONTENT_Y + 8 + rowH * 2 + GAP * 2;
      const commentary = nonEmpty(seed.inputs?.returnsCommentary) ? String(seed.inputs?.returnsCommentary)
        : 'The project return is earned on the development spread; the equity return adds the effect of leverage and the timing of distributions.';
      return [
        ...titleBlock(num, 'Returns Analysis'),
        ...kpiRow(['headline.projectIrr', 'headline.equityIrr', 'headline.distributedEquityIrr'], CONTENT_Y + 8, { h: rowH }),
        ...kpiRow(['headline.projectMoic', 'headline.equityMoic', 'returns.npv'], CONTENT_Y + 8 + rowH + GAP, { h: rowH }),
        ...captionBlock({ x: MARGIN, y: capY, w: Math.round((CONTENT_W - GAP) * 0.52), h: CONTENT_BOTTOM - capY },
          'Reading the returns', commentary, 'navy'),
        table({ x: MARGIN + Math.round((CONTENT_W - GAP) * 0.52) + GAP, y: capY, w: CONTENT_W - Math.round((CONTENT_W - GAP) * 0.52) - GAP, h: CONTENT_BOTTOM - capY }, 'table.reMetrics'),
      ];
    },
  }),

  // 14 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'exit_optionality', title: 'Exit-Year Optionality', group: 'The case', chrome: 'content',
    available: (m) => m.exitYears.length > 1,
    build: (m, seed, num) => {
      const leftW = Math.round(CONTENT_W * 0.5);
      const rightX = MARGIN + leftW + GAP * 2;
      const rightW = CONTENT_W - leftW - GAP * 2;
      const capH = 96;
      const bodyH = CONTENT_H - capH - GAP - 8;
      const commentary = nonEmpty(seed.inputs?.exitCommentary) ? String(seed.inputs?.exitCommentary)
        : 'Exit timing is optionality, not a fixed assumption: holding longer trades a lower IRR for a higher multiple as the recurring base matures.';
      return [
        ...titleBlock(num, 'Exit-Year Optionality'),
        table({ x: MARGIN, y: CONTENT_Y + 8, w: leftW, h: bodyH }, 'table.exitYears'),
        chart({ x: rightX, y: CONTENT_Y + 8, w: rightW, h: bodyH }, 'chart.exitMoic', { title: 'Equity MOIC by exit year' }),
        ...captionBlock({ x: MARGIN, y: CONTENT_Y + 8 + bodyH + GAP, w: CONTENT_W, h: capH }, 'Timing is optionality', commentary, 'pale'),
      ];
    },
  }),

  // 15 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'sensitivity', title: 'Sensitivity Analysis', group: 'The case', chrome: 'content',
    available: (m) => m.sensitivity.hasData,
    build: (m, seed, num) => {
      const leftW = Math.round(CONTENT_W * 0.62);
      const rightX = MARGIN + leftW + GAP * 2;
      const rightW = CONTENT_W - leftW - GAP * 2;
      return [
        ...titleBlock(num, 'Sensitivity Analysis'),
        heatmap({ x: MARGIN, y: CONTENT_Y + 8, w: leftW, h: CONTENT_H - 8 }, { title: 'Equity IRR' }),
        ...captionBlock({ x: rightX, y: CONTENT_Y + 8, w: rightW, h: CONTENT_H - 8 },
          'Driver swing',
          `Equity IRR is graded across ${m.sensitivity.xVariable} and ${m.sensitivity.yVariable}. The base case sits at the centre; the grid shows how much room the return has before it breaks the committee's hurdle.`,
          'pale'),
      ];
    },
  }),

  // 16 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'scenario_comparison', title: 'Scenario Comparison', group: 'The case', chrome: 'content',
    available: (m) => !!m.scenarios && m.scenarios.columns.length > 1,
    build: (m, seed, num) => {
      const half = Math.round((CONTENT_W - GAP * 2) * 0.5);
      const rightX = MARGIN + half + GAP * 2;
      const chartH = 250;
      const capY = CONTENT_Y + 8 + chartH + GAP;
      const takeaway = nonEmpty(seed.inputs?.scenarioTakeaway) ? String(seed.inputs?.scenarioTakeaway)
        : 'The case holds across the range tested: the downside stays above water, and the upside is not required to justify the commitment.';
      return [
        ...titleBlock(num, 'Scenario Comparison'),
        chart({ x: MARGIN, y: CONTENT_Y + 8, w: half, h: chartH }, 'chart.scenarioIrr', { title: 'IRR by case' }),
        chart({ x: rightX, y: CONTENT_Y + 8, w: half, h: chartH }, 'chart.scenarioNpv', { title: 'NPV by case' }),
        table({ x: MARGIN, y: capY, w: half, h: CONTENT_BOTTOM - capY }, 'table.scenarioReturns'),
        ...captionBlock({ x: rightX, y: capY, w: half, h: CONTENT_BOTTOM - capY }, 'Takeaway', takeaway, 'navy'),
      ];
    },
  }),

  // 17 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'key_risks', title: 'Key Risks', group: 'Closing', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const seeded = seed.inputs?.risks?.length
        ? seed.inputs.risks.map((r) => {
            const row = r as { title?: string; mitigant?: string };
            return { risk: row.title ?? '', likelihood: 'Medium' as const, impact: 'Medium' as const, mitigation: row.mitigant ?? '' };
          }).filter((r) => r.risk)
        : [];
      const rows = seeded.length ? seeded : [
        { risk: PLACEHOLDER('a delivery risk'), likelihood: 'Medium' as const, impact: 'High' as const, mitigation: PLACEHOLDER('the mitigant') },
        { risk: PLACEHOLDER('a market risk'), likelihood: 'Medium' as const, impact: 'High' as const, mitigation: PLACEHOLDER('the mitigant') },
        { risk: PLACEHOLDER('a funding risk'), likelihood: 'Low' as const, impact: 'High' as const, mitigation: PLACEHOLDER('the mitigant') },
      ];
      return [
        ...titleBlock(num, 'Key Risks & Mitigants'),
        riskMatrix({ x: MARGIN, y: CONTENT_Y + 8, w: CONTENT_W, h: CONTENT_H - 8 }, rows),
      ];
    },
  }),

  // 18 ───────────────────────────────────────────────────────────────────────
  T({
    id: 'recommendation', title: 'Investment Recommendation', group: 'Closing', chrome: 'content',
    available: () => true,
    build: (m, seed, num) => {
      const askY = CONTENT_Y + 8;
      const blockY = askY + 96 + GAP;
      const leftW = Math.round(CONTENT_W * 0.58);
      const rightX = MARGIN + leftW + GAP * 2;
      const rightW = CONTENT_W - leftW - GAP * 2;
      const rec = nonEmpty(seed.inputs?.recommendation) ? String(seed.inputs?.recommendation) : PLACEHOLDER('the recommendation and the approval sought');
      const conditions = seed.inputs?.conditionsPrecedent?.length
        ? seed.inputs.conditionsPrecedent.map((x) => (typeof x === 'string' ? x : String(x))).filter(Boolean)
        : [PLACEHOLDER('a condition precedent')];
      const next = nonEmpty(seed.inputs?.nextSteps) ? toPoints(seed.inputs?.nextSteps, []) : [PLACEHOLDER('a next step')];
      return [
        ...titleBlock(num, 'Investment Recommendation'),
        ...kpiRow(['ask.equityCommitment', 'capital.peakDebt', 'headline.equityIrr'], askY, { h: 96 }),
        ...captionBlock({ x: MARGIN, y: blockY, w: leftW, h: CONTENT_BOTTOM - blockY }, 'The Committee is asked to approve', rec, 'green'),
        panelLabel({ x: rightX, y: blockY, w: rightW, h: 14 }, 'Conditions precedent'),
        bullets({ x: rightX, y: blockY + 22, w: rightW, h: 150 }, conditions, { ...textStyles.caption(), size: 12 }, { numbered: true }),
        panelLabel({ x: rightX, y: blockY + 184, w: rightW, h: 14 }, 'Next steps'),
        bullets({ x: rightX, y: blockY + 206, w: rightW, h: CONTENT_BOTTOM - (blockY + 206) }, next, { ...textStyles.caption(), size: 12 }),
      ];
    },
  }),

  // 19 (appendix) ────────────────────────────────────────────────────────────
  T({
    id: 'appendix', title: 'Appendix', group: 'Closing', chrome: 'content',
    available: (m) => m.phasing.length > 0,
    build: (m, seed, num) => {
      const half = Math.round((CONTENT_W - GAP * 2) * 0.5);
      const rightX = MARGIN + half + GAP * 2;
      const disclaimers = nonEmpty(seed.inputs?.disclaimers) ? String(seed.inputs?.disclaimers)
        : 'This presentation is confidential and prepared for the recipient only. Figures are model outputs based on stated assumptions and do not constitute a forecast, valuation or offer.';
      const discH = 84;
      const bodyH = CONTENT_H - discH - GAP - 8;
      return [
        ...titleBlock(num, 'Appendix'),
        panelLabel({ x: MARGIN, y: CONTENT_Y + 6, w: half, h: 14 }, 'Phasing schedule'),
        table({ x: MARGIN, y: CONTENT_Y + 26, w: half, h: bodyH - 18 }, 'table.phasing'),
        panelLabel({ x: rightX, y: CONTENT_Y + 6, w: half, h: 14 }, 'Development economics'),
        table({ x: rightX, y: CONTENT_Y + 26, w: half, h: bodyH - 18 }, 'table.devEconomics'),
        text({ x: MARGIN, y: CONTENT_Y + 8 + bodyH + GAP, w: CONTENT_W, h: discH }, disclaimers,
          { ...textStyles.caption(), size: 9, color: DECK_THEME.slateLight }),
      ];
    },
  }),
];

export const TEMPLATE_BY_ID: Record<string, SlideTemplate> =
  Object.fromEntries(SLIDE_TEMPLATES.map((t) => [t.id, t]));

// ── Deck assembly ───────────────────────────────────────────────────────────

/** Build one slide from a template. Exported so "reset to layout" and the Insert
 *  menu both go through the same path the seeder does. */
export function buildSlideFromTemplate(t: SlideTemplate, m: ICReportModel, seed: TemplateSeed, num: string): Slide {
  return {
    id: deckId('sld'),
    title: t.title,
    chrome: t.chrome,
    finding: '',
    objects: t.build(m, seed, num),
    templateId: t.id,
  };
}

/**
 * Seed a whole deck for a project. Templates the model cannot support are omitted
 * rather than shipped blank, and section numbering is assigned AFTER omission so
 * the chips read 01..N with no gaps.
 */
export function seedDeck(projectId: string, m: ICReportModel, seed: TemplateSeed, opt: { asOf: string; title?: string }): Deck {
  resetDeckIds();
  const usable = SLIDE_TEMPLATES.filter((t) => t.available(m, seed));
  let n = 0;
  const slides = usable.map((t) => {
    // The cover carries no section chip, and is excluded from the numbering.
    const num = t.chrome === 'cover' ? '' : String(++n).padStart(2, '0');
    return buildSlideFromTemplate(t, m, seed, num);
  });
  const inputs = seed.inputs;
  return {
    schemaVersion: DECK_SCHEMA_VERSION,
    projectId,
    title: opt.title ?? `${m.cover.projectName} Investment Committee`,
    slides,
    branding: {
      ...DEFAULT_BRANDING,
      headerText: inputs?.headerText?.trim() ? inputs.headerText : DEFAULT_BRANDING.headerText,
      footerText: inputs?.footerText?.trim() ? inputs.footerText : DEFAULT_BRANDING.footerText,
      fontHeading: inputs?.fontHeading?.trim() ? inputs.fontHeading : DEFAULT_BRANDING.fontHeading,
      fontBody: inputs?.fontBody?.trim() ? inputs.fontBody : DEFAULT_BRANDING.fontBody,
    },
    settings: {
      deckCase: inputs?.icDeckCase === 'active' ? 'active' : 'management',
      moneyScale: inputs?.icMoneyScale === 'thousands' ? 'thousands' : 'millions',
      asOf: opt.asOf,
    },
  };
}

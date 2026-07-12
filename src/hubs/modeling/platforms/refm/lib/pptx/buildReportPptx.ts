/**
 * buildReportPptx.ts (REFM Module 7 Reports, Phase 3a)
 *
 * ONE PPT exporter for all three report types (IC / Lender / One-Pager). It
 * renders from the SAME (report model + ReportInputs + ordered sections) pair the
 * on-screen preview uses, so the deck mirrors the preview exactly: same visible
 * sections in the same order (show/hide + reorder respected), same snapshot
 * numbers, narrative from the form. Snapshot read-only: no engine call here.
 *
 * The deck is a 16:9 editable master: a navy header band, a Table of Contents
 * slide with clickable internal links to each section, a divider slide before
 * each section, KPI tiles, and the Lender covenant heatmap (green pass / red
 * fail per period). The editable header/footer text and the chosen fonts are
 * applied. Fonts are written as NAMED faces (pptxgenjs does not embed font
 * files): PowerPoint substitutes a default face if the viewer lacks the named
 * font, so the layout is preserved and only the glyphs change.
 *
 * Returns the pptxgen instance (caller decides output: browser -> write blob,
 * Node/verifier -> write nodebuffer).
 *
 * No em dashes in this file.
 */

import PptxGenJS from 'pptxgenjs';
import { SECTIONS, type ReportType, type ReportInputs, type ICSectionKey } from '../reportInputs';
import { icSectionOmitted, type ICReportModel } from '../reports/icReport';
import type { LenderReportModel, LenderCovenantRow } from '../reports/lenderReport';
import type { OnePagerReportModel } from '../reports/onePagerReport';
import type { CaseComparisonReport } from '../reports/caseComparisonReport';

// Brand hex WITHOUT '#', as pptxgenjs expects.
const B = { navy: '1B4F8A', white: 'FFFFFF', slate: '5A6675', pale: 'DDE7F3', mid: '7FA8D9', green: '2E7D52', red: 'DC2626', border: 'C9D8EC', ink: '1A2230', paleBg: 'EEF3FA' };

const REPORT_LABEL: Record<ReportType, string> = { ic: 'Investment Committee Report', lender: 'Lender Package', onepager: 'Investor One-Pager' };

const pct = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const mult = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(2)}x`);
const covFmt = (v: number | null, unit: 'x' | 'pct'): string => (v == null || !Number.isFinite(v) ? 'n/a' : unit === 'pct' ? pct(v) : mult(v));

export interface BuildReportPptxInput {
  reportType: ReportType;
  projectName: string;
  inputs: ReportInputs;
  fmt: (n: number) => string;
  currency: string;
  asOf: string;
  ic?: ICReportModel;
  lender?: LenderReportModel;
  onePager?: OnePagerReportModel;
  scenarios?: CaseComparisonReport | null;
}

const MASTER = 'FMP_MASTER';
// LAYOUT_WIDE = 13.33 x 7.5 in.
const PW = 13.33, PH = 7.5, MX = 0.5, CONTENT_Y = 1.0, CONTENT_W = PW - MX * 2;

export function buildReportPptx(input: BuildReportPptxInput): PptxGenJS {
  const { reportType, projectName, inputs, fmt, currency, asOf } = input;
  const fontBody = inputs.fontBody || 'Calibri';
  const fontHeading = inputs.fontHeading || 'Cambria';
  const reportLabel = REPORT_LABEL[reportType];

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Financial Modeler Pro';
  pptx.company = 'Financial Modeler Pro';
  pptx.title = `${projectName} - ${reportLabel}`;

  const headerLeft = inputs.headerText.trim() || 'Financial Modeler Pro · Strictly Private & Confidential';
  const headerRight = `${projectName} · ${reportLabel}`;
  const footerText = inputs.footerText.trim() || 'Strictly Private & Confidential';

  pptx.defineSlideMaster({
    title: MASTER,
    background: { color: B.white },
    objects: [
      { rect: { x: 0, y: 0, w: PW, h: 0.5, fill: { color: B.navy } } },
      { text: { text: headerLeft, options: { x: 0.3, y: 0, w: 8.2, h: 0.5, color: B.white, fontSize: 9, fontFace: fontBody, valign: 'middle' } } },
      { text: { text: headerRight, options: { x: 8.3, y: 0, w: 4.7, h: 0.5, color: B.white, fontSize: 9, fontFace: fontBody, align: 'right', valign: 'middle' } } },
      { line: { x: MX, y: PH - 0.35, w: CONTENT_W, h: 0, line: { color: B.border, width: 0.75 } } },
      { text: { text: footerText, options: { x: MX, y: PH - 0.33, w: 9, h: 0.3, color: B.slate, fontSize: 8, fontFace: fontBody, valign: 'middle' } } },
    ],
    slideNumber: { x: PW - 0.9, y: PH - 0.33, w: 0.6, h: 0.3, color: B.slate, fontSize: 8, fontFace: fontBody, align: 'right' },
  });

  // Ordered, visible sections; the 'cover' section (if any) is consumed by the
  // deck cover slide, so nav = everything else.
  const ordered = [...(inputs.sectionConfig[reportType] ?? [])].sort((a, b) => a.order - b.order).filter((s) => s.visible);
  const labelFor = (key: string): string => SECTIONS[reportType].find((s) => s.key === key)?.label ?? key;
  // AUTO-OMIT: for IC, drop sections whose model data is absent / trivial or whose
  // FORM field is empty (shared predicate with the preview), so the deck never
  // carries an empty tile / blank narrative slide. Filter BEFORE numbering so the
  // TOC links + dividerSlideOf indices stay consistent.
  const nav = ordered
    .filter((s) => s.key !== 'cover')
    .filter((s) => !(reportType === 'ic' && input.ic && icSectionOmitted(s.key as ICSectionKey, input.ic, inputs)));
  // Slide plan: cover=1, toc=2, then per nav section [divider, content].
  const dividerSlideOf = (i: number): number => 3 + i * 2;

  // ── heading + text helpers ──
  const heading = (slide: PptxGenJS.Slide, text: string, sub?: string): void => {
    slide.addText(text, { x: MX, y: 0.62, w: CONTENT_W, h: 0.45, fontFace: fontHeading, fontSize: 22, bold: true, color: B.navy });
    slide.addShape(pptx.ShapeType.line, { x: MX, y: 1.06, w: CONTENT_W, h: 0, line: { color: B.pale, width: 1.5 } });
    if (sub) slide.addText(sub, { x: MX, y: 0.7, w: CONTENT_W, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.slate, align: 'right' });
  };
  const narrative = (slide: PptxGenJS.Slide, text: string, empty: string): void => {
    slide.addText(text.trim() || empty, { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, h: 4.5, fontFace: fontBody, fontSize: 13, color: text.trim() ? B.ink : B.slate, italic: !text.trim(), valign: 'top', lineSpacingMultiple: 1.3 });
  };
  // KPI tiles, up to `perRow` per row, starting at y.
  const kpiTiles = (slide: PptxGenJS.Slide, tiles: Array<{ label: string; value: string; sub?: string; good?: boolean }>, y: number, perRow = 4): void => {
    const gap = 0.2, w = (CONTENT_W - gap * (perRow - 1)) / perRow, h = 1.05;
    tiles.forEach((t, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = MX + col * (w + gap), ty = y + row * (h + gap);
      slide.addShape(pptx.ShapeType.roundRect, { x, y: ty, w, h, fill: { color: B.pale }, line: { color: B.border, width: 0.75 }, rectRadius: 0.06 });
      slide.addText(t.label.toUpperCase(), { x: x + 0.12, y: ty + 0.1, w: w - 0.24, h: 0.25, fontFace: fontBody, fontSize: 8, bold: true, color: B.slate });
      slide.addText(t.value, { x: x + 0.12, y: ty + 0.34, w: w - 0.24, h: 0.4, fontFace: fontHeading, fontSize: 20, bold: true, color: t.good ? B.green : B.navy });
      if (t.sub) slide.addText(t.sub, { x: x + 0.12, y: ty + 0.76, w: w - 0.24, h: 0.22, fontFace: fontBody, fontSize: 8, color: B.slate });
    });
  };
  const factGrid = (slide: PptxGenJS.Slide, facts: Array<{ label: string; value: string }>, y: number): void => {
    const perRow = 3, gap = 0.2, w = (CONTENT_W - gap * (perRow - 1)) / perRow, h = 0.7;
    facts.forEach((f, i) => {
      const col = i % perRow, row = Math.floor(i / perRow);
      const x = MX + col * (w + gap), ty = y + row * (h + gap);
      slide.addText(f.label.toUpperCase(), { x, y: ty, w, h: 0.25, fontFace: fontBody, fontSize: 8, bold: true, color: B.slate });
      slide.addText(f.value, { x, y: ty + 0.24, w, h: 0.4, fontFace: fontBody, fontSize: 12, color: B.ink, valign: 'top' });
    });
  };
  // Period table (years as columns).
  const periodTable = (slide: PptxGenJS.Slide, yearLabels: number[], rows: Array<{ label: string; values: number[] }>, y: number): void => {
    const header = [{ text: 'Line', options: { fill: { color: B.navy }, color: B.white, bold: true, align: 'left', fontSize: 8 } },
      ...yearLabels.map((yl) => ({ text: String(yl), options: { fill: { color: B.navy }, color: B.white, bold: true, align: 'right', fontSize: 8 } }))];
    const body = rows.map((r) => [{ text: r.label, options: { align: 'left', fontSize: 8, color: B.ink } },
      ...yearLabels.map((_, i) => ({ text: fmt(r.values[i] ?? 0), options: { align: 'right', fontSize: 8, color: B.ink } }))]);
    slide.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y, w: CONTENT_W, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
  };
  // Generic data table: first header cell left-aligned, rest right; first body
  // column left, rest right. `emphasis` rows (by index) render bold navy.
  const dataTable = (slide: PptxGenJS.Slide, headers: string[], rows: string[][], y: number, emphasis: Set<number> = new Set(), fs = 9): void => {
    const header = headers.map((t, i) => ({ text: t, options: { fill: { color: B.navy }, color: B.white, bold: true, align: (i === 0 ? 'left' : 'right') as 'left' | 'right', fontSize: fs } }));
    const body = rows.map((r, ri) => r.map((cell, ci) => ({ text: cell, options: { align: (ci === 0 ? 'left' : 'right') as 'left' | 'right', fontSize: fs, bold: emphasis.has(ri), color: emphasis.has(ri) ? B.navy : B.ink } })));
    slide.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y, w: CONTENT_W, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
  };
  // Bulleted / numbered narrative text block.
  const bulletList = (slide: PptxGenJS.Slide, lines: string[], y: number, numbered = false): void => {
    const runs = lines.map((t) => ({ text: t, options: { bullet: numbered ? { type: 'number' as const } : true, fontSize: 12, color: B.ink, paraSpaceAfter: 6 } }));
    slide.addText(runs as PptxGenJS.TextProps[], { x: MX, y, w: CONTENT_W, h: 4.5, fontFace: fontBody, valign: 'top', lineSpacingMultiple: 1.2 });
  };
  // Small two-column money list (Sources / Uses), with a total row.
  const moneyList = (slide: PptxGenJS.Slide, title: string, rows: Array<{ label: string; value: number }>, total: number, x: number, y: number): void => {
    slide.addText(title, { x, y, w: CONTENT_W / 2 - 0.2, h: 0.3, fontFace: fontBody, fontSize: 11, bold: true, color: B.navy });
    const shown = rows.filter((r) => Math.abs(r.value) > 0.5);
    shown.forEach((r, i) => {
      const ry = y + 0.35 + i * 0.32;
      slide.addText(r.label, { x, y: ry, w: 3.4, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.slate });
      slide.addText(fmt(r.value), { x: x + 2.6, y: ry, w: 2.4, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.ink, align: 'right' });
    });
    const yt = y + 0.35 + shown.length * 0.32 + 0.05;
    slide.addText(`Total ${title}`, { x, y: yt, w: 3.4, h: 0.3, fontFace: fontBody, fontSize: 10, bold: true, color: B.navy });
    slide.addText(fmt(total), { x: x + 2.6, y: yt, w: 2.4, h: 0.3, fontFace: fontBody, fontSize: 10, bold: true, color: B.navy, align: 'right' });
  };
  const sbridge = (v: number): string => (v < 0 ? `(${fmt(Math.abs(v))})` : fmt(v));
  const sensVarLabel = (v: string): string => ({ exit_cap_rate: 'Exit cap rate', discount_rate: 'Discount rate', sales_price_pct: 'Sales price', adr_pct: 'ADR', construction_cost_pct: 'Construction cost' }[v] ?? v);
  const sensVal = (variable: string, v: number): string => (variable === 'exit_cap_rate' || variable === 'discount_rate') ? pct(v) : `${v > 0 ? '+' : ''}${pct(v)}`;

  // ── Cover slide (deck level; consumes the 'cover' section if present) ──
  const cover = pptx.addSlide();
  cover.background = { color: B.navy };
  cover.addText(reportLabel.toUpperCase(), { x: 0.7, y: 1.6, w: 11.9, h: 0.4, fontFace: fontBody, fontSize: 13, color: B.mid, charSpacing: 3 });
  cover.addText(projectName || 'Untitled Project', { x: 0.7, y: 2.1, w: 11.9, h: 1.1, fontFace: fontHeading, fontSize: 40, bold: true, color: B.white });
  const coverLoc = reportType === 'onepager' ? (input.onePager?.dealAtAGlance.location ?? '') : reportType === 'lender' ? (input.lender?.cover.location ?? '') : (input.ic?.cover.location ?? '');
  cover.addText(coverLoc || 'Location not set', { x: 0.7, y: 3.2, w: 11.9, h: 0.5, fontFace: fontBody, fontSize: 16, color: B.pale });
  cover.addText(`As of ${asOf}`, { x: 0.7, y: 4.0, w: 6, h: 0.4, fontFace: fontBody, fontSize: 12, color: B.pale });
  cover.addText('Strictly Private & Confidential. For the intended recipient only.', { x: 0.7, y: 6.5, w: 11.9, h: 0.4, fontFace: fontBody, fontSize: 10, color: B.mid });

  // ── Table of Contents (clickable internal links) ──
  const toc = pptx.addSlide({ masterName: MASTER });
  heading(toc, 'Contents');
  nav.forEach((sec, i) => {
    const y = CONTENT_Y + 0.3 + i * 0.5;
    const num = String(i + 1).padStart(2, '0');
    const link = { slide: dividerSlideOf(i), tooltip: labelFor(sec.key) };
    // The hyperlink must sit on the text RUNS (not the box options) for pptxgenjs
    // to emit the internal slide relationship, so both runs carry it.
    toc.addText(
      [{ text: `${num}   `, options: { color: B.mid, bold: true, hyperlink: link } }, { text: labelFor(sec.key), options: { color: B.navy, hyperlink: link } }],
      { x: MX, y, w: CONTENT_W, h: 0.42, fontFace: fontBody, fontSize: 14, valign: 'middle' },
    );
  });

  // ── Section divider + content slides ──
  nav.forEach((sec, i) => {
    const num = String(i + 1).padStart(2, '0');
    // Divider.
    const div = pptx.addSlide({ masterName: MASTER });
    div.addShape(pptx.ShapeType.rect, { x: 0, y: 2.6, w: PW, h: 2.3, fill: { color: B.paleBg } });
    div.addText(num, { x: MX, y: 2.5, w: 2, h: 1.4, fontFace: fontHeading, fontSize: 60, bold: true, color: B.mid });
    div.addText(labelFor(sec.key), { x: 2.4, y: 3.0, w: CONTENT_W - 2, h: 1.0, fontFace: fontHeading, fontSize: 30, bold: true, color: B.navy, valign: 'middle' });
    div.addText([{ text: 'Back to contents', options: { hyperlink: { slide: 2, tooltip: 'Contents' } } }], { x: MX, y: PH - 0.7, w: 3, h: 0.3, fontFace: fontBody, fontSize: 9, color: B.slate });
    // Content.
    const c = pptx.addSlide({ masterName: MASTER });
    heading(c, `${num}  ${labelFor(sec.key)}`);
    if (reportType === 'ic') renderIC(c, sec.key);
    else if (reportType === 'lender') renderLender(c, sec.key);
    else renderOnePager(c, sec.key);
  });

  // ── IC content (A+B full model-driven structure) ──
  // Scenario KPI matrix helper (shared by cases + economics).
  const scenarioTable = (c: PptxGenJS.Slide, labels: string[], y: number): void => {
    const sc = input.scenarios;
    if (!sc) return;
    const kdef = (label: string) => sc.kpis.find((k) => k.label === label);
    const fk = (v: number | null | undefined, kind?: string): string => (v == null || !Number.isFinite(v)) ? 'n/a' : kind === 'pct' ? pct(v) : kind === 'mult' ? mult(v) : fmt(v);
    const headers = ['Metric', ...sc.columns.map((col) => `${col.role === 'base' ? '★ ' : ''}${col.name}`)];
    const rows = labels.map((label) => [label, ...sc.columns.map((col) => fk(col.values[label], kdef(label)?.kind))]);
    dataTable(c, headers, rows, y);
  };

  function renderIC(c: PptxGenJS.Slide, key: string): void {
    const m = input.ic!;
    const topNote = (): void => { c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate }); };
    switch (key as ICSectionKey) {
      case 'executive_summary':
        if (inputs.execPoints.length) bulletList(c, inputs.execPoints.map((p) => (p.title ? `${p.title}. ${p.body}` : p.body)), CONTENT_Y + 0.3, true);
        else narrative(c, inputs.executiveSummary, 'No executive summary provided.');
        break;
      case 'investment_recommendation': {
        const a = m.ask;
        topNote();
        const tiles = [
          { label: 'Equity Commitment', value: fmt(a.equityCommitment), sub: `existing ${fmt(a.existingEquity)} + in-kind ${fmt(a.inKindEquity)}` },
          ...(a.peakDebt > 0.5 ? [{ label: 'Senior Debt (peak)', value: fmt(a.peakDebt), sub: `existing ${fmt(a.existingDebt)} + new ${fmt(a.newDebt)}` }] : []),
          { label: 'Target Returns', value: `${pct(a.projectIrr)} / ${pct(a.equityIrr)}`, sub: `Project / Equity IRR, ${mult(a.equityMoic)} MOIC`, good: true },
        ];
        kpiTiles(c, tiles, CONTENT_Y + 0.4, 3);
        if (inputs.recommendation.trim()) c.addText(inputs.recommendation, { x: MX, y: CONTENT_Y + 1.9, w: CONTENT_W, h: 3, fontFace: fontBody, fontSize: 12, color: B.ink, valign: 'top', lineSpacingMultiple: 1.3 });
        break;
      }
      case 'project_overview': {
        const o = m.overview;
        const facts = [
          { label: 'Location', value: [o.location, o.country].filter(Boolean).join(', ') || 'n/a' },
          ...(o.landAreaSqm > 0 ? [{ label: 'Land area', value: `${o.landAreaSqm.toLocaleString()} sqm` }] : []),
          ...(o.totalBua > 0 ? [{ label: 'Built-up area', value: `${Math.round(o.totalBua).toLocaleString()} sqm` }] : []),
          { label: 'Strategy mix', value: o.strategyMix || 'n/a' },
          { label: 'Model horizon', value: `${o.startYear} to ${o.exitYear} (${o.durationYears} yrs)` },
          { label: 'Funding', value: o.fundingMethodLabel },
        ];
        if (o.sponsors.length) facts.push({ label: 'Sponsor', value: o.sponsors.map((p) => p.name).join(', ') });
        if (o.developers.length) facts.push({ label: 'Developer', value: o.developers.map((p) => p.name).join(', ') });
        if (o.investors.length) facts.push({ label: 'Investor(s)', value: o.investors.map((p) => p.name).join(', ') });
        factGrid(c, facts, CONTENT_Y + 0.3);
        if (inputs.developmentConcept.trim()) c.addText(inputs.developmentConcept, { x: MX, y: CONTENT_Y + 3.0, w: CONTENT_W, h: 2, fontFace: fontBody, fontSize: 11, color: B.ink, valign: 'top', lineSpacingMultiple: 1.3 });
        break;
      }
      case 'master_plan':
        topNote();
        dataTable(c, ['Phase', 'From', 'Assets', 'Capex'],
          m.phasing.map((ph) => [`${ph.name}${ph.strategies ? ` (${ph.strategies})` : ''}`, ph.startYear ? String(ph.startYear) : '-', String(ph.assetCount), fmt(ph.capex)]),
          CONTENT_Y + 0.35);
        break;
      case 'asset_mix':
        dataTable(c, ['Asset', 'Strategy', 'Phase', 'BUA (sqm)', 'Units'],
          [...m.assetMix.rows.map((r) => [r.name, r.strategy, r.phaseName || '-', r.bua > 0 ? Math.round(r.bua).toLocaleString() : '-', r.units > 0 ? String(r.units) : '-']),
            ['Total', '', '', Math.round(m.assetMix.totalBua).toLocaleString(), String(m.assetMix.totalUnits)]],
          CONTENT_Y + 0.3, new Set([m.assetMix.rows.length]));
        c.addText(`Built-up area by strategy: ${m.assetMix.byStrategy.map((s) => `${s.strategy} ${pct(s.pct)}`).join('  ·  ')}`,
          { x: MX, y: PH - 0.9, w: CONTENT_W, h: 0.4, fontFace: fontBody, fontSize: 10, color: B.slate });
        break;
      case 'market_context': {
        const mc = inputs.marketContext;
        if (mc.points.length) bulletList(c, mc.points.map((p) => (p.title ? `${p.title}. ${p.body}` : p.body)), CONTENT_Y + 0.3, true);
        if (mc.stats.length) kpiTiles(c, mc.stats.map((s) => ({ label: s.label, value: s.value })), CONTENT_Y + 0.3 + Math.min(3, mc.points.length) * 0.5 + 0.3, 3);
        if (mc.sourcesNote.trim()) c.addText(mc.sourcesNote, { x: MX, y: PH - 0.75, w: CONTENT_W, h: 0.35, fontFace: fontBody, fontSize: 9, italic: true, color: B.slate });
        break;
      }
      case 'development_programme':
        topNote();
        if (m.phasing.length) dataTable(c, ['Phase', 'From', 'Capex'], m.phasing.map((ph) => [`${ph.name}${ph.strategies ? ` (${ph.strategies})` : ''}`, ph.startYear ? String(ph.startYear) : '-', fmt(ph.capex)]), CONTENT_Y + 0.35);
        if (inputs.keyGates.trim()) c.addText(inputs.keyGates, { x: MX, y: PH - 1.6, w: CONTENT_W, h: 1.2, fontFace: fontBody, fontSize: 11, color: B.ink, valign: 'top', lineSpacingMultiple: 1.25 });
        break;
      case 'development_costs':
        topNote();
        dataTable(c, ['Cost stack', currency], m.costStack.map((r) => [r.label, sbridge(r.value)]), CONTENT_Y + 0.35, new Set(m.costStack.map((r, i) => (r.emphasis ? i : -1)).filter((i) => i >= 0)));
        break;
      case 'value_economics': {
        const d = m.devEconomics;
        topNote();
        kpiTiles(c, [
          { label: 'GDV', value: fmt(d.gdv) },
          { label: 'Profit before Fin.', value: fmt(d.profitBeforeFinancing), good: d.profitBeforeFinancing >= 0 },
          { label: 'Profit after Fin.', value: fmt(d.profitAfterFinancing), good: d.profitAfterFinancing >= 0 },
          { label: 'Development Margin', value: pct(d.developmentMargin), sub: 'profit / GDV', good: (d.developmentMargin ?? 0) >= 0 },
        ], CONTENT_Y + 0.4, 4);
        dataTable(c, ['Value bridge', currency], m.valueBridge.map((r) => [r.label, sbridge(r.value)]), CONTENT_Y + 1.85, new Set(m.valueBridge.map((r, i) => (r.emphasis ? i : -1)).filter((i) => i >= 0)));
        break;
      }
      case 'sources_uses':
        topNote();
        moneyList(c, 'Sources', m.sourcesUses.sources, m.sourcesUses.totalSources, MX, CONTENT_Y + 0.4);
        moneyList(c, 'Uses', m.sourcesUses.uses, m.sourcesUses.totalUses, MX + CONTENT_W / 2 + 0.2, CONTENT_Y + 0.4);
        break;
      case 'financing_structure': {
        const f = m.financing;
        const facts = [
          { label: 'Funding method', value: f.fundingMethodLabel },
          { label: 'Existing debt', value: fmt(f.existingDebt) },
          { label: 'New debt', value: fmt(f.newDebt) },
          { label: 'Peak debt', value: fmt(f.peakDebt) },
          { label: 'Debt tenor', value: f.tenorYears == null ? 'n/a' : `${f.tenorYears} yrs` },
          { label: 'Debt paydown', value: f.paydownPct == null ? 'n/a' : `${pct(f.paydownPct)} by exit` },
          { label: 'Debt at exit', value: fmt(f.remainingDebtAtExit) },
          ...(f.customerCollections > 0.5 ? [{ label: 'Customer collections', value: fmt(f.customerCollections) }] : []),
          ...(f.minCashReserve > 0.5 ? [{ label: 'Minimum cash reserve', value: fmt(f.minCashReserve) }] : []),
        ];
        topNote();
        factGrid(c, facts, CONTENT_Y + 0.4);
        break;
      }
      case 'returns_analysis': {
        const h = m.headline; const re = m.reMetrics;
        topNote();
        kpiTiles(c, [
          { label: 'Project IRR', value: pct(h.projectIrr), sub: 'unlevered', good: true },
          { label: 'Equity IRR', value: pct(h.equityIrr), sub: 'levered', good: true },
          { label: 'Distributed IRR', value: pct(h.distributedEquityIrr), sub: 'dividends' },
          { label: 'Equity Multiple', value: mult(h.equityMultiple), sub: 'distributions / invested' },
          { label: 'Yield on Cost', value: pct(re.yieldOnCost) },
          { label: 'Cap Rate at Exit', value: pct(re.capRateAtExit) },
          { label: 'Profit on Cost', value: pct(re.profitOnCost) },
          { label: 'Terminal Equity', value: fmt(h.terminalEquity), sub: `exit ${m.overview.exitYear}` },
        ], CONTENT_Y + 0.4, 4);
        if (inputs.returnsCommentary.trim()) c.addText(inputs.returnsCommentary, { x: MX, y: PH - 1.6, w: CONTENT_W, h: 1.2, fontFace: fontBody, fontSize: 11, color: B.ink, valign: 'top', lineSpacingMultiple: 1.25 });
        break;
      }
      case 'exit_optionality':
        topNote();
        dataTable(c, ['Exit year', 'Equity value', 'Project IRR', 'Equity IRR', 'Equity MOIC'],
          m.exitYears.map((r) => [`${r.year}${r.selected ? ' (selected)' : ''}`, fmt(r.equityValue), pct(r.projectIrr), pct(r.equityIrr), mult(r.equityMoic)]),
          CONTENT_Y + 0.35);
        if (inputs.exitCommentary.trim()) c.addText(inputs.exitCommentary, { x: MX, y: PH - 1.4, w: CONTENT_W, h: 1.0, fontFace: fontBody, fontSize: 10, color: B.ink, valign: 'top', lineSpacingMultiple: 1.2 });
        break;
      case 'scenario_cases':
        if (!input.scenarios) break;
        scenarioTable(c, ['Equity IRR (FCFE)', 'Project IRR (FCFF)', 'Equity MOIC', 'Development Margin'], CONTENT_Y + 0.35);
        break;
      case 'scenario_economics':
        if (!input.scenarios) break;
        topNote();
        scenarioTable(c, ['NPV (FCFF)', 'Gross Development Value', 'Total Development Cost', 'Total Financing Cost', 'Profit after Financing', 'Development Margin', 'Peak Equity', 'Terminal Equity Value'], CONTENT_Y + 0.35);
        if (inputs.scenarioTakeaway.trim()) c.addText(inputs.scenarioTakeaway, { x: MX, y: PH - 1.4, w: CONTENT_W, h: 1.0, fontFace: fontBody, fontSize: 10, color: B.ink, valign: 'top', lineSpacingMultiple: 1.2 });
        break;
      case 'sensitivity': {
        const s = m.sensitivity;
        c.addText(`Equity IRR: ${sensVarLabel(s.yVariable)} (rows) x ${sensVarLabel(s.xVariable)} (cols)`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        const headers = [`${sensVarLabel(s.yVariable)} \\ ${sensVarLabel(s.xVariable)}`, ...s.xValues.map((xv) => sensVal(s.xVariable, xv))];
        const rows = s.yValues.map((yv, yi) => [sensVal(s.yVariable, yv), ...s.xValues.map((_, xi) => { const v = s.irr[yi]?.[xi]; return v == null || !Number.isFinite(v) ? 'n/a' : pct(v); })]);
        dataTable(c, headers, rows, CONTENT_Y + 0.35, new Set(), 8);
        break;
      }
      case 'risk_assessment':
        if (inputs.risks.length) bulletList(c, inputs.risks.map((r) => (r.mitigant ? `${r.risk}  |  Mitigant: ${r.mitigant}` : r.risk)), CONTENT_Y + 0.3);
        else narrative(c, inputs.keyRisks, 'No risks provided.');
        break;
      case 'regulatory_tax':
        bulletList(c, inputs.regulatoryTax.map((r) => (r.body ? `${r.label}: ${r.body}` : r.label)), CONTENT_Y + 0.3);
        break;
      case 'recommendation_approvals': {
        const a = m.ask;
        const asks = [
          `Total equity commitment of ${fmt(a.equityCommitment)} (existing ${fmt(a.existingEquity)}; in-kind land ${fmt(a.inKindEquity)})`,
          ...(a.peakDebt > 0.5 ? [`Senior debt facility supporting peak drawn debt of ${fmt(a.peakDebt)}`] : []),
          `Target returns: ${pct(a.projectIrr)} project IRR, ${pct(a.equityIrr)} equity IRR, ${mult(a.equityMoic)} equity multiple`,
        ];
        c.addText('The Committee is asked to approve', { x: MX, y: CONTENT_Y + 0.25, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, bold: true, color: B.slate });
        bulletList(c, asks, CONTENT_Y + 0.55);
        if (inputs.conditionsPrecedent.length) {
          c.addText('Conditions precedent', { x: MX, y: CONTENT_Y + 2.3, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, bold: true, color: B.slate });
          bulletList(c, inputs.conditionsPrecedent, CONTENT_Y + 2.6, true);
        }
        if (inputs.nextSteps.trim()) c.addText(`Next steps: ${inputs.nextSteps}`, { x: MX, y: PH - 1.0, w: CONTENT_W, h: 0.6, fontFace: fontBody, fontSize: 10, color: B.ink, valign: 'top' });
        break;
      }
      case 'disclaimers':
        narrative(c, inputs.disclaimers, 'This document is strictly private and confidential and is intended solely for the recipient. Figures are model outputs, not a guarantee of future performance.');
        break;
      default: break;
    }
  }

  // ── Lender content ──
  function renderLender(c: PptxGenJS.Slide, key: string): void {
    const m = input.lender!;
    switch (key) {
      case 'executive_summary': narrative(c, inputs.executiveSummary, 'No executive summary provided.'); break;
      case 'facility_terms': {
        if (m.facilities.length === 0) { narrative(c, '', 'No debt facilities configured.'); break; }
        const header = ['Facility', 'Rate', 'LTV', 'Share', 'Cash Sweep'].map((t, i) => ({ text: t, options: { fill: { color: B.navy }, color: B.white, bold: true, align: i === 0 ? 'left' : 'right', fontSize: 10 } }));
        const body = m.facilities.map((f) => [
          { text: f.name, options: { align: 'left', fontSize: 10, color: B.ink } },
          { text: `${f.interestRatePct.toFixed(2)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
          { text: `${f.ltvPct.toFixed(0)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
          { text: f.facilitySharePct == null ? 'n/a' : `${f.facilitySharePct.toFixed(0)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
          { text: f.sweepRatioPct == null ? 'none' : `${f.sweepRatioPct.toFixed(0)}%`, options: { align: 'right', fontSize: 10, color: B.ink } },
        ]);
        c.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
        break;
      }
      case 'capital_structure': {
        const cap = m.capital;
        kpiTiles(c, [
          { label: 'Debt', value: pct(cap.debtPct), sub: 'of sources' },
          { label: 'Cash Equity', value: pct(cap.cashEquityPct), sub: 'of sources' },
          { label: 'Peak Debt', value: fmt(cap.peakDebt) },
          { label: 'Debt at Exit', value: fmt(cap.remainingDebtAtExit) },
          { label: 'Debt Tenor', value: cap.tenorYears == null ? 'n/a' : `${cap.tenorYears} yrs` },
          { label: 'Peak Equity', value: fmt(cap.peakEquity), sub: 'equity at risk' },
        ], CONTENT_Y + 0.3);
        break;
      }
      case 'sources_uses': {
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        const mk = (title: string, rows: Array<{ label: string; value: number }>, total: number, x: number): void => {
          c.addText(title, { x, y: CONTENT_Y + 0.35, w: CONTENT_W / 2 - 0.2, h: 0.3, fontFace: fontBody, fontSize: 11, bold: true, color: B.navy });
          const shown = rows.filter((r) => Math.abs(r.value) > 0.5);
          shown.forEach((r, i) => {
            const y = CONTENT_Y + 0.7 + i * 0.32;
            c.addText(r.label, { x, y, w: 3.2, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.slate });
            c.addText(fmt(r.value), { x: x + 2.5, y, w: 2.5, h: 0.3, fontFace: fontBody, fontSize: 10, color: B.ink, align: 'right' });
          });
          const yt = CONTENT_Y + 0.7 + shown.length * 0.32 + 0.05;
          c.addText(`Total ${title}`, { x, y: yt, w: 3.2, h: 0.3, fontFace: fontBody, fontSize: 10, bold: true, color: B.navy });
          c.addText(fmt(total), { x: x + 2.5, y: yt, w: 2.5, h: 0.3, fontFace: fontBody, fontSize: 10, bold: true, color: B.navy, align: 'right' });
        };
        mk('Sources', m.sourcesUses.sources, m.sourcesUses.totalSources, MX);
        mk('Uses', m.sourcesUses.uses, m.sourcesUses.totalUses, MX + CONTENT_W / 2 + 0.2);
        break;
      }
      case 'repayment_schedule':
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        periodTable(c, m.yearLabels, [
          { label: 'Debt Drawdown', values: m.repayment.drawdown },
          { label: 'Interest Paid', values: m.repayment.interest },
          { label: 'Principal (incl. sweep)', values: m.repayment.principal },
          { label: 'Cash Sweep', values: m.repayment.sweep },
          { label: 'Debt Outstanding', values: m.repayment.debtOutstanding },
        ], CONTENT_Y + 0.35);
        break;
      case 'covenant_analysis': covenantTable(c, m.covenants, m.yearLabels); break;
      case 'key_cash_flows':
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        periodTable(c, m.yearLabels, [
          { label: 'Operating Cash Flow', values: m.keyCashFlows.cfo },
          { label: 'Investing Cash Flow', values: m.keyCashFlows.cfi },
          { label: 'Financing Cash Flow', values: m.keyCashFlows.cff },
          { label: 'Closing Cash', values: m.keyCashFlows.closing },
        ], CONTENT_Y + 0.35);
        break;
      case 'security_collateral': narrative(c, inputs.securityCollateral, 'No security / collateral notes provided.'); break;
      case 'covenant_commentary': narrative(c, inputs.covenantCommentary, 'No covenant commentary provided.'); break;
      case 'disclaimers': narrative(c, inputs.disclaimers, 'No disclaimers provided.'); break;
      default: break;
    }
  }

  function covenantTable(c: PptxGenJS.Slide, covenants: LenderCovenantRow[], yearLabels: number[]): void {
    if (covenants.length === 0) { narrative(c, '', 'No covenants configured (see the RE Metrics tab).'); return; }
    const cellPass = (row: LenderCovenantRow, v: number): boolean => (row.operator === 'min' ? v >= row.threshold : v <= row.threshold);
    const hOpt = { fill: { color: B.navy }, color: B.white, bold: true, fontSize: 7, align: 'right' as const };
    const header = [{ text: 'Covenant', options: { ...hOpt, align: 'left' as const } }, { text: 'Thresh.', options: hOpt }, { text: 'Worst', options: hOpt }, { text: 'Result', options: hOpt },
      ...yearLabels.map((y) => ({ text: String(y), options: hOpt }))];
    const body = covenants.map((row) => {
      const cells: PptxGenJS.TableCell[] = [
        { text: `${row.label} (${row.operator})`, options: { align: 'left', fontSize: 7, color: B.ink } },
        { text: covFmt(row.threshold, row.unit), options: { align: 'right', fontSize: 7, color: B.slate } },
        { text: covFmt(row.worst, row.unit), options: { align: 'right', fontSize: 7, bold: true, color: B.ink } },
        { text: row.pass == null ? 'n/a' : row.pass ? 'PASS' : 'FAIL', options: { align: 'right', fontSize: 7, bold: true, color: row.pass == null ? B.slate : row.pass ? B.green : B.red } },
      ];
      for (let i = 0; i < yearLabels.length; i++) {
        if (row.exitOnly) { cells.push({ text: i === yearLabels.length - 1 ? covFmt(row.worst, row.unit) : '', options: { align: 'right', fontSize: 7, color: B.slate } }); continue; }
        const v = row.seriesPerPeriod[i];
        const has = v != null && Number.isFinite(v);
        const ok = has ? cellPass(row, v as number) : null;
        cells.push({ text: has ? covFmt(v as number, row.unit) : '', options: { align: 'right', fontSize: 7, color: ok == null ? B.slate : ok ? B.green : B.red, fill: { color: ok == null ? B.white : ok ? 'DDEEE3' : 'F6DBDB' } } });
      }
      return cells;
    });
    c.addTable([header, ...body] as PptxGenJS.TableRow[], { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, border: { type: 'solid', color: B.border, pt: 0.5 }, fontFace: fontBody, autoPage: false });
  }

  // ── One-Pager content ──
  function renderOnePager(c: PptxGenJS.Slide, key: string): void {
    const m = input.onePager!;
    switch (key) {
      case 'deal_at_a_glance': {
        const d = m.dealAtAGlance;
        factGrid(c, [
          { label: 'Project', value: d.projectName || 'Untitled' },
          { label: 'Location', value: d.location || 'n/a' },
          { label: 'Phases', value: String(d.phaseCount) },
          { label: 'Asset mix', value: d.assetMix.map((a) => a.name).join(', ') || 'n/a' },
        ], CONTENT_Y + 0.3);
        break;
      }
      case 'headline_returns': {
        const h = m.headline;
        kpiTiles(c, [
          { label: 'Project IRR', value: pct(h.projectIrr), good: true },
          { label: 'Equity IRR', value: pct(h.equityIrr), good: true },
          { label: 'MOIC', value: mult(h.equityMultiple) },
          { label: 'Project MOIC', value: mult(h.projectMoic) },
        ], CONTENT_Y + 0.3);
        break;
      }
      case 'capital_ask': {
        const cap = m.capitalAsk;
        c.addText(`Figures in ${currency}`, { x: MX, y: CONTENT_Y + 0.05, w: CONTENT_W, h: 0.25, fontFace: fontBody, fontSize: 9, color: B.slate });
        kpiTiles(c, [
          { label: 'Total Equity', value: fmt(cap.totalEquity) },
          { label: 'Peak Equity', value: fmt(cap.peakEquity) },
          { label: 'Peak Debt', value: fmt(cap.peakDebt) },
          { label: 'Debt / Equity', value: `${pct(cap.debtPct)} / ${pct(cap.equityPct)}` },
        ], CONTENT_Y + 0.5);
        break;
      }
      case 'timeline':
        c.addText(`${m.timeline.startYear} to ${m.timeline.exitYear}  (${m.timeline.durationYears} year hold)`, { x: MX, y: CONTENT_Y + 0.4, w: CONTENT_W, h: 0.5, fontFace: fontBody, fontSize: 16, color: B.ink });
        break;
      case 'asset_mix':
        c.addText(m.assetMix.map((a) => `${a.name} (${a.strategy})`).join('    ') || 'No assets', { x: MX, y: CONTENT_Y + 0.4, w: CONTENT_W, h: 1.5, fontFace: fontBody, fontSize: 13, color: B.navy, valign: 'top', lineSpacingMultiple: 1.4 });
        break;
      case 'thesis_contact': {
        c.addText(m.thesisLine.trim() ? `“${m.thesisLine}”` : 'No thesis line provided.', { x: MX, y: CONTENT_Y + 0.3, w: CONTENT_W, h: 1.0, fontFace: fontBody, fontSize: 15, italic: true, color: m.thesisLine.trim() ? B.ink : B.slate, valign: 'top' });
        const contactLines: string[] = [];
        if (m.preparedBy.length) contactLines.push(`Prepared by ${m.preparedBy.map((p) => p.name).join(', ')}`);
        if (m.contacts.length) contactLines.push(`Contact: ${m.contacts.map((p) => `${p.name}${p.identifier ? ` (${p.identifier})` : ''}`).join(', ')}`);
        if (contactLines.length) c.addText(contactLines.join('\n'), { x: MX, y: CONTENT_Y + 1.5, w: CONTENT_W, h: 1.0, fontFace: fontBody, fontSize: 11, color: B.slate, valign: 'top', lineSpacingMultiple: 1.3 });
        break;
      }
      default: break;
    }
  }

  return pptx;
}

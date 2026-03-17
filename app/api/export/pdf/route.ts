import { NextRequest, NextResponse } from 'next/server';
import ReactPDF, { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';
import React from 'react';

// ── Types (minimal) ───────────────────────────────────────────────────────────
interface FinancingLineItem { name: string; total: number; debtAmt: number; equityAmt: number; debtPct: number }
interface FinancingResult   { lineItems: FinancingLineItem[]; totalDebt: number; totalEquity: number; totalInterest: number }
interface ExportPayload {
  projectName: string; projectType: string; country: string; currency: string;
  modelType: string; projectStart: string; constructionPeriods: number;
  operationsPeriods: number; projectEndDate: string;
  totalLandArea: number; totalLandValue: number; landValuePerSqm: number;
  cashPercent: number; inKindPercent: number;
  projectRoadsPct: number; projectFAR: number; projectNDA: number; totalProjectGFA: number;
  residentialPercent: number; hospitalityPercent: number; retailPercent: number;
  residentialGFA: number; hospitalityGFA: number; retailGFA: number;
  residentialBUA: number; hospitalityBUA: number; retailBUA: number;
  showResidential: boolean; showHospitality: boolean; showRetail: boolean;
  costInputMode: string;
  residentialCosts: { name: string; method: string; value: number }[];
  hospitalityCosts: { name: string; method: string; value: number }[];
  retailCosts: { name: string; method: string; value: number }[];
  interestRate: number; financingMode: string; globalDebtPct: number;
  capitalizeInterest: boolean; repaymentPeriods: number; repaymentMethod: string;
  finRes: FinancingResult | null; finHosp: FinancingResult | null; finRet: FinancingResult | null;
  totalCapex: number; totalDebt: number; totalEquity: number;
  projectLabel: string; versionLabel: string;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page:      { fontFamily: 'Helvetica', fontSize: 9, padding: 36, backgroundColor: '#FFFFFF' },
  coverBg:   { backgroundColor: '#0D2E5A', padding: 48 },
  coverTitle: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', marginBottom: 8 },
  coverSub:  { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 4 },
  coverMeta: { fontSize: 10, color: 'rgba(255,255,255,0.5)', marginTop: 24 },
  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '2px solid #1B4F8A', paddingBottom: 4, marginBottom: 14 },
  headerLeft:{ fontSize: 9, color: '#1B4F8A', fontFamily: 'Helvetica-Bold' },
  headerRight:{ fontSize: 8, color: '#6B7280' },
  section:   { marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', backgroundColor: '#1B4F8A', padding: '5 8', marginBottom: 0 },
  subTitle:  { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', backgroundColor: '#1B4F8A', padding: '3 8', marginBottom: 2 },
  greenTitle:{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', backgroundColor: '#1B6E50', padding: '3 8', marginBottom: 2 },
  row:       { flexDirection: 'row', borderBottom: '0.5px solid #E5E7EB' },
  rowAlt:    { flexDirection: 'row', borderBottom: '0.5px solid #E5E7EB', backgroundColor: '#F0F5FF' },
  cell:      { flex: 1, padding: '3 6', fontSize: 8.5 },
  cellR:     { flex: 1, padding: '3 6', fontSize: 8.5, textAlign: 'right' },
  cellLabel: { flex: 2, padding: '3 6', fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
  totalRow:  { flexDirection: 'row', backgroundColor: '#1B4F8A', marginTop: 1 },
  totalCell: { flex: 1, padding: '3 6', fontSize: 8.5, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  totalCellL:{ flex: 2, padding: '3 6', fontSize: 8.5, color: '#FFFFFF', fontFamily: 'Helvetica-Bold' },
  kpiGrid:   { flexDirection: 'row', gap: 8, marginBottom: 12 },
  kpi:       { flex: 1, backgroundColor: '#EFF6FF', border: '1px solid #BFDBFE', padding: '8 10', borderRadius: 3 },
  kpiLabel:  { fontSize: 7, color: '#1E40AF', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', marginBottom: 3 },
  kpiValue:  { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#1E3A8A' },
  footer:    { position: 'absolute', bottom: 24, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', borderTop: '0.5px solid #D1D5DB', paddingTop: 4 },
  footerText:{ fontSize: 7, color: '#9CA3AF' },
});

const fmt = (n: number) => Math.round(n).toLocaleString();
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ── PDF Document ──────────────────────────────────────────────────────────────
function REFMReport({ d }: { d: ExportPayload }) {
  const exportedAt = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return React.createElement(Document, { title: `${d.projectLabel} — REFM Report` },

    // ── Cover Page ──
    React.createElement(Page, { size: 'A4', style: s.page },
      React.createElement(View, { style: s.coverBg },
        React.createElement(Text, { style: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 24, fontFamily: 'Helvetica-Bold', letterSpacing: 2 } }, 'REAL ESTATE FINANCIAL MODELING PLATFORM'),
        React.createElement(Text, { style: s.coverTitle }, d.projectLabel),
        React.createElement(Text, { style: s.coverSub }, d.versionLabel),
        React.createElement(Text, { style: s.coverSub }, `Module 1 — Project Setup & Financial Structure`),
        React.createElement(Text, { style: s.coverMeta }, `Exported: ${exportedAt}`),
        React.createElement(Text, { style: s.coverMeta }, `Project Type: ${d.projectType}  ·  Country: ${d.country}  ·  Currency: ${d.currency}`),
        React.createElement(Text, { style: s.coverMeta }, `Model: ${d.modelType}  ·  Construction: ${d.constructionPeriods} ${d.modelType === 'monthly' ? 'months' : 'years'}  ·  Operations: ${d.operationsPeriods} ${d.modelType === 'monthly' ? 'months' : 'years'}`),
      ),
      React.createElement(View, { style: s.footer },
        React.createElement(Text, { style: s.footerText }, 'REFM Pro — Confidential'),
        React.createElement(Text, { style: s.footerText }, exportedAt),
      ),
    ),

    // ── Page 2: KPIs + Land ──
    React.createElement(Page, { size: 'A4', style: s.page },
      React.createElement(View, { style: s.header },
        React.createElement(Text, { style: s.headerLeft }, `${d.projectLabel}  ›  ${d.versionLabel}`),
        React.createElement(Text, { style: s.headerRight }, 'Module 1 — Project Setup'),
      ),

      // KPI grid
      React.createElement(View, { style: s.kpiGrid },
        ...[
          { label: 'Total Land Area', value: `${fmt(d.totalLandArea)} sqm` },
          { label: 'Total Land Value', value: `${d.currency} ${fmt(d.totalLandValue)}` },
          { label: 'Total GFA', value: `${fmt(d.totalProjectGFA)} sqm` },
          { label: 'Total CAPEX', value: `${d.currency} ${fmt(d.totalCapex)}` },
          { label: 'Total Debt', value: `${d.currency} ${fmt(d.totalDebt)}` },
          { label: 'Total Equity', value: `${d.currency} ${fmt(d.totalEquity)}` },
        ].map(k => React.createElement(View, { key: k.label, style: s.kpi },
          React.createElement(Text, { style: s.kpiLabel }, k.label),
          React.createElement(Text, { style: s.kpiValue }, k.value),
        ))
      ),

      // Timeline section
      React.createElement(View, { style: s.section },
        React.createElement(Text, { style: s.sectionTitle }, 'PROJECT TIMELINE'),
        ...[
          ['Project Name',          d.projectName],
          ['Project Type',          d.projectType],
          ['Country / Currency',    `${d.country} / ${d.currency}`],
          ['Model Type',            d.modelType],
          ['Start Date',            d.projectStart],
          ['Construction Duration', `${d.constructionPeriods} ${d.modelType === 'monthly' ? 'months' : 'years'}`],
          ['Operations Duration',   `${d.operationsPeriods} ${d.modelType === 'monthly' ? 'months' : 'years'}`],
          ['Project End Date',      d.projectEndDate],
        ].map(([label, val], i) =>
          React.createElement(View, { key: label, style: i % 2 === 0 ? s.row : s.rowAlt },
            React.createElement(Text, { style: s.cellLabel }, label),
            React.createElement(Text, { style: s.cellR }, val),
          )
        ),
      ),

      // Land section
      React.createElement(View, { style: s.section },
        React.createElement(Text, { style: s.sectionTitle }, 'LAND & AREA'),
        ...[
          ['Total Land Area',         `${fmt(d.totalLandArea)} sqm`],
          ['Land Value per sqm',      `${d.currency} ${fmt(d.landValuePerSqm)}`],
          ['Total Land Value',        `${d.currency} ${fmt(d.totalLandValue)}`],
          ['Cash / In-Kind Split',    `${fmtPct(d.cashPercent)} / ${fmtPct(d.inKindPercent)}`],
          ['Roads %',                 fmtPct(d.projectRoadsPct)],
          ['Floor Area Ratio (FAR)',  d.projectFAR.toFixed(2)],
          ['Net Developable Area',    `${fmt(d.projectNDA)} sqm`],
          ['Total Project GFA',       `${fmt(d.totalProjectGFA)} sqm`],
        ].map(([label, val], i) =>
          React.createElement(View, { key: label, style: i % 2 === 0 ? s.row : s.rowAlt },
            React.createElement(Text, { style: s.cellLabel }, label),
            React.createElement(Text, { style: s.cellR }, val),
          )
        ),
      ),

      React.createElement(View, { style: s.footer },
        React.createElement(Text, { style: s.footerText }, 'REFM Pro — Confidential'),
        React.createElement(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`, style: s.footerText }),
      ),
    ),

    // ── Page 3: Area allocation + Costs ──
    React.createElement(Page, { size: 'A4', style: s.page },
      React.createElement(View, { style: s.header },
        React.createElement(Text, { style: s.headerLeft }, `${d.projectLabel}  ›  ${d.versionLabel}`),
        React.createElement(Text, { style: s.headerRight }, 'Development Costs'),
      ),

      // Area allocation
      React.createElement(View, { style: s.section },
        React.createElement(Text, { style: s.greenTitle }, 'AREA ALLOCATION BY ASSET'),
        React.createElement(View, { style: { ...s.row, backgroundColor: '#1B6E50' } },
          ...['Asset', 'Alloc %', 'GFA (sqm)', 'BUA (sqm)', 'Net Saleable', 'Land Value'].map(h =>
            React.createElement(Text, { key: h, style: { ...s.cellR, color: '#FFFFFF', fontFamily: 'Helvetica-Bold' } }, h)
          ),
        ),
        ...[
          { label: 'Residential', pct: d.residentialPercent, gfa: d.residentialGFA, bua: d.residentialBUA, nsa: 0, lv: d.totalLandValue * d.residentialPercent / 100, show: d.showResidential },
          { label: 'Hospitality', pct: d.hospitalityPercent, gfa: d.hospitalityGFA, bua: d.hospitalityBUA, nsa: 0, lv: d.totalLandValue * d.hospitalityPercent / 100, show: d.showHospitality },
          { label: 'Retail',      pct: d.retailPercent,      gfa: d.retailGFA,      bua: d.retailBUA,      nsa: 0, lv: d.totalLandValue * d.retailPercent / 100,      show: d.showRetail },
        ].filter(a => a.show).map((a, i) =>
          React.createElement(View, { key: a.label, style: i % 2 === 0 ? s.row : s.rowAlt },
            React.createElement(Text, { style: s.cell }, a.label),
            React.createElement(Text, { style: s.cellR }, fmtPct(a.pct)),
            React.createElement(Text, { style: s.cellR }, fmt(a.gfa)),
            React.createElement(Text, { style: s.cellR }, fmt(a.bua)),
            React.createElement(Text, { style: s.cellR }, '—'),
            React.createElement(Text, { style: s.cellR }, `${d.currency} ${fmt(a.lv)}`),
          )
        ),
      ),

      // Costs sections
      ...([
        { costs: d.residentialCosts, label: 'RESIDENTIAL', show: d.showResidential },
        { costs: d.hospitalityCosts, label: 'HOSPITALITY',  show: d.showHospitality && d.costInputMode === 'separate' },
        { costs: d.retailCosts,      label: 'RETAIL',       show: d.showRetail      && d.costInputMode === 'separate' },
      ] as { costs: { name: string; method: string; value: number }[]; label: string; show: boolean }[])
        .filter(s => s.show)
        .map(({ costs, label }) =>
          React.createElement(View, { key: label, style: s.section },
            React.createElement(Text, { style: s.greenTitle }, `${d.costInputMode === 'same-for-all' ? 'ALL ASSETS (SHARED)' : label} — DEVELOPMENT COSTS`),
            React.createElement(View, { style: { ...s.row, backgroundColor: '#1B4F8A' } },
              ...['Cost Item', 'Method', 'Input Value'].map(h =>
                React.createElement(Text, { key: h, style: { ...s.cellR, color: '#FFFFFF', fontFamily: 'Helvetica-Bold' } }, h)
              ),
            ),
            ...costs.map((c, i) =>
              React.createElement(View, { key: `${c.name}-${i}`, style: i % 2 === 0 ? s.row : s.rowAlt },
                React.createElement(Text, { style: s.cell }, c.name),
                React.createElement(Text, { style: s.cellR }, c.method.replace(/_/g, ' ')),
                React.createElement(Text, { style: s.cellR }, fmt(c.value)),
              )
            ),
            React.createElement(View, { style: s.totalRow },
              React.createElement(Text, { style: s.totalCellL }, `TOTAL ${label}`),
              React.createElement(Text, { style: s.totalCell }, ''),
              React.createElement(Text, { style: s.totalCell }, `${d.currency} ${fmt(costs.reduce((sum, c) => sum + c.value, 0))}`),
            ),
          )
        ),

      React.createElement(View, { style: s.footer },
        React.createElement(Text, { style: s.footerText }, 'REFM Pro — Confidential'),
        React.createElement(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`, style: s.footerText }),
      ),
    ),

    // ── Page 4: Financing ──
    React.createElement(Page, { size: 'A4', style: s.page },
      React.createElement(View, { style: s.header },
        React.createElement(Text, { style: s.headerLeft }, `${d.projectLabel}  ›  ${d.versionLabel}`),
        React.createElement(Text, { style: s.headerRight }, 'Financing'),
      ),

      React.createElement(View, { style: s.section },
        React.createElement(Text, { style: s.sectionTitle }, 'FINANCING ASSUMPTIONS'),
        ...[
          ['Interest Rate (% p.a.)',    `${d.interestRate.toFixed(2)}%`],
          ['Financing Mode',            d.financingMode === 'fixed' ? 'Fixed Global Ratio' : 'Per Line Item'],
          ['Global Debt %',             fmtPct(d.globalDebtPct)],
          ['Capitalize Interest',       d.capitalizeInterest ? 'Yes' : 'No'],
          ['Repayment Method',          d.repaymentMethod === 'fixed' ? 'Fixed Instalments' : 'Cash Sweep'],
          ['Repayment Periods',         `${d.repaymentPeriods} ${d.modelType === 'monthly' ? 'months' : 'years'}`],
        ].map(([label, val], i) =>
          React.createElement(View, { key: label, style: i % 2 === 0 ? s.row : s.rowAlt },
            React.createElement(Text, { style: s.cellLabel }, label),
            React.createElement(Text, { style: s.cellR }, val),
          )
        ),
      ),

      ...[
        { fin: d.finRes,  label: 'RESIDENTIAL' },
        { fin: d.finHosp, label: 'HOSPITALITY' },
        { fin: d.finRet,  label: 'RETAIL' },
      ].filter(x => x.fin != null).map(({ fin, label }) =>
        React.createElement(View, { key: label, style: s.section },
          React.createElement(Text, { style: s.greenTitle }, `${label} — FINANCING SUMMARY`),
          React.createElement(View, { style: { ...s.row, backgroundColor: '#1B6E50' } },
            ...['Cost Line', 'Total', 'Debt', 'Equity', 'Debt %'].map(h =>
              React.createElement(Text, { key: h, style: { ...s.cellR, color: '#FFFFFF', fontFamily: 'Helvetica-Bold' } }, h)
            ),
          ),
          ...(fin!.lineItems.map((li, i) =>
            React.createElement(View, { key: `${li.name}-${i}`, style: i % 2 === 0 ? s.row : s.rowAlt },
              React.createElement(Text, { style: s.cell }, li.name),
              React.createElement(Text, { style: s.cellR }, fmt(li.total)),
              React.createElement(Text, { style: s.cellR }, fmt(li.debtAmt)),
              React.createElement(Text, { style: s.cellR }, fmt(li.equityAmt)),
              React.createElement(Text, { style: s.cellR }, fmtPct(li.debtPct)),
            )
          )),
          React.createElement(View, { style: s.totalRow },
            React.createElement(Text, { style: s.totalCellL }, `TOTAL ${label}`),
            React.createElement(Text, { style: s.totalCell }, fmt(fin!.totalDebt + fin!.totalEquity)),
            React.createElement(Text, { style: s.totalCell }, fmt(fin!.totalDebt)),
            React.createElement(Text, { style: s.totalCell }, fmt(fin!.totalEquity)),
            React.createElement(Text, { style: s.totalCell }, fmtPct(fin!.totalDebt / (fin!.totalDebt + fin!.totalEquity || 1) * 100)),
          ),
        )
      ),

      // Grand summary
      React.createElement(View, { style: s.section },
        React.createElement(Text, { style: s.sectionTitle }, 'PROJECT FINANCING SUMMARY'),
        ...[
          ['Total CAPEX',      `${d.currency} ${fmt(d.totalCapex)}`],
          ['Total Debt',       `${d.currency} ${fmt(d.totalDebt)}`],
          ['Total Equity',     `${d.currency} ${fmt(d.totalEquity)}`],
          ['Debt / CAPEX',     fmtPct(d.totalCapex > 0 ? d.totalDebt / d.totalCapex * 100 : 0)],
        ].map(([label, val], i) =>
          React.createElement(View, { key: label, style: i % 2 === 0 ? s.row : s.rowAlt },
            React.createElement(Text, { style: s.cellLabel }, label),
            React.createElement(Text, { style: { ...s.cellR, fontFamily: 'Helvetica-Bold', color: '#1B4F8A' } }, val),
          )
        ),
      ),

      React.createElement(View, { style: s.footer },
        React.createElement(Text, { style: s.footerText }, 'REFM Pro — Confidential'),
        React.createElement(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`, style: s.footerText }),
      ),
    ),
  );
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const d: ExportPayload = await req.json();

  // ── White-label cover placeholder ────────────────────────────────────────────
  // TODO: When white-label is enabled, read clientName / clientLogo from the
  // branding_config table (server-side) and apply them to the PDF cover page.
  // For now the cover uses the standard REFM Pro branding.
  // ─────────────────────────────────────────────────────────────────────────────

  // renderToBuffer is simpler than stream for server routes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf: Buffer = await ReactPDF.renderToBuffer(React.createElement(REFMReport, { d }) as any);

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="REFM_Report.pdf"',
    },
  });
}

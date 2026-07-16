/**
 * SlideObjectView.tsx (REFM Module 7, IC Presentation Builder: object renderers)
 *
 * Paints one slide object onto the canvas. Every object is absolutely positioned
 * in LOGICAL pixels on the 1280x720 slide; the parent applies a single CSS
 * transform to scale the whole slide to the viewport, so nothing here needs to
 * know the zoom level. What you see is exactly what the PPTX exporter receives.
 *
 * The unlinked state is deliberate and visible. When a binding cannot resolve
 * (no debt in this model, no scenarios defined, a key that no longer exists), the
 * object paints a dashed amber frame that states WHY, instead of showing a stale
 * or invented number. "Broken links are never allowed" cannot mean the link
 * always resolves; it has to mean a link is either live or loudly absent.
 *
 * DOM, not canvas or SVG: text stays selectable and editable, Recharts renders
 * natively, and the browser does the font work that a canvas renderer would have
 * to reimplement.
 *
 * No em dashes in this file.
 */

'use client';

import React from 'react';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { ICReportModel } from '../../../lib/reports/icReport';
import type {
  BulletsObject, ChartObject, DeckBranding, DeckObject, DividerObject, GanttObject,
  HeatmapObject, ImageObject, KpiObject, RiskMatrixObject, ShapeObject, TableObject, TextObject, TextStyle,
} from '../../../lib/reports/deck/types';
import { DECK_THEME, blend, fontFor, fontStack, TYPE_SCALE } from '../../../lib/reports/deck/theme';
import {
  resolveChart, resolveMetric, resolveTable, resolveText, type DeckFmt,
} from '../../../lib/reports/deck/bindings';

export interface RenderCtx {
  model: ICReportModel;
  fmt: DeckFmt;
  branding: DeckBranding;
}

// ── Shared bits ─────────────────────────────────────────────────────────────

/** Turn a TextStyle into CSS. One place, so canvas text and PPTX text agree. */
export function styleToCss(s: TextStyle, b: DeckBranding): React.CSSProperties {
  return {
    fontFamily: fontStack(s.fontFamily ?? fontFor(b, s.fontRole)),
    fontSize: s.size,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: s.underline ? 'underline' : 'none',
    color: s.color,
    textAlign: s.align,
    lineHeight: s.lineHeight ?? 1.35,
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}px` : undefined,
    textTransform: s.uppercase ? 'uppercase' : 'none',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflow: 'hidden',
  };
}

/** The visible unlinked state. Amber, dashed, and it says why. */
function Unlinked({ reason, label }: { reason: string; label: string }): React.JSX.Element {
  return (
    <div
      data-testid="deck-unlinked"
      style={{
        width: '100%', height: '100%', border: `1px dashed #B98A2E`, borderRadius: 4,
        background: 'rgba(185,138,46,0.06)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8, textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8A6520', letterSpacing: 0.6, textTransform: 'uppercase' }}>
        {label} not available
      </div>
      <div style={{ fontSize: 10, color: '#8A6520', lineHeight: 1.35 }}>{reason}</div>
    </div>
  );
}

const boxCss = (o: DeckObject): React.CSSProperties => {
  const b = o.box;
  if (!b) return {};
  return {
    background: b.fill ?? undefined,
    border: b.border ? `${b.border.width}px solid ${b.border.color}` : undefined,
    borderRadius: b.radius ?? undefined,
    opacity: b.opacity ?? undefined,
    boxShadow: b.shadow ? '0 2px 10px rgba(13,46,90,0.14)' : undefined,
  };
};

// ── Per-type renderers ──────────────────────────────────────────────────────

function TextView({ o, ctx }: { o: TextObject; ctx: RenderCtx }): React.JSX.Element {
  let content = o.text;
  if (o.binding) {
    const r = resolveText(o.binding, ctx.model, ctx.fmt);
    if (!r.available) return <Unlinked reason={r.reason} label="Text" />;
    content = r.value;
  }
  return <div style={{ ...styleToCss(o.style, ctx.branding), ...boxCss(o), width: '100%', height: '100%' }}>{content}</div>;
}

function BulletsView({ o, ctx }: { o: BulletsObject; ctx: RenderCtx }): React.JSX.Element {
  const css = styleToCss(o.style, ctx.branding);
  return (
    <div style={{ ...css, ...boxCss(o), width: '100%', height: '100%', display: 'block' }}>
      {o.items.map((it, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
          <span style={{ color: o.markerColor ?? DECK_THEME.navy, fontWeight: 700, flexShrink: 0, minWidth: o.numbered ? 18 : 8 }}>
            {o.numbered ? `${i + 1}.` : '•'}
          </span>
          <span style={{ flex: 1 }}>{it}</span>
        </div>
      ))}
    </div>
  );
}

function KpiView({ o, ctx }: { o: KpiObject; ctx: RenderCtx }): React.JSX.Element {
  const r = resolveMetric(o.metric, ctx.model, ctx.fmt);
  if (!r.available) return <Unlinked reason={r.reason} label="Metric" />;
  const { label, value, sub, raw } = r.value;

  const onDark = o.variant === 'navy' || o.variant === 'green';
  const fill = o.variant === 'navy' ? DECK_THEME.navy
    : o.variant === 'green' ? DECK_THEME.green
    : o.variant === 'pale' ? DECK_THEME.paleWash
    : 'transparent';
  const valueColor = o.signColor && raw !== null
    ? (raw < 0 ? DECK_THEME.red : DECK_THEME.green)
    : onDark ? DECK_THEME.white : DECK_THEME.navy;

  return (
    <div style={{
      width: '100%', height: '100%', background: fill, borderRadius: 4, padding: '12px 14px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, overflow: 'hidden',
      border: o.variant === 'plain' ? `1px solid ${DECK_THEME.rule}` : undefined,
    }}>
      <div style={{
        fontFamily: fontStack(fontFor(ctx.branding, 'body')), fontSize: TYPE_SCALE.kpiLabel, fontWeight: 700,
        letterSpacing: 0.6, textTransform: 'uppercase', color: onDark ? DECK_THEME.pale : DECK_THEME.slate,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {o.labelOverride ?? label}
      </div>
      <div style={{
        fontFamily: fontStack(fontFor(ctx.branding, 'heading')),
        fontSize: Math.min(TYPE_SCALE.kpiValue, Math.max(16, o.h * 0.34)),
        fontWeight: 700, color: valueColor, lineHeight: 1.1, whiteSpace: 'nowrap',
      }}>
        {value}
      </div>
      {(o.subOverride ?? sub) ? (
        <div style={{
          fontFamily: fontStack(fontFor(ctx.branding, 'body')), fontSize: TYPE_SCALE.kpiSub,
          color: onDark ? DECK_THEME.pale : DECK_THEME.slateLight, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {o.subOverride ?? sub}
        </div>
      ) : null}
    </div>
  );
}

const axisTick = { fontSize: 9, fill: DECK_THEME.slate };

function ChartView({ o, ctx }: { o: ChartObject; ctx: RenderCtx }): React.JSX.Element {
  const r = resolveChart(o.chart, ctx.model, ctx.fmt);
  if (!r.available) return <Unlinked reason={r.reason} label="Chart" />;
  const d = r.value;
  const kind = o.kindOverride ?? d.kind;

  // Recharts wants row-per-category; the registry gives series-per-column.
  const rows = d.labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    d.series.forEach((s) => { row[s.name] = s.values[i] ?? null; });
    return row;
  });

  const titleEl = o.title ? (
    <div style={{
      fontFamily: fontStack(fontFor(ctx.branding, 'body')), fontSize: 10, fontWeight: 700,
      color: DECK_THEME.slate, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4, flexShrink: 0,
    }}>
      {o.title}
      <span style={{ float: 'right', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: DECK_THEME.slateLight }}>
        {d.axisUnit}
      </span>
    </div>
  ) : null;

  const fmtAxis = (v: number): string => (d.pctAxis ? `${(v * 100).toFixed(0)}%` : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(v));
  const fmtTip = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? `${fmtAxis(v)}${d.pctAxis ? '' : ` ${d.axisUnit}`}` : String(v ?? ''));

  const body = (): React.JSX.Element => {
    if (kind === 'doughnut') {
      const pie = d.labels.map((label, i) => ({ name: label, value: Number(d.series[0]?.values[i] ?? 0) }));
      return (
        <PieChart>
          <Pie data={pie} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="80%" paddingAngle={1}>
            {pie.map((_p, i) => <Cell key={i} fill={d.pointColors?.[i] ?? DECK_THEME.navy} />)}
          </Pie>
          <Tooltip formatter={(v) => fmtTip(v)} />
          {o.showLegend !== false ? <Legend wrapperStyle={{ fontSize: 9 }} /> : null}
        </PieChart>
      );
    }
    if (kind === 'line') {
      return (
        <LineChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={DECK_THEME.rule} vertical={false} />
          <XAxis dataKey="label" tick={axisTick} />
          <YAxis tick={axisTick} tickFormatter={fmtAxis} />
          <Tooltip formatter={(v) => fmtTip(v)} />
          {d.series.map((s) => (
            <Line key={s.name} type="monotone" dataKey={s.name} stroke={s.color ?? DECK_THEME.navy} strokeWidth={2} dot={{ r: 2 }} />
          ))}
        </LineChart>
      );
    }
    const horizontal = kind === 'bar';
    return (
      <BarChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={DECK_THEME.rule} vertical={horizontal} horizontal={!horizontal} />
        {horizontal
          ? <><XAxis type="number" tick={axisTick} tickFormatter={fmtAxis} /><YAxis type="category" dataKey="label" tick={axisTick} width={90} /></>
          : <><XAxis dataKey="label" tick={axisTick} /><YAxis tick={axisTick} tickFormatter={fmtAxis} /></>}
        <Tooltip formatter={(v) => fmtTip(v)} />
        {o.showLegend !== false && d.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 9 }} /> : null}
        {d.series.map((s) => (
          <Bar key={s.name} dataKey={s.name} fill={s.color ?? DECK_THEME.navy} stackId={kind === 'stackedColumn' ? 'a' : undefined}>
            {d.pointColors ? rows.map((_r, i) => <Cell key={i} fill={d.pointColors?.[i] ?? DECK_THEME.navy} />) : null}
          </Bar>
        ))}
      </BarChart>
    );
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', ...boxCss(o) }}>
      {titleEl}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">{body()}</ResponsiveContainer>
      </div>
    </div>
  );
}

function TableView({ o, ctx }: { o: TableObject; ctx: RenderCtx }): React.JSX.Element {
  const r = resolveTable(o.table, ctx.model, ctx.fmt);
  if (!r.available) return <Unlinked reason={r.reason} label="Table" />;
  const d = r.value;
  const fs = o.fontSize ?? TYPE_SCALE.table;

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', ...boxCss(o) }}>
      {o.title ? (
        <div style={{ fontFamily: fontStack(fontFor(ctx.branding, 'body')), fontSize: 10, fontWeight: 700, color: DECK_THEME.slate, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
          {o.title}
        </div>
      ) : null}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: fontStack(fontFor(ctx.branding, 'body')), fontSize: fs, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {d.headers.map((h, i) => (
              <th key={i} style={{
                background: DECK_THEME.navy, color: DECK_THEME.white, textAlign: h.align, padding: '5px 8px',
                fontSize: TYPE_SCALE.tableHead, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {h.text}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {d.rows.map((row, ri) => (
            <tr key={ri} style={{
              background: row.shaded ? DECK_THEME.paleWash
                : row.emphasis ? '#EEF3F9'
                : o.striped && ri % 2 === 1 ? `${DECK_THEME.rowGrey}55` : 'transparent',
              borderTop: row.emphasis ? `1.5px solid ${DECK_THEME.navy}` : `1px solid ${DECK_THEME.rule}`,
            }}>
              {row.cells.map((c, ci) => (
                <td key={ci} style={{
                  textAlign: c.align, padding: '4px 8px',
                  fontWeight: c.bold || row.emphasis ? 700 : 400,
                  color: c.color ?? (row.emphasis ? DECK_THEME.green : DECK_THEME.ink),
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {c.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImageView({ o }: { o: ImageObject }): React.JSX.Element {
  if (!o.url) {
    return (
      <div style={{
        width: '100%', height: '100%', border: `1px dashed ${DECK_THEME.navyLight}`, borderRadius: 4,
        background: DECK_THEME.offWhite, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 6, color: DECK_THEME.slateLight,
      }}>
        <div style={{ fontSize: 22 }}>🖼</div>
        <div style={{ fontSize: 11, fontWeight: 600 }}>{o.name ?? 'Image'}</div>
        <div style={{ fontSize: 9 }}>Click to upload</div>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={o.url} alt={o.alt ?? ''} style={{ width: '100%', height: '100%', objectFit: o.fit, borderRadius: o.box?.radius ?? 0, ...boxCss(o) }} />
  );
}

function ShapeView({ o, ctx }: { o: ShapeObject; ctx: RenderCtx }): React.JSX.Element {
  const radius = o.shape === 'ellipse' ? '50%' : (o.box?.radius ?? 0);
  return (
    <div style={{ width: '100%', height: '100%', ...boxCss(o), borderRadius: radius, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {o.text ? <div style={{ ...styleToCss(o.style ?? ({} as TextStyle), ctx.branding), width: '100%', height: '100%', alignItems: 'center' }}>{o.text}</div> : null}
    </div>
  );
}

function DividerView({ o }: { o: DividerObject }): React.JSX.Element {
  return <div style={{ width: '100%', height: o.thickness, background: o.color, marginTop: 0 }} />;
}

/** The development-programme Gantt. Positioned bars over a year grid, all read
 *  from model.programme so it can never drift from the phase dates. */
function GanttView({ o, ctx }: { o: GanttObject; ctx: RenderCtx }): React.JSX.Element {
  const p = ctx.model.programme;
  if (!p.lanes.length) return <Unlinked reason="No phases are defined in this model" label="Programme" />;

  const y0 = p.startYear, y1 = p.exitYear;
  const span = Math.max(1, y1 - y0);
  const labelW = 132;
  const trackW = o.w - labelW - 8;
  const xOf = (year: number): number => labelW + ((year - y0) / span) * trackW;
  const laneH = Math.min(38, Math.max(20, (o.h - 40) / p.lanes.length));
  const ticks: number[] = [];
  const step = span > 14 ? 3 : span > 8 ? 2 : 1;
  for (let y = y0; y <= y1; y += step) ticks.push(y);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', fontFamily: fontStack(fontFor(ctx.branding, 'body')) }}>
      {/* year axis */}
      {ticks.map((y) => (
        <div key={y} style={{ position: 'absolute', left: xOf(y), top: 0, bottom: 22, width: 1, background: DECK_THEME.rule }}>
          <div style={{ position: 'absolute', top: -2, left: -14, width: 28, textAlign: 'center', fontSize: 9, color: DECK_THEME.slate }}>{y}</div>
        </div>
      ))}
      {p.lanes.map((lane, i) => {
        const top = 20 + i * laneH;
        const cs = xOf(lane.constructionStart), ce = xOf(lane.constructionEnd + 1);
        const hasOps = lane.operationsStart !== null && lane.operationsEnd !== null;
        const os = hasOps ? xOf(lane.operationsStart as number) : 0;
        const oe = hasOps ? xOf((lane.operationsEnd as number) + 1) : 0;
        return (
          <React.Fragment key={i}>
            <div style={{ position: 'absolute', left: 0, top, width: labelW - 8, height: laneH - 8, fontSize: 10, color: DECK_THEME.ink, overflow: 'hidden' }}>
              <div style={{ fontWeight: 700, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{lane.name}</div>
              <div style={{ fontSize: 8, color: DECK_THEME.slateLight, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{lane.strategies}</div>
            </div>
            <div title="Construction" style={{
              position: 'absolute', left: cs, top: top + 2, width: Math.max(3, ce - cs), height: laneH - 14,
              background: DECK_THEME.navy, borderRadius: 2,
            }} />
            {hasOps ? (
              <div title="Operations" style={{
                position: 'absolute', left: os, top: top + 2, width: Math.max(3, oe - os), height: laneH - 14,
                background: DECK_THEME.navyLight, borderRadius: 2, opacity: 0.9,
              }} />
            ) : null}
          </React.Fragment>
        );
      })}
      {/* markers */}
      {p.debtRepaidYear ? (
        <div style={{ position: 'absolute', left: xOf(p.debtRepaidYear), top: 14, bottom: 22, width: 2, background: DECK_THEME.green }}>
          <div style={{ position: 'absolute', bottom: -18, left: -30, width: 64, textAlign: 'center', fontSize: 8, color: DECK_THEME.green, fontWeight: 700 }}>
            Debt repaid
          </div>
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: Math.min(xOf(p.exitYear), labelW + trackW - 1), top: 14, bottom: 22, width: 2, background: DECK_THEME.red }}>
        <div style={{ position: 'absolute', bottom: -18, left: -20, width: 44, textAlign: 'center', fontSize: 8, color: DECK_THEME.red, fontWeight: 700 }}>Exit</div>
      </div>
      {/* legend */}
      <div style={{ position: 'absolute', right: 0, bottom: 0, display: 'flex', gap: 12, fontSize: 8, color: DECK_THEME.slate }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: DECK_THEME.navy, marginRight: 4 }} />Construction</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, background: DECK_THEME.navyLight, marginRight: 4 }} />Operations</span>
      </div>
    </div>
  );
}

/** The two-way sensitivity grid, colour graded across the value range. */
function HeatmapView({ o, ctx }: { o: HeatmapObject; ctx: RenderCtx }): React.JSX.Element {
  const s = ctx.model.sensitivity;
  if (!s.hasData) return <Unlinked reason="No sensitivity grid is configured for this model" label="Sensitivity" />;

  const flat = s.irr.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const grade = (v: number | null): string => {
    if (v === null || hi === lo) return DECK_THEME.white;
    return blend(DECK_THEME.pale, DECK_THEME.navy, (v - lo) / (hi - lo));
  };
  const readable = (v: number | null): string => {
    if (v === null || hi === lo) return DECK_THEME.ink;
    return (v - lo) / (hi - lo) > 0.55 ? DECK_THEME.white : DECK_THEME.ink;
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', fontFamily: fontStack(fontFor(ctx.branding, 'body')) }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: DECK_THEME.slate, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>
        {o.title ?? 'Equity IRR'}
        <span style={{ float: 'right', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: DECK_THEME.slateLight }}>
          {s.yVariable} (rows) vs {s.xVariable} (columns)
        </span>
      </div>
      <table style={{ width: '100%', flex: 1, borderCollapse: 'collapse', fontSize: 10, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ background: DECK_THEME.navy, color: DECK_THEME.white, padding: '4px 6px', fontSize: 9 }} />
            {s.xValues.map((x, i) => (
              <th key={i} style={{ background: DECK_THEME.navy, color: DECK_THEME.white, padding: '4px 6px', fontSize: 9, fontWeight: 700 }}>
                {ctx.fmt.pct(x)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {s.yValues.map((y, ri) => (
            <tr key={ri}>
              <th style={{ background: DECK_THEME.navy, color: DECK_THEME.white, padding: '4px 6px', fontSize: 9, fontWeight: 700, textAlign: 'right' }}>
                {ctx.fmt.pct(y)}
              </th>
              {s.xValues.map((_x, ci) => {
                const v = s.irr[ri]?.[ci] ?? null;
                return (
                  <td key={ci} style={{
                    background: grade(v), color: readable(v), textAlign: 'center', padding: '4px 6px',
                    border: `1px solid ${DECK_THEME.white}`, fontWeight: 600,
                  }}>
                    {v === null ? 'n/a' : ctx.fmt.pct(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RISK_TONE: Record<string, string> = { Low: DECK_THEME.green, Medium: '#B98A2E', High: DECK_THEME.red };

function RiskMatrixView({ o, ctx }: { o: RiskMatrixObject; ctx: RenderCtx }): React.JSX.Element {
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', fontFamily: fontStack(fontFor(ctx.branding, 'body')) }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {['Risk', 'Likelihood', 'Impact', 'Mitigation'].map((h, i) => (
              <th key={h} style={{
                background: DECK_THEME.navy, color: DECK_THEME.white, textAlign: 'left', padding: '5px 8px',
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
                width: i === 0 ? '30%' : i === 3 ? '42%' : '14%',
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {o.rows.map((r, i) => (
            <tr key={i} style={{ borderTop: `1px solid ${DECK_THEME.rule}`, background: i % 2 === 1 ? `${DECK_THEME.rowGrey}44` : 'transparent' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600, color: DECK_THEME.ink, verticalAlign: 'top' }}>{r.risk}</td>
              {[r.likelihood, r.impact].map((v, j) => (
                <td key={j} style={{ padding: '6px 8px', verticalAlign: 'top' }}>
                  <span style={{
                    background: `${RISK_TONE[v] ?? DECK_THEME.slate}1A`, color: RISK_TONE[v] ?? DECK_THEME.slate,
                    borderRadius: 3, padding: '2px 8px', fontSize: 9, fontWeight: 700,
                  }}>
                    {v}
                  </span>
                </td>
              ))}
              <td style={{ padding: '6px 8px', color: DECK_THEME.slate, verticalAlign: 'top', lineHeight: 1.35 }}>{r.mitigation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

/** Paint one object. The caller positions it; this fills the given box. */
export function SlideObjectView({ o, ctx }: { o: DeckObject; ctx: RenderCtx }): React.JSX.Element | null {
  if (o.hidden) return null;
  switch (o.type) {
    case 'text':       return <TextView o={o} ctx={ctx} />;
    case 'bullets':    return <BulletsView o={o} ctx={ctx} />;
    case 'kpi':        return <KpiView o={o} ctx={ctx} />;
    case 'chart':      return <ChartView o={o} ctx={ctx} />;
    case 'table':      return <TableView o={o} ctx={ctx} />;
    case 'image':      return <ImageView o={o} />;
    case 'shape':      return <ShapeView o={o} ctx={ctx} />;
    case 'divider':    return <DividerView o={o} />;
    case 'gantt':      return <GanttView o={o} ctx={ctx} />;
    case 'heatmap':    return <HeatmapView o={o} ctx={ctx} />;
    case 'riskMatrix': return <RiskMatrixView o={o} ctx={ctx} />;
    default:           return null;
  }
}

'use client';

/**
 * PortfolioSummary - the money the Portfolio Dashboard shows.
 *
 * It replaces five count tiles, three of which (ACTIVE / IN REVIEW / APPROVED)
 * were status labels nothing in the product ever set, so they read zero
 * permanently. Counts are not insight; these are the figures a developer with
 * several projects actually asks for.
 *
 * Everything here is DISPLAY. The figures come from /api/refm/portfolio, which
 * runs the same engine the workspace runs, over each project's MANAGEMENT BASE
 * case, so a sensitivity left selected inside one project cannot move the
 * portfolio. Archived projects are excluded.
 *
 * Three honesty rules are visible in the markup, not just in the API:
 *   * every ratio carries "N of M modelled", because an empty project must
 *     not read as a zero that drags an average;
 *   * a mixed-currency portfolio is NEVER summed into one number: one block
 *     per currency, and a note saying why;
 *   * the IRR is labelled as computed from aggregated cash flows, because an
 *     average of IRRs is not an IRR and must not be read as one.
 *
 * Locked palette: navy / gold / green tokens only.
 *
 * No em dashes in this file.
 */
import React, { useEffect, useState } from 'react';

interface YearPoint { year: number; byProject: Record<string, number>; total: number }
interface Group {
  currency: string;
  projects: Array<{ projectId: string; name: string; modelled: boolean; gdv: number; irr: number | null; error?: string }>;
  modelledCount: number; projectCount: number;
  gdv: number; totalDevelopmentCost: number; totalFinancingCost: number;
  fundingRequirement: number; saleableAreaSqm: number; saleableUnits: number;
  peakDebt: number; peakDebtYear: number | null;
  portfolioEquityIrr: number | null; portfolioEquityMultiple: number | null;
  fundingByYear: YearPoint[];
}
interface PortfolioResponse {
  groups: Group[]; mixedCurrency: boolean;
  projectCount: number; modelledCount: number; markets: number;
  archivedExcluded?: number;
}

// Series colours for the stacked chart, from the locked palette only.
const SERIES = [
  'var(--color-navy)', 'var(--color-gold)', 'var(--color-green)',
  'var(--color-navy-mid)', 'var(--color-navy-dark)', 'var(--color-grey-mid)',
];

function money(v: number, currency: string): string {
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${currency} ${(v / 1e9).toFixed(2)}bn`;
  if (abs >= 1e6) return `${currency} ${(v / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${currency} ${(v / 1e3).toFixed(0)}k`;
  return `${currency} ${v.toFixed(0)}`;
}
const pct = (v: number | null): string => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const mult = (v: number | null): string => (v == null ? 'n/a' : `${v.toFixed(2)}x`);
const num = (v: number): string => Math.round(v).toLocaleString();

function Tile({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div
      className="card"
      style={{
        padding: 'var(--sp-2)', display: 'flex', flexDirection: 'column', gap: 2,
        gridColumn: wide ? 'span 2' : undefined,
      }}
    >
      <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--font-section)', fontWeight: 800, color: 'var(--color-heading)', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>{sub}</div>}
    </div>
  );
}

/** Funding requirement by calendar year, stacked by project. Years are the
 *  engine's own absolute year labels, so projects starting in different years
 *  line up correctly rather than by period index. */
function FundingChart({ group, currency }: { group: Group; currency: string }) {
  // Funding is front-loaded by nature, so the dense axis carried a long tail
  // of empty years, each labelled "SAR 0". Trim the empty HEAD and TAIL only:
  // an INTERIOR empty year is kept, because it is real information (a pause in
  // funding) and dropping it would compress the time axis, which is the same
  // mistake that overstated the IRR before the axis was made dense. The DATA
  // axis is untouched; this is display.
  const all = group.fundingByYear;
  const firstReal = all.findIndex((p) => p.total !== 0);
  const lastReal = all.length - 1 - [...all].reverse().findIndex((p) => p.total !== 0);
  const points = firstReal === -1 ? [] : all.slice(firstReal, lastReal + 1);
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.total));
  const ids = [...new Set(points.flatMap((p) => Object.keys(p.byProject)))];
  const nameOf = (id: string) => group.projects.find((p) => p.projectId === id)?.name ?? 'Project';
  const colourOf = (id: string) => SERIES[ids.indexOf(id) % SERIES.length];

  return (
    <div className="card" style={{ padding: 'var(--sp-3)', marginTop: 'var(--sp-2)' }} data-testid="portfolio-funding-chart">
      <div style={{ fontSize: 'var(--font-meta)', fontWeight: 700, color: 'var(--color-heading)', marginBottom: 2 }}>
        Funding requirement by year
      </div>
      <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
        Stacked by project, on calendar years. Hover a bar for the amount. {currency}.
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-2)', height: 160 }}>
        {points.map((p) => (
          <div key={p.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%' }}>
            <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              {ids.filter((id) => (p.byProject[id] ?? 0) > 0).map((id) => (
                <div
                  key={id}
                  title={`${nameOf(id)} · ${p.year} · ${money(p.byProject[id] ?? 0, currency)}`}
                  style={{
                    height: `${((p.byProject[id] ?? 0) / max) * 100}%`,
                    background: colourOf(id),
                    borderRadius: 2,
                    marginTop: 1,
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', whiteSpace: 'nowrap' }}>{p.year}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
        {ids.map((id) => (
          <span key={id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 'var(--font-micro)', color: 'var(--color-meta)' }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: colourOf(id) }} />
            {nameOf(id)}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function PortfolioSummary({ projectCount, markets }: { projectCount: number; markets: number }): React.JSX.Element {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/refm/portfolio', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (!cancelled) setData(j as PortfolioResponse); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  // PROJECTS and MARKETS are facts about the LIST, not the portfolio, so they
  // sit in the footnote under the tiles rather than as a stray grey line above
  // them. Shown on their own only while there are no figures to caption.
  const counts = (
    <div style={{ display: 'flex', gap: 'var(--sp-3)', fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
      <span data-testid="portfolio-count-projects"><strong style={{ color: 'var(--color-heading)' }}>{projectCount}</strong> project{projectCount === 1 ? '' : 's'}</span>
      <span data-testid="portfolio-count-markets"><strong style={{ color: 'var(--color-heading)' }}>{markets}</strong> market{markets === 1 ? '' : 's'}</span>
    </div>
  );

  if (failed) {
    return (
      <div data-testid="portfolio-summary">
        {counts}
        <div className="card" style={{ padding: 'var(--sp-2)', fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
          Portfolio figures are unavailable right now. Your projects are unaffected.
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div data-testid="portfolio-summary">
        {counts}
        <div className="card" style={{ padding: 'var(--sp-2)', fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>
          Calculating portfolio figures…
        </div>
      </div>
    );
  }

  const groupsWithModel = data.groups.filter((g) => g.modelledCount > 0);

  return (
    <div data-testid="portfolio-summary">
      {/* The counts caption the tiles from below; with nothing modelled there
          are no tiles to caption, so they stand on their own. */}
      {groupsWithModel.length === 0 && counts}

      {groupsWithModel.length === 0 ? (
        <div className="card" style={{ padding: 'var(--sp-3)', fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }} data-testid="portfolio-nothing-modelled">
          No project has a model yet, so there are no portfolio figures to show. Open a project and
          build its feasibility model, then these tiles fill in.
        </div>
      ) : (
        <>
          {data.mixedCurrency && (
            <div
              data-testid="portfolio-mixed-currency"
              style={{ marginBottom: 'var(--sp-2)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'var(--color-navy-pale)', fontSize: 'var(--font-micro)', color: 'var(--color-heading)', lineHeight: 1.6 }}
            >
              Your projects use more than one currency, so totals are shown per currency and are
              deliberately not added together.
            </div>
          )}

          {groupsWithModel.map((g) => (
            <div key={g.currency} style={{ marginBottom: 'var(--sp-3)' }}>
              {data.groups.length > 1 && (
                <div style={{ fontSize: 'var(--font-meta)', fontWeight: 700, color: 'var(--color-heading)', marginBottom: 6 }}>{g.currency}</div>
              )}

              <div style={{ display: 'grid', gap: 'var(--sp-2)', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
                <Tile label="Gross development value" value={money(g.gdv, g.currency)} sub="GDV over the hold" />
                <Tile label="Development cost" value={money(g.totalDevelopmentCost, g.currency)} sub="incl. land" />
                <Tile label="Funding requirement" value={money(g.fundingRequirement, g.currency)} sub="net cash to fund" />
                <Tile
                  label="Peak debt"
                  value={money(g.peakDebt, g.currency)}
                  sub={g.peakDebtYear ? `portfolio peak in ${g.peakDebtYear}` : 'across the portfolio'}
                />
                <Tile
                  label="Portfolio equity IRR"
                  value={pct(g.portfolioEquityIrr)}
                  sub="aggregated cash flows"
                />
                <Tile
                  label="Equity multiple"
                  value={mult(g.portfolioEquityMultiple)}
                  sub="distributions / equity invested"
                />
              </div>

              {/* ONE footnote under the tiles carrying every caption: the list
                  counts, the modelled count (stated once, not on two tiles),
                  saleable area, and the basis. */}
              <div style={{ fontSize: 'var(--font-micro)', color: 'var(--color-meta)', marginTop: 'var(--sp-1)', lineHeight: 1.7 }} data-testid="portfolio-footnote">
                <span data-testid="portfolio-count-projects"><strong style={{ color: 'var(--color-heading)' }}>{projectCount}</strong> project{projectCount === 1 ? '' : 's'}</span>
                {' across '}
                <span data-testid="portfolio-count-markets"><strong style={{ color: 'var(--color-heading)' }}>{markets}</strong> market{markets === 1 ? '' : 's'}</span>
                {' · '}
                <span data-testid="portfolio-modelled">{g.modelledCount} of {g.projectCount} modelled</span>
                {g.saleableAreaSqm > 0 && (
                  <>
                    {' · '}
                    <span data-testid="portfolio-saleable">
                      {num(g.saleableAreaSqm)} sqm saleable{g.saleableUnits > 0 ? `, ${num(g.saleableUnits)} units` : ''}
                    </span>
                  </>
                )}
                {!!data.archivedExcluded && <>{' · '}{data.archivedExcluded} archived (excluded)</>}
                <br />
                Management base case, archived projects excluded. The IRR is computed once on the
                combined cash flows of every modelled project; it is not an average of project IRRs.
              </div>

              <FundingChart group={g} currency={g.currency} />
            </div>
          ))}
        </>
      )}
    </div>
  );
}

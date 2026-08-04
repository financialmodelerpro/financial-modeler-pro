'use client';

/**
 * Module1FundTerms.tsx (REFM Module 1, tab 3, fund layer Step 2 extended)
 *
 * The fund vehicle's terms: the toggle, the fee BASES the user types, the fund
 * management fees, the performance fee and hurdle, and the per-party fee
 * distribution matrix. See docs/FUND_LAYER_GUIDELINE.md.
 *
 * INPUTS ONLY. Nothing entered here changes a number anywhere yet: the fees
 * reach M4 at Step 3 and the waterfall M5 at Step 4. The tab says so rather
 * than letting a user believe their returns already reflect a fee they typed.
 *
 * ── THREE THINGS THAT ARE NOT ARBITRARY ────────────────────────────────────
 *
 * 1. THE FEE ROWS RENDER FROM `FUND_FEE_SPECS`, not from hand-written JSX per
 *    fee. Each spec carries its timing and its base, both shown in the row, so
 *    the user can see WHAT each fee charges on, and Step 3 reads the same
 *    registry rather than re-deciding per fee in engine code.
 *
 * 2. THE MATRIX ROWS ARE THE PROJECT'S LIVE PARTIES, loaded from the Parties
 *    tab, not a fixed role list. A share belongs to a named counterparty. Each
 *    saved cell keys on partyId and SNAPSHOTS partyName, the same shape an M5
 *    equity partner uses, so a rename or a deletion never blanks a saved row.
 *
 * 3. TWO WRITES, ON PURPOSE. `refm_fund_terms` is the durable per-project row;
 *    `Project.fundTerms` in the store is the ENGINE-FACING copy that rides in
 *    the version snapshot. The engine will read the snapshot, never the table,
 *    so a saved version reproduces the terms it was computed with. Writing only
 *    the table would silently re-price every historical version the moment
 *    someone edited this tab.
 *
 * Rates are stored as DECIMAL FRACTIONS (0.02) and shown as percentages (2), so
 * the x100 lives in one input component and nowhere else.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { FAST_INPUT } from './_shared/inputStyles';
import type { Party } from '../../lib/parties';
import {
  FUND_FEE_SPECS, FEE_BASE_LABELS, FEE_TIMING_LABELS, FEE_DISTRIBUTION_COLUMNS,
  FUND_MANAGER_ROW_ID, DEFAULT_FUND_MANAGER_NAME, isFundManagerRow,
  resolveFundTerms, toFundTermsPatch, feeColumnTotal, feeColumnBalanced,
  type FeeDistributionColumnKey, type FeeDistributionRow, type FundTerms,
} from '../../lib/fundTerms';
import { resolveFacilityLimit } from '../../lib/fundFees';
import { getFundTerms, saveFundTerms, listParties } from '../../lib/persistence/client';

const NAVY = '#1B3A6B';
const BLUE = '#1B4F8A';
const BORDER = '#E8F0FB';
const GREEN = '#2E7D52';
const AMBER_BG = '#FFF8E8';
const AMBER_LINE = '#E4C271';
const AMBER_INK = '#7A5B12';

const card: React.CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 10, background: '#FFFFFF',
  padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)',
};
const sectionTitle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 4 };
const helpText: React.CSSProperties = { fontSize: 11, color: '#6B7A90', lineHeight: 1.5 };
const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: NAVY, marginBottom: 4 };
const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#FFFFFF', background: BLUE,
  padding: '6px 8px', whiteSpace: 'nowrap',
};
const td: React.CSSProperties = { padding: '5px 8px', fontSize: 12, color: NAVY, borderBottom: `1px solid ${BORDER}` };
const chip = (ok: boolean): React.CSSProperties => ({
  display: 'inline-block', borderRadius: 4, padding: '3px 8px', fontSize: 11, fontWeight: 700,
  background: ok ? '#EAF6EF' : AMBER_BG,
  border: `1px solid ${ok ? GREEN : AMBER_LINE}`,
  color: ok ? GREEN : AMBER_INK,
});

const asPctText = (v: number): string => String(Math.round(v * 1000000) / 10000);

/**
 * Percent-valued input over a decimal-fraction value. The x100 lives here.
 *
 * The text is held locally while editing so a half-typed "1." or an emptied box
 * is not rewritten to 0 under the user's cursor. Re-syncing to an externally
 * changed value happens DURING RENDER by comparing against the last value seen,
 * which is React's documented way to adjust state when a prop changes. An
 * effect would work too but schedules a second render pass for something that
 * is pure derivation, and the linter is right to object to it.
 */
function PctInput({ value, onChange, testId }: {
  value: number; onChange: (decimal: number) => void; testId: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<{ text: string; from: number }>(() => ({ text: asPctText(value), from: value }));
  if (draft.from !== value) setDraft({ text: asPctText(value), from: value });
  const text = draft.text;
  const setText = (t: string): void => setDraft({ text: t, from: value });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number" min={0} max={100} step={0.25} inputMode="decimal"
        value={text} data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(100, n)) / 100);
        }}
        onBlur={() => setText(asPctText(value))}
        style={FAST_INPUT}
      />
      <span style={{ fontSize: 11, color: '#6B7A90' }}>%</span>
    </div>
  );
}

function AmountInput({ value, onChange, testId }: {
  value: number; onChange: (v: number) => void; testId: string;
}): React.JSX.Element {
  return (
    <input
      type="number" min={0} step={1000} inputMode="decimal"
      value={value} data-testid={testId}
      onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      style={FAST_INPUT}
    />
  );
}

export default function Module1FundTerms({ projectId }: { projectId: string | null }): React.JSX.Element {
  const { project, setProject, financingTranches } = useModule1Store(useShallow((s) => ({
    project: s.project, setProject: s.setProject, financingTranches: s.financingTranches,
  })));

  // The snapshot copy is the source of truth for what is ON SCREEN, because it
  // is what a version save captures. The table row seeds it on open.
  const terms = useMemo(() => resolveFundTerms(project), [project]);

  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [extended, setExtended] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load the parties (matrix rows) and the durable row, seeding the snapshot
  // copy from the latter ONCE per project and only when the snapshot carries no
  // terms: a snapshot that already holds terms (an older version being viewed,
  // or unsaved edits) must win, or opening the tab would silently overwrite
  // what the user is looking at with today's row.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const [pr, ft] = await Promise.all([listParties(projectId), getFundTerms(projectId)]);
      if (!alive) return;
      setLoading(false);
      setParties(pr.data?.parties ?? []);
      setAvailable(ft.data?.available !== false);
      setExtended(ft.data?.extended !== false);
      if (ft.error || !ft.data) return;
      if (ft.data.saved && project?.fundTerms === undefined) {
        setProject({ fundTerms: toFundTermsPatch(ft.data.terms) });
      }
    })();
    return () => { alive = false; };
    // Deliberately keyed on the project only: this is a seed, not a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /** Every edit writes the snapshot copy immediately (so a version save always
   *  captures what is on screen) and marks the row dirty for an explicit Save. */
  const patch = useCallback((next: Partial<FundTerms>) => {
    setProject({ fundTerms: toFundTermsPatch({ ...terms, ...next }) });
    setDirty(true);
    setNotice(null);
  }, [terms, setProject]);

  // ── The matrix, reconciled against the LIVE parties ──────────────────────
  //
  // Rows displayed are the project's parties. Stored values are looked up by
  // partyId, so renaming a party keeps its shares and the snapshotted name is
  // refreshed. Stored rows whose party no longer exists are NOT silently
  // dropped: they are counted and surfaced, and only removed on an explicit
  // save, because discarding numbers a user typed without telling them is how
  // trust in a model is lost.
  // The Fund Manager is ALWAYS the first row: it exists whenever the fund layer
  // is on, whether or not any party has been given a share, because it earns
  // the management fees regardless. It is not a party and never appears on the
  // Parties tab, so it is pinned here rather than looked up.
  const displayRows = useMemo<FeeDistributionRow[]>(() => {
    const managerStored = terms.feeDistribution.find(isFundManagerRow);
    const manager: FeeDistributionRow = {
      partyId: FUND_MANAGER_ROW_ID,
      partyName: terms.fundManagerName || DEFAULT_FUND_MANAGER_NAME,
      performanceFeePct: managerStored?.performanceFeePct ?? 0,
      developerFeePct: managerStored?.developerFeePct ?? 0,
      commissionPct: managerStored?.commissionPct ?? 0,
    };
    const partyRows = parties.map((p) => {
      const stored = terms.feeDistribution.find((r) => r.partyId === p.id);
      return {
        partyId: p.id,
        partyName: p.name,
        performanceFeePct: stored?.performanceFeePct ?? 0,
        developerFeePct: stored?.developerFeePct ?? 0,
        commissionPct: stored?.commissionPct ?? 0,
      };
    });
    return [manager, ...partyRows];
  }, [parties, terms.feeDistribution, terms.fundManagerName]);

  // Orphans exclude the Fund Manager row, which has no party to go missing.
  const orphans = useMemo(
    () => terms.feeDistribution.filter((r) => !isFundManagerRow(r) && !parties.some((p) => p.id === r.partyId)),
    [terms.feeDistribution, parties],
  );

  const setCell = useCallback((partyId: string, col: FeeDistributionColumnKey, decimal: number) => {
    const next = displayRows.map((r) => (r.partyId === partyId ? { ...r, [col]: decimal } : r));
    // Orphans ride along untouched until the user saves, so an edit to one row
    // cannot quietly delete another party's numbers.
    patch({ feeDistribution: [...next, ...orphans] });
  }, [displayRows, orphans, patch]);

  const save = useCallback(async () => {
    if (!projectId || saving) return;
    setSaving(true); setNotice(null);
    // Saving is what prunes the orphans, after they have been shown.
    const cleaned: FundTerms = { ...terms, feeDistribution: displayRows };
    setProject({ fundTerms: toFundTermsPatch(cleaned) });
    const res = await saveFundTerms(projectId, cleaned);
    setSaving(false);
    if (res.error) { setNotice(res.error); setAvailable(res.data?.available !== false); return; }
    setExtended(res.data?.extended !== false);
    setDirty(false);
    setNotice(orphans.length
      ? `Fund terms saved. ${orphans.length} share${orphans.length === 1 ? '' : 's'} for parties that no longer exist ${orphans.length === 1 ? 'was' : 'were'} removed.`
      : 'Fund terms saved. They also travel with the next project version you save.');
  }, [projectId, saving, terms, displayRows, orphans.length, setProject]);

  if (!projectId) {
    return <div style={{ padding: 'var(--sp-3)', color: '#6B7A90', fontSize: 13 }} data-testid="fund-terms-no-project">
      Open a project to set its fund terms.
    </div>;
  }

  const off = !terms.enabled;

  // The facility limit as the model states it. capexTotal is null because the
  // tab has no cheap capex total; the resolver then reports the SOURCE without
  // an amount rather than the UI re-deriving capex and drifting from the engine.
  const facility = resolveFacilityLimit({
    tranches: financingTranches ?? [],
    capexTotal: null,
    manualLimit: terms.facilityLimit,
    override: terms.facilityLimitOverride,
  });

  return (
    <div data-testid="module1-fund-terms">
      {/* ── The toggle ─────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <div style={sectionTitle}>Fund structure</div>
            <div style={helpText}>
              A standalone project models the development on its own. A fund adds the vehicle`s economics on top:
              the fees it charges, the preferred return to investors, and the performance fee to the manager.
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input
              type="checkbox" checked={terms.enabled} data-testid="fund-terms-enabled"
              onChange={(e) => patch({ enabled: e.target.checked })}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: terms.enabled ? BLUE : '#6B7A90' }}>
              {terms.enabled ? 'Fund structure ON' : 'Standalone project'}
            </span>
          </label>
        </div>

        {off ? (
          <div style={{ marginTop: 'var(--sp-2)', background: '#F4F8FD', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '9px 11px', ...helpText }}>
            The fund layer is off, so this project behaves exactly as it does today. You can still fill everything in
            below: it is saved with the project and takes effect only when you switch the toggle on.
          </div>
        ) : (
          <div style={{ marginTop: 'var(--sp-2)', background: AMBER_BG, border: `1px solid ${AMBER_LINE}`, color: AMBER_INK, borderRadius: 6, padding: '9px 11px', fontSize: 11, lineHeight: 1.5 }}>
            These terms are recorded but do not yet flow into the model. The fees reach the financial statements, and
            the hurdle and performance fee reach the returns waterfall, in the next steps of the fund build.
          </div>
        )}
      </div>

      {/* ── Fee bases ───────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={sectionTitle}>Fee bases</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          Both figures are yours to enter: a target or committed fund size, and the facility limit. They are inputs
          rather than results, so a fee can raise the funding requirement without the extra funding raising the fee.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--sp-2)' }}>
          <div>
            <label style={label}>Fund size</label>
            <AmountInput value={terms.fundSize} onChange={(v) => patch({ fundSize: v })} testId="fund-terms-fund-size" />
            <div style={{ ...helpText, marginTop: 4 }}>
              Base for the one-time fund structure fee. You enter this rather than the model working it out:
              fund size is equity plus debt, the debt is decided by the funding requirement, and these fees
              raise that requirement. Reading it from the model would make the fee change its own base.
            </div>
          </div>
          <div>
            <label style={label}>Facility limit</label>
            {/* Read from the model where the model states one. The tab cannot
                compute capex cheaply, so an LTV cap resolves with the source
                but no amount here (amountKnown false) and says so, rather than
                the UI re-implementing capex and drifting from the engine. */}
            {facility.source !== 'manual' && facility.source !== 'none' ? (
              <div data-testid="fund-terms-facility-resolved" style={{
                border: `1px solid ${BORDER}`, borderRadius: 6, padding: '7px 9px', background: '#F4F8FD',
                fontSize: 12, color: NAVY, fontWeight: 600,
              }}>
                {facility.amountKnown ? facility.amount.toLocaleString() : 'From your facilities'}
              </div>
            ) : (
              <AmountInput value={terms.facilityLimit} onChange={(v) => patch({ facilityLimit: v })} testId="fund-terms-facility-limit" />
            )}
            <div style={{ ...helpText, marginTop: 4 }}>{facility.explanation}</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, cursor: 'pointer' }}>
              <input
                type="checkbox" checked={terms.facilityLimitOverride} data-testid="fund-terms-facility-override"
                onChange={(e) => patch({ facilityLimitOverride: e.target.checked })}
              />
              <span style={{ fontSize: 11, color: NAVY }}>Enter the limit myself</span>
            </label>
            {terms.facilityLimitOverride ? (
              <div style={{ marginTop: 6 }}>
                <AmountInput value={terms.facilityLimit} onChange={(v) => patch({ facilityLimit: v })} testId="fund-terms-facility-limit" />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── The Fund Manager ────────────────────────────────────────────── */}
      <div style={card}>
        <div style={sectionTitle}>Fund Manager</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          The entity that runs the fund. It exists only while the fund structure is on, so it is set here rather
          than on the Parties tab. It earns ALL of the fund management fees below, and takes its own share of the
          performance fee in the distribution table.
        </div>
        <div style={{ maxWidth: 360 }}>
          <label style={label}>Name</label>
          <input
            type="text" value={terms.fundManagerName} maxLength={120}
            onChange={(e) => patch({ fundManagerName: e.target.value })}
            placeholder={DEFAULT_FUND_MANAGER_NAME} data-testid="fund-terms-manager-name"
            style={{ ...FAST_INPUT, background: '#FFFFFF' }}
          />
        </div>
      </div>

      {/* ── Fund management fees, rendered from FUND_FEE_SPECS ──────────── */}
      <div style={card}>
        <div style={sectionTitle}>Fund management fees</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          Each fee shows when it is charged and what it is charged on. Annual NAV fees use NAV at the START of the
          year, so the amount is known before that year`s cash moves.
          {' '}<strong>All of these go to {terms.fundManagerName || DEFAULT_FUND_MANAGER_NAME}</strong>, in full and unsplit.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '38%' }}>Fee</th>
                <th style={{ ...th, width: '14%' }}>When</th>
                <th style={{ ...th, width: '20%' }}>Charged on</th>
                <th style={{ ...th, width: '28%' }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {FUND_FEE_SPECS.map((spec) => (
                <tr key={spec.key} data-testid={`fund-fee-row-${spec.key}`}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{spec.label}</div>
                    <div style={helpText}>{spec.help}</div>
                  </td>
                  <td style={{ ...td, fontSize: 11 }}>{FEE_TIMING_LABELS[spec.timing]}</td>
                  <td style={{ ...td, fontSize: 11 }}>{FEE_BASE_LABELS[spec.base]}</td>
                  <td style={td}>
                    {spec.kind === 'rate' ? (
                      <PctInput
                        value={terms[spec.key] as number}
                        onChange={(v) => patch({ [spec.key]: v } as Partial<FundTerms>)}
                        testId={`fund-terms-${spec.key}`}
                      />
                    ) : (
                      <AmountInput
                        value={terms[spec.key] as number}
                        onChange={(v) => patch({ [spec.key]: v } as Partial<FundTerms>)}
                        testId={`fund-terms-${spec.key}`}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Performance fee ─────────────────────────────────────────────── */}
      <div style={card}>
        <div style={sectionTitle}>Performance fee</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          Investors are paid back their capital and then the hurdle. The manager takes the performance fee out of
          whatever is left above it.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-2)' }}>
          <div>
            <label style={label}>Performance fee</label>
            <PctInput value={terms.performanceFeePct} onChange={(v) => patch({ performanceFeePct: v })} testId="fund-terms-performance-fee" />
          </div>
          <div>
            <label style={label}>Hurdle rate (IRR)</label>
            <PctInput value={terms.hurdleRatePct} onChange={(v) => patch({ hurdleRatePct: v })} testId="fund-terms-hurdle" />
          </div>
        </div>
      </div>

      {/* ── Fee distribution matrix ─────────────────────────────────────── */}
      <div style={card}>
        <div style={sectionTitle}>Fee distribution</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          How each fee type is split across the parties on the Parties tab. Each column should total 100%.
        </div>

        {!parties.length ? (
          <div style={{ background: '#F4F8FD', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '10px 12px', ...helpText, marginBottom: 'var(--sp-2)' }} data-testid="fund-terms-no-parties">
            No parties yet. Add them on the Parties tab and they will appear here alongside the Fund Manager.
          </div>
        ) : null}
        {(
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }} data-testid="fund-terms-matrix">
              <thead>
                <tr>
                  <th style={{ ...th, width: '34%' }}>Earns</th>
                  {FEE_DISTRIBUTION_COLUMNS.map((c) => <th key={c.key} style={th}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => (
                  <tr key={row.partyId} data-testid="fund-terms-matrix-row">
                    <td style={{ ...td, background: isFundManagerRow(row) ? '#F4F8FD' : undefined }}>
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {row.partyName}
                        {isFundManagerRow(row) ? (
                          <span
                            data-testid="fund-terms-manager-badge"
                            style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: '#FFFFFF', background: BLUE, borderRadius: 3, padding: '1px 5px' }}
                          >FUND MANAGER</span>
                        ) : null}
                      </div>
                      <div style={helpText}>
                        {isFundManagerRow(row)
                          ? 'Also earns 100% of the fund management fees'
                          : (parties.find((p) => p.id === row.partyId)?.roles ?? []).join(', ') || 'No role set'}
                      </div>
                    </td>
                    {FEE_DISTRIBUTION_COLUMNS.map((c) => (
                      <td key={c.key} style={td}>
                        <PctInput
                          value={row[c.key]}
                          onChange={(v) => setCell(row.partyId, c.key, v)}
                          testId={`fund-terms-cell-${c.key}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td style={{ ...td, fontWeight: 700 }}>Total</td>
                  {FEE_DISTRIBUTION_COLUMNS.map((c) => {
                    const total = feeColumnTotal(displayRows, c.key);
                    const ok = feeColumnBalanced(displayRows, c.key);
                    return (
                      <td key={c.key} style={td}>
                        <span style={chip(ok)} data-testid={`fund-terms-total-${c.key}`}>
                          {`${(total * 100).toFixed(2)}%`}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {orphans.length ? (
          <div style={{ marginTop: 'var(--sp-2)', background: AMBER_BG, border: `1px solid ${AMBER_LINE}`, color: AMBER_INK, borderRadius: 6, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.5 }} data-testid="fund-terms-orphans">
            {`${orphans.length} saved share${orphans.length === 1 ? '' : 's'} belong${orphans.length === 1 ? 's' : ''} to `}
            {`part${orphans.length === 1 ? 'y' : 'ies'} that no longer exist (${orphans.map((o) => o.partyName || o.partyId).join(', ')}). `}
            They are still stored and will be removed when you save.
          </div>
        ) : null}
      </div>

      {/* ── Save ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <button
          type="button" className="btn-primary" onClick={() => void save()}
          disabled={saving || loading} data-testid="fund-terms-save"
          style={{ padding: 'var(--sp-1) var(--sp-3)' }}
        >
          {saving ? 'Saving...' : dirty ? 'Save fund terms' : 'Saved'}
        </button>
        <span style={helpText}>
          Your entries are already part of the project version you save. This button also keeps them as the
          project`s current fund terms.
        </span>
      </div>

      {!available ? (
        <div style={{ marginTop: 'var(--sp-2)', background: AMBER_BG, border: `1px solid ${AMBER_LINE}`, color: AMBER_INK, borderRadius: 6, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.5 }} data-testid="fund-terms-migration-notice">
          Fund terms cannot be stored on this database yet (migration 208 has not been applied). Everything above still
          works and travels with the project version you save.
        </div>
      ) : !extended ? (
        <div style={{ marginTop: 'var(--sp-2)', background: AMBER_BG, border: `1px solid ${AMBER_LINE}`, color: AMBER_INK, borderRadius: 6, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.5 }} data-testid="fund-terms-extended-notice">
          The extended fee fields and the distribution matrix are not stored on this database yet (migration 209 has not
          been applied). They still travel with the project version you save, so nothing you type here is lost.
        </div>
      ) : null}

      {notice ? (
        <div style={{ marginTop: 'var(--sp-2)', background: '#F4F8FD', border: `1px solid ${BORDER}`, borderRadius: 6, padding: '9px 11px', fontSize: 11.5, color: NAVY }} data-testid="fund-terms-notice">
          {notice}
        </div>
      ) : null}
    </div>
  );
}

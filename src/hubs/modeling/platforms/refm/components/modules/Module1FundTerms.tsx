'use client';

/**
 * Module1FundTerms.tsx (REFM Module 1, tab 3, fund layer Step 2, migration 208)
 *
 * The fund vehicle's terms: standalone-vs-fund toggle, management fee, fee
 * base, hurdle, carry, committed capital, and fee share by party role. See
 * docs/FUND_LAYER_GUIDELINE.md.
 *
 * INPUTS ONLY. Nothing entered here changes a number anywhere yet: the fee
 * lands in M4 at Step 3 and the waterfall in M5 at Step 4. The tab says so
 * plainly rather than letting a user believe their returns already reflect a
 * fee they just typed.
 *
 * TWO WRITES, ON PURPOSE, and the reason matters:
 *
 *   1. `refm_fund_terms` (migration 208) is the DURABLE per-project store, the
 *      row this tab loads on open.
 *   2. `Project.fundTerms` in the store is the ENGINE-FACING copy, which rides
 *      inside the version snapshot when the user saves a version.
 *
 * The engine will read (2), never (1). That is what makes a saved version
 * reproduce the numbers it was computed with, lets Module 6 scenarios override
 * fund terms later, and keeps the PDF/Excel version picker honest about old
 * versions. It follows the M5 partner precedent, which links to a party by id
 * but SNAPSHOTS the name so the engine never depends on a mutable side table.
 * Writing only the table would silently re-price every historical version the
 * moment someone edited this tab.
 *
 * Rates are stored as DECIMAL FRACTIONS (0.02) and shown as percentages (2),
 * so the x100 lives here and nowhere else.
 *
 * No em dashes in this file.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import { FAST_INPUT } from './_shared/inputStyles';
import { PARTY_ROLES } from '../../lib/parties';
import {
  FEE_BASES, FEE_BASE_LABELS, FEE_BASE_HELP,
  resolveFundTerms, toFundTermsPatch, feeShareTotal, feeSharesBalanced,
  type FeeBase, type FundTerms,
} from '../../lib/fundTerms';
import { getFundTerms, saveFundTerms } from '../../lib/persistence/client';

const NAVY = '#1B3A6B';
const BLUE = '#1B4F8A';
const BORDER = '#E8F0FB';

const card: React.CSSProperties = {
  border: `1px solid ${BORDER}`, borderRadius: 10, background: '#FFFFFF',
  padding: 'var(--sp-3)', marginBottom: 'var(--sp-3)',
};
const sectionTitle: React.CSSProperties = {
  fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 4,
};
const helpText: React.CSSProperties = {
  fontSize: 11, color: '#6B7A90', lineHeight: 1.5,
};
const label: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600, color: NAVY, marginBottom: 4,
};
const grid: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 'var(--sp-2)',
};

/** Percent-valued input over a decimal-fraction value. The x100 lives here. */
function PctInput({ value, onChange, disabled, testId }: {
  value: number; onChange: (decimal: number) => void; disabled: boolean; testId: string;
}): React.JSX.Element {
  // Held as text while editing so a half-typed "1." or an emptied box does not
  // get rewritten to 0 under the user's cursor.
  const [text, setText] = useState<string>(() => String(Math.round(value * 1000000) / 10000));
  useEffect(() => { setText(String(Math.round(value * 1000000) / 10000)); }, [value]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input
        type="number" min={0} max={100} step={0.25} inputMode="decimal"
        value={text} disabled={disabled} data-testid={testId}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.min(100, n)) / 100);
        }}
        onBlur={() => setText(String(Math.round(value * 1000000) / 10000))}
        style={{ ...FAST_INPUT, opacity: disabled ? 0.55 : 1 }}
      />
      <span style={{ fontSize: 11, color: '#6B7A90' }}>%</span>
    </div>
  );
}

export default function Module1FundTerms({ projectId }: { projectId: string | null }): React.JSX.Element {
  const { project, setProject } = useModule1Store(useShallow((s) => ({ project: s.project, setProject: s.setProject })));

  // The snapshot copy is the source of truth for what is ON SCREEN, because it
  // is what a version save captures. The table row seeds it on open.
  const terms = useMemo(() => resolveFundTerms(project), [project]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [available, setAvailable] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Load the durable row and seed the snapshot copy from it, ONCE per project.
  // Only when the project carries no fund terms yet: a snapshot that already
  // holds terms (an older version being viewed, or unsaved edits) must win over
  // the table, or opening the tab would silently overwrite what the user is
  // looking at with today's row.
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      const res = await getFundTerms(projectId);
      if (!alive) return;
      setLoading(false);
      setAvailable(res.data?.available !== false);
      if (res.error || !res.data) return;
      if (res.data.saved && project?.fundTerms === undefined) {
        setProject({ fundTerms: toFundTermsPatch(res.data.terms) });
      }
    })();
    return () => { alive = false; };
    // Deliberately keyed on the project only: this is a seed, not a sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /** Every edit writes the snapshot copy immediately (so a version save always
   *  captures what is on screen) and marks the row dirty for an explicit Save. */
  const patch = useCallback((next: Partial<FundTerms>) => {
    const merged = { ...terms, ...next };
    setProject({ fundTerms: toFundTermsPatch(merged) });
    setDirty(true);
    setNotice(null);
  }, [terms, setProject]);

  const setShare = useCallback((role: string, decimal: number) => {
    const rest = terms.feeShares.filter((s) => s.role !== role);
    const next = decimal > 0 ? [...rest, { role, sharePct: decimal }] : rest;
    patch({ feeShares: PARTY_ROLES.filter((r) => next.some((s) => s.role === r)).map((r) => next.find((s) => s.role === r)!) });
  }, [terms.feeShares, patch]);

  const save = useCallback(async () => {
    if (!projectId || saving) return;
    setSaving(true); setNotice(null);
    const res = await saveFundTerms(projectId, terms);
    setSaving(false);
    if (res.error) { setNotice(res.error); setAvailable(res.data?.available !== false); return; }
    setDirty(false);
    setNotice('Fund terms saved. They also travel with the next project version you save.');
  }, [projectId, saving, terms]);

  if (!projectId) {
    return <div style={{ padding: 'var(--sp-3)', color: '#6B7A90', fontSize: 13 }} data-testid="fund-terms-no-project">
      Open a project to set its fund terms.
    </div>;
  }

  const off = !terms.enabled;
  const shareTotal = feeShareTotal(terms.feeShares);
  const balanced = feeSharesBalanced(terms.feeShares);

  return (
    <div data-testid="module1-fund-terms">
      {/* ── The toggle. Everything below it is stored either way, and inert
             until it is on. ─────────────────────────────────────────────── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <div style={sectionTitle}>Fund structure</div>
            <div style={helpText}>
              A standalone project models the development on its own. A fund adds the vehicle`s economics on top:
              a management fee, a preferred return to investors, and a performance fee to the manager.
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
            The fund layer is off, so this project behaves exactly as it does today. You can still fill the terms in below:
            they are saved with the project and take effect only when you switch the toggle on.
          </div>
        ) : (
          <div style={{ marginTop: 'var(--sp-2)', background: '#FFF8E8', border: '1px solid #E4C271', color: '#7A5B12', borderRadius: 6, padding: '9px 11px', fontSize: 11, lineHeight: 1.5 }}>
            These terms are recorded but do not yet flow into the model. The management fee reaches the financial
            statements, and the hurdle and carry reach the returns waterfall, in the next steps of the fund build.
          </div>
        )}
      </div>

      {/* ── Fee ──────────────────────────────────────────────────────────── */}
      <div style={card}>
        <div style={sectionTitle}>Management fee</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          Charged on the base you choose. Both bases are deliberately independent of how the project is funded,
          so paying the fee can raise the funding requirement without the extra funding raising the fee.
        </div>
        <div style={grid}>
          <div>
            <label style={label}>Management fee</label>
            <PctInput value={terms.managementFeePct} onChange={(v) => patch({ managementFeePct: v })} disabled={false} testId="fund-terms-fee-pct" />
          </div>
          <div>
            <label style={label}>Fee base</label>
            <select
              value={terms.feeBase} data-testid="fund-terms-fee-base"
              onChange={(e) => patch({ feeBase: e.target.value as FeeBase })}
              style={{ ...FAST_INPUT, padding: '5px 6px' }}
            >
              {FEE_BASES.map((b) => <option key={b} value={b}>{FEE_BASE_LABELS[b]}</option>)}
            </select>
            <div style={{ ...helpText, marginTop: 4 }}>{FEE_BASE_HELP[terms.feeBase]}</div>
          </div>
          <div>
            <label style={label}>Committed capital</label>
            <input
              type="number" min={0} step={1000} inputMode="decimal"
              value={terms.committedCapital} data-testid="fund-terms-committed-capital"
              onChange={(e) => patch({ committedCapital: Math.max(0, Number(e.target.value) || 0) })}
              style={FAST_INPUT}
            />
            <div style={{ ...helpText, marginTop: 4 }}>
              {terms.feeBase === 'committed_capital'
                ? 'This is the fee base.'
                : 'Kept for reference. The fee is charged on total development cost.'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Waterfall terms ──────────────────────────────────────────────── */}
      <div style={card}>
        <div style={sectionTitle}>Preferred return and carry</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          Investors are paid back their capital and then the preferred return. The manager takes the performance fee
          out of whatever is left above it.
        </div>
        <div style={grid}>
          <div>
            <label style={label}>Preferred return (hurdle)</label>
            <PctInput value={terms.hurdleRatePct} onChange={(v) => patch({ hurdleRatePct: v })} disabled={false} testId="fund-terms-hurdle" />
          </div>
          <div>
            <label style={label}>Performance fee (carry)</label>
            <PctInput value={terms.carryPct} onChange={(v) => patch({ carryPct: v })} disabled={false} testId="fund-terms-carry" />
          </div>
        </div>
      </div>

      {/* ── Fee share by party role ──────────────────────────────────────── */}
      <div style={card}>
        <div style={sectionTitle}>Fee share by party role</div>
        <div style={{ ...helpText, marginBottom: 'var(--sp-2)' }}>
          How fee and carry income is split across the roles on the Parties tab. Leave every row at zero if one
          manager takes all of it. Roles come from the same fixed set the Parties tab uses.
        </div>
        <div style={grid}>
          {PARTY_ROLES.map((role) => {
            const share = terms.feeShares.find((s) => s.role === role)?.sharePct ?? 0;
            return (
              <div key={role}>
                <label style={label}>{role}</label>
                <PctInput value={share} onChange={(v) => setShare(role, v)} disabled={false} testId={`fund-terms-share-${role.replace(/[^a-z]+/gi, '-').toLowerCase()}`} />
              </div>
            );
          })}
        </div>
        {terms.feeShares.length > 0 ? (
          <div
            data-testid="fund-terms-share-total"
            style={{
              marginTop: 'var(--sp-2)', display: 'inline-block', borderRadius: 5, padding: '5px 10px', fontSize: 11.5, fontWeight: 700,
              background: balanced ? '#EAF6EF' : '#FFF8E8',
              border: `1px solid ${balanced ? '#2E7D52' : '#E4C271'}`,
              color: balanced ? '#2E7D52' : '#7A5B12',
            }}
          >
            {`Allocated ${(shareTotal * 100).toFixed(2)}%`}{balanced ? '' : ' (should total 100%)'}
          </div>
        ) : null}
      </div>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
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
        <div style={{ marginTop: 'var(--sp-2)', background: '#FFF8E8', border: '1px solid #E4C271', color: '#7A5B12', borderRadius: 6, padding: '9px 11px', fontSize: 11.5, lineHeight: 1.5 }} data-testid="fund-terms-migration-notice">
          Fund terms cannot be stored on this database yet (migration 208 has not been applied). Everything above still
          works and travels with the project version you save.
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

'use client';

/**
 * AssetTypeStandardsModal (2026-09-07, land planning step 1)
 *
 * The firm's asset type registry and company standards, account-scoped
 * (mig 242) and editable by ANY member, the same rule as the cost catalog:
 * this is vocabulary, not entitlement.
 *
 * A BLANK AND A TYPED ZERO ARE DIFFERENT ANSWERS, so every standards input is
 * a free-text field whose empty state means "not decided" (stored NULL) and
 * whose "0" means a real zero. The table renders blanks as a dash with the
 * word "not set", never as 0.
 *
 * Nothing here is read by the calculation engine. Selecting a type on an
 * asset stamps the resolved values onto the asset; editing this table changes
 * ONLY what future selections stamp.
 *
 * No em dashes in this file.
 */

import React, { useEffect, useState } from 'react';
import {
  PARKING_RATIO_BASES,
  PARKING_RATIO_BASIS_LABELS,
  normaliseAssetTypeId,
  type AssetTypeStandard,
  type ParkingRatioBasis,
} from '../../lib/state/assetTypeStandards';

interface Props {
  open: boolean;
  onClose: () => void;
  entries: AssetTypeStandard[];
  parkingAreaPerSlot: number | null;
  available: boolean;
  /** Re-fetch after any write so the pickers see the same list. */
  onChanged: () => void;
}

interface Draft {
  entryId?: string;           // absent on the add row
  label: string;
  category: string;
  avgUnitSize: string;        // '' = blank
  parkingRatio: string;       // '' = blank
  parkingRatioBasis: ParkingRatioBasis;
}

const toDraft = (e: AssetTypeStandard): Draft => ({
  entryId: e.id,
  label: e.label,
  category: e.category ?? '',
  avgUnitSize: e.avgUnitSizeSqm !== undefined ? String(e.avgUnitSizeSqm) : '',
  parkingRatio: e.parkingRatio !== undefined ? String(e.parkingRatio) : '',
  parkingRatioBasis: e.parkingRatioBasis,
});

const EMPTY_DRAFT: Draft = { label: '', category: '', avgUnitSize: '', parkingRatio: '', parkingRatioBasis: 'slots_per_unit' };

/** '' -> null (blank); otherwise a finite non-negative number or an error. */
function parseStandard(s: string): { ok: true; value: number | null } | { ok: false } {
  const t = s.trim();
  if (t === '') return { ok: true, value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return { ok: false };
  return { ok: true, value: n };
}

const cellInput: React.CSSProperties = {
  width: '100%', padding: '4px 6px', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)', fontSize: 'var(--font-small)', background: 'var(--color-input-bg, #fff)',
};
const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px', fontSize: 'var(--font-micro)', textTransform: 'uppercase',
  letterSpacing: '0.04em', color: 'var(--color-meta)', borderBottom: '1px solid var(--color-border)',
};
const td: React.CSSProperties = { padding: '4px 6px', verticalAlign: 'middle' };
const smallBtn: React.CSSProperties = {
  border: '1px solid var(--color-border)', background: 'transparent', borderRadius: 'var(--radius-sm)',
  padding: '3px 10px', cursor: 'pointer', fontSize: 'var(--font-micro)',
};

export default function AssetTypeStandardsModal({
  open, onClose, entries, parkingAreaPerSlot, available, onChanged,
}: Props): React.JSX.Element | null {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [slotDraft, setSlotDraft] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDrafts(entries.map(toDraft));
    setSlotDraft(parkingAreaPerSlot !== null ? String(parkingAreaPerSlot) : '');
    setAddDraft(EMPTY_DRAFT);
    setError(null);
  }, [open, entries, parkingAreaPerSlot]);

  if (!open) return null;

  const saveEntry = async (d: Draft): Promise<void> => {
    setError(null);
    const label = d.label.trim();
    if (!label) { setError('Every asset type needs a name.'); return; }
    const unit = parseStandard(d.avgUnitSize);
    const ratio = parseStandard(d.parkingRatio);
    if (!unit.ok) { setError(`"${label}": average unit size must be blank, zero or a positive number.`); return; }
    if (!ratio.ok) { setError(`"${label}": parking ratio must be blank, zero or a positive number.`); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/refm/asset-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(d.entryId ? { entryId: d.entryId } : {}),
          label,
          category: d.category.trim(),
          avgUnitSize: unit.value,
          parkingRatio: ratio.value,
          parkingRatioBasis: d.parkingRatioBasis,
        }),
      });
      const body = await res.json() as { entry?: AssetTypeStandard; error?: string };
      if (!res.ok || !body.entry) throw new Error(body.error ?? 'Could not save the entry.');
      if (!d.entryId) setAddDraft(EMPTY_DRAFT);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entryId: string): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/refm/asset-types?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Could not delete the entry.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSlotArea = async (): Promise<void> => {
    setError(null);
    const parsed = parseStandard(slotDraft);
    if (!parsed.ok) { setError('Parking area per slot must be blank, zero or a positive number.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/refm/asset-types', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parkingAreaPerSlot: parsed.value }),
      });
      const body = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? 'Could not save.');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rowInputs = (d: Draft, set: (patch: Partial<Draft>) => void, idPrefix: string): React.JSX.Element => (
    <>
      <td style={td}>
        <input style={cellInput} value={d.label} data-testid={`${idPrefix}-label`}
          placeholder="e.g. High End Apartments" onChange={(e) => set({ label: e.target.value })} />
      </td>
      <td style={td}>
        <input style={cellInput} value={d.category} data-testid={`${idPrefix}-category`}
          placeholder="e.g. Residential" onChange={(e) => set({ category: e.target.value })} />
      </td>
      <td style={td}>
        <input style={cellInput} value={d.avgUnitSize} inputMode="decimal" data-testid={`${idPrefix}-unit-size`}
          placeholder="blank = not set" onChange={(e) => set({ avgUnitSize: e.target.value })} />
      </td>
      <td style={td}>
        <input style={cellInput} value={d.parkingRatio} inputMode="decimal" data-testid={`${idPrefix}-parking-ratio`}
          placeholder="blank = not set" onChange={(e) => set({ parkingRatio: e.target.value })} />
      </td>
      <td style={td}>
        <select style={cellInput} value={d.parkingRatioBasis} data-testid={`${idPrefix}-basis`}
          onChange={(e) => set({ parkingRatioBasis: e.target.value as ParkingRatioBasis })}>
          {PARKING_RATIO_BASES.map((b) => (<option key={b} value={b}>{PARKING_RATIO_BASIS_LABELS[b]}</option>))}
        </select>
      </td>
    </>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-3)',
      }}
      onClick={onClose}
      data-testid="asset-type-standards-modal"
    >
      <div
        style={{
          background: 'var(--color-surface, #fff)', borderRadius: 'var(--radius)', width: 'min(880px, 96vw)',
          maxHeight: '86vh', overflowY: 'auto', padding: 'var(--sp-3)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-1)' }}>
          <h3 style={{ fontSize: 'var(--font-h3)', margin: 0 }}>Company standards: asset types</h3>
          <button type="button" onClick={onClose} style={smallBtn} data-testid="asset-type-standards-close">Close</button>
        </div>
        <p style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', margin: '0 0 var(--sp-2)' }}>
          Your firm&apos;s asset type list with its unit size and parking standards, shared by every member
          across your projects. Picking a type on an asset copies these values onto that asset at that moment;
          editing here changes only future picks, never a saved model. A <strong>blank</strong> value means the
          standard is not set; a <strong>0</strong> is a real zero. They are not the same answer.
        </p>

        {!available && (
          <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-negative)', marginBottom: 'var(--sp-2)' }} data-testid="asset-type-standards-unavailable">
            The registry could not be reached, so the list below may be incomplete and saving may fail.
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', marginBottom: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <label htmlFor="std-parking-area-per-slot" style={{ fontSize: 'var(--font-small)', fontWeight: 600 }}>
            Parking area per slot (sqm), account-wide:
          </label>
          <input
            id="std-parking-area-per-slot"
            data-testid="std-parking-area-per-slot"
            style={{ ...cellInput, width: 130 }}
            inputMode="decimal"
            value={slotDraft}
            placeholder="blank = not set"
            onChange={(e) => setSlotDraft(e.target.value)}
          />
          <button type="button" className="btn-primary" data-view-mutates="true" disabled={busy}
            style={{ padding: '4px 12px', fontSize: 'var(--font-small)' }}
            onClick={() => { void saveSlotArea(); }} data-testid="std-parking-area-per-slot-save">
            Save
          </button>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="asset-type-standards-table">
          <thead>
            <tr>
              <th style={th}>Asset type</th>
              <th style={th}>Category</th>
              <th style={th}>Avg unit size (sqm)</th>
              <th style={th}>Parking ratio</th>
              <th style={th}>Ratio basis</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => (
              <tr key={d.entryId ?? i}>
                {rowInputs(d, (patch) => setDrafts((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x))), `std-row-${d.entryId}`)}
                <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button type="button" style={smallBtn} data-view-mutates="true" disabled={busy}
                    onClick={() => { void saveEntry(d); }} data-testid={`std-row-${d.entryId}-save`}>
                    Save
                  </button>{' '}
                  <button type="button" style={{ ...smallBtn, color: 'var(--color-negative)', borderColor: 'var(--color-negative)' }}
                    data-view-mutates="true" disabled={busy}
                    onClick={() => { void deleteEntry(d.entryId!); }} data-testid={`std-row-${d.entryId}-delete`}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              {rowInputs(addDraft, (patch) => setAddDraft((prev) => ({ ...prev, ...patch })), 'std-add')}
              <td style={{ ...td, textAlign: 'right' }}>
                <button type="button" className="btn-primary" data-view-mutates="true"
                  disabled={busy || !addDraft.label.trim() || !normaliseAssetTypeId(addDraft.label)}
                  style={{ padding: '4px 12px', fontSize: 'var(--font-small)' }}
                  onClick={() => { void saveEntry(addDraft); }} data-testid="std-add-save">
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        {drafts.length === 0 && (
          <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-meta)', marginTop: 'var(--sp-1)' }} data-testid="asset-type-standards-empty">
            No asset types yet. Add your firm&apos;s list above; there are no built-in standards because unit
            sizes and parking ratios are company decisions, not platform defaults.
          </div>
        )}

        {error && (
          <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-negative)', marginTop: 'var(--sp-1)' }} data-testid="asset-type-standards-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

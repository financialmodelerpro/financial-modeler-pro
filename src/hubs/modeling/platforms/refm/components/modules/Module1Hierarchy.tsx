'use client';

/**
 * Module1Hierarchy.tsx
 *
 * 5-layer REFM project hierarchy:
 *
 *   Master Holding (optional, singleton)
 *     └── Sub-Project 1..N        (Architecture sheet "Fund")
 *           └── Phase 1..N
 *                 └── Asset 1..N
 *                       └── Sub-Unit 1..N
 *
 * History:
 *   - M1.5/6: read-only tree view scaffold.
 *   - M1.5/7: Sub-Project CRUD — add / inline-edit name + currency +
 *     Master-Holding rollup + revenue-share, delete with a cascade-
 *     aware confirmation that lists the phases / assets / costs /
 *     sub-units the store will drop.
 *   - M1.5/8 (this commit): Phase CRUD per Sub-Project — add / inline-
 *     edit name + constructionStart + constructionPeriods +
 *     operationsPeriods + overlapPeriods (operationsStart auto-derived
 *     from the same formula makeDefaultPhase uses). Delete confirms
 *     the bound asset / cost cascade.
 *   - M1.5/9-10 (upcoming): Asset + Sub-Unit CRUD, Master Holding panel
 *     + toggle.
 *
 * The component subscribes to useModule1Store directly; CRUD goes
 * straight through the store actions (add/update/remove SubProject /
 * Phase) which already implement the cascade rules defined in
 * module1-store.ts.
 */

import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../../lib/state/module1-store';
import type { Phase, SubProject } from '../../lib/state/module1-types';

// ── Visual tokens ──────────────────────────────────────────────────────────
const tokens = {
  mhAccent:       'var(--color-primary)',
  subProjAccent:  'var(--color-navy)',
  phaseAccent:    'var(--color-info)',
  assetAccent:    'var(--color-positive)',
  subUnitAccent:  'var(--color-meta)',
};

const cardBase: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  padding: 'var(--sp-2)',
  marginBottom: 'var(--sp-2)',
};

const tierLabelStyle = (accent: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-bold)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: accent,
  background: `color-mix(in srgb, ${accent} 12%, var(--color-surface))`,
  marginBottom: 4,
});

const nodeNameStyle: React.CSSProperties = {
  fontSize: 'var(--font-body)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-heading)',
};

const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  marginTop: 4,
  fontSize: 'var(--font-meta)',
  color: 'var(--color-meta)',
};

const metaPillStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const emptyHintStyle: React.CSSProperties = {
  fontSize: 'var(--font-meta)',
  color: 'var(--color-meta)',
  fontStyle: 'italic',
  padding: '4px 0',
};

const indentBlockStyle = (accent: string): React.CSSProperties => ({
  marginLeft: 'var(--sp-2)',
  paddingLeft: 'var(--sp-2)',
  borderLeft: `2px solid color-mix(in srgb, ${accent} 35%, var(--color-border))`,
});

// FAST blue input (per CLAUDE.md REFM convention).
const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--font-body)',
  fontFamily: 'Inter, sans-serif',
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  fontWeight: 'var(--fw-semibold)',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 'var(--font-micro)',
  fontWeight: 'var(--fw-semibold)',
  color: 'var(--color-meta)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 4,
  display: 'block',
};

const iconBtnStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: 'var(--font-meta)',
  color: 'var(--color-meta)',
  borderRadius: 4,
};

const primaryBtnStyle: React.CSSProperties = {
  background: 'var(--color-primary)',
  color: 'var(--color-on-primary-navy)',
  border: 'none',
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  cursor: 'pointer',
};

const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--color-meta)',
  border: '1px solid var(--color-border)',
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 'var(--font-meta)',
  fontWeight: 'var(--fw-semibold)',
  cursor: 'pointer',
};

// ── Sub-Project edit row ───────────────────────────────────────────────────
// Inline editor used for both "edit existing" and "add new" flows. Uses
// a local draft so the user can cancel without writing back to the store.
interface SubProjectEditorProps {
  initial: SubProject;
  masterHoldingEnabled: boolean;
  onSave: (next: SubProject) => void;
  onCancel: () => void;
}

function SubProjectEditor({ initial, masterHoldingEnabled, onSave, onCancel }: SubProjectEditorProps) {
  const [draft, setDraft] = useState<SubProject>(initial);

  return (
    <div style={{ marginTop: 8, padding: 'var(--sp-2)', background: 'color-mix(in srgb, var(--color-navy) 4%, var(--color-surface))', border: '1px dashed var(--color-border)', borderRadius: 6 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={labelStyle}>Currency</label>
          <input
            type="text"
            value={draft.currency}
            onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 4) })}
            style={{ ...inputStyle, width: '100%' }}
            placeholder="SAR"
          />
        </div>
      </div>

      <div style={{ marginBottom: 'var(--sp-2)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--font-meta)', color: 'var(--color-body)', cursor: masterHoldingEnabled ? 'pointer' : 'not-allowed', opacity: masterHoldingEnabled ? 1 : 0.5 }}>
          <input
            type="checkbox"
            checked={!!draft.masterHoldingId}
            disabled={!masterHoldingEnabled}
            onChange={(e) => setDraft({
              ...draft,
              masterHoldingId: e.target.checked ? 'mh_1' : null,
              revenueShareToMaster: e.target.checked ? draft.revenueShareToMaster : 0,
            })}
          />
          Roll up under Master Holding
          {!masterHoldingEnabled && <span style={{ color: 'var(--color-meta)', fontStyle: 'italic' }}>(enable MH first in M1.5/10)</span>}
        </label>

        {draft.masterHoldingId && (
          <div style={{ marginTop: 8, marginLeft: 24, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Revenue share to MH</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={draft.revenueShareToMaster}
              onChange={(e) => setDraft({ ...draft, revenueShareToMaster: Number(e.target.value) || 0 })}
              style={{ ...inputStyle, width: 80 }}
            />
            <span style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)' }}>%</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
        <button
          onClick={() => onSave(draft)}
          disabled={!draft.name.trim() || !draft.currency.trim()}
          style={{ ...primaryBtnStyle, opacity: (!draft.name.trim() || !draft.currency.trim()) ? 0.5 : 1, cursor: (!draft.name.trim() || !draft.currency.trim()) ? 'not-allowed' : 'pointer' }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Phase edit row ─────────────────────────────────────────────────────────
// Inline editor for both "edit existing" and "add new" Phase flows.
// operationsStart is intentionally NOT user-editable: the store's
// makeDefaultPhase derives it from constructionPeriods - overlapPeriods
// + 1, and we keep that invariant on every save so manual edits can't
// land the timeline in an inconsistent state. Multi-phase users who
// want explicit gaps will get a follow-up control in M1.5/12.
interface PhaseEditorProps {
  initial: Phase;
  onSave: (next: Phase) => void;
  onCancel: () => void;
}

function PhaseEditor({ initial, onSave, onCancel }: PhaseEditorProps) {
  const [draft, setDraft] = useState<Phase>(initial);

  const operationsStart = Math.max(1, draft.constructionStart + draft.constructionPeriods - draft.overlapPeriods);

  const commit = () => onSave({ ...draft, operationsStart });

  return (
    <div style={{ marginTop: 8, padding: 'var(--sp-2)', background: 'color-mix(in srgb, var(--color-info) 4%, var(--color-surface))', border: '1px dashed var(--color-border)', borderRadius: 6 }}>
      <div style={{ marginBottom: 'var(--sp-2)' }}>
        <label style={labelStyle}>Phase name</label>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          style={{ ...inputStyle, width: '100%' }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <div>
          <label style={labelStyle}>Construction start</label>
          <input
            type="number"
            min={1}
            step={1}
            value={draft.constructionStart}
            onChange={(e) => setDraft({ ...draft, constructionStart: Math.max(1, Number(e.target.value) || 1) })}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={labelStyle}>Construction periods</label>
          <input
            type="number"
            min={0}
            step={1}
            value={draft.constructionPeriods}
            onChange={(e) => setDraft({ ...draft, constructionPeriods: Math.max(0, Number(e.target.value) || 0) })}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={labelStyle}>Operations periods</label>
          <input
            type="number"
            min={0}
            step={1}
            value={draft.operationsPeriods}
            onChange={(e) => setDraft({ ...draft, operationsPeriods: Math.max(0, Number(e.target.value) || 0) })}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div>
          <label style={labelStyle}>Overlap periods</label>
          <input
            type="number"
            min={0}
            step={1}
            value={draft.overlapPeriods}
            onChange={(e) => setDraft({ ...draft, overlapPeriods: Math.max(0, Number(e.target.value) || 0) })}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
      </div>

      <div style={{ fontSize: 'var(--font-meta)', color: 'var(--color-meta)', marginBottom: 'var(--sp-2)' }}>
        Operations start auto-derives to <strong>period {operationsStart}</strong> (= constructionStart + constructionPeriods − overlapPeriods).
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={ghostBtnStyle}>Cancel</button>
        <button
          onClick={commit}
          disabled={!draft.name.trim()}
          style={{ ...primaryBtnStyle, opacity: !draft.name.trim() ? 0.5 : 1, cursor: !draft.name.trim() ? 'not-allowed' : 'pointer' }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Module1Hierarchy() {
  const { masterHolding, subProjects, phases, assets, subUnits, currency } = useModule1Store(useShallow((s) => ({
    masterHolding: s.masterHolding,
    subProjects:   s.subProjects,
    phases:        s.phases,
    assets:        s.assets,
    subUnits:      s.subUnits,
    currency:      s.currency,
  })));

  // Pull mutating actions outside of the shallow read so they don't
  // count as state changes — getState() at call time is enough.
  const addSubProject    = useModule1Store((s) => s.addSubProject);
  const updateSubProject = useModule1Store((s) => s.updateSubProject);
  const removeSubProject = useModule1Store((s) => s.removeSubProject);
  const addPhase         = useModule1Store((s) => s.addPhase);
  const updatePhase      = useModule1Store((s) => s.updatePhase);
  const removePhase      = useModule1Store((s) => s.removePhase);

  // editingId === '__new__' means the add-new Sub-Project editor is open;
  // otherwise it's the id of the Sub-Project currently being edited inline.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Phase editor: 'phase__new__:<subProjectId>' = adding a new phase to a
  // specific Sub-Project; '<phaseId>' = editing that existing phase.
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);

  const phasesBySubProject = (subProjectId: string) =>
    phases.filter(p => p.subProjectId === subProjectId);

  const assetsByPhase = (phaseId: string) =>
    assets.filter(a => a.phaseId === phaseId);

  const subUnitsByAsset = (assetId: string) =>
    subUnits.filter(u => u.assetId === assetId);

  const handleAddSubProject = (next: SubProject) => {
    // Mint a stable id; timestamp is good enough for the local-only
    // store (collision risk is negligible at human click rates and the
    // Supabase migration in M1.6 will replace these with server uuids).
    const id = `subproject_${Date.now()}`;
    addSubProject({ ...next, id });
    setEditingId(null);
  };

  const handleUpdateSubProject = (id: string, next: SubProject) => {
    updateSubProject(id, next);
    setEditingId(null);
  };

  const handleRemoveSubProject = (sp: SubProject) => {
    // Build a cascade-aware confirmation so the user knows what's about
    // to be dropped. Mirrors the cascade rules in module1-store.ts.
    const subPhases = phases.filter(p => p.subProjectId === sp.id);
    const subPhaseIds = new Set(subPhases.map(p => p.id));
    const subAssets = assets.filter(a => a.subProjectId === sp.id);
    const subAssetIds = new Set(subAssets.map(a => a.id));
    const subSubUnits = subUnits.filter(u => subAssetIds.has(u.assetId));
    // Costs cascade by both subProjectId-stamp AND by ownership through
    // assets — count both so the warning is accurate.
    const subCosts = new Set<string | number>();
    for (const c of useModule1Store.getState().costs) {
      if (c.subProjectId === sp.id || subAssetIds.has(c.assetId) || (c.phaseId && subPhaseIds.has(c.phaseId))) {
        subCosts.add(c.id);
      }
    }
    const summary = [
      `${subPhases.length} phase${subPhases.length === 1 ? '' : 's'}`,
      `${subAssets.length} asset${subAssets.length === 1 ? '' : 's'}`,
      `${subSubUnits.length} sub-unit${subSubUnits.length === 1 ? '' : 's'}`,
      `${subCosts.size} cost line${subCosts.size === 1 ? '' : 's'}`,
    ].join(', ');
    const ok = window.confirm(
      `Delete Sub-Project "${sp.name}"?\n\n` +
      `This will also drop everything under it: ${summary}.\n\n` +
      `This cannot be undone.`,
    );
    if (!ok) return;
    removeSubProject(sp.id);
    if (editingId === sp.id) setEditingId(null);
  };

  // Default for a new Sub-Project: inherit the project's currency,
  // standalone (no MH), name = "Sub-Project N+1".
  const newDraft: SubProject = {
    id: '__new__',
    name: `Sub-Project ${subProjects.length + 1}`,
    currency,
    masterHoldingId: null,
    revenueShareToMaster: 0,
  };

  // Phase CRUD handlers.
  const handleAddPhase = (subProjectId: string, next: Phase) => {
    const id = `phase_${Date.now()}`;
    addPhase({ ...next, id, subProjectId });
    setEditingPhaseId(null);
  };

  const handleUpdatePhase = (phaseId: string, next: Phase) => {
    updatePhase(phaseId, next);
    setEditingPhaseId(null);
  };

  const handleRemovePhase = (phase: Phase) => {
    const phaseAssets   = assets.filter(a => a.phaseId === phase.id);
    const phaseAssetIds = new Set(phaseAssets.map(a => a.id));
    const phaseSubUnits = subUnits.filter(u => phaseAssetIds.has(u.assetId));
    // Costs scoped via the dropped assets are deleted; costs that
    // referenced the phase via phaseId only are preserved (they get
    // their phaseId cleared by the store cascade).
    const allCosts = useModule1Store.getState().costs;
    const droppedCosts = allCosts.filter(c => phaseAssetIds.has(c.assetId)).length;
    const reparentedCosts = allCosts.filter(c => c.phaseId === phase.id && !phaseAssetIds.has(c.assetId)).length;

    const lines: string[] = [];
    lines.push(`${phaseAssets.length} asset${phaseAssets.length === 1 ? '' : 's'} bound to this phase`);
    lines.push(`${phaseSubUnits.length} sub-unit${phaseSubUnits.length === 1 ? '' : 's'} under those assets`);
    lines.push(`${droppedCosts} cost line${droppedCosts === 1 ? '' : 's'} (dropped)`);
    if (reparentedCosts > 0) lines.push(`${reparentedCosts} cost line${reparentedCosts === 1 ? '' : 's'} reparented to sub-project scope (phaseId cleared)`);

    const ok = window.confirm(
      `Delete Phase "${phase.name}"?\n\n` +
      `This will:\n  - ${lines.join('\n  - ')}\n\n` +
      `This cannot be undone.`,
    );
    if (!ok) return;
    removePhase(phase.id);
    if (editingPhaseId === phase.id) setEditingPhaseId(null);
  };

  const newPhaseDraft = (subProjectId: string, ordinal: number): Phase => ({
    id: '__new__',
    name: `Phase ${ordinal}`,
    subProjectId,
    constructionStart: 1,
    constructionPeriods: 4,
    operationsStart: 5,
    operationsPeriods: 5,
    overlapPeriods: 0,
  });

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'var(--sp-3) 0' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ fontSize: 'var(--font-section)', fontWeight: 'var(--fw-bold)', color: 'var(--color-heading)', margin: '0 0 4px' }}>
          🗂️ Project Hierarchy
        </h2>
        <p style={{ color: 'var(--color-meta)', fontSize: 'var(--font-meta)', margin: 0, lineHeight: 1.6 }}>
          5-layer structure: <strong>Master Holding → Sub-Project → Phase → Asset → Sub-Unit</strong>. Sub-Project + Phase
          CRUD are live; Asset / Sub-Unit / Master Holding editing arrives in M1.5/9 - M1.5/10.
        </p>
      </div>

      {/* ── Master Holding (optional) ── */}
      {masterHolding.enabled ? (
        <div style={{ ...cardBase, borderLeft: `4px solid ${tokens.mhAccent}` }}>
          <div style={tierLabelStyle(tokens.mhAccent)}>Master Holding</div>
          <div style={nodeNameStyle}>{masterHolding.name}</div>
          <div style={metaRowStyle}>
            <span style={metaPillStyle}>
              📐 Land cost: {masterHolding.landCostMethod === 'fixed' ? `${currency} ${masterHolding.landCostValue.toLocaleString()}` : `${masterHolding.landCostValue} (rate × allocated)`}
            </span>
            <span style={metaPillStyle}>
              🏦 Master debt: {currency} {masterHolding.masterDebtPrincipal.toLocaleString()} @ {masterHolding.masterDebtRate}% / {masterHolding.masterDebtTermPeriods} periods
            </span>
          </div>
        </div>
      ) : (
        <div style={{ ...cardBase, borderLeft: `4px solid color-mix(in srgb, ${tokens.mhAccent} 30%, var(--color-border))`, background: 'transparent' }}>
          <div style={tierLabelStyle(tokens.mhAccent)}>Master Holding</div>
          <div style={emptyHintStyle}>
            Disabled. Single-project layouts skip this layer; toggle on
            from M1.5/10 onwards to roll Sub-Projects up under a holding entity.
          </div>
        </div>
      )}

      {/* ── Sub-Projects ── */}
      <div style={indentBlockStyle(tokens.subProjAccent)}>
        {subProjects.length === 0 ? (
          <div style={{ ...cardBase, ...emptyHintStyle }}>No sub-projects.</div>
        ) : subProjects.map(sp => {
          const sps = phasesBySubProject(sp.id);
          const isEditing = editingId === sp.id;
          return (
            <div key={sp.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.subProjAccent}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={tierLabelStyle(tokens.subProjAccent)}>Sub-Project</div>
                  <div style={nodeNameStyle}>{sp.name}</div>
                  <div style={metaRowStyle}>
                    <span style={metaPillStyle}>💱 {sp.currency}</span>
                    {sp.masterHoldingId
                      ? <span style={metaPillStyle}>↑ Rolls up to MH ({sp.revenueShareToMaster}% revenue share)</span>
                      : <span style={metaPillStyle}>Standalone (no Master Holding)</span>}
                    <span style={metaPillStyle}>📅 {sps.length} phase{sps.length === 1 ? '' : 's'}</span>
                  </div>
                </div>
                {!isEditing && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      title="Edit Sub-Project"
                      onClick={() => setEditingId(sp.id)}
                      style={iconBtnStyle}
                    >
                      ✏ Edit
                    </button>
                    <button
                      title="Delete Sub-Project"
                      onClick={() => handleRemoveSubProject(sp)}
                      style={{ ...iconBtnStyle, color: 'var(--color-negative)' }}
                    >
                      🗑 Delete
                    </button>
                  </div>
                )}
              </div>

              {isEditing && (
                <SubProjectEditor
                  initial={sp}
                  masterHoldingEnabled={masterHolding.enabled}
                  onSave={(next) => handleUpdateSubProject(sp.id, next)}
                  onCancel={() => setEditingId(null)}
                />
              )}

              {/* ── Phases under this Sub-Project ── */}
              <div style={indentBlockStyle(tokens.phaseAccent)}>
                {sps.length === 0 && editingPhaseId !== `phase__new__:${sp.id}` && (
                  <div style={emptyHintStyle}>No phases yet.</div>
                )}
                {sps.map(phase => {
                  const phaseAssets = assetsByPhase(phase.id);
                  const isEditingPhase = editingPhaseId === phase.id;
                  return (
                    <div key={phase.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.phaseAccent}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <div style={tierLabelStyle(tokens.phaseAccent)}>Phase</div>
                          <div style={nodeNameStyle}>{phase.name}</div>
                          <div style={metaRowStyle}>
                            <span style={metaPillStyle}>🛠 Construction: {phase.constructionPeriods} periods (start {phase.constructionStart})</span>
                            <span style={metaPillStyle}>🏨 Operations: {phase.operationsPeriods} periods (start {phase.operationsStart})</span>
                            {phase.overlapPeriods > 0 && <span style={metaPillStyle}>↔ Overlap: {phase.overlapPeriods}</span>}
                            <span style={metaPillStyle}>🧱 {phaseAssets.length} asset{phaseAssets.length === 1 ? '' : 's'}</span>
                          </div>
                        </div>
                        {!isEditingPhase && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              title="Edit Phase"
                              onClick={() => setEditingPhaseId(phase.id)}
                              style={iconBtnStyle}
                            >
                              ✏ Edit
                            </button>
                            <button
                              title="Delete Phase"
                              onClick={() => handleRemovePhase(phase)}
                              style={{ ...iconBtnStyle, color: 'var(--color-negative)' }}
                            >
                              🗑 Delete
                            </button>
                          </div>
                        )}
                      </div>

                      {isEditingPhase && (
                        <PhaseEditor
                          initial={phase}
                          onSave={(next) => handleUpdatePhase(phase.id, next)}
                          onCancel={() => setEditingPhaseId(null)}
                        />
                      )}

                      {/* ── Assets under this Phase ── */}
                      <div style={indentBlockStyle(tokens.assetAccent)}>
                        {phaseAssets.length === 0 ? (
                          <div style={emptyHintStyle}>No assets in this phase.</div>
                        ) : phaseAssets.map(asset => {
                          const aSubUnits = subUnitsByAsset(asset.id);
                          return (
                            <div key={asset.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.assetAccent}` }}>
                              <div style={tierLabelStyle(tokens.assetAccent)}>Asset</div>
                              <div style={nodeNameStyle}>
                                {asset.name}
                                {!asset.visible && <span style={{ marginLeft: 8, fontSize: 'var(--font-micro)', color: 'var(--color-meta)', fontWeight: 'var(--fw-normal)' }}>(hidden)</span>}
                              </div>
                              <div style={metaRowStyle}>
                                <span style={metaPillStyle}>🏷 {asset.category} · {asset.type}</span>
                                <span style={metaPillStyle}>📊 {asset.allocationPct}% allocation</span>
                                <span style={metaPillStyle}>➖ {asset.deductPct}% deduct</span>
                                <span style={metaPillStyle}>⚙ {asset.efficiencyPct}% efficiency</span>
                                <span style={metaPillStyle}>📦 {aSubUnits.length} sub-unit{aSubUnits.length === 1 ? '' : 's'}</span>
                              </div>

                              {aSubUnits.length > 0 && (
                                <div style={indentBlockStyle(tokens.subUnitAccent)}>
                                  {aSubUnits.map(unit => (
                                    <div key={unit.id} style={{ ...cardBase, borderLeft: `4px solid ${tokens.subUnitAccent}`, marginBottom: 'var(--sp-1)' }}>
                                      <div style={tierLabelStyle(tokens.subUnitAccent)}>Sub-Unit</div>
                                      <div style={nodeNameStyle}>{unit.name}</div>
                                      <div style={metaRowStyle}>
                                        <span style={metaPillStyle}>{unit.metric === 'count' ? '#' : '㎡'} {unit.metricValue.toLocaleString()} {unit.metric === 'count' ? 'units' : 'sqm'}</span>
                                        <span style={metaPillStyle}>💵 {currency} {unit.unitPrice.toLocaleString()} / {unit.metric === 'count' ? 'unit' : 'sqm'}</span>
                                        {unit.priceEscalationPct !== undefined && unit.priceEscalationPct !== 0 && (
                                          <span style={metaPillStyle}>📈 {unit.priceEscalationPct}% escalation/year</span>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* ── Add Phase ── */}
                {editingPhaseId === `phase__new__:${sp.id}` ? (
                  <div style={{ ...cardBase, borderLeft: `4px dashed ${tokens.phaseAccent}` }}>
                    <div style={tierLabelStyle(tokens.phaseAccent)}>New Phase</div>
                    <PhaseEditor
                      initial={newPhaseDraft(sp.id, sps.length + 1)}
                      onSave={(next) => handleAddPhase(sp.id, next)}
                      onCancel={() => setEditingPhaseId(null)}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingPhaseId(`phase__new__:${sp.id}`)}
                    style={{
                      ...primaryBtnStyle,
                      width: '100%',
                      padding: 8,
                      background: 'transparent',
                      color: tokens.phaseAccent,
                      border: `1px dashed color-mix(in srgb, ${tokens.phaseAccent} 50%, var(--color-border))`,
                      marginTop: 4,
                    }}
                  >
                    ＋ Add Phase to {sp.name}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* ── Add Sub-Project ── */}
        {editingId === '__new__' ? (
          <div style={{ ...cardBase, borderLeft: `4px dashed ${tokens.subProjAccent}` }}>
            <div style={tierLabelStyle(tokens.subProjAccent)}>New Sub-Project</div>
            <SubProjectEditor
              initial={newDraft}
              masterHoldingEnabled={masterHolding.enabled}
              onSave={handleAddSubProject}
              onCancel={() => setEditingId(null)}
            />
          </div>
        ) : (
          <button
            onClick={() => setEditingId('__new__')}
            style={{
              ...primaryBtnStyle,
              width: '100%',
              padding: 10,
              background: 'transparent',
              color: tokens.subProjAccent,
              border: `1px dashed color-mix(in srgb, ${tokens.subProjAccent} 50%, var(--color-border))`,
              marginTop: 4,
            }}
          >
            ＋ Add Sub-Project
          </button>
        )}
      </div>

      {/* Footer hint */}
      <p style={{ marginTop: 'var(--sp-3)', fontSize: 'var(--font-meta)', color: 'var(--color-meta)', fontStyle: 'italic', textAlign: 'center' }}>
        Next: Asset + Sub-Unit CRUD (M1.5/9) → Master Holding panel + toggle (M1.5/10).
      </p>
    </div>
  );
}

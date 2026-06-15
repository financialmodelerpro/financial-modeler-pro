'use client';

/**
 * CaseSwitcher.tsx (2026-06-03)
 *
 * Topbar control for scenario / case management. A case = the base
 * ("Management") model plus a set of field overrides. This widget:
 *   - shows the active case (amber chip when a scenario, not the base, is on);
 *   - switches the active case (the whole model + all modules recompute);
 *   - adds / renames / deletes scenario cases;
 *   - lists the active scenario's overrides (base value -> case value) with a
 *     per-field "Reset to base" and a "Reset all".
 *
 * It reads the global module1 store directly, so the Topbar needs no new
 * props. Editing any input while a scenario case is active is captured as that
 * case's override automatically (the store flushes via buildOverrides); this
 * panel is where the user sees and unwinds those overrides.
 */

import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModule1Store } from '../lib/state/module1-store';
import { buildOverrides, getByPath, baseCaseId } from '../lib/cases/applyOverrides';
import { FAST_INPUT } from './modules/_shared/inputStyles';

// Compact value formatter for the override list (raw, not currency-scaled).
function fmtVal(v: unknown): string {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v.length > 24 ? v.slice(0, 22) + '…' : v;
  if (Array.isArray(v)) return `[${v.length}]`;
  return '{…}';
}

// Humanise a diff path for display: drop the "[id=…]" verbosity to the last
// readable segment + field, e.g. "assets[id=a1].revenue.sell.pricePerUnit"
// -> "assets › revenue.sell.pricePerUnit".
function humanPath(path: string): string {
  return path
    .replace(/\[id=[^\]]+\]/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\.+/g, '.')
    .replace(/^\./, '');
}

export default function CaseSwitcher(): React.JSX.Element {
  const s = useModule1Store(
    useShallow((st) => ({
      cases: st.cases,
      activeCaseId: st.activeCaseId,
      baseSnapshot: st.baseSnapshot,
      // Model fields, selected so the override list re-derives on every edit.
      project: st.project, phases: st.phases, parcels: st.parcels,
      landAllocationMode: st.landAllocationMode, assets: st.assets, subUnits: st.subUnits,
      costLines: st.costLines, costOverrides: st.costOverrides,
      financingTranches: st.financingTranches, equityContributions: st.equityContributions,
      migrationsApplied: st.migrationsApplied,
      setActiveCase: st.setActiveCase, addCase: st.addCase, renameCase: st.renameCase,
      removeCase: st.removeCase, clearCaseOverrides: st.clearCaseOverrides, resetOverridePath: st.resetOverridePath,
      setUseScenarios: st.setUseScenarios,
    })),
  );

  const [open, setOpen] = useState(false);
  const baseId = baseCaseId(s.cases);
  const active = s.cases.find((c) => c.id === s.activeCaseId) ?? s.cases.find((c) => c.id === baseId);
  const isScenario = !!active && active.role !== 'base';
  // Same flag + behaviour as the Module 6 tab toggle (shared store action), so
  // the topbar and the tab stay in sync. Off locks the case list here.
  const useScenarios = s.project.useScenarios ?? true;

  // Live overrides for the active scenario (derived fresh from the current
  // model vs the base, so it reflects unsaved edits immediately).
  const liveModel = {
    project: s.project, phases: s.phases, parcels: s.parcels, landAllocationMode: s.landAllocationMode,
    assets: s.assets, subUnits: s.subUnits, costLines: s.costLines, costOverrides: s.costOverrides,
    financingTranches: s.financingTranches, equityContributions: s.equityContributions, migrationsApplied: s.migrationsApplied,
  };
  const overrides = useMemo(
    () => (isScenario ? buildOverrides(s.baseSnapshot, liveModel) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isScenario, s.baseSnapshot, s.project, s.phases, s.parcels, s.landAllocationMode, s.assets, s.subUnits, s.costLines, s.costOverrides, s.financingTranches, s.equityContributions],
  );
  const overridePaths = Object.keys(overrides);

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="pm-btn ctx"
        onClick={() => setOpen((v) => !v)}
        data-testid="topbar-open-cases"
        title={'CASE\n\nA scenario built on the Management (base) case by changing a few inputs. The active case drives every module and the Returns tabs. Switch cases to compare; the Case Comparison tab shows them side by side.'}
        style={isScenario ? {
          background: 'color-mix(in srgb, var(--color-warning, #92400e) 28%, transparent)',
          borderColor: 'color-mix(in srgb, var(--color-warning, #92400e) 65%, transparent)',
        } : undefined}
      >
        <span className="ctx-eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {isScenario && <span style={{ fontSize: 10 }}>◆</span>}
          Case
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
          <span className="ctx-name">{active?.name ?? 'Management Case'}</span>
          <span className="ctx-arrow">▼</span>
        </span>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 9000 }} />
          <div
            data-testid="case-switcher-panel"
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 9001,
              width: 360, maxHeight: 480, overflowY: 'auto',
              background: 'var(--color-surface, #fff)', color: 'var(--color-body)',
              border: '1px solid var(--color-border)', borderRadius: 8,
              boxShadow: '0 10px 30px rgba(0,0,0,0.18)', padding: 10, fontSize: 12,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--color-heading)', marginBottom: 6 }}>Cases</div>
            <div style={{ fontSize: 11, color: 'var(--color-meta)', marginBottom: 8 }}>
              The Management Case is the base. Switch to a scenario to edit a few inputs; every change applies only to that case.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, opacity: useScenarios ? 1 : 0.45, pointerEvents: useScenarios ? 'auto' : 'none' }}>
              {s.cases.map((c) => {
                const isActive = c.id === s.activeCaseId;
                const isBase = c.role === 'base';
                return (
                  <div key={c.id} style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: 6,
                    border: isActive ? '1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)' : '1px solid var(--color-border)',
                    background: isActive ? 'color-mix(in srgb, var(--color-primary) 7%, transparent)' : 'transparent',
                  }}>
                    <button
                      type="button" onClick={() => s.setActiveCase(c.id)}
                      data-testid={`case-select-${c.id}`}
                      style={{ flex: 1, textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', fontWeight: isActive ? 700 : 500, color: 'var(--color-heading)' }}
                      title={isActive ? 'Active case' : 'Switch to this case'}
                    >
                      {isBase ? '★ ' : '◆ '}
                      <input
                        value={c.name}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => s.renameCase(c.id, e.target.value)}
                        style={{ ...FAST_INPUT, width: 150, fontWeight: isActive ? 700 : 500 }}
                        title="Rename case"
                      />
                      {isBase && <span style={{ fontSize: 10, color: 'var(--color-meta)', marginLeft: 4 }}>base</span>}
                    </button>
                    {!isBase && (
                      <button
                        type="button" onClick={() => s.removeCase(c.id)} data-testid={`case-remove-${c.id}`}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 13 }}
                        title="Delete case"
                      >✕</button>
                    )}
                  </div>
                );
              })}
            </div>

            <button type="button" onClick={() => s.addCase()} data-testid="case-add" disabled={!useScenarios}
              style={{ border: '1px solid var(--color-navy)', borderRadius: 6, padding: '4px 12px', cursor: useScenarios ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: 12, background: 'transparent', color: 'var(--color-navy)', marginBottom: 10, opacity: useScenarios ? 1 : 0.45 }}>
              + Add case
            </button>

            {/* "Use scenarios?" toggle, shared with the Module 6 tab (same flag). */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontWeight: 700, color: 'var(--color-heading)' }}>Use scenarios?</span>
              <div style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden' }} data-testid="case-use-scenarios">
                {([['Yes', true], ['No', false]] as const).map(([label, val]) => {
                  const on = useScenarios === val;
                  return (
                    <button key={label} type="button" onClick={() => s.setUseScenarios(val)} data-testid={`case-use-scenarios-${label.toLowerCase()}`}
                      style={{ border: '1px solid var(--color-navy)', padding: '4px 14px', cursor: 'pointer', fontWeight: 700, fontSize: 12,
                        background: on ? 'var(--color-navy)' : 'transparent', color: on ? 'var(--color-on-primary-navy)' : 'var(--color-navy)' }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {!useScenarios && (
              <div style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic', marginBottom: 8 }} data-testid="case-scenarios-off-note">
                Scenarios are off. The platform computes on the Management Case and the case list is locked. Your cases are saved. Set to Yes to use them again.
              </div>
            )}

            {/* Active scenario overrides */}
            {isScenario && (
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: 'var(--color-heading)' }}>
                    Overrides vs Management ({overridePaths.length})
                  </span>
                  {overridePaths.length > 0 && (
                    <button type="button" onClick={() => s.clearCaseOverrides(s.activeCaseId)} data-testid="case-reset-all"
                      style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--color-primary)', fontSize: 11, fontWeight: 700 }}>
                      Reset all to base
                    </button>
                  )}
                </div>
                {overridePaths.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--color-meta)', fontStyle: 'italic' }}>
                    No overrides yet. Edit any input while this case is active to record one.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {overridePaths.map((p) => (
                      <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', borderBottom: '1px dashed var(--color-border)' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: 'var(--color-heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>
                            {humanPath(p)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--color-meta)' }}>
                            <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{fmtVal(getByPath(s.baseSnapshot, p))}</span>
                            {' → '}
                            <span style={{ fontWeight: 700, color: 'var(--color-heading)' }}>{fmtVal(overrides[p])}</span>
                          </div>
                        </div>
                        <button type="button" onClick={() => s.resetOverridePath(p)} data-testid="case-reset-one"
                          style={{ border: '1px solid var(--color-border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--color-body)', fontSize: 10, padding: '2px 6px' }}
                          title="Reset this field to the Management value">Reset</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

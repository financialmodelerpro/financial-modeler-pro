'use client';

/**
 * LandChainSection.tsx (2026-09-07, land planning step 2)
 *
 * The TOP-DOWN area chain on one asset: its six per-asset inputs, and a
 * READ-ONLY panel putting the derived areas beside the ones the asset
 * actually carries.
 *
 * NOTHING HERE WRITES INTO THE MODEL'S AREAS. The panel compares and says how
 * far apart the two are; it never copies a derived figure onto the asset, and
 * no calculation reads the derivation. Which of the two derivations wins is
 * the wiring step's decision, not this one's.
 *
 * THE TWO VOCABULARIES MEET HERE, and their outermost tiers have opposite
 * names, so every compared row names both:
 *   reference Net Saleable / GLA  =  platform NSA
 *   reference Total GFA           =  platform BUA   (the building, no parking)
 *   reference BUA Area            =  platform GFA   (everything, parking in)
 * Getting that backwards is the one mistake that would make a correct chain
 * look wrong, so the labels carry both names rather than assuming a reader
 * holds the mapping in their head.
 *
 * An asset with no chain inputs renders the inputs collapsed and NO panel, so
 * it looks and behaves exactly as it did before this existed.
 *
 * No em dashes in this file.
 */

import React, { useState } from 'react';
import {
  chainGapText,
  compareChainValue,
  computeLandChain,
  landChainIsEmpty,
  type ChainResult,
  type LandChainInputs,
  type LandChainStandards,
} from '@/src/core/calculations/landChain';

const FIELD: React.CSSProperties = {
  background: 'var(--color-navy-pale)',
  color: 'var(--color-navy)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px 6px',
  fontSize: 11,
  textAlign: 'right',
  fontFamily: 'inherit',
  width: '100%',
};
const LABEL: React.CSSProperties = { fontSize: 10, color: 'var(--color-meta)', display: 'block', marginBottom: 2 };
const TD: React.CSSProperties = { padding: '3px 6px', fontSize: 11 };
const TDNUM: React.CSSProperties = { ...TD, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

const fmt = (n: number | undefined, dp = 2): string =>
  n === undefined ? '-' : n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** '' clears the input (blank, not decided); a typed 0 is a real share. */
function parseOptional(s: string): number | undefined | 'bad' {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 'bad';
  return n;
}

/** One numeric chain input: draft while typing, the model when not. */
function ChainInput({
  label, value, onCommit, testId, hint, disabled,
}: {
  label: string;
  value: number | undefined;
  onCommit: (v: number | undefined) => void;
  testId: string;
  hint: string;
  disabled?: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const stored = value !== undefined ? String(value) : '';
  const parsedDraft = draft === null ? undefined : parseOptional(draft);
  return (
    <div>
      <label style={LABEL} title={hint}>{label}</label>
      <input
        style={{ ...FIELD, ...(parsedDraft === 'bad' ? { borderColor: 'var(--color-negative)' } : {}) }}
        value={draft ?? stored}
        inputMode="decimal"
        placeholder="not set"
        title={hint}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const parsed = parseOptional(next);
          if (parsed !== 'bad') onCommit(parsed);
        }}
        onBlur={() => setDraft(null)}
      />
    </div>
  );
}

interface Props {
  assetId: string;
  inputs: LandChainInputs | undefined;
  onChange: (patch: LandChainInputs) => void;
  /** The asset's allocated land, from the existing land allocation. */
  landAreaSqm: number | undefined;
  /** Resolved from the project's asset type values (tab 4). */
  standards: LandChainStandards;
  /** The count the asset's own sub-units state, when they do. */
  subUnitUnits?: number;
  /** What the asset actually carries today, in PLATFORM terms. */
  entered: { nsa: number; bua: number; gfa: number; unitCount: number; parkingArea: number };
  /** Read-only mode (a locked project) disables the inputs. */
  disabled?: boolean;
  typeName?: string;
}

export default function LandChainSection({
  assetId, inputs, onChange, landAreaSqm, standards, subUnitUnits, entered, disabled, typeName,
}: Props): React.JSX.Element {
  const empty = landChainIsEmpty(inputs);
  const [open, setOpen] = useState(!empty);
  const chain: ChainResult = computeLandChain(landAreaSqm, inputs, standards, subUnitUnits);

  // The three tiers that exist in BOTH vocabularies, compared.
  const rows = [
    {
      key: 'nsa',
      label: 'Net saleable / GLA',
      both: 'reference Net Saleable / GLA = platform NSA',
      cmp: compareChainValue(chain.netSaleableSqm, entered.nsa),
    },
    {
      key: 'bua',
      label: 'Building floor area',
      both: 'reference Total GFA = platform BUA (no parking)',
      cmp: compareChainValue(chain.totalGfaSqm, entered.bua),
    },
    {
      key: 'gfa',
      label: 'All area including parking',
      both: 'reference BUA Area = platform GFA',
      cmp: compareChainValue(chain.totalBuaSqm, entered.gfa),
    },
    {
      key: 'parking',
      label: 'Parking area',
      both: 'reference Total Parking Area = platform Parking Area',
      cmp: compareChainValue(chain.totalParkingAreaSqm, entered.parkingArea),
    },
    {
      key: 'units',
      label: `Units or keys${chain.unitsSource === 'sub_units' ? ' (from sub-units)' : ''}`,
      both: 'reference Number of Units / Keys = platform sub-unit count',
      cmp: compareChainValue(chain.units, entered.unitCount),
    },
  ];

  const steps: Array<[string, number | undefined]> = [
    ['Land area', chain.landAreaSqm],
    ['Land utilised', chain.landUtilisedSqm],
    ['Footprint', chain.footprintSqm],
    [`Landscape${chain.landscapePct !== undefined ? ` (${fmt(chain.landscapePct, 0)}%)` : ''}`, chain.landscapeSqm],
    ['Retail GFA', chain.retailGfaSqm],
    ['Lobby GFA', chain.lobbyGfaSqm],
    // PLATFORM WORDS, matching the results table column for column. The
    // reference calls this tier Total GFA and the last one BUA Area; here BUA
    // is the building and GFA is everything, parking included.
    ['BUA (reference Total GFA)', chain.totalGfaSqm],
    ['Main asset GFA', chain.mainAssetGfaSqm],
    ['Net saleable / GLA', chain.netSaleableSqm],
    ['Units / keys', chain.units],
    ['Parking slots', chain.parkingSlots],
    ['Retail parking slots', chain.retailParkingSlots],
    ['Total parking slots', chain.totalParkingSlots],
    ['Total parking area', chain.totalParkingAreaSqm],
    ['GFA (reference BUA Area)', chain.totalBuaSqm],
  ];

  return (
    <div style={{ marginTop: 'var(--sp-2)' }} data-testid={`asset-${assetId}-land-chain`}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={() => setOpen(!open)}
      >
        <strong style={{ fontSize: 'var(--font-small)' }}>Area derivation (top down)</strong>
        <span style={{ fontSize: 10, color: 'var(--color-meta)' }}>
          {empty ? 'not used on this asset' : 'derived from land, utilisation and FAR'}
        </span>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{open ? 'v' : '>'}</span>
      </div>

      {open && (
        <>
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 'var(--sp-1)',
              marginTop: 'var(--sp-1)', marginBottom: 'var(--sp-1)',
            }}
          >
            <ChainInput label="Utilisation %" value={inputs?.utilisationPct} disabled={disabled}
              hint="Share of the plot that is developable. The chain starts here: land x utilisation."
              testId={`asset-${assetId}-chain-utilisation`}
              onCommit={(v) => onChange({ utilisationPct: v })} />
            <ChainInput label="Coverage %" value={inputs?.coveragePct} disabled={disabled}
              hint="Share of the utilised area the footprint covers. Landscape is the remainder of the UTILISED area."
              testId={`asset-${assetId}-chain-coverage`}
              onCommit={(v) => onChange({ coveragePct: v })} />
            <ChainInput label="FAR" value={inputs?.farRatio} disabled={disabled}
              hint="Floor area ratio. BUA = utilised land x FAR (not the footprint, and not the gross plot)."
              testId={`asset-${assetId}-chain-far`}
              onCommit={(v) => onChange({ farRatio: v })} />
            <ChainInput label="Retail % (ground)" value={inputs?.retailPct} disabled={disabled}
              hint="Share of the FOOTPRINT given to ground-floor retail. With no retail the whole GFA stays with the main asset, lobby included."
              testId={`asset-${assetId}-chain-retail`}
              onCommit={(v) => onChange({ retailPct: v })} />
            <ChainInput label="Service %" value={inputs?.servicePct} disabled={disabled}
              hint="Service and back-of-house share taken off the main asset GFA to give net saleable."
              testId={`asset-${assetId}-chain-service`}
              onCommit={(v) => onChange({ servicePct: v })} />
            <ChainInput label="Retail sqm / slot" value={inputs?.retailAreaPerSlotSqm} disabled={disabled}
              hint="Sqm of retail GFA per parking slot. Its own input because the reference divides retail by one fixed company figure, never by this asset's own parking ratio."
              testId={`asset-${assetId}-chain-retail-slot`}
              onCommit={(v) => onChange({ retailAreaPerSlotSqm: v })} />
          </div>

          {empty ? (
            <div style={{ fontSize: 10, color: 'var(--color-meta)' }} data-testid={`asset-${assetId}-chain-idle`}>
              Enter a utilisation and coverage percent and a FAR to derive this asset&apos;s areas from its land.
              Nothing is derived until then, and nothing here changes the model: the derivation is shown beside
              the entered areas for comparison only.
            </div>
          ) : (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}
                  data-testid={`asset-${assetId}-chain-compare`}>
                  <thead>
                    <tr style={{ background: 'var(--color-grey-pale)' }}>
                      <th style={{ ...TD, textAlign: 'left' }}>Compared</th>
                      <th style={TDNUM}>Derived</th>
                      <th style={TDNUM}>Entered</th>
                      <th style={TDNUM}>Difference</th>
                      <th style={TDNUM}>%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={TD} title={r.both}>
                          {r.label}
                          <div style={{ fontSize: 9, color: 'var(--color-meta)' }}>{r.both}</div>
                        </td>
                        <td style={TDNUM} data-testid={`asset-${assetId}-chain-${r.key}-derived`}>{fmt(r.cmp.derived)}</td>
                        <td style={TDNUM}>{fmt(r.cmp.entered)}</td>
                        <td style={{ ...TDNUM, color: r.cmp.diff === undefined || Math.abs(r.cmp.diff) < 0.01 ? 'inherit' : 'var(--color-warning, #92400e)' }}>
                          {fmt(r.cmp.diff)}
                        </td>
                        <td style={TDNUM}>{r.cmp.diffPct === undefined ? '-' : `${fmt(r.cmp.diffPct, 1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details style={{ marginTop: 'var(--sp-1)' }}>
                <summary style={{ fontSize: 10, color: 'var(--color-meta)', cursor: 'pointer' }}>
                  Every step of the derivation{typeName ? ` for ${typeName}` : ''}
                </summary>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginTop: 4 }}
                  data-testid={`asset-${assetId}-chain-steps`}>
                  <tbody>
                    {steps.map(([label, v]) => (
                      <tr key={label}>
                        <td style={TD}>{label}</td>
                        <td style={TDNUM}>{fmt(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>

              {chain.gaps.length > 0 && (
                <ul
                  style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 10, color: 'var(--color-meta)' }}
                  data-testid={`asset-${assetId}-chain-gaps`}
                >
                  {chain.gaps.map((g) => (<li key={g}>{chainGapText(g)}</li>))}
                </ul>
              )}

              <div style={{ fontSize: 9, color: 'var(--color-meta)', marginTop: 6 }}>
                Read only. Nothing here is written to the asset and no calculation reads it: the model still
                uses the entered areas.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

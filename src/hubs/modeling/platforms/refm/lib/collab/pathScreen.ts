/**
 * pathScreen.ts (2026-09-23)
 *
 * WHERE IS THIS FIELD EDITED?
 *
 * A comment or an activity row carries a snapshot path (`assets[id=x].buaSqm`).
 * On a client-facing screen that reads like a debugger, and the reader's actual
 * question is "where do I go to change it". This is the one answer to that.
 *
 * THREE RULES GOVERN THIS FILE, all of them bought with a measurement:
 *
 * 1. A SCREEN NAME HERE IS A CLAIM, AND EVERY CLAIM IS WRITE-VERIFIED.
 *    A misfiled badge is a quiet lie: it sends someone to a tab where the field
 *    is not, and nothing on that tab contradicts it. So every rule below was
 *    checked against what the screens actually WRITE, mechanically, by
 *    `scripts/audit-path-screen-map.ts`, before it was written down. A screen
 *    READS far more than it writes, so "the path appears in that file" is not
 *    evidence of anything.
 *
 * 2. A FIELD MAY HAVE MORE THAN ONE HOME, AND THE MAP SAYS SO.
 *    Five families are written from two tabs. Naming one would be wrong half
 *    the time, so `screens` is an ARRAY and the sentence reads "edited on Capex
 *    or Asset Types & Standards". Guessing is the failure this file prevents.
 *
 * 3. UNMAPPED IS AN ANSWER, NOT A GAP.
 *    Two fields are RETIRED: no screen writes them, by decision, and a rule
 *    pointing at a tab would invent an editor that does not exist. One is a
 *    view setting nothing writes. Each says WHY in its own words, so a reader
 *    is told the field is not editable rather than being sent somewhere.
 *
 * THE AUDIT FOUND FOUR THINGS THAT THE OBVIOUS MAP WOULD HAVE GOT WRONG, and
 * every one is recorded at its rule: `project.tax` is edited on the P&L and not
 * on Project & Phases; `project.costEscalationPct` on Asset Types & Standards
 * and not on Capex; and two retired fields had a plausible-looking home.
 *
 * Labels come from the LIVE tab registry (`moduleTabs.ts`), never a copy, for
 * the reason that file already records: a frozen copy of the tab list is how
 * the guide verifier reported 34/34 while two whole modules were missing.
 *
 * No em dashes in this file.
 */
import { MODULE_TABS } from '../moduleTabs';

/** A tab key as the shell's own render conditions spell it. */
export type ScreenKey = string;

export interface ScreenRef {
  /** The tab key, which is what a jump needs. */
  key: ScreenKey;
  /** The module the tab belongs to, e.g. 'module1'. A jump needs both. */
  module: string;
  /** The tab's own label with its step number stripped: "Capex", not "6. Capex". */
  label: string;
}

export interface PathScreen {
  /** Empty when the field is not editable on any screen. */
  screens: ScreenRef[];
  /**
   * The sentence to render. Always present, including when nothing is mapped,
   * because "we do not know" and "nothing edits this" are different answers and
   * a reader deserves the one that is true.
   */
  sentence: string;
  /** True when the field is deliberately editable nowhere. */
  unmapped: boolean;
}

/* ─────────────────────── the tab registry, read live ─────────────────────── */

/** key -> { module, label }, built once from the registry the shell renders. */
const SCREENS: Map<string, { module: string; label: string }> = (() => {
  const out = new Map<string, { module: string; label: string }>();
  for (const [moduleId, tabs] of Object.entries(MODULE_TABS)) {
    for (const t of tabs) {
      // "6. Capex" is a position in a sidebar, not a name. The number is
      // stripped because a sentence reading "edited on 6. Capex" is noise, and
      // because a tab's number MOVES when tabs are reordered while its identity
      // does not (the same rule the platform applies to module numbers).
      out.set(t.key, { module: moduleId, label: t.label.replace(/^\d+\.\s*/, '') });
    }
  }
  return out;
})();

const ref = (key: string): ScreenRef | null => {
  const s = SCREENS.get(key);
  return s ? { key, module: s.module, label: s.label } : null;
};

/* ────────────────────────────── the rules ───────────────────────────────── */

interface Rule {
  /** Matched against the SHAPE of a path (every [...] reduced to []). */
  prefix: string;
  /** One key, or several where the field genuinely has several homes. */
  screens: ScreenKey[];
  /** Why, when the answer is not obvious. Kept beside the claim, not in a doc. */
  note?: string;
}

/**
 * ORDERED MOST SPECIFIC FIRST. The first match wins, so a narrower rule must
 * sit above the rule it carves out of.
 */
const RULES: readonly Rule[] = [
  // ── assets[]: four tabs write into this root, resolved by the field ──
  { prefix: 'assets[].revenue.', screens: ['m2-inputs', 'assets'],
    note: 'terms on the Revenue inputs tab, prices on Table 5 of the Assets tab' },
  { prefix: 'assets[].opex.', screens: ['m3-inputs'] },
  // TWO HOMES, by measurement and by the founder's direction: a capex phasing
  // curve is typed on Capex AND seeded from the cost standards. Picking one
  // would be wrong half the time.
  { prefix: 'assets[].capexPhasing.', screens: ['costs', 'asset-standards'] },
  { prefix: 'assets[].landChain.', screens: ['assets'] },
  { prefix: 'assets[].', screens: ['assets'] },

  // ── the project's own reference data ──
  { prefix: 'project.assetTypeValues', screens: ['asset-standards'] },
  { prefix: 'project.assetTypes[]', screens: ['asset-standards'] },
  { prefix: 'project.costStandardRows[]', screens: ['asset-standards'] },
  { prefix: 'project.parkingAreaPerSlotSqm', screens: ['asset-standards'] },
  // CORRECTED BY THE AUDIT. The obvious home is Capex, since this escalates
  // cost rates, and that is what the first draft of this map said. It is typed
  // on Asset Types & Standards, with the rest of the cost reference data.
  { prefix: 'project.costEscalationPct', screens: ['asset-standards'] },

  // ── financing and the fund ──
  { prefix: 'project.fundTerms', screens: ['fund-terms', 'financing'],
    note: 'the management fee funding toggle is one field on both tabs' },
  { prefix: 'project.financing', screens: ['financing'] },
  { prefix: 'project.dividendPolicy', screens: ['financing'] },
  { prefix: 'financingTranches[].', screens: ['financing'] },
  { prefix: 'equityContributions[].', screens: ['financing'] },

  // ── the statements and the returns ──
  // CORRECTED BY THE AUDIT. Project & Phases looks right (it holds the
  // country, and tax follows a country), but the tax inputs are typed on the
  // P&L, beside the charge they produce.
  { prefix: 'project.tax', screens: ['m4-pl'] },
  { prefix: 'project.returns', screens: ['m5-returns'] },
  { prefix: 'project.covenants', screens: ['m5-metrics'] },
  { prefix: 'project.escrow', screens: ['m2-escrow'] },
  { prefix: 'project.hqOpex', screens: ['m3-inputs'] },

  // ── the model's own rows ──
  { prefix: 'phases[].', screens: ['project-phases'] },
  { prefix: 'parcels[].', screens: ['assets'] },
  { prefix: 'subUnits[].', screens: ['assets'] },
  // TWO HOMES each: a line's rate is typed on Capex, and the cost standards
  // write the same lines as `origin: 'standard'` overrides.
  { prefix: 'costLines[].', screens: ['costs', 'asset-standards'] },
  { prefix: 'costOverrides[].', screens: ['costs', 'asset-standards'] },

  // ── project scalars, including the three view settings that ARE written ──
  // These three were nearly declared unmapped as "view settings". The write
  // evidence says otherwise, and the evidence wins: they are typed on real
  // tabs and a reader looking for them should be sent there.
  { prefix: 'project.displayScale', screens: ['project-phases'] },
  { prefix: 'project.displayDecimals', screens: ['project-phases'] },
  { prefix: 'project.resultsViewMode', screens: ['costs', 'asset-standards'] },
  { prefix: 'project.', screens: ['project-phases'] },
];

/**
 * EDITABLE NOWHERE, AND THAT IS THE ANSWER.
 *
 * Each of these had a plausible home that the audit refused to support. A rule
 * pointing at a tab would invent an editor the platform does not have, which is
 * worse than saying so.
 */
const UNMAPPED: ReadonlyArray<{ prefix: string; because: string }> = [
  { prefix: 'landAllocationMode',
    because: 'land is allocated by area only, so this is no longer a choice anyone makes' },
  { prefix: 'project.retailAreaPerSlotSqm',
    because: 'retired: the parking ratio now comes from the retail asset type itself' },
  { prefix: 'assets[].landChain.retailAreaPerSlotSqm',
    because: 'retired: the parking ratio now comes from the retail asset type itself' },
  { prefix: 'project.outputGranularity',
    because: 'a display setting with no input on any tab' },
];

/* ─────────────────────────────── the answer ─────────────────────────────── */

/** `assets[id=asset_1].buaSqm` -> `assets[].buaSqm`. */
export const pathShape = (path: string): string => path.replace(/\[[^\]]*\]/g, '[]');

/** Joins screen names the way a person reads them: "A or B". */
const orList = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;

/**
 * Where a snapshot path is edited.
 *
 * Returns null ONLY for a path no rule covers, which is a genuine "I do not
 * know" and must render as nothing rather than as a guess. A field that is
 * deliberately editable nowhere comes back with `unmapped: true` and a reason.
 */
export function screenForPath(path: string | null | undefined): PathScreen | null {
  if (!path) return null;
  const shape = pathShape(path.trim());
  if (!shape) return null;

  // Unmapped is checked FIRST: these are carve-outs from rules that would
  // otherwise claim them (landAllocationMode is a project field, the retail
  // slot area sits under a chain the Assets tab owns).
  for (const u of UNMAPPED) {
    if (shape === u.prefix || shape.startsWith(u.prefix)) {
      return { screens: [], unmapped: true, sentence: `Not editable: ${u.because}` };
    }
  }

  for (const r of RULES) {
    if (!(shape === r.prefix.replace(/\.$/, '') || shape.startsWith(r.prefix))) continue;
    const screens = r.screens.map(ref).filter((s): s is ScreenRef => s !== null);
    // A rule naming a tab that no longer exists must not render half an answer.
    if (screens.length === 0) return null;
    const sentence = `Edited on ${orList(screens.map((s) => s.label))}`
      + (r.note ? ` (${r.note})` : '');
    return { screens, unmapped: false, sentence };
  }
  return null;
}

/** Exposed so a verifier can enumerate the rules rather than restate them. */
export const PATH_SCREEN_RULES = RULES;
export const PATH_SCREEN_UNMAPPED = UNMAPPED;

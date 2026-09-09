/**
 * landChain.ts (2026-09-07, land planning step 2)
 *
 * THE AREA DERIVATION, top down, as ONE pure function.
 *
 * The platform derives area BOTTOM UP: sub-units give NSA, plus support gives
 * BUA, plus parking gives GFA. The reference land structure derives it TOP
 * DOWN: land, utilisation and FAR give GFA, and the unit count falls out of
 * it. This file is the second of those, and ONLY the second: it computes, it
 * returns, and nothing else in the platform reads what it produces.
 *
 * NOTHING HERE IS WIRED TO THE ENGINE. No caller in `src/core/calculations`,
 * the resolvers, the reports or the exports imports this module; the one
 * consumer is a READ-ONLY panel on the asset card that shows derived beside
 * entered. `verify-land-chain` fails if that changes. So an asset carrying
 * chain inputs computes exactly the same model as one without them, which is
 * what makes this step safe to ship before the wiring step decides which of
 * the two derivations wins.
 *
 * TERMS ARE TRANSLATED HERE, NOT DOWNSTREAM. The reference workbook's "BUA
 * Area" is Total GFA plus parking, which is what this platform calls GFA;
 * its "Total GLA / Net Saleable" is what this platform calls NSA. The
 * translation lives in this file and in the panel that renders it, so no
 * existing surface has to learn a second vocabulary. See `ChainResult` field
 * comments for each mapping.
 *
 * EVERY STEP IS CHECKED AGAINST THE SOURCE. `verify-land-chain` reproduces
 * two real rows of the reference workbook to the cent, one without retail
 * (Resort 5 Star) and one with it (High End Apartments), so a change to any
 * line below fails against the workbook rather than against my reading of it.
 *
 * A BLANK INPUT IS NOT A ZERO. Every input is optional and an ABSENT one
 * stops the chain at that point rather than multiplying by zero and reporting
 * a confident 0: `undefined` propagates, and each result field says whether
 * it could be computed. A typed 0 is a real answer and computes.
 *
 * Pure. No imports. No em dashes in this file.
 */

/** The per-asset inputs of the chain. All optional: an asset that states none
 *  of them derives nothing, which is how this stays inert on every existing
 *  project. Percentages are 0..100 (the platform's convention), not fractions;
 *  `farRatio` is a plain multiple (3.6 means 3.6x). */
export interface LandChainInputs {
  /** Share of the plot that is developable. Absent means the chain cannot
   *  start, since every later step is a share of this. */
  utilisationPct?: number;
  /** Share of the utilised area the building footprint covers. */
  coveragePct?: number;
  /** Share of the FOOTPRINT given to retail at ground level. */
  retailPct?: number;
  /** Share of the main asset GFA taken by service and back of house. */
  servicePct?: number;
  /** Floor area ratio: total GFA per sqm of utilised land. */
  farRatio?: number;
  /**
   * RETIRED 2026-09-09. Sqm of retail GFA that requires one parking slot.
   *
   * It was a per-plot input and it should never have been: the reference
   * divides every plot's retail parking by ONE fixed company figure, and the
   * evidence agreed before it was moved. Across 1,406 stored versions the field
   * appears on THREE assets, all in one version, all holding the same value
   * (40): the only person who ever typed it typed it three times identically.
   * Five rows holding one number are five chances to disagree about it.
   *
   * It now lives on the PROJECT, beside the parking area per slot, which is the
   * same kind of quantity and was already a single value. A per-plot figure
   * could in principle express two municipalities or two retail formats, but
   * neither is sayable in this model (there is no per-plot jurisdiction and no
   * retail sub-type), so it would be an answer to a question nobody can ask.
   *
   * The field stays DECLARED so a stored snapshot still types, and is read by
   * NOTHING: hydrate lifts any stored value onto the project.
   */
  retailAreaPerSlotSqm?: number;
  /**
   * Max floors, the reference's own column O.
   *
   * CARRIED, NOT COMPUTED WITH. Height is a planning constraint that FAR
   * already expresses in area terms, so nothing in this chain divides or
   * multiplies by it and adding it moves no derived figure. It is here because
   * a planner reads it beside coverage and FAR, and because a later step that
   * checks FAR against a height limit will need it stored rather than
   * remembered.
   */
  maxFloors?: number;
}

/** The standards the chain draws from the project's asset type values. Passed
 *  in rather than looked up, so this file stays pure and the caller states
 *  where each number came from. */
export interface LandChainStandards {
  /** Sqm per unit or key. Resolved by the caller (sub-units first, the asset
   *  type average as the fallback), which is the step 1 rule. */
  avgUnitSizeSqm?: number;
  /** Slots per unit, or sqm per slot, per `parkingRatioBasis`. */
  parkingRatio?: number;
  parkingRatioBasis?: 'slots_per_unit' | 'sqm_per_slot';
  /** Sqm one parking slot occupies. */
  parkingAreaPerSlotSqm?: number;
  /**
   * Sqm of retail GFA that requires one parking slot.
   *
   * A PROJECT FIGURE, beside the area a slot occupies. Retail parking divides
   * by THIS and never by the asset's own parking ratio, because a shop's
   * parking is sized off floor area and an apartment's off units. Absent means
   * retail parking is not derived, and the result SAYS so rather than reporting
   * zero slots.
   */
  retailAreaPerSlotSqm?: number;
}

/** Why a figure could not be derived. Absent means it was. */
export type ChainGap =
  | 'no_land'
  | 'no_utilisation'
  | 'no_coverage'
  | 'no_far'
  | 'no_unit_size'
  | 'no_parking_ratio'
  | 'no_parking_area_per_slot'
  | 'no_retail_area_per_slot';

export interface ChainResult {
  /** The plot area the chain started from (the asset's allocated land). */
  landAreaSqm?: number;
  /** land x utilisation. */
  landUtilisedSqm?: number;
  /** utilised x coverage. */
  footprintSqm?: number;
  /** 1 - coverage, as a percentage, for display beside the area. */
  landscapePct?: number;
  /** utilised x landscape share. NOT footprint-based: the reference takes it
   *  off the UTILISED area. */
  landscapeSqm?: number;
  /** footprint x retail share. */
  retailGfaSqm?: number;
  /** footprint less retail. Called "Lobby Area GFA" in the reference. */
  lobbyGfaSqm?: number;
  /** utilised x FAR. The platform calls this tier GFA once parking is added
   *  (see `totalBuaSqm`); on its own it is the building's floor area. */
  totalGfaSqm?: number;
  /** Total GFA when there is no retail; otherwise total less retail and
   *  lobby. The reference deducts NEITHER when retail is zero, which is why
   *  this is a branch and not a subtraction. */
  mainAssetGfaSqm?: number;
  /** main x (1 - service). The platform calls this NSA. */
  netSaleableSqm?: number;
  /**
   * Net saleable / unit size, or the sub-unit count when the caller supplied
   * one, ROUNDED TO A WHOLE NUMBER.
   *
   * A DELIBERATE DIVERGENCE FROM THE REFERENCE (2026-09-08, founder's
   * decision). The workbook carries fractional units and keys (1221.5745 on
   * its first plot) and lets the fraction run through parking and BUA. You
   * cannot build 0.57 of an apartment, so the count rounds here and
   * EVERYTHING DOWNSTREAM FOLLOWS FROM THE ROUNDED FIGURE: slots come off the
   * rounded count, parking area off the rounded slots, and Total BUA off that
   * area. The consequence is that this chain no longer ties to the workbook to
   * the cent past step 7, which is expected and is what the A-section pins.
   */
  units?: number;
  /** Where `units` came from, so the panel can say. */
  unitsSource?: 'sub_units' | 'derived';
  /** Rounded units x parking ratio (slots_per_unit), or main GFA / ratio
   *  (sqm_per_slot). Whole slots: half a bay cannot be built either. */
  parkingSlots?: number;
  /** retail GFA / retail area per slot, whole slots. */
  retailParkingSlots?: number;
  /** The two whole-slot figures added, so it is whole by construction. */
  totalParkingSlots?: number;
  parkingAreaSqm?: number;
  retailParkingAreaSqm?: number;
  totalParkingAreaSqm?: number;
  /**
   * Total GFA + total parking area.
   *
   * THE REFERENCE CALLS THIS "BUA Area"; THIS PLATFORM CALLS IT GFA. The
   * outermost tier has opposite names in the two vocabularies (here
   * NSA is inside BUA is inside GFA; there GFA is inside BUA), and this is
   * the one place the two meet. Compare it against the platform's GFA, never
   * against the platform's BUA.
   */
  totalBuaSqm?: number;
  /** Every step that could not be computed, in chain order, so a caller can
   *  say WHY a figure is blank instead of printing a confident zero. */
  gaps: ChainGap[];
  /** True when the asset states no chain inputs at all: the panel renders
   *  nothing, and the asset behaves exactly as it did before this existed. */
  empty: boolean;
}

/** 0..100 -> 0..1, refusing anything that is not a real number. A typed 0 is
 *  a real share and survives; undefined stays undefined. */
function share(pct: number | undefined): number | undefined {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return undefined;
  return pct / 100;
}

const num = (v: number | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** True when an asset states nothing the chain can use. */
export function landChainIsEmpty(inputs: LandChainInputs | undefined): boolean {
  if (!inputs) return true;
  // The retired per-plot retail figure is NOT consulted: a legacy snapshot
  // carrying it must not make a chain look started when nothing else is set.
  return !num(inputs.utilisationPct) && !num(inputs.coveragePct) && !num(inputs.retailPct)
    && !num(inputs.servicePct) && !num(inputs.farRatio);
}

/**
 * Run the chain. Each step consumes the previous one, so an absent input
 * leaves everything downstream of it absent and records one gap.
 *
 * `subUnitUnits` is the count the asset's own sub-units already state. When
 * present it WINS over the derived count, the same precedence as the unit
 * size rule: the rows the user typed are more precise than one division.
 */
export function computeLandChain(
  landAreaSqm: number | undefined,
  inputs: LandChainInputs | undefined,
  standards: LandChainStandards | undefined,
  subUnitUnits?: number,
): ChainResult {
  const gaps: ChainGap[] = [];
  const empty = landChainIsEmpty(inputs);
  if (empty) return { gaps, empty: true };

  const i = inputs as LandChainInputs;
  const s = standards ?? {};
  const out: ChainResult = { gaps, empty: false };

  // 1. Land, and the developable share of it.
  if (!num(landAreaSqm) || landAreaSqm <= 0) gaps.push('no_land');
  else out.landAreaSqm = landAreaSqm;

  const util = share(i.utilisationPct);
  if (util === undefined) gaps.push('no_utilisation');
  if (out.landAreaSqm !== undefined && util !== undefined) {
    out.landUtilisedSqm = out.landAreaSqm * util;
  }

  // 2. Footprint and landscape, both shares of the UTILISED area.
  const cov = share(i.coveragePct);
  if (cov === undefined) gaps.push('no_coverage');
  if (out.landUtilisedSqm !== undefined && cov !== undefined) {
    out.footprintSqm = out.landUtilisedSqm * cov;
    out.landscapePct = 100 - (i.coveragePct as number);
    out.landscapeSqm = out.landUtilisedSqm * (1 - cov);
  }

  // 3. Retail and lobby, both shares of the FOOTPRINT.
  const retail = share(i.retailPct) ?? 0;
  if (out.footprintSqm !== undefined) {
    out.retailGfaSqm = out.footprintSqm * retail;
    out.lobbyGfaSqm = out.footprintSqm - out.retailGfaSqm;
  }

  // 4. Total GFA from FAR on the UTILISED area (not the footprint, and not
  //    the gross plot).
  if (!num(i.farRatio)) gaps.push('no_far');
  if (out.landUtilisedSqm !== undefined && num(i.farRatio)) {
    out.totalGfaSqm = out.landUtilisedSqm * i.farRatio;
  }

  // 5. Main asset GFA. With NO retail the whole GFA is the asset's, lobby
  //    included; with retail, both retail and lobby come out.
  if (out.totalGfaSqm !== undefined) {
    out.mainAssetGfaSqm = retail === 0
      ? out.totalGfaSqm
      : out.totalGfaSqm - (out.retailGfaSqm ?? 0) - (out.lobbyGfaSqm ?? 0);
  }

  // 6. Net saleable: the main asset less its service share.
  const svc = share(i.servicePct) ?? 0;
  if (out.mainAssetGfaSqm !== undefined) {
    out.netSaleableSqm = out.mainAssetGfaSqm * (1 - svc);
  }

  // 7. Units. The sub-units win when they state a count; otherwise the
  //    division, which needs a unit size.
  if (num(subUnitUnits) && subUnitUnits > 0) {
    out.units = Math.round(subUnitUnits);
    out.unitsSource = 'sub_units';
  } else if (out.netSaleableSqm !== undefined && num(s.avgUnitSizeSqm) && s.avgUnitSizeSqm > 0) {
    out.units = Math.round(out.netSaleableSqm / s.avgUnitSizeSqm);
    out.unitsSource = 'derived';
  } else if (out.netSaleableSqm !== undefined) {
    gaps.push('no_unit_size');
  }

  // 8. Parking. Slots per unit is the common basis; sqm per slot divides the
  //    main asset GFA instead, which is what a retail-style ratio means.
  //    Slots come off the ROUNDED unit count, per the counting rule above.
  if (num(s.parkingRatio)) {
    if (s.parkingRatioBasis === 'sqm_per_slot') {
      if (out.mainAssetGfaSqm !== undefined && s.parkingRatio > 0) {
        out.parkingSlots = Math.round(out.mainAssetGfaSqm / s.parkingRatio);
      }
    } else if (out.units !== undefined) {
      out.parkingSlots = Math.round(out.units * s.parkingRatio);
    }
  } else {
    gaps.push('no_parking_ratio');
  }

  // 9. Retail parking, on its own basis. The reference divides retail GFA by
  //    ONE company figure, never by the asset's own ratio.
  if (out.retailGfaSqm !== undefined && out.retailGfaSqm > 0) {
    if (num(s.retailAreaPerSlotSqm) && s.retailAreaPerSlotSqm > 0) {
      out.retailParkingSlots = Math.round(out.retailGfaSqm / s.retailAreaPerSlotSqm);
    } else {
      gaps.push('no_retail_area_per_slot');
    }
  }

  if (out.parkingSlots !== undefined || out.retailParkingSlots !== undefined) {
    out.totalParkingSlots = (out.parkingSlots ?? 0) + (out.retailParkingSlots ?? 0);
  }

  // 10. Slot counts become area at the project's sqm per slot.
  if (num(s.parkingAreaPerSlotSqm)) {
    if (out.parkingSlots !== undefined) out.parkingAreaSqm = out.parkingSlots * s.parkingAreaPerSlotSqm;
    if (out.retailParkingSlots !== undefined) out.retailParkingAreaSqm = out.retailParkingSlots * s.parkingAreaPerSlotSqm;
    if (out.parkingAreaSqm !== undefined || out.retailParkingAreaSqm !== undefined) {
      out.totalParkingAreaSqm = (out.parkingAreaSqm ?? 0) + (out.retailParkingAreaSqm ?? 0);
    }
  } else if (out.totalParkingSlots !== undefined) {
    gaps.push('no_parking_area_per_slot');
  }

  // 11. The outermost tier. Reference name: BUA. Platform name: GFA.
  if (out.totalGfaSqm !== undefined) {
    out.totalBuaSqm = out.totalGfaSqm + (out.totalParkingAreaSqm ?? 0);
  }

  return out;
}

/** One sentence per gap, so a surface can say why a figure is blank. */
export function chainGapText(gap: ChainGap): string {
  switch (gap) {
    case 'no_land': return 'This asset has no land allocated, so the chain has nothing to start from.';
    case 'no_utilisation': return 'Set a utilisation percent to start the chain.';
    case 'no_coverage': return 'Set a coverage percent to derive the footprint and the landscape area.';
    case 'no_far': return 'Set a FAR to derive the total GFA.';
    case 'no_unit_size': return 'No average unit size for this asset type on the standards tab, and no sub-unit states one, so the unit count cannot be derived.';
    case 'no_parking_ratio': return 'No parking ratio for this asset type on the standards tab, so slots cannot be derived.';
    case 'no_parking_area_per_slot': return 'No parking area per slot on the standards tab, so slots cannot become an area.';
    case 'no_retail_area_per_slot': return 'This asset has retail but no retail area per slot, so retail parking is not derived.';
    default: return '';
  }
}

/** A signed difference and its percentage, for the derived-against-entered
 *  panel. Absent when either side is missing: a comparison against nothing is
 *  not a variance, it is an unknown. */
export interface ChainComparison {
  derived?: number;
  entered?: number;
  diff?: number;
  diffPct?: number;
}

export function compareChainValue(derived: number | undefined, entered: number | undefined): ChainComparison {
  const out: ChainComparison = {};
  if (num(derived)) out.derived = derived;
  if (num(entered)) out.entered = entered;
  if (num(derived) && num(entered)) {
    out.diff = derived - entered;
    if (entered !== 0) out.diffPct = ((derived - entered) / entered) * 100;
  }
  return out;
}

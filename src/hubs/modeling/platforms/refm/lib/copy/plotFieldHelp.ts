/**
 * plotFieldHelp.ts — M1.10b/5 shared plain-English tooltip copy for
 * Plot fields. Used by:
 *   - Module1AreaProgram (inline Plot card)
 *   - PlotSetupWizard (modal-step variant)
 *
 * Keys mirror the Plot type's writable field names so callers can pass
 * `PLOT_FIELD_HELP[key]` directly. Verbose enough to disambiguate similar
 * concepts (e.g. Plot Buildable Area vs Land Parcel Area, Podium
 * Coverage vs Typical Coverage). Acronyms (FAR, GFA) are expanded on
 * first use.
 */

export const PLOT_FIELD_HELP: Record<string, string> = {
  plotArea:
    "The portion of your land you'll actually build on. Can be smaller than the parcel area if part of the land is undeveloped or sold separately.",
  maxFAR:
    "Floor Area Ratio. Maximum total building area allowed by regulator, expressed as a multiple of plot area. E.g., FAR 3.0 means you can build up to 3× the plot area.",
  coveragePct:
    "How much of the plot the podium footprint covers. Higher = wider base; lower = more open space.",
  typicalCoveragePct:
    "How much of the plot the tower floors cover. Typically lower than podium for slimmer tower.",
  numberOfFloors:
    "Total above-ground floors (podium + typical). Informational — only podium and typical floor counts drive built GFA in the calc.",
  podiumFloors:
    "Number of podium floors. Usually houses retail, parking, or amenities.",
  typicalFloors:
    "Number of tower floors above the podium. Usually residential or office.",
  landscapePct:
    "Share of public area dedicated to greenery. Public area = plot area minus podium footprint.",
  hardscapePct:
    "Share of public area for paved surfaces (walkways, plazas).",
  surfaceBaySqm:
    "Square metres per surface parking bay (includes drive aisles + access). Drives how many surface bays fit in the leftover public area.",
  verticalBaySqm:
    "Square metres per vertical (podium) parking bay (includes ramps + circulation). Drives podium-floor parking capacity.",
  basementBaySqm:
    "Square metres per basement parking bay (includes ramps + walls). Drives basement parking capacity.",
  basementCount:
    "Number of basement floors. Usually parking + back-of-house.",
  basementEfficiencyPct:
    "Net usable share of basement floor (after walls, ramps, mechanical).",
  verticalParkingFloors:
    "Above-grade parking floors carved out of the podium. Independent of podium floors so you can split podium between retail / amenity / parking.",
};

/**
 * parcelFieldHelp.ts, M1.11/m1.
 *
 * Shared plain-English help copy for the 5 LandParcel fields. Used by
 * both the inline Parcel table on the Land tab and the ParcelSetupWizard
 * modal so labels and tooltips match exactly across surfaces.
 *
 * Mirrors the plotFieldHelp.ts pattern from M1.10b/5.
 */

export const PARCEL_FIELD_HELP: Record<string, string> = {
  name:
    'A short label so you can tell parcels apart later. Useful when a project sits on multiple plots of land you bought separately.',
  area:
    'Total parcel area in square metres (sqm). The Land tab sums all parcels into Total Land Area, which feeds Project FAR and the GFA cascade.',
  rate:
    'Acquisition cost per square metre, in the project currency. Multiplied by Area to get Total Land Value for this parcel.',
  cashPct:
    'Share of the parcel cost paid in cash (vs. an in-kind contribution like equity-for-land). The two add up to 100. Editing one auto-fills the other.',
  inKindPct:
    'Share of the parcel cost paid in kind (e.g., land contributed as equity by a partner). The two add up to 100. Editing one auto-fills the other.',
};

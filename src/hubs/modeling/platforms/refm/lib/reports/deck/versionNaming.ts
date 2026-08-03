/**
 * versionNaming.ts (REFM Module 7: auto-named presentation versions)
 *
 * Saving a presentation version used to require the user to type a name, and
 * the POST route rejected an empty one. The platform's MODEL versions have not
 * worked that way since 2026-06-01: they auto-generate
 * {ProjectName}_v{Major}.{Minor}_{MMDDYYYY}_{TaskName} and show it read-only.
 * This gives the deck the same treatment, minus the task word (the deck has no
 * task field and the point is to type nothing at all):
 *
 *   {ProjectName}_Presentation_v{Major}.{Minor}_{MMDDYYYY}
 *   e.g. FMP RE HUB_Presentation_v1.3_08032026
 *
 * The numbering RULES are not re-implemented here. `getNextVersionNumber`,
 * `formatVersionDate` and `sanitizeForFilename` are imported from the platform
 * helper so both naming schemes roll over identically (1.0 to 1.9 then 2.0,
 * advancing from the LATEST version by date so a delete never refills a gap).
 *
 * That import is the ONLY thing report versioning shares with model versioning.
 * It is a pure function module: no I/O, no state, no table. The two histories
 * stay in separate tables, separate routes and separate UI, exactly as
 * migration 207 describes.
 *
 * Pure and isomorphic on purpose: the server names the version (so no client
 * path can produce an unnamed row) and the UI can show the same string without
 * a round trip.
 *
 * No em dashes in this file.
 */

import {
  getNextVersionNumber,
  formatVersionDate,
  sanitizeForFilename,
} from '../../persistence/versionNaming';

/** Marks a deck version name, and is what `parseDeckVersionLabel` keys on. */
export const DECK_VERSION_TOKEN = 'Presentation';

/** Pull "1.3" out of a generated deck version name. Mirrors the model flow,
 *  which also parses its label back out of the stored name. */
export function parseDeckVersionLabel(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /_v(\d+\.\d+)_/.exec(name);
  return m ? m[1] : null;
}

/**
 * Next X.Y label for a deck, given the versions already saved for the project.
 *
 * Rows are passed in newest-first or oldest-first indifferently: ordering is
 * resolved from `createdAt` by the shared helper. A row whose label does not
 * parse (a hand-typed name from before this change) is ignored rather than
 * treated as 1.0, so one custom name cannot reset the sequence.
 */
export function nextDeckVersionLabel(
  existing: Array<{ label?: string | null; createdAt?: string | null }>,
): string {
  return getNextVersionNumber(
    (existing ?? []).map((v) => ({
      versionLabel: parseDeckVersionLabel(v.label),
      createdAt: v.createdAt ?? null,
    })),
  );
}

/** Build the full auto-generated presentation version name. */
export function buildDeckVersionName(
  projectName: string | null | undefined,
  versionLabel: string,
  date: Date = new Date(),
): string {
  const proj = sanitizeForFilename(projectName) || 'Project';
  return `${proj}_${DECK_VERSION_TOKEN}_v${versionLabel}_${formatVersionDate(date)}`;
}

/** The one call the save paths need: name the NEXT version of this deck. */
export function autoDeckVersionName(
  projectName: string | null | undefined,
  existing: Array<{ label?: string | null; createdAt?: string | null }>,
  date: Date = new Date(),
): string {
  return buildDeckVersionName(projectName, nextDeckVersionLabel(existing), date);
}

/**
 * versionNaming.ts (2026-06-01)
 *
 * Auto-generated version names + version-number rollover for the REFM version
 * creation flow.
 *
 * Name format:
 *   {ProjectName}_v{Major}.{Minor}_{MMDDYYYY}_{TaskName}
 *   e.g. FMP RE HUB_v1.5_06152026_Debt Assumptions
 *
 * Rules:
 *   - Start at v1.0; minor auto-increments (1.0 -> 1.1 -> ... -> 1.9).
 *   - At minor 9 the next version rolls to the next major (1.9 -> 2.0).
 *   - Major / minor are auto-managed; the user never edits them.
 *   - Numbering advances from the LATEST existing version (by created_at);
 *     deletes do NOT fill gaps (delete v1.1 from {1.0,1.1,1.2} -> next is 1.3).
 *
 * Pure functions, no I/O. Shared by the create-version modal (live preview)
 * and the persistence layer (stored versionName / versionLabel).
 */

export const TASK_NAME_MAX = 50;
export const COMMENT_MAX = 1000;

// Characters that break filenames across OSes. Replaced with '_'.
const FILENAME_UNSAFE = /[/\\:*?"<>|]/g;
// Task name allows letters, numbers, spaces, underscores only.
const TASK_NAME_ALLOWED = /^[A-Za-z0-9 _]*$/;

/** Replace filename-breaking characters with underscore + trim. */
export function sanitizeForFilename(s: string | null | undefined): string {
  return (s ?? '').replace(FILENAME_UNSAFE, '_').trim();
}

/** System date as MMDDYYYY (e.g. 06152026 for 2026-06-15). */
export function formatVersionDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}${d.getFullYear()}`;
}

export interface ParsedVersion { major: number; minor: number }

/** Parse a "1.5" version label into {major, minor}; null if malformed. */
export function parseVersionLabel(s: string | null | undefined): ParsedVersion | null {
  if (!s) return null;
  const m = /^(\d+)\.(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function formatVersionLabel(v: ParsedVersion): string {
  return `${v.major}.${v.minor}`;
}

/**
 * Next version label given the existing versions. Starts at "1.0", increments
 * the minor, and rolls to the next major when the latest minor is 9. Advances
 * from the LATEST existing version by created_at (deletes do not fill gaps).
 */
export function getNextVersionNumber(
  existing: Array<{ versionLabel?: string | null; createdAt?: string | null }>,
): string {
  if (!existing || existing.length === 0) return '1.0';
  const parsed = existing
    .map((v) => ({ p: parseVersionLabel(v.versionLabel), t: v.createdAt ? Date.parse(v.createdAt) : 0 }))
    .filter((x): x is { p: ParsedVersion; t: number } => x.p !== null);
  if (parsed.length === 0) return '1.0';
  // Latest by created_at; tie-break on the numeric version (major*100 + minor).
  parsed.sort((a, b) => (b.t - a.t) || ((b.p.major * 100 + b.p.minor) - (a.p.major * 100 + a.p.minor)));
  const latest = parsed[0].p;
  return latest.minor < 9
    ? formatVersionLabel({ major: latest.major, minor: latest.minor + 1 })
    : formatVersionLabel({ major: latest.major + 1, minor: 0 });
}

/** Build the full auto-generated version name. */
export function buildVersionName(
  projectName: string | null | undefined,
  versionLabel: string,
  taskName: string,
  date: Date = new Date(),
): string {
  const proj = sanitizeForFilename(projectName) || 'Project';
  const task = sanitizeForFilename(taskName);
  return `${proj}_v${versionLabel}_${formatVersionDate(date)}_${task}`;
}

export interface FieldValidation { ok: boolean; error?: string }

export function validateTaskName(taskName: string): FieldValidation {
  const t = taskName ?? '';
  if (t.trim().length === 0) return { ok: false, error: 'Task name is required.' };
  if (t.length > TASK_NAME_MAX) return { ok: false, error: `Max ${TASK_NAME_MAX} characters.` };
  if (!TASK_NAME_ALLOWED.test(t)) {
    return { ok: false, error: 'Only letters, numbers, spaces and underscores are allowed.' };
  }
  return { ok: true };
}

export function validateComment(comment: string): FieldValidation {
  const c = comment ?? '';
  if (c.trim().length === 0) return { ok: false, error: 'Comment is required.' };
  if (c.length > COMMENT_MAX) return { ok: false, error: `Max ${COMMENT_MAX} characters.` };
  return { ok: true };
}

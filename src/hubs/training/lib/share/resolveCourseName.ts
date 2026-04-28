import { COURSES } from '@/src/hubs/training/config/courses';

/**
 * Training-Hub-specific course-name resolver. Accepts any of:
 *   - the course id (`'3sfm'`, `'bvm'`)
 *   - the short title (`'3SFM'`, `'BVM'`)
 *   - the full title (passthrough)
 * Returns the input unchanged when no match — lets live-session names and
 * other non-COURSES values pass through untouched.
 *
 * Pass to `renderShareTemplate(template, vars, { courseResolver: resolveCourseName })`
 * from any Training-Hub call site (or the admin daily-roundup) so that
 * abbreviations like `'3SFM'` expand to `'3-Statement Financial Modeling'`
 * in the rendered share text.
 */
export function resolveCourseName(value: string | null | undefined): string {
  if (!value) return '';
  const v = String(value).trim();
  if (!v) return '';
  const vUpper = v.toUpperCase();
  const vLower = v.toLowerCase();
  for (const c of Object.values(COURSES)) {
    if (c.title === v) return c.title;
    if (c.shortTitle.toUpperCase() === vUpper) return c.title;
    if (c.id === vLower) return c.title;
  }
  return v;
}

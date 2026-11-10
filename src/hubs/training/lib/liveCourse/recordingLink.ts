/**
 * A course recording LINK never travels in a list or a page (2026-11-10):
 * every surface but the checked session API gets this marker instead, so a
 * locked recording cannot be fetched from somewhere else. No imports, so the
 * session list reader can use it without an import cycle. The unlock rule is
 * in recordingAccess.ts.
 */

/** Stands in for a course recording URL: truthy ("a recording exists"), never a link. */
export const RECORDING_MARKER = 'recording-available';

/** A course session's recording URL replaced by the marker; a single session unchanged. */
export function withoutCourseRecordingLink<T extends { course_code?: string | null; youtube_url?: string | null }>(row: T): T {
  if (!row.course_code) return row;
  return { ...row, youtube_url: row.youtube_url && String(row.youtube_url).trim() ? RECORDING_MARKER : row.youtube_url ?? null };
}

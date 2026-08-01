/**
 * Cache-Control values for Supabase storage uploads.
 *
 * Supabase defaults an upload that passes no `cacheControl` to `no-cache`,
 * which means every page view pays a blocking revalidation round-trip per
 * image even when the bytes have not changed. That default is what made the
 * marketing images expensive twice over: oversized AND re-fetched.
 *
 * Which constant to use is decided by ONE question: can the bytes at this
 * storage path ever change?
 *
 *   - Path contains a timestamp / uuid, so replacing the file writes a NEW
 *     path and a new URL  ->  IMMUTABLE. Nothing can go stale, because the
 *     old URL keeps serving the old bytes and nobody references it any more.
 *
 *   - Path is stable and uploaded with `upsert: true`, so the same URL can
 *     serve different bytes over time  ->  REPLACEABLE. A long cache here
 *     would show an admin the OLD image after they replaced it, which reads
 *     as a broken upload. Short enough to self-correct, long enough that a
 *     page of thumbnails is not re-validated on every view.
 */

/** One year. For content-unique paths (timestamped or uuid-named). */
export const STORAGE_CACHE_IMMUTABLE = '31536000';

/** Five minutes. For stable paths that are overwritten in place. */
export const STORAGE_CACHE_REPLACEABLE = '300';

/**
 * A live course's own playlist (2026-11-08, founder): every session of a
 * course sits in ONE playlist named for the course ("REFM Live Series"),
 * so the session page's sidebar and "next session" walk the course in order.
 *
 * `syncCoursePlaylist` is the ONE writer: it finds or creates the playlist
 * and puts every session of the course in it. Idempotent, so the seed and
 * every admin save call it. Single sessions are never touched.
 *
 * The playlist is a COURSE playlist, so the single-session screens leave it
 * out (`coursePlaylistIds`), and the public page offers the course once, as
 * its series filter, not twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLiveCourseSettings, isLiveCourseRow } from './courseSettings';
import { seriesLabel } from './publicListing';
export { coursePlaylistIds } from './publicListing';

export interface PlaylistSyncResult { playlistId: string; created: boolean; assigned: number }

export async function syncCoursePlaylist(sb: SupabaseClient, courseCode: string): Promise<PlaylistSyncResult | null> {
  const course = await getLiveCourseSettings(sb, courseCode);
  if (!isLiveCourseRow(course)) return null;
  const name = seriesLabel(course.shortTitle, course.courseCode);

  const { data: found } = await sb.from('live_playlists').select('id').eq('name', name).order('created_at').limit(1);
  let playlistId = (found?.[0]?.id as string | undefined) ?? '';
  let created = false;
  if (!playlistId) {
    const { data, error } = await sb.from('live_playlists')
      .insert({ name, description: course.title, thumbnail_url: course.cardImageUrl ?? '', display_order: 0, is_published: true })
      .select('id').single();
    if (error || !data) throw new Error(`Could not create the ${name} playlist: ${error?.message ?? 'no row'}`);
    playlistId = data.id as string;
    created = true;
  }

  const { data: moved, error: e2 } = await sb.from('live_sessions')
    .update({ playlist_id: playlistId })
    .eq('course_code', course.courseCode)
    .or(`playlist_id.is.null,playlist_id.neq.${playlistId}`)
    .select('id');
  if (e2) throw new Error(`Could not assign the ${name} playlist: ${e2.message}`);
  return { playlistId, created, assigned: moved?.length ?? 0 };
}

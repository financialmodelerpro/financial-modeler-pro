import type { Metadata } from 'next';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { getServerClient } from '@/src/lib/shared/supabase';
import { getAllPageSections } from '@/src/lib/shared/cms';
import { SessionsClient, type PublicSession, type HeroContent } from './SessionsClient';

export const metadata: Metadata = {
  title: 'Training Sessions | Financial Modeler Pro',
  description: 'Join free live financial modeling training sessions or watch recordings. Learn DCF, valuation, and 3-statement modeling with Ahmad Din.',
};

export const dynamic = 'force-dynamic';

async function getSessions(): Promise<PublicSession[]> {
  try {
    const sb = getServerClient();
    const { data, error } = await sb
      .from('live_sessions')
      .select('id, title, description, session_type, scheduled_datetime, timezone, category, banner_url, duration_minutes, max_attendees, difficulty_level, instructor_name, instructor_title, tags, is_featured, youtube_url, youtube_embed, playlist_id, live_playlists(id, name)')
      .eq('is_published', true)
      .order('scheduled_datetime', { ascending: true });

    if (error) {
      console.error('[training-sessions] Supabase error:', error.message);
      return [];
    }

    // Get registration counts
    const sessionIds = (data ?? []).map(s => s.id);
    let regCounts: Record<string, number> = {};
    if (sessionIds.length > 0) {
      try {
        const { data: regs } = await sb
          .from('session_registrations')
          .select('session_id')
          .in('session_id', sessionIds);
        for (const r of regs ?? []) {
          regCounts[r.session_id] = (regCounts[r.session_id] ?? 0) + 1;
        }
      } catch { /* optional */ }
    }

    return (data ?? []).map(s => ({
      id: s.id,
      title: s.title,
      description: s.description,
      session_type: s.session_type,
      scheduled_datetime: s.scheduled_datetime,
      timezone: s.timezone,
      category: s.category,
      banner_url: s.banner_url,
      duration_minutes: s.duration_minutes,
      max_attendees: s.max_attendees,
      difficulty_level: s.difficulty_level,
      instructor_name: s.instructor_name,
      tags: s.tags,
      is_featured: s.is_featured,
      youtube_url: s.youtube_url ?? null,
      youtube_embed: s.youtube_embed ?? false,
      instructor_title: s.instructor_title ?? null,
      playlist: (Array.isArray(s.live_playlists) ? s.live_playlists[0] : s.live_playlists) as PublicSession['playlist'],
      registration_count: regCounts[s.id] ?? 0,
    }));
  } catch (err) {
    console.error('[training-sessions] Error:', err);
    return [];
  }
}

export default async function TrainingSessionsPage() {
  const [sessions, cmsSections] = await Promise.all([
    getSessions(),
    getAllPageSections('training-sessions'),
  ]);

  // Extract hero from CMS
  const heroRaw = cmsSections.find(s => s.section_type === 'hero');
  const heroContent: HeroContent | undefined = heroRaw?.visible !== false
    ? heroRaw?.content as HeroContent | undefined
    : undefined;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      <SessionsClient sessions={sessions} hero={heroContent} />

      <SharedFooter
        company="Financial Modeler Pro"
        founder="Financial Modeler Pro Team"
        copyright={`\u00A9 ${new Date().getFullYear()} Financial Modeler Pro`}
        height="compact"
      />
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { SessionCard, getEffectiveType, type LiveSessionData } from '@/src/components/sessions/SessionCard';

interface Session {
  id: string;
  title: string;
  scheduled_datetime: string;
  timezone: string;
  duration_minutes: number | null;
  difficulty_level: string;
  instructor_name: string;
  banner_url: string | null;
  session_type: string;
  youtube_url?: string | null;
}

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const NAVY = '#0D2E5A';
const GREEN = '#2EAA4A';

export function UpcomingSessionsPreview() {
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Fetch all sessions (not just upcoming) so we can mix in recordings
    fetch('/api/public/training-sessions?limit=20')
      .then(r => r.json())
      .then((j: { sessions?: Session[] }) => setAllSessions(j.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return null;

  // Split by effective type
  const upcoming = allSessions
    .filter(s => { const t = getEffectiveType(s); return t === 'upcoming' || t === 'live'; })
    .sort((a, b) => new Date(a.scheduled_datetime).getTime() - new Date(b.scheduled_datetime).getTime());
  const recorded = allSessions
    .filter(s => getEffectiveType(s) === 'recorded')
    .sort((a, b) => new Date(b.scheduled_datetime).getTime() - new Date(a.scheduled_datetime).getTime());

  // Priority: upcoming first, fill remaining with recordings, max 3
  const display: Session[] = [];
  for (const s of upcoming) { if (display.length < 3) display.push(s); }
  for (const s of recorded) { if (display.length < 3) display.push(s); }

  // Hide if empty
  if (display.length === 0) return null;

  return (
    <section style={{ background: '#F5F7FA', padding: 'clamp(48px,7vw,80px) 40px' }}>
      <style>{`
        @media (max-width: 767px) {
          .tsp-grid { display: flex !important; overflow-x: auto !important; gap: 12px !important; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
          .tsp-grid > * { min-width: 260px !important; max-width: 300px !important; flex-shrink: 0 !important; scroll-snap-align: start; }
        }
      `}</style>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: GREEN, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            Live Learning
          </div>
          <h2 style={{ fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: NAVY, margin: 0 }}>
            FMP Real-World Financial Modeling
          </h2>
          <p style={{ fontSize: 14, color: '#6B7280', marginTop: 10 }}>
            Live sessions and recorded content. Practitioner-led. Built on real deal work.
          </p>
        </div>

        <style>{`
          .session-card { transition: box-shadow 0.2s, transform 0.2s; }
          .session-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.12) !important; transform: translateY(-2px); }
          @keyframes live-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        `}</style>
        <div className="tsp-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {display.map(s => (
            <SessionCard key={s.id} session={s as LiveSessionData} variant="public" compact />
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link href={`${LEARN_URL}/training-sessions`} style={{ fontSize: 14, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none' }}>
            View All Live Sessions &#8594;
          </Link>
        </div>
      </div>
    </section>
  );
}

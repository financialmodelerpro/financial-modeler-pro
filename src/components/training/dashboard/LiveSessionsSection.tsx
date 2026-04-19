'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, Play } from 'lucide-react';
import { LiveSessionCard } from './LiveSessionCard';
import {
  getLiveSessionsForStudent,
  type LiveSessionsForStudent,
} from '@/src/lib/training/liveSessionsForStudent';

const NAVY = '#0D2E5A';

interface Props {
  studentEmail: string;
  courseId?: string;
  /** How many cards to render per sub-section. Defaults to 3. */
  limit?: number;
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 16,
};

const headerRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 14,
};

const heading: React.CSSProperties = {
  fontSize: 15, fontWeight: 800, color: NAVY,
  margin: 0,
  display: 'flex', alignItems: 'center', gap: 8,
  letterSpacing: '-0.01em',
};

const subHeading: React.CSSProperties = {
  fontSize: 16, fontWeight: 800, color: NAVY, margin: 0,
};

const viewAllLink: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none',
};

export function LiveSessionsSection({ studentEmail, courseId, limit = 3 }: Props) {
  const [data, setData] = useState<LiveSessionsForStudent | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!studentEmail) { setLoaded(true); return; }
    getLiveSessionsForStudent(studentEmail, courseId, limit)
      .then(d => { if (!cancelled) { setData(d); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [studentEmail, courseId, limit]);

  if (!loaded) return null;
  if (!data) return null;

  const upcomingMerged = [...data.upcomingRegistered, ...data.upcoming].slice(0, limit);
  const hasUpcoming = upcomingMerged.length > 0;
  const hasRecorded = data.recorded.length > 0;

  if (!hasUpcoming && !hasRecorded) return null;

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={headerRow}>
        <h2 style={subHeading}>Live Sessions</h2>
        <Link href="/training/live-sessions" style={viewAllLink}>
          View all →
        </Link>
      </div>

      {hasUpcoming && (
        <div style={{ marginBottom: hasRecorded ? 24 : 0 }}>
          <div style={headerRow}>
            <h3 style={heading}>
              <Radio size={14} color="#EA580C" /> Upcoming
            </h3>
            <Link href="/training/live-sessions" style={viewAllLink}>See all upcoming →</Link>
          </div>
          <div style={gridStyle}>
            {upcomingMerged.map(s => (
              <LiveSessionCard
                key={s.id}
                variant="upcoming"
                session={s}
                reg={data.regStatus[s.id]}
                href={`/training/live-sessions/${s.id}`}
              />
            ))}
          </div>
        </div>
      )}

      {hasRecorded && (
        <div>
          <div style={headerRow}>
            <h3 style={heading}>
              <Play size={14} color="#0F766E" fill="#0F766E" /> Recorded
            </h3>
            <Link href="/training/live-sessions" style={viewAllLink}>See all recordings →</Link>
          </div>
          <div style={gridStyle}>
            {data.recorded.map(s => (
              <LiveSessionCard
                key={s.id}
                variant="recorded"
                session={s}
                watch={data.watchHistory[s.id]}
                href={`/training/live-sessions/${s.id}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

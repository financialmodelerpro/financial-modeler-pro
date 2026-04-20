'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, CalendarClock } from 'lucide-react';
import { LiveSessionCard } from './LiveSessionCard';
import {
  getLiveSessionsForStudent,
  type LiveSessionsForStudent,
} from '@/src/lib/training/liveSessionsForStudent';

const NAVY = '#0D2E5A';

interface Props {
  studentEmail: string;
  courseId?: string;
  /** How many upcoming cards to render. Defaults to 3 — matches the
   *  "max 3 cards per row" dashboard layout. */
  limit?: number;
}

/**
 * Dashboard live-sessions preview — UPCOMING ONLY. The main
 * `/training/live-sessions` page shows both upcoming + recorded;
 * the dashboard keeps the preview tight so students scan the
 * "what's next" list without scrolling past a wall of recordings.
 *
 * Layout: up to 3 cards, flex-wrapped so each card stays ≤ 1/3 width
 * on wide screens (>=780px) and gracefully collapses to 2/1 columns
 * on narrower viewports.
 */
const EMPTY_DATA: LiveSessionsForStudent = {
  upcoming: [], upcomingRegistered: [], recorded: [],
  regStatus: {}, watchHistory: {},
};

export function LiveSessionsSection({ studentEmail, courseId, limit = 3 }: Props) {
  const [data, setData] = useState<LiveSessionsForStudent | null>(null);

  useEffect(() => {
    if (!studentEmail) return;
    let cancelled = false;
    getLiveSessionsForStudent(studentEmail, courseId, limit)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(EMPTY_DATA); });
    return () => { cancelled = true; };
  }, [studentEmail, courseId, limit]);

  // Still loading — hide the section to avoid a flash of empty state before
  // the fetch completes. Once `data` is set (even to EMPTY_DATA on error),
  // we render either the grid or the empty-state placeholder.
  if (data === null && studentEmail) return null;

  // Registered-first ordering so the student's own commitments lead.
  // Slice to `limit` so the grid always holds max 3 cards.
  const upcoming = data
    ? [...data.upcomingRegistered, ...data.upcoming].slice(0, limit)
    : [];

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: NAVY, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} color="#EA580C" />
          Upcoming Live Sessions
        </h2>
        <Link href="/training/live-sessions" style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', textDecoration: 'none' }}>
          View all →
        </Link>
      </div>

      {upcoming.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Fixed 3-slot grid (2 tablet, 1 mobile) with a 280px per-column
              cap + justify-content: start so cards don't stretch when
              fewer than 3 are present. Shared `fmp-upcoming-grid` class
              matches the rule shipped by LiveSessionsPanel's Upcoming
              section — dashboard preview and Live Sessions tab render
              pixel-identical card widths. */}
          <style>{`
            .fmp-upcoming-grid {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 280px));
              gap: 16px;
              justify-content: start;
            }
            @media (max-width: 900px) {
              .fmp-upcoming-grid { grid-template-columns: repeat(2, minmax(0, 280px)); }
            }
            @media (max-width: 600px) {
              .fmp-upcoming-grid { grid-template-columns: 1fr; }
            }
          `}</style>
          <div className="fmp-upcoming-grid">
            {upcoming.map(s => (
              <LiveSessionCard
                key={s.id}
                variant="upcoming"
                session={s}
                reg={data?.regStatus[s.id]}
                href={`/training/live-sessions/${s.id}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{
      padding: '32px 24px',
      background: '#fff',
      border: '1px dashed #E5E7EB',
      borderRadius: 12,
      textAlign: 'center',
      color: '#6B7280',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
        <CalendarClock size={28} color="#9CA3AF" />
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
        No upcoming live sessions scheduled
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.55, maxWidth: 420, margin: '0 auto 14px' }}>
        New live sessions appear here as soon as they&apos;re announced. In the meantime, the recordings
        library is available on the Live Sessions page.
      </div>
      <Link
        href="/training/live-sessions"
        style={{
          display: 'inline-block', padding: '8px 16px', borderRadius: 8,
          background: '#1B4F8A', color: '#fff', fontSize: 12, fontWeight: 700,
          textDecoration: 'none',
        }}
      >
        Browse recordings →
      </Link>
    </div>
  );
}

'use client';

/**
 * A course session's time: KSA first ("Tue 1 Dec, 7:00 PM KSA"), plus the
 * viewer's own time when their zone differs ("(9:00 PM your time)"). The KSA
 * label renders on the server; the suffix is added after mount, when the
 * viewer's zone is known, so the two renders never disagree.
 */
import { useEffect, useState } from 'react';
import { courseTimeLabel, viewerClock } from '@/src/hubs/training/lib/liveCourse/time';

export function CourseTime({ iso, style, year, variant = 'inline' }: {
  iso: string | null | undefined; style?: React.CSSProperties;
  /** "Tue 1 Dec 2026, 7:00 PM KSA". */
  year?: boolean;
  /** inline: "... KSA (9:00 PM your time)"; line: "Your time: 9:00 PM" on its own line. */
  variant?: 'inline' | 'line';
}) {
  const [clock, setClock] = useState('');
  useEffect(() => {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* unknown zone: KSA only */ }
    const t = setTimeout(() => setClock(viewerClock(iso, tz)), 0);
    return () => clearTimeout(t);
  }, [iso]);
  return (
    <span data-testid="course-time" style={style}>
      {courseTimeLabel(iso, { year })}
      {clock && (variant === 'line'
        ? <span data-testid="course-time-yours" style={{ display: 'block', fontSize: '0.92em', color: '#1B4F8A', marginTop: 4 }}>Your time: {clock}</span>
        : <span data-testid="course-time-yours" style={{ opacity: 0.8 }}> ({clock} your time)</span>)}
    </span>
  );
}

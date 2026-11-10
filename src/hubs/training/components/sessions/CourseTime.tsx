'use client';

/**
 * A course session's time: KSA first ("Tue 1 Dec, 7:00 PM KSA"), plus the
 * viewer's own time when their zone differs ("(9:00 PM your time)"). The KSA
 * label renders on the server; the suffix is added after mount, when the
 * viewer's zone is known, so the two renders never disagree.
 */
import { useEffect, useState } from 'react';
import { courseTimeLabel, viewerTimeSuffix } from '@/src/hubs/training/lib/liveCourse/time';

export function CourseTime({ iso, style }: { iso: string | null | undefined; style?: React.CSSProperties }) {
  const [suffix, setSuffix] = useState('');
  useEffect(() => {
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* unknown zone: KSA only */ }
    const t = setTimeout(() => setSuffix(viewerTimeSuffix(iso, tz)), 0);
    return () => clearTimeout(t);
  }, [iso]);
  return (
    <span data-testid="course-time" style={style}>
      {courseTimeLabel(iso)}
      {suffix && <span data-testid="course-time-yours" style={{ opacity: 0.8 }}> {suffix}</span>}
    </span>
  );
}

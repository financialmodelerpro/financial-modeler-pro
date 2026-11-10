'use client';

/**
 * Dashboard cards for live courses: one-click Enrol for a student not yet
 * enrolled, Open course for one who is. Renders nothing when there is no
 * live course, so the dashboard is unchanged for exam-only students.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';
import { CourseTime } from '@/src/hubs/training/components/sessions/CourseTime';

interface CourseCard {
  courseCode: string;
  title: string;
  description: string;
  sessionCount: number;
  nextSessionAt: string | null;
  enrolled: boolean;
}

const NAVY = '#1B4F8A';

export function LiveCourseCards() {
  const [courses, setCourses] = useState<CourseCard[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<Record<string, string>>({});

  const load = () => fetch('/api/training/live-course')
    .then((r) => (r.ok ? r.json() : { courses: [] }))
    .then((j: { courses?: CourseCard[] }) => setCourses(j.courses ?? []))
    .catch(() => {});
  useEffect(() => { void load(); }, []);

  async function enrol(code: string) {
    setBusy(code);
    try {
      const r = await fetch('/api/training/enroll', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ courseCode: code }) });
      const j = await r.json() as { ok?: boolean; emailSent?: boolean; error?: string };
      setMsg((m) => ({ ...m, [code]: j.ok ? (j.emailSent ? 'Enrolled. Check your email for the schedule.' : 'Enrolled.') : (j.error ?? 'Enrolment failed.') }));
      if (j.ok) await load();
    } finally { setBusy(''); }
  }

  if (!courses.length) return null;
  return (
    <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
      {courses.map((c) => (
        <div key={c.courseCode} data-testid="dashboard-live-course" style={{ background: 'linear-gradient(135deg, #0D2E5A, #1B4F8A)', color: '#fff', borderRadius: 12, padding: '18px 22px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 280px' }}>
            <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.85 }}>Live course · {c.sessionCount} sessions</div>
            <div style={{ fontSize: 18, fontWeight: 800, margin: '4px 0' }}>{c.title}</div>
            <div style={{ fontSize: 13, opacity: 0.9 }}>{c.nextSessionAt ? <>Next: <CourseTime iso={c.nextSessionAt} /></> : c.description}</div>
            {msg[c.courseCode] && <div style={{ fontSize: 12.5, marginTop: 6 }}>{msg[c.courseCode]}</div>}
          </div>
          {c.enrolled ? (
            <Link data-testid="dashboard-live-course-open" href={coursePagePath(c.courseCode)} style={{ background: '#fff', color: NAVY, padding: '10px 20px', borderRadius: 8, fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>Open course →</Link>
          ) : (
            <button data-testid="dashboard-live-course-enrol" onClick={() => enrol(c.courseCode)} disabled={busy === c.courseCode} style={{ background: '#2E7D52', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
              {busy === c.courseCode ? 'Enrolling…' : 'Enrol (free)'}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

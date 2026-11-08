'use client';

/**
 * Admin > Live Training > one course. Publish / Unpublish / Archive at the
 * top (with a confirm step), then the tabs:
 *   Details · Sessions · Students and attendance · Submissions · Certificate
 * Every tab reuses the screen that already does the job (the shared session
 * editor, the attendance panel, the model submissions screen).
 */
import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import type { LiveCourseSettings, CourseStatus } from '@/src/hubs/training/lib/liveCourse/courseSettings';
import { LiveSessionsManager } from '../LiveSessionsManager';
import { StatusBadge } from '../StatusBadge';
import { CourseDetailsTab } from './CourseDetailsTab';
import { CourseCertificateTab } from './CourseCertificateTab';
import { CourseAttendancePanel } from './CourseAttendancePanel';
import { ModelSubmissionsManager } from '../../model-submissions/ModelSubmissionsManager';
import { TeamsMeetingsButton } from './TeamsMeetingsButton';

const NAVY = '#1B4F8A';
const SLATE = '#5A6675';
const PALE = '#E8EEF7';
const TABS = [
  { key: 'details', label: 'Details' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'students', label: 'Students and attendance' },
  { key: 'submissions', label: 'Submissions' },
  { key: 'certificate', label: 'Certificate' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const btn: React.CSSProperties = { padding: '8px 16px', borderRadius: 6, border: `1px solid ${NAVY}`, background: '#fff', color: NAVY, fontSize: 13, fontWeight: 700, cursor: 'pointer' };

const STATUS_ACTIONS: Record<CourseStatus, { to: CourseStatus; label: string; confirm: string; color: string }[]> = {
  draft: [{ to: 'published', label: 'Publish', confirm: 'Publish this course? Its card and course page become public and new students can register.', color: '#2E7D52' }],
  published: [
    { to: 'draft', label: 'Unpublish', confirm: 'Unpublish this course? It is hidden from the public and registration closes. Enrolled students keep access.', color: '#B45309' },
    { to: 'archived', label: 'Archive', confirm: 'Archive this course? It is hidden from the public. Enrolled students keep their recordings, materials and certificate.', color: '#5A6675' },
  ],
  archived: [{ to: 'draft', label: 'Restore to draft', confirm: 'Move this course back to draft? It stays hidden until you publish it.', color: NAVY }],
};

function CourseAdminInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>((TABS.find((t) => t.key === params.get('tab'))?.key) ?? 'details');
  const [course, setCourse] = useState<LiveCourseSettings | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [confirmTo, setConfirmTo] = useState<CourseStatus | null>(null);
  const [toast, setToast] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/live-course/${code}`);
    if (!r.ok) { setNotFound(true); return; }
    const j = await r.json() as { course: LiveCourseSettings; previewUrl: string };
    setCourse(j.course); setPreviewUrl(j.previewUrl);
  }, [code]);
  useEffect(() => { void load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4500); void load(); setReloadKey((k) => k + 1); };

  async function changeStatus(to: CourseStatus) {
    const r = await fetch(`/api/admin/live-course/${code}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: to }) });
    const j = await r.json() as { error?: string };
    setConfirmTo(null);
    flash(r.ok ? `Course is now ${to}.` : `Could not change status: ${j.error ?? r.status}`);
  }

  const goTab = (t: TabKey) => { setTab(t); router.replace(`/admin/training-hub/live-training/${code}${t === 'details' ? '' : `?tab=${t}`}`); };
  const action = confirmTo && course ? STATUS_ACTIONS[course.status].find((a) => a.to === confirmTo) : null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/live-training" />
      <main data-testid="admin-course-page" style={{ flex: 1, padding: 32, overflowY: 'auto', color: '#2A3440', minWidth: 0 }}>
        {toast && <div style={{ position: 'fixed', bottom: 24, right: 24, maxWidth: 480, background: NAVY, color: '#fff', padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 900 }}>{toast}</div>}
        <Link href="/admin/training-hub/live-training" style={{ color: SLATE, fontSize: 12.5, textDecoration: 'none' }}>← Live Training</Link>
        {notFound && <div style={{ marginTop: 16, color: '#B91C1C' }}>Course not found.</div>}
        {course && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', margin: '8px 0 18px' }}>
              <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', margin: 0 }}>{course.title}</h1>
              <span style={{ color: SLATE, fontSize: 13 }}>{course.courseCode}</span>
              <StatusBadge status={course.status} enrolmentOpen={course.enrolmentOpen} />
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {course.status !== 'published' && previewUrl && (
                  <a data-testid="course-preview-link" href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none' }}>Preview course page</a>
                )}
                {course.status === 'published' && (
                  <a href={`${previewUrl.split('?')[0]}`} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none' }}>View public page</a>
                )}
                {STATUS_ACTIONS[course.status].map((a) => (
                  <button key={a.to} data-testid={`course-status-${a.to}`} onClick={() => setConfirmTo(a.to)} style={{ ...btn, background: a.color, borderColor: a.color, color: '#fff' }}>{a.label}</button>
                ))}
              </div>
            </div>

            {action && (
              <div data-testid="course-status-confirm" style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5, color: '#78350F', flex: 1 }}>{action.confirm}</span>
                <button data-testid="course-status-confirm-yes" onClick={() => changeStatus(action.to)} style={{ ...btn, background: action.color, borderColor: action.color, color: '#fff' }}>Yes, {action.label.toLowerCase()}</button>
                <button onClick={() => setConfirmTo(null)} style={btn}>Cancel</button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: `2px solid ${PALE}`, flexWrap: 'wrap' }}>
              {TABS.map((t) => (
                <button key={t.key} data-testid={`course-tab-${t.key}`} onClick={() => goTab(t.key)} style={{ padding: '9px 16px', border: 'none', borderBottom: tab === t.key ? `3px solid ${NAVY}` : '3px solid transparent', background: 'none', color: tab === t.key ? NAVY : SLATE, fontWeight: 800, fontSize: 13.5, cursor: 'pointer', marginBottom: -2 }}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === 'details' && <CourseDetailsTab key={`d${reloadKey}`} course={course} onSaved={flash} />}
            {tab === 'sessions' && (
              <>
                <TeamsMeetingsButton courseCode={course.courseCode} onDone={() => setReloadKey((k) => k + 1)} />
                <LiveSessionsManager key={`s${reloadKey}`} courseCode={course.courseCode} embedded />
              </>
            )}
            {tab === 'students' && <CourseAttendancePanel courseCode={course.courseCode} attendanceThresholdPct={course.attendanceThresholdPct} />}
            {tab === 'submissions' && <ModelSubmissionsManager courseCode={course.courseCode} embedded />}
            {tab === 'certificate' && <CourseCertificateTab key={`c${reloadKey}`} course={course} onSaved={flash} />}
          </>
        )}
      </main>
    </div>
  );
}

export default function LiveCourseAdminPage() {
  return <Suspense fallback={null}><CourseAdminInner /></Suspense>;
}

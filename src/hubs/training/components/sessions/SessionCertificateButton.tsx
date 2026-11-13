'use client';

/**
 * Opens the session's achievement card (the same system-made card and share
 * modal a single live session uses: achievementCardUrl + ShareModal + the
 * admin's 'achievement_card' share template). Download and LinkedIn share
 * come with the modal.
 */
import { useState } from 'react';
import { ShareModal } from '@/src/shared/share/components/ShareModal';
import { useShareTemplate } from '@/src/shared/share/useShareTemplate';
import { renderShareTemplate, formatShareDate } from '@/src/shared/share/shareTemplates';
import { achievementCardUrl } from '@/src/hubs/training/lib/liveSessions/achievementCard';
import { structuredLearningText } from '@/src/hubs/training/lib/liveCourse/pageSections';
import { coursePagePath } from '@/src/hubs/training/lib/liveCourse/paths';

const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

export function SessionCertificateButton({ session, studentName, registrationId, courseTitle, courseCode, sessionCount, via }: {
  session: { title: string; scheduled_datetime: string | null; duration_minutes: number | null; course_session_no?: number | null };
  studentName: string;
  registrationId: string;
  courseTitle: string;
  /**
   * The live-course card's facts (founder, 2026-11-13): with them the card
   * reads "Session N of M", the session's structured learning, how it was
   * completed (live or by recording) and a QR code to the course page.
   */
  courseCode?: string;
  sessionCount?: number;
  via?: 'live' | 'recording' | null;
}) {
  const [open, setOpen] = useState(false);
  // "Session 3: Financing, ..." on the card; the card says Completed, never a percentage.
  const cardTitle = session.course_session_no != null ? `Session ${session.course_session_no}: ${session.title}` : session.title;
  const template = useShareTemplate('achievement_card');
  const rendered = renderShareTemplate(template, {
    studentName,
    sessionName: cardTitle,
    score: 'Completed',
    course: courseTitle,
    date: formatShareDate(session.scheduled_datetime ?? new Date()),
    regId: registrationId,
  });
  return (
    <>
      <button data-testid="session-certificate" onClick={() => setOpen(true)}
        style={{ padding: '8px 14px', borderRadius: 8, border: '1.5px solid #2E7D52', background: '#fff', color: '#2E7D52', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
        🎓 Session certificate
      </button>
      {open && (
        <ShareModal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="🎉 Your Achievement Card"
          text={rendered.text}
          hashtags={rendered.hashtags}
          cardImageUrl={achievementCardUrl({ title: sessionCount ? session.title : cardTitle, has_assessment: false, duration_minutes: session.duration_minutes }, studentName, registrationId, undefined, session.scheduled_datetime, courseTitle, {
            completed: true,
            sessionNo: session.course_session_no ?? null,
            sessionCount: sessionCount ?? null,
            learning: structuredLearningText(session.duration_minutes),
            via: via ?? null,
            qrUrl: courseCode ? `${LEARN_URL}${coursePagePath(courseCode)}` : null,
          })}
          cardDownloadName={`FMP-${session.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}.png`}
        />
      )}
    </>
  );
}

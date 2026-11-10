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

export function SessionCertificateButton({ session, studentName, registrationId, courseTitle }: {
  session: { title: string; scheduled_datetime: string | null; duration_minutes: number | null; course_session_no?: number | null };
  studentName: string;
  registrationId: string;
  courseTitle: string;
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
          cardImageUrl={achievementCardUrl({ title: cardTitle, has_assessment: false, duration_minutes: session.duration_minutes }, studentName, registrationId, undefined, session.scheduled_datetime, courseTitle, { completed: true })}
          cardDownloadName={`FMP-${session.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}.png`}
        />
      )}
    </>
  );
}

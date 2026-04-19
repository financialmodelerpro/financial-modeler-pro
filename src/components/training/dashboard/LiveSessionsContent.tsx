'use client';

import { LiveSessionsPanel } from './LiveSessionsPanel';

interface Props {
  studentEmail: string;
  studentName?: string;
  registrationId?: string;
}

/**
 * Rendered inline on `/training/dashboard?tab=live-sessions`. Delegates to the
 * same `LiveSessionsPanel` used by the standalone `/training/live-sessions`
 * page so both entry points show the redesigned layout.
 */
export function LiveSessionsContent({ studentEmail, studentName, registrationId }: Props) {
  return (
    <LiveSessionsPanel
      studentEmail={studentEmail}
      studentName={studentName}
      registrationId={registrationId}
      maxWidth={1200}
    />
  );
}

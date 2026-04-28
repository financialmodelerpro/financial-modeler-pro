'use client';

import { TrainingShell } from '@/src/hubs/training/components/TrainingShell';
import { LiveSessionsPanel } from '@/src/hubs/training/components/dashboard/LiveSessionsPanel';

interface Props {
  studentEmail: string;
  studentName: string;
  registrationId: string;
}

export function LiveSessionsClient({ studentEmail, studentName, registrationId }: Props) {
  return (
    <TrainingShell activeNav="live-sessions">
      <div style={{ padding: '24px 20px 48px' }}>
        <LiveSessionsPanel
          studentEmail={studentEmail}
          studentName={studentName}
          registrationId={registrationId}
        />
      </div>
    </TrainingShell>
  );
}

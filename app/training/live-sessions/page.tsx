import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTrainingCookieSession } from '@/src/hubs/training/lib/session/trainingSessionCookie';
import { getServerClient } from '@/src/core/db/supabase';
import { LiveSessionsClient } from './LiveSessionsClient';

export const metadata: Metadata = {
  title: 'Live Sessions | FMP Training Hub',
  description: 'Live sessions and recorded content from FMP Real-World Financial Modeling.',
};

export const dynamic = 'force-dynamic';

async function fetchStudentName(email: string): Promise<string> {
  const sb = getServerClient();
  const { data } = await sb
    .from('training_registrations_meta')
    .select('name')
    .eq('email', email)
    .maybeSingle();
  return (data?.name as string | undefined) ?? '';
}

export default async function StudentLiveSessionsPage() {
  const sess = await getTrainingCookieSession();
  if (!sess) redirect('/signin');

  const studentName = await fetchStudentName(sess.email).catch(() => '');

  return (
    <LiveSessionsClient
      studentEmail={sess.email}
      studentName={studentName}
      registrationId={sess.registrationId}
    />
  );
}

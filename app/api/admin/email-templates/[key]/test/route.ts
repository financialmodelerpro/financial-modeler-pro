import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { sendTemplatedEmail } from '@/src/shared/email/sendTemplatedEmail';

async function checkAdmin() {
  const session = await getServerSession(authOptions);
  return !!(session?.user && (session.user as { role?: string }).role === 'admin');
}

/** POST - send test email to admin */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!await checkAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { key } = await params;

  // Send to admin email (from ENV or fallback)
  const adminEmail = process.env.EMAIL_FROM_TRAINING ?? 'training@financialmodelerpro.com';

  const dummyPlaceholders: Record<string, string> = {
    student_name: 'Test Student',
    session_title: 'Sample Training Session: Financial Modeling Fundamentals',
    session_date: 'Wed, 15 Jan 2026',
    session_time: '02:00 PM',
    session_timezone: 'Asia/Riyadh',
    session_duration: '90 min',
    session_description: 'An introduction to real estate financial modeling covering project setup, timeline, and financing structure.',
    instructor_name: 'Ahmad Din',
    join_url: 'https://teams.microsoft.com/meet/test-session',
    view_url: `${process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com'}/training-sessions/test-id`,
    youtube_url: 'https://youtube.com/watch?v=test123',
    registration_count: '47',
  };

  const result = await sendTemplatedEmail({
    templateKey: key,
    recipients: [{ email: adminEmail, name: 'Admin Test' }],
    placeholders: dummyPlaceholders,
  });

  return NextResponse.json({ success: result.sent > 0, sentTo: adminEmail });
}

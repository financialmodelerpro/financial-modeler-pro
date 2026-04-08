import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { getServerClient } from '@/src/lib/shared/supabase';
import { listAllStudents } from '@/src/lib/training/sheets';
import { sendEmail, FROM } from '@/src/lib/email/sendEmail';
import { liveSessionNotificationTemplate } from '@/src/lib/email/templates/liveSessionNotification';

export const maxDuration = 300; // 5 min for bulk email

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json() as { type?: 'announcement' | 'reminder'; target?: 'all' | '3sfm' | 'bvm'; preview?: boolean };
  const type = body.type ?? 'announcement';
  const target = body.target ?? 'all';

  const sb = getServerClient();

  // Get session details
  const { data: liveSession } = await sb.from('live_sessions').select('*').eq('id', id).single();
  if (!liveSession) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Get attachments
  const { data: atts } = await sb.from('course_attachments').select('file_name, file_url').eq('tab_key', `LIVE_${id}`).eq('is_visible', true);

  // Get students from Apps Script
  const studentsResult = await listAllStudents();
  if (!studentsResult.success || !studentsResult.data?.length) {
    return NextResponse.json({ error: 'Could not fetch student list', sent: 0, failed: 0 }, { status: 500 });
  }

  let filteredStudents = studentsResult.data.filter(s => s.email);
  if (target === '3sfm') filteredStudents = filteredStudents.filter(s => (s.course ?? '').toUpperCase().includes('3SFM'));
  if (target === 'bvm') filteredStudents = filteredStudents.filter(s => (s.course ?? '').toUpperCase().includes('BVM'));

  // Preview mode — send only to admin
  if (body.preview) {
    filteredStudents = [{ name: 'Admin Preview', email: 'meetahmadch@gmail.com', registrationId: 'PREVIEW', course: '', registeredAt: '' }];
  }

  const students = filteredStudents.map(s => ({ name: s.name || s.registrationId, email: s.email }));

  // Get registration count
  const { count: regCount } = await sb.from('session_registrations').select('*', { count: 'exact', head: true }).eq('session_id', id);

  // Format date/time
  const dt = liveSession.scheduled_datetime ? new Date(liveSession.scheduled_datetime) : null;
  const sessionDate = dt ? dt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const sessionTime = dt ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
  const sessionUrl = `https://learn.financialmodelerpro.com/training/live-sessions/${id}`;

  // Send emails in batches of 10
  let sent = 0;
  let failed = 0;
  const batchSize = 10;

  for (let i = 0; i < students.length; i += batchSize) {
    const batch = students.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(student => {
        const { subject, html } = liveSessionNotificationTemplate({
          name: student.name,
          sessionTitle: liveSession.title,
          sessionDate,
          sessionTime,
          timezone: liveSession.timezone ?? 'Asia/Riyadh',
          sessionUrl,
          description: liveSession.description ?? undefined,
          attachments: (atts ?? []).map(a => ({ name: a.file_name, url: a.file_url })),
          isReminder: type === 'reminder',
          registrationCount: regCount ?? 0,
        });
        return sendEmail({ to: student.email, subject, html, from: FROM.training });
      })
    );
    sent += results.filter(r => r.status === 'fulfilled').length;
    failed += results.filter(r => r.status === 'rejected').length;
  }

  // Update notification flags
  const updates: Record<string, unknown> = {};
  if (type === 'announcement') {
    updates.notification_sent = true;
    updates.notification_sent_at = new Date().toISOString();
    updates.notification_sent_count = sent;
  } else {
    updates.reminder_sent = true;
    updates.reminder_sent_at = new Date().toISOString();
    updates.reminder_sent_count = sent;
  }
  await sb.from('live_sessions').update(updates).eq('id', id);

  return NextResponse.json({ success: true, sent, failed, total: students.length });
}

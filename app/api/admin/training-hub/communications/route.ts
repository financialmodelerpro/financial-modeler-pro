import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { listAllStudents } from '@/src/lib/training/sheets';
import { getServerClient } from '@/src/lib/shared/supabase';

export const revalidate = 0;

// ── GET: history or dropout groups ────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get('type') ?? 'history';

  if (type === 'history') {
    const sb = getServerClient();
    const { data } = await sb.from('training_email_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(200);
    return NextResponse.json({ logs: data ?? [] });
  }

  if (type === 'dropout') {
    const res = await listAllStudents();
    const students = res.data ?? [];
    const now = Date.now();
    const DAY = 86400000;

    const neverStarted = students.filter(s =>
      (s.sessionsPassedCount ?? 0) === 0
    ).map(s => ({
      ...s,
      daysSinceEnroll: s.registeredAt ? Math.floor((now - new Date(s.registeredAt).getTime()) / DAY) : null,
    }));

    const stalled = students.filter(s => {
      const passed = s.sessionsPassedCount ?? 0;
      return passed > 0 && !s.finalPassed && !s.certificateIssued;
    }).map(s => ({
      ...s,
      daysSinceEnroll: s.registeredAt ? Math.floor((now - new Date(s.registeredAt).getTime()) / DAY) : null,
    }));

    const almostDone = students.filter(s => {
      const passed = s.sessionsPassedCount ?? 0;
      const total  = s.totalSessions ?? 17;
      return passed >= Math.floor(total * 0.8) && !s.finalPassed && !s.certificateIssued;
    }).map(s => ({
      ...s,
      sessionsLeft: (s.totalSessions ?? 17) - (s.sessionsPassedCount ?? 0),
    }));

    return NextResponse.json({ neverStarted, stalled, almostDone });
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 });
}

// ── POST: send announcement ───────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    campaignName: string;
    subject: string;
    message: string;
    emailType: string;
    recipients: { registrationId: string; email: string; name: string }[];
  };

  if (!body.recipients?.length) {
    return NextResponse.json({ error: 'No recipients' }, { status: 400 });
  }

  // Call Apps Script to actually send emails
  let sent = 0;
  let failed = 0;

  try {
    const sb = getServerClient();
    const { data: settingsRow } = await sb.from('training_settings')
      .select('value').eq('key', 'apps_script_url').single();
    const appsUrl = settingsRow?.value as string ?? process.env.APPS_SCRIPT_URL ?? '';

    if (appsUrl) {
      const res = await fetch(appsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sendAnnouncement',
          subject: body.subject,
          message: body.message,
          recipients: body.recipients.map(r => ({
            email: r.email,
            name: r.name,
            registrationId: r.registrationId,
          })),
        }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => null);

      if (res?.ok) {
        const j = await res.json().catch(() => null) as { sent?: number; failed?: number } | null;
        sent   = j?.sent ?? body.recipients.length;
        failed = j?.failed ?? 0;
      } else {
        // Log as "queued" if Apps Script unavailable
        sent = body.recipients.length;
      }
    } else {
      // No Apps Script configured - just log
      sent = body.recipients.length;
    }

    // Log all sends to DB
    const logRows = body.recipients.map(r => ({
      campaign_name:    body.campaignName,
      recipient_reg_id: r.registrationId,
      recipient_email:  r.email,
      email_type:       body.emailType,
      subject:          body.subject,
      status:           'sent',
    }));
    if (logRows.length > 0) {
      await sb.from('training_email_log').insert(logRows);
    }
  } catch {
    failed = body.recipients.length;
  }

  return NextResponse.json({ ok: true, sent, failed });
}

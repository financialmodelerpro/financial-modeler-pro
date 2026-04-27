import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { sendTestEmail } from '@/src/lib/newsletter/sender';
import { getTemplate, renderTemplate, type TemplateVars } from '@/src/lib/newsletter/templates';

interface TestBody {
  subject?: string;
  body?: string;
  templateKey?: string;
  templateVars?: TemplateVars;
  /** Override target email - falls back to the admin's session email. */
  toEmail?: string;
  hub?: 'training' | 'modeling' | 'all';
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const adminEmail = (session?.user as { email?: string; role?: string } | undefined);
  if (adminEmail?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let payload: TestBody;
  try { payload = await req.json() as TestBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let subject = payload.subject?.trim() ?? '';
  let body = payload.body ?? '';

  if (payload.templateKey) {
    const tpl = await getTemplate(payload.templateKey);
    if (!tpl) return NextResponse.json({ error: `Template not found: ${payload.templateKey}` }, { status: 404 });
    const rendered = renderTemplate(tpl, payload.templateVars ?? {});
    subject = rendered.subject;
    body = rendered.body;
  }

  if (!subject || !body) {
    return NextResponse.json({ error: 'subject and body (or templateKey) required' }, { status: 400 });
  }

  const toEmail = (payload.toEmail ?? adminEmail?.email ?? '').trim();
  if (!toEmail) return NextResponse.json({ error: 'No target email' }, { status: 400 });

  // Use a synthetic unsubscribe token for the test send (not a real
  // subscriber token - test sends should not link to a real unsub flow).
  const result = await sendTestEmail({
    toEmail,
    subject,
    body,
    hub: payload.hub ?? 'training',
    unsubscribeToken: '00000000-0000-0000-0000-000000000000',
  });

  if (!result.ok) return NextResponse.json({ error: result.error ?? 'send failed' }, { status: 500 });
  return NextResponse.json({ ok: true, sentTo: toEmail });
}

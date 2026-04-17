import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return new NextResponse(htmlPage('Invalid unsubscribe link', 'No token provided.'), { headers: { 'Content-Type': 'text/html' } });
  }

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('newsletter_subscribers')
      .select('id, email, hub, status')
      .eq('unsubscribe_token', token)
      .maybeSingle();

    if (!data) {
      return new NextResponse(htmlPage('Link Not Found', 'This unsubscribe link is invalid or has already been used.'), { headers: { 'Content-Type': 'text/html' } });
    }

    if (data.status === 'unsubscribed') {
      return new NextResponse(htmlPage('Already Unsubscribed', `You've already been unsubscribed from the ${data.hub} newsletter.`), { headers: { 'Content-Type': 'text/html' } });
    }

    await sb.from('newsletter_subscribers').update({
      status: 'unsubscribed',
      unsubscribed_at: new Date().toISOString(),
    }).eq('id', data.id);

    return new NextResponse(
      htmlPage('Unsubscribed', `You've been unsubscribed from the <strong>${data.hub}</strong> newsletter. You can resubscribe anytime at <a href="https://financialmodelerpro.com" style="color:#1B4F8A;">financialmodelerpro.com</a>.`),
      { headers: { 'Content-Type': 'text/html' } },
    );
  } catch {
    return new NextResponse(htmlPage('Error', 'Something went wrong. Please try again later.'), { headers: { 'Content-Type': 'text/html' } });
  }
}

function htmlPage(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Financial Modeler Pro</title></head>
<body style="font-family:Inter,-apple-system,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
<div style="background:#fff;border-radius:16px;padding:40px;max-width:420px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
<h1 style="font-size:22px;color:#0D2E5A;margin:0 0 12px;">${title}</h1>
<p style="font-size:15px;color:#6B7280;line-height:1.6;margin:0;">${body}</p>
</div></body></html>`;
}

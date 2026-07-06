import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { getInvoicePdfUrl, listSubscriptionInvoices } from '@/src/shared/payments/paddleApi';
import { loadPaymentSettings, providerConfigFrom } from '@/src/shared/payments/config';
import { userOwnsPaddleTransaction } from '@/src/shared/payments/manualInvoice';

// GET /api/payments/invoice/[id]?platform=<slug>
// Redirects to the Paddle-hosted, signed invoice/receipt PDF for one of the
// signed-in user's transactions. The Paddle API key is used server-side only;
// the client receives a 302 to the time-limited Paddle URL. The billing tab
// EMBEDS this route in an in-dashboard iframe (PDF renders inline, no forced
// download); a Download button opens the same route in a new tab.
//
// OWNERSHIP: the transaction id must belong to THIS user. It is verified from the
// DURABLE payment_transactions ledger (so a HISTORICAL Paddle invoice stays
// viewable AFTER a cancel / convert / source flip, when there is no live
// subscription to list against), with a live-subscription list as a fallback for
// a very recent transaction not yet in the ledger. If Paddle cannot produce the
// PDF, a 404 is returned so the billing tab simply shows the row without a working
// link (no crash).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || DEFAULT_PAYMENTS_PLATFORM;
  const sb = getServerClient();

  // Primary ownership: the durable ledger (survives source flips).
  let owns = await userOwnsPaddleTransaction(sb, userId, platform, id);
  // Fallback: a live subscription's current transactions (recent, pre-ledger).
  const pctx = await loadUserPaddleContext(sb, userId, platform);
  if (!owns && pctx.state === 'ok' && pctx.subscriptionId) {
    const list = await listSubscriptionInvoices(pctx.cfg, pctx.subscriptionId);
    owns = list.ok && list.data.some((inv) => inv.transactionId === id);
  }
  if (!owns) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Build the Paddle config independently of a live subscription so historical
  // invoices remain fetchable by transaction id after the sub is gone.
  const settings = await loadPaymentSettings(sb, platform);
  const cfg = providerConfigFrom(settings, 'paddle');
  if (!cfg.apiKey) return NextResponse.json({ error: 'not_configured' }, { status: 404 });

  const res = await getInvoicePdfUrl(cfg, id);
  if (!res.ok) {
    // Paddle cannot produce the PDF (e.g. old/unavailable): 404, no crash; the
    // list still shows the row (from the ledger) without a working link.
    return NextResponse.json({ error: res.error }, { status: res.status >= 500 ? 502 : 404 });
  }
  // PROXY the PDF bytes so we control the disposition. A 302 to Paddle's hosted URL
  // serves the PDF as an ATTACHMENT, which makes the in-dashboard iframe trigger a
  // download and render blank. Fetching + re-serving with Content-Disposition
  // inline lets the iframe PREVIEW it; ?download=1 (the Download button) forces the
  // save. The Paddle URL is fetched server-side, so the API key never leaks.
  const download = req.nextUrl.searchParams.get('download') === '1';
  const pdf = await fetch(res.data, { cache: 'no-store' });
  if (!pdf.ok) return NextResponse.json({ error: 'pdf_unavailable' }, { status: 502 });
  const buf = Buffer.from(await pdf.arrayBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="invoice-${id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

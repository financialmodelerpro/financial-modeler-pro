import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadOwnedManualInvoice, signManualInvoiceUrl } from '@/src/shared/payments/manualInvoice';

// GET /api/payments/manual-invoice/[id]
// Redirects to a short-lived signed URL for the signed-in user's manual receipt
// PDF (mig 182), stored in the PRIVATE 'invoices' bucket. The billing tab embeds
// this route in an iframe (renders inline) and a Download button opens it in a
// new tab, mirroring the Paddle invoice route.
//
// OWNERSHIP: the manual_invoices row is verified to belong to THIS user before
// any signed URL is issued, so a user can only ever fetch their own receipts.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = getServerClient();
  const owned = await loadOwnedManualInvoice(sb, id, userId);
  if (!owned) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const url = await signManualInvoiceUrl(sb, owned.storagePath);
  if (!url) return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  // PROXY the PDF bytes with Content-Disposition inline so the in-dashboard iframe
  // PREVIEWS it (a 302 to the signed URL serves it as an attachment, which makes
  // the iframe download + render blank). ?download=1 (the Download button) forces
  // the save. The signed URL is fetched server-side.
  const download = req.nextUrl.searchParams.get('download') === '1';
  const pdf = await fetch(url, { cache: 'no-store' });
  if (!pdf.ok) return NextResponse.json({ error: 'unavailable' }, { status: 502 });
  const buf = Buffer.from(await pdf.arrayBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="receipt-${id}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

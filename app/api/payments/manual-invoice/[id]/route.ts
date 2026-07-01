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
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
  return NextResponse.redirect(url, 302);
}

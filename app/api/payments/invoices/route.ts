import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { loadUserPaddleContext, DEFAULT_PAYMENTS_PLATFORM } from '@/src/shared/payments/subscriptionContext';
import { listSubscriptionInvoices } from '@/src/shared/payments/paddleApi';
import { recordPaymentTransaction } from '@/src/shared/payments/config';
import { listManualInvoices, listPaddleLedgerInvoices, type NormalizedInvoice } from '@/src/shared/payments/manualInvoice';

// GET /api/payments/invoices
// Lists ALL of the signed-in user's invoices / receipts for a platform, ALL TIME,
// REGARDLESS of the CURRENT source: manual (offline) receipts (mig 182) AND Paddle
// transactions from the DURABLE payment_transactions ledger (mig 180). The ledger
// is the source of truth for Paddle history because it PERSISTS across a cancel /
// convert / source flip (the live Paddle API only returns the current
// subscription's transactions, so it loses history once the sub is gone). When a
// live subscription exists we ALSO fetch the live list and merge it (deduped by
// transaction id, live wins for the invoice number). Newest first. Each row is
// { id, source, billedAt, number, amountMinor, currency }; PDFs are served on
// demand via /api/payments/invoice/[id] (Paddle) or /api/payments/manual-invoice/[id]
// (manual), both ownership-checked server-side.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = (session.user as { id?: string }).id ?? '';
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const platform = req.nextUrl.searchParams.get('platform') || DEFAULT_PAYMENTS_PLATFORM;
  const sb = getServerClient();

  // Manual receipts (durable, per user+platform; survive any source flip).
  const manual = await listManualInvoices(sb, userId, platform);

  // Paddle history from the DURABLE ledger (survives cancel/convert/source flip).
  const byId = new Map<string, NormalizedInvoice>();
  for (const inv of await listPaddleLedgerInvoices(sb, userId, platform)) byId.set(inv.id, inv);

  // Enrich/refresh with the LIVE Paddle list when a subscription is active (better
  // invoice numbers + any very recent txn not yet in the ledger). Deduped by id.
  const ctx = await loadUserPaddleContext(sb, userId, platform);
  if (ctx.state === 'ok' && ctx.subscriptionId) {
    const res = await listSubscriptionInvoices(ctx.cfg, ctx.subscriptionId);
    if (res.ok) {
      for (const inv of res.data) {
        byId.set(inv.transactionId, {
          id: inv.transactionId, source: 'paddle', billedAt: inv.billedAt,
          number: inv.invoiceNumber ?? inv.transactionId, amountMinor: inv.amountMinor, currency: inv.currency,
        });
        // Self-heal the DURABLE ledger from this live read so the Paddle history
        // SURVIVES a later cancel / convert-to-manual (the webhook's
        // transaction.completed may not have fired in sandbox, which is why the
        // history vanished once the live sub was gone). Idempotent on the
        // transaction id; only settled transactions so revenue is not inflated.
        if ((inv.status === 'completed' || inv.status === 'paid') && inv.amountMinor !== null) {
          await recordPaymentTransaction(sb, {
            source: 'paddle', externalId: inv.transactionId, userId, platform,
            planKey: ctx.planKey ?? null, amountMinor: inv.amountMinor, currency: inv.currency,
            status: 'completed', billedAt: inv.billedAt,
          });
        }
      }
    }
  }

  const invoices = [...byId.values(), ...manual].sort((a, b) => {
    const ta = a.billedAt ? Date.parse(a.billedAt) : 0;
    const tb = b.billedAt ? Date.parse(b.billedAt) : 0;
    return tb - ta; // newest first
  });

  return NextResponse.json({ invoices });
}

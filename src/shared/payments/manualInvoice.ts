/**
 * payments/manualInvoice.ts (SERVER ONLY)
 *
 * FMP-branded receipts for MANUAL (offline / bank) payments. When an admin
 * assigns/renews a manual plan with an amount, the server:
 *   1. builds a branded receipt PDF (pdf-lib, no external assets),
 *   2. stores it in the PRIVATE 'invoices' storage bucket keyed by user id,
 *   3. records a manual_invoices row (mig 182),
 * and returns the PDF bytes so the caller can also email it.
 *
 * The PDF is only ever served through /api/payments/manual-invoice/[id], which
 * verifies ownership and returns a short-lived signed URL (the bucket is private,
 * so a user can only ever see their own receipts). This module makes NO
 * entitlement decisions and never writes plan/gate state.
 *
 * No em dashes in this file.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const BUCKET = 'invoices';
const NAVY = rgb(0.122, 0.220, 0.392);   // #1F3864
const MUTED = rgb(0.42, 0.45, 0.50);
const TEXT = rgb(0.10, 0.12, 0.16);
const WHITE = rgb(1, 1, 1);

/** A row normalized for the combined billing-tab invoice list. */
export interface NormalizedInvoice {
  id: string;
  source: 'paddle' | 'manual';
  billedAt: string | null;
  number: string | null;
  amountMinor: number | null;
  currency: string | null;
}

function money(amountMinor: number | null, currency: string | null): string {
  if (amountMinor == null || !Number.isFinite(amountMinor)) return '';
  const major = (amountMinor / 100).toFixed(2);
  return currency ? `${currency.toUpperCase()} ${major}` : major;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function planLabel(planKey: string | null): string {
  const k = (planKey ?? '').trim();
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Plan';
}

/** The plan coverage period line for the receipt line item, or '' when unknown. */
function fmtPeriod(start: string | null | undefined, end: string | null | undefined): string {
  const s = fmtDate(start ?? null);
  const e = fmtDate(end ?? null);
  if (s && e) return `Period: ${s} to ${e}`;
  if (s) return `Period from ${s}`;
  return '';
}

/**
 * PaceMakers' legal seller details, shown on the receipt for identification. The
 * FBR NTN is IDENTIFICATION ONLY: no tax is charged and no tax line is rendered.
 */
const SELLER_LINES: Array<{ s: string; bold?: boolean; size?: number }> = [
  { s: 'PaceMakers Business Consultants LLP', bold: true, size: 10.5 },
  { s: 'LLP Registration No: 0200688', size: 9 },
  { s: '71-C-3, Gulberg III, Lahore, 54660,', size: 9 },
  { s: 'Punjab, Pakistan', size: 9 },
  { s: 'FBR NTN: 6899301', size: 9 },
];

/** A stable, human-facing receipt number: FMP-YYYYMMDD-XXXXXX. */
export function makeReceiptNumber(issuedAtIso: string): string {
  const d = new Date(issuedAtIso);
  const day = (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10).replace(/-/g, '');
  const rand = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
  return `FMP-${day}-${rand}`;
}

export interface ReceiptData {
  receiptNumber: string;
  issuedAt: string;
  planKey: string | null;
  amountMinor: number;
  currency: string | null;
  customerName: string | null;
  customerEmail: string;
  customerCompany?: string | null;
  /** Plan coverage window (manual plan started_at / expires_at), for the line item. */
  periodStart?: string | null;
  periodEnd?: string | null;
}

/** Build the branded receipt PDF (A4 portrait). Text-only branding (FMP +
 *  PaceMakers), matching how the platform PDFs render the company line. */
export async function generateManualReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 portrait
  const W = page.getWidth();
  const H = page.getHeight();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const MARGIN = 48;

  const text = (s: string, x: number, y: number, size: number, opts?: { font?: typeof font; color?: typeof TEXT; align?: 'left' | 'right' }) => {
    const f = opts?.font ?? font;
    const w = f.widthOfTextAtSize(s, size);
    const tx = opts?.align === 'right' ? x - w : x;
    page.drawText(s, { x: tx, y, size, font: f, color: opts?.color ?? TEXT });
  };

  // Header band.
  const bandH = 96;
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: NAVY });
  text('Financial Modeler Pro', MARGIN, H - 42, 18, { font: bold, color: WHITE });
  text('A PaceMakers Business Consultants Platform', MARGIN, H - 62, 10, { color: rgb(0.80, 0.85, 0.92) });
  text('financialmodelerpro.com', MARGIN, H - 78, 9, { color: rgb(0.80, 0.85, 0.92) });
  text('RECEIPT', W - MARGIN, H - 50, 22, { font: bold, color: WHITE, align: 'right' });

  const topY = H - bandH - 40;
  const colR = W - MARGIN - 190;
  const label = (s: string, x: number, yy: number) => text(s.toUpperCase(), x, yy, 8, { font: bold, color: MUTED });

  // Seller (legal details, left) + receipt meta (right), same top line.
  label('Seller', MARGIN, topY);
  let ly = topY - 15;
  for (const ln of SELLER_LINES) {
    text(ln.s, MARGIN, ly, ln.size ?? 9, { font: ln.bold ? bold : font, color: TEXT });
    ly -= 14;
  }

  label('Receipt number', colR, topY);
  text(data.receiptNumber, colR, topY - 15, 11, { font, color: TEXT });
  label('Date issued', colR, topY - 40);
  text(fmtDate(data.issuedAt) || '-', colR, topY - 55, 11, { font, color: TEXT });

  // Continue below the taller (seller) column.
  let y = ly - 12;

  // Bill-to.
  label('Billed to', MARGIN, y);
  text(data.customerName || data.customerEmail, MARGIN, y - 15, 11, { font, color: TEXT });
  let by = y - 29;
  text(data.customerEmail, MARGIN, by, 10, { color: MUTED });
  if (data.customerCompany) { by -= 14; text(data.customerCompany, MARGIN, by, 10, { color: MUTED }); }
  y = by - 30;

  // Line item (plan + period + amount).
  const tableY = y;
  page.drawRectangle({ x: MARGIN, y: tableY - 4, width: W - 2 * MARGIN, height: 26, color: rgb(0.94, 0.96, 0.98) });
  text('DESCRIPTION', MARGIN + 10, tableY + 5, 8, { font: bold, color: MUTED });
  text('AMOUNT', W - MARGIN - 10, tableY + 5, 8, { font: bold, color: MUTED, align: 'right' });
  y = tableY - 24;
  text(`${planLabel(data.planKey)} plan (offline / bank payment)`, MARGIN + 10, y, 11, { font });
  text(money(data.amountMinor, data.currency), W - MARGIN - 10, y, 11, { font: bold, align: 'right' });
  const period = fmtPeriod(data.periodStart, data.periodEnd);
  if (period) { y -= 14; text(period, MARGIN + 10, y, 9, { color: MUTED }); }
  y -= 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: W - MARGIN, y }, thickness: 1, color: rgb(0.88, 0.90, 0.93) });
  // No tax is charged on this receipt; the space below the line item is left
  // clean so a tax line could be added later, but none is rendered now.
  y -= 24;
  text('Total paid', W - MARGIN - 140, y, 11, { font: bold, color: MUTED });
  text(money(data.amountMinor, data.currency), W - MARGIN - 10, y, 13, { font: bold, color: NAVY, align: 'right' });

  // Footer.
  text('This receipt records a payment processed offline by the Financial Modeler Pro team.', MARGIN, 64, 9, { color: MUTED });
  text('Financial Modeler Pro  |  A PaceMakers Business Consultants Platform  |  financialmodelerpro.com', MARGIN, 48, 8, { color: MUTED });

  return doc.save();
}

/** Ensure the private 'invoices' bucket exists, then upload the receipt bytes.
 *  Idempotent (upsert). Returns the storage path. */
async function uploadReceipt(sb: SupabaseClient, path: string, bytes: Uint8Array): Promise<void> {
  const buf = Buffer.from(bytes);
  const first = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
  if (first.error) {
    const msg = first.error.message.toLowerCase();
    if (msg.includes('bucket') || msg.includes('not found')) {
      await sb.storage.createBucket(BUCKET, { public: false });
      const retry = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'application/pdf', upsert: true });
      if (retry.error) throw new Error(retry.error.message);
    } else {
      throw new Error(first.error.message);
    }
  }
}

export interface IssuedManualInvoice {
  id: string;
  receiptNumber: string;
  storagePath: string;
  pdfBytes: Uint8Array;
}

/**
 * Generate + store a manual receipt and record the manual_invoices row. Returns
 * the row id + receipt number + PDF bytes (so the caller can attach the PDF to a
 * receipt email). Throws on failure so the caller can decide to swallow.
 */
export async function createAndStoreManualInvoice(
  sb: SupabaseClient,
  args: { userId: string; platform: string; planKey: string | null; amountMinor: number; currency: string | null; issuedAt: string; customerName: string | null; customerEmail: string; customerCompany?: string | null; periodStart?: string | null; periodEnd?: string | null },
): Promise<IssuedManualInvoice> {
  const receiptNumber = makeReceiptNumber(args.issuedAt);
  const pdfBytes = await generateManualReceiptPdf({
    receiptNumber, issuedAt: args.issuedAt, planKey: args.planKey,
    amountMinor: args.amountMinor, currency: args.currency,
    customerName: args.customerName, customerEmail: args.customerEmail,
    customerCompany: args.customerCompany ?? null,
    periodStart: args.periodStart ?? null, periodEnd: args.periodEnd ?? null,
  });
  const storagePath = `${args.userId}/${receiptNumber}.pdf`;
  await uploadReceipt(sb, storagePath, pdfBytes);

  const { data, error } = await sb.from('manual_invoices').insert({
    receipt_number: receiptNumber,
    user_id: args.userId,
    platform_slug: args.platform,
    plan_key: args.planKey,
    amount_minor: args.amountMinor,
    currency: args.currency,
    issued_at: args.issuedAt,
    storage_path: storagePath,
  }).select('id').single();
  if (error) throw new Error(error.message);

  return { id: (data as { id: string }).id, receiptNumber, storagePath, pdfBytes };
}

/** List the user's manual receipts for a platform, normalized for the combined
 *  invoice list. Best effort: a missing table (pre mig 182) yields []. */
export async function listManualInvoices(
  sb: SupabaseClient, userId: string, platform: string,
): Promise<NormalizedInvoice[]> {
  try {
    const { data, error } = await sb
      .from('manual_invoices')
      .select('id, receipt_number, amount_minor, currency, issued_at')
      .eq('user_id', userId).eq('platform_slug', platform)
      .order('issued_at', { ascending: false });
    if (error || !data) return [];
    return (data as Array<{ id: string; receipt_number: string; amount_minor: number; currency: string | null; issued_at: string }>)
      .map((r) => ({ id: r.id, source: 'manual' as const, billedAt: r.issued_at, number: r.receipt_number, amountMinor: r.amount_minor, currency: r.currency }));
  } catch {
    return [];
  }
}

/**
 * The user's DURABLE Paddle invoice history from the payment_transactions ledger
 * (mig 180), normalized for the combined list. Unlike the live Paddle API (which
 * only returns the CURRENT subscription's transactions), the ledger persists every
 * completed Paddle transaction permanently, so history SURVIVES a cancel / convert
 * / source flip. Best effort: a missing table (pre mig 180) yields [].
 */
export async function listPaddleLedgerInvoices(
  sb: SupabaseClient, userId: string, platform: string,
): Promise<NormalizedInvoice[]> {
  try {
    const { data, error } = await sb
      .from('payment_transactions')
      .select('external_id, amount_minor, currency, billed_at')
      .eq('user_id', userId).eq('platform_slug', platform).eq('source', 'paddle')
      .order('billed_at', { ascending: false });
    if (error || !data) return [];
    return (data as Array<{ external_id: string | null; amount_minor: number | null; currency: string | null; billed_at: string | null }>)
      .filter((r) => !!r.external_id)
      .map((r) => ({ id: r.external_id as string, source: 'paddle' as const, billedAt: r.billed_at, number: r.external_id, amountMinor: r.amount_minor, currency: r.currency }));
  } catch {
    return [];
  }
}

/** Whether a Paddle transaction id belongs to the user (ownership from the durable
 *  ledger, so historical Paddle invoices stay authorizable after a source flip,
 *  when no live subscription exists to list against). Best effort -> false. */
export async function userOwnsPaddleTransaction(
  sb: SupabaseClient, userId: string, platform: string, txnId: string,
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from('payment_transactions')
      .select('id')
      .eq('user_id', userId).eq('platform_slug', platform).eq('source', 'paddle').eq('external_id', txnId)
      .maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

/** Load a manual invoice row IF it belongs to the user (ownership check). */
export async function loadOwnedManualInvoice(
  sb: SupabaseClient, id: string, userId: string,
): Promise<{ storagePath: string } | null> {
  try {
    const { data, error } = await sb
      .from('manual_invoices')
      .select('user_id, storage_path')
      .eq('id', id).maybeSingle();
    if (error || !data) return null;
    const row = data as { user_id: string; storage_path: string };
    if (row.user_id !== userId) return null;
    return { storagePath: row.storage_path };
  } catch {
    return null;
  }
}

/** A short-lived signed URL for a private receipt PDF. */
export async function signManualInvoiceUrl(sb: SupabaseClient, storagePath: string): Promise<string | null> {
  try {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 120);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

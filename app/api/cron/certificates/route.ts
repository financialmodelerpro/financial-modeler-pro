/**
 * GET /api/cron/certificates
 * Called by Vercel cron every 15 minutes.
 * Secured by CRON_SECRET Authorization header.
 */

import { NextRequest } from 'next/server';
import { processPendingCertificates } from '@/src/lib/training/certificateEngine';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min max for PDF generation

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processPendingCertificates();
    console.log(`[cron/certificates] processed=${result.processed} errors=${result.errors.length}`);
    return Response.json(result);
  } catch (e) {
    console.error('[cron/certificates]', e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

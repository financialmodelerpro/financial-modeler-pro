/**
 * GET /api/export/watermark (2026-08-20)
 *
 * Resolves whether THIS caller's export is watermarked, and with what text.
 *
 * THE CLIENT NEVER SENDS ITS PLAN. The live PDF export is generated in the
 * browser, so if the browser also decided whether to stamp it, the answer
 * would be a value sitting in client memory. It resolves the session's plan
 * server side through the same `resolveUserGate` the rest of the gate uses,
 * and returns a decision the client can only obey or fail on. There is no
 * request body and no query parameter, on purpose: there is nothing for a
 * caller to vary.
 *
 * WHAT THIS DOES NOT CLAIM. A client-side PDF builder cannot be made
 * tamper-proof against somebody running the app's own code in devtools. What
 * this does guarantee is that the product offers no way to turn the mark off,
 * that the decision is not a client-side flag, that a failure to resolve
 * REFUSES the export rather than producing an unmarked file, and that the
 * server-side export routes stamp independently of anything the browser did.
 *
 * No em dashes in this file.
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { resolveUserGate } from '@/src/shared/entitlements/resolveUser';
import { resolveWatermarkForGate } from '@/src/shared/entitlements/watermarkServer';

export async function GET() {
  let session;
  try {
    session = await getServerSession(authOptions);
  } catch {
    // getServerSession throws without a request scope (TRAPS 9.4). Treated as
    // unresolved, which the client turns into a refusal, not into a clean PDF.
    return NextResponse.json({ error: 'unresolved' }, { status: 503 });
  }
  const u = session?.user as { id?: string; role?: string } | undefined;
  if (!u?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  try {
    const gate = await resolveUserGate(u.id, { sessionIsAdmin: u.role === 'admin' });
    // Plan, not privilege. An admin sitting on a listed plan is stamped too,
    // which is the only way to check the setting before enabling it.
    const spec = await resolveWatermarkForGate(gate);
    return NextResponse.json({ planKey: gate.planKey, watermark: spec });
  } catch {
    return NextResponse.json({ error: 'unresolved' }, { status: 503 });
  }
}

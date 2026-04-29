import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/training-settings/model-submission-gate
 *
 * Audit-logged write for the three soft-launch flags that drive the
 * model-submission gate (migration 148):
 *   - model_submission_announcement_only
 *   - model_submission_required_3sfm
 *   - model_submission_required_bvm
 *
 * Body: { key: string, value: 'true' | 'false' }
 *
 * Why a dedicated endpoint instead of POST /api/admin/training-settings?
 * The generic settings endpoint accepts arbitrary key/value pairs and
 * does NOT write to admin_audit_log. Flipping required_<course>='true'
 * is a real cutover decision affecting every enrolled student, so it
 * deserves its own audit trail with action='model_submission_gate_change'
 * + before/after values. Other settings in this table are bookkeeping
 * (Apps Script URL, watch threshold, etc.) and do not need that.
 *
 * Response: { ok: true, key, value, before } on success.
 */

const ALLOWED_KEYS = new Set([
  'model_submission_announcement_only',
  'model_submission_required_3sfm',
  'model_submission_required_bvm',
]);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as { role?: string }).role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const adminUser = session.user as { id?: string; email?: string };
  const adminId = adminUser.id ?? null;
  const adminEmail = adminUser.email ?? null;

  const body = await req.json().catch(() => ({})) as { key?: string; value?: string };
  const key = (body.key ?? '').trim();
  const value = (body.value ?? '').trim();

  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json({
      error: 'invalid_key',
      message: `key must be one of: ${[...ALLOWED_KEYS].join(', ')}`,
    }, { status: 400 });
  }
  if (value !== 'true' && value !== 'false') {
    return NextResponse.json({
      error: 'invalid_value',
      message: 'value must be "true" or "false"',
    }, { status: 400 });
  }

  const sb = getServerClient();

  // Read the current value so the audit log captures the transition.
  // Missing row counts as the implicit default (announcement_only seed
  // is 'true', required_<course> seeds are 'false' per migration 148).
  const { data: existing } = await sb
    .from('training_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  const before = (existing?.value as string | null) ?? null;

  // No-op when the value isn't actually changing. We still return ok so
  // double-clicks from the UI don't surface as errors.
  if (before === value) {
    return NextResponse.json({ ok: true, key, value, before, noop: true });
  }

  const { error: upsertErr } = await sb
    .from('training_settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (upsertErr) {
    console.error('[model-submission-gate POST] upsert failed:', upsertErr);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // Audit. Failure logs but does NOT unwind the upsert; the row is the
  // source of truth, the audit log is observability. Mirrors the
  // pattern used by the watch_force_complete + model_submission_review
  // endpoints from earlier phases.
  const { error: auditErr } = await sb.from('admin_audit_log').insert({
    admin_id: adminId,
    action: 'model_submission_gate_change',
    before_value: { key, value: before },
    after_value: {
      key,
      value,
      admin_email: adminEmail,
    },
  });
  if (auditErr) {
    console.error('[model-submission-gate POST] audit insert failed:', auditErr.message);
  }

  console.log('[model-submission-gate]', { key, before, value, by: adminEmail });

  return NextResponse.json({ ok: true, key, value, before });
}

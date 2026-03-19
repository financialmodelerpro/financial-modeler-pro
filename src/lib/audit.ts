/**
 * audit.ts — Server-side helper to write admin audit log entries.
 * Import in API routes only (uses service-role Supabase client).
 */

import { getServerClient } from '@/src/lib/supabase';

interface AuditEntry {
  adminId: string;
  action: string;
  targetUserId?: string | null;
  beforeValue?: Record<string, unknown> | null;
  afterValue?: Record<string, unknown> | null;
  reason?: string | null;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const db = getServerClient();
    await db.from('admin_audit_log').insert({
      admin_id:       entry.adminId,
      action:         entry.action,
      target_user_id: entry.targetUserId ?? null,
      before_value:   entry.beforeValue  ?? null,
      after_value:    entry.afterValue   ?? null,
      reason:         entry.reason       ?? null,
    });
  } catch {
    // Audit log failures must never break the main operation
  }
}

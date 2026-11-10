/**
 * The real announcement sender and allowance (server only): Brevo through the
 * one send path, counted as ANNOUNCEMENT emails, within today's budget.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmailPerRecipient, FROM } from '@/src/shared/email/sendEmail';
import { todayUsage, announcementAllowance } from '@/src/shared/email/emailBudget';
import type { QueueDeps } from './queue';

export function realQueueDeps(sb: SupabaseClient): QueueDeps {
  return {
    allowance: async () => announcementAllowance(await todayUsage(sb)),
    send: (items) => sendEmailPerRecipient(items.map((i) => ({ ...i, from: i.from ?? FROM.training })), { kind: 'announcement' }),
  };
}

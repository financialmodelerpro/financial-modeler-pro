/**
 * Sends emails using CMS-managed templates from email_templates table.
 * Fetches template by key, replaces placeholders, wraps in branded base, sends via Resend.
 */

import { getServerClient } from '@/src/lib/shared/supabase';
import { sendEmail, FROM } from './sendEmail';
import { baseLayoutBranded } from './templates/_base';

// ── Placeholder replacement ────────────────────────────────────────────────

function replacePlaceholders(text: string, placeholders: Record<string, string>): string {
  let result = text;

  // Replace simple {{key}} placeholders
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value ?? '');
  }

  // Handle conditional blocks: {{#key}}...content...{{/key}}
  // Show block only if placeholder value is truthy (non-empty)
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    const val = placeholders[key];
    return val && val.trim() ? replacePlaceholders(content, placeholders) : '';
  });

  // Clean up any remaining unreplaced placeholders
  result = result.replace(/\{\{[a-z_]+\}\}/g, '');

  return result;
}

// ── Main send function ─────────────────────────────────────────────────────

export async function sendTemplatedEmail(params: {
  templateKey: string;
  recipients: Array<{ email: string; name: string }>;
  placeholders: Record<string, string>;
  fromAddress?: string;
}): Promise<{ sent: number; failed: number }> {
  const { templateKey, recipients, placeholders, fromAddress } = params;

  if (recipients.length === 0) return { sent: 0, failed: 0 };

  // Fetch template
  const sb = getServerClient();
  const { data: template } = await sb
    .from('email_templates')
    .select('*')
    .eq('template_key', templateKey)
    .single();

  if (!template) {
    console.error(`[sendTemplatedEmail] Template not found: ${templateKey}`);
    return { sent: 0, failed: recipients.length };
  }

  if (!template.is_active) {
    console.log(`[sendTemplatedEmail] Template disabled: ${templateKey}`);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const from = fromAddress ?? FROM.training;

  // Send in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (recipient) => {
      try {
        // Per-recipient placeholders (student_name varies)
        const mergedPlaceholders = {
          ...placeholders,
          student_name: recipient.name || 'Student',
        };

        const subject = replacePlaceholders(template.subject, mergedPlaceholders);
        const bodyHtml = replacePlaceholders(template.body_html, mergedPlaceholders);
        const fullHtml = await baseLayoutBranded(bodyHtml);

        await sendEmail({ to: recipient.email, subject, html: fullHtml, from });
        sent++;
      } catch (err) {
        console.error(`[sendTemplatedEmail] Failed to send to ${recipient.email}:`, err);
        failed++;
      }
    });

    await Promise.allSettled(promises);
  }

  console.log(`[sendTemplatedEmail] key=${templateKey} sent=${sent} failed=${failed}`);
  return { sent, failed };
}

// ── Helper: build session placeholders from a live_sessions row ────────────

export function buildSessionPlaceholders(session: {
  id: string;
  title: string;
  description?: string;
  scheduled_datetime?: string;
  timezone?: string;
  duration_minutes?: number;
  instructor_name?: string;
  live_url?: string;
  youtube_url?: string;
  registration_count?: number;
}): Record<string, string> {
  const mainUrl = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
  const learnUrl = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

  let sessionDate = '';
  let sessionTime = '';
  if (session.scheduled_datetime) {
    try {
      const d = new Date(session.scheduled_datetime);
      sessionDate = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      sessionTime = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch { /* leave empty */ }
  }

  const dur = session.duration_minutes;
  const durationStr = dur
    ? (dur >= 60 ? `${Math.floor(dur / 60)}h ${dur % 60 > 0 ? `${dur % 60}min` : ''}`.trim() : `${dur} min`)
    : '';

  return {
    session_title: session.title ?? '',
    session_date: sessionDate,
    session_time: sessionTime,
    session_timezone: session.timezone ?? '',
    session_duration: durationStr,
    session_description: (session.description ?? '').slice(0, 200),
    instructor_name: session.instructor_name ?? '',
    join_url: session.live_url ?? '',
    view_url: `${learnUrl}/training-sessions/${session.id}`,
    youtube_url: session.youtube_url ?? '',
    registration_count: String(session.registration_count ?? 0),
  };
}

/**
 * Newsletter template engine - single source of truth for both manual
 * compose (Newsletter tab Compose) and auto-notify (autoNotify.ts) paths.
 *
 * Templates are stored in `newsletter_templates` (migration 143). Each
 * template has a `subject_template` and `body_html` with `{token}` markers
 * that are interpolated at send time. Variables are case-sensitive; missing
 * variables render as empty string (not the literal `{token}`) so partial
 * data does not produce ugly placeholders in the email.
 */
import { getServerClient } from '@/src/core/db/supabase';

export interface NewsletterTemplate {
  id: string;
  template_key: string;
  name: string;
  subject_template: string;
  body_html: string;
  event_type: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface RenderedTemplate {
  subject: string;
  body: string;
}

export type TemplateVars = Record<string, string | number | undefined | null>;

/**
 * Per-event-type variable schema. Used by the admin UI to show which
 * tokens are valid for each template, and by the auto-notify call sites
 * to know which keys to populate.
 */
export const TEMPLATE_VARIABLES: Record<string, string[]> = {
  article_published:       ['title', 'description', 'url'],
  live_session_scheduled:  ['title', 'description', 'date', 'time', 'platform', 'url'],
  live_session_recording:  ['title', 'description', 'url'],
  new_course_session:      ['title', 'description', 'course', 'url'],
  platform_launch:         ['title', 'description', 'url'],
  new_modeling_module:     ['title', 'description', 'url'],
};

/** Substitute {token} with vars[token] (empty string for missing). */
export function interpolate(template: string, vars: TemplateVars): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

/** Fetch a single template by key. Returns null if missing or inactive. */
export async function getTemplate(templateKey: string): Promise<NewsletterTemplate | null> {
  const sb = getServerClient();
  const { data } = await sb
    .from('newsletter_templates')
    .select('*')
    .eq('template_key', templateKey)
    .eq('active', true)
    .maybeSingle();
  return (data ?? null) as NewsletterTemplate | null;
}

/** Fetch a template matched by event_type (used by auto-notify). */
export async function getTemplateByEvent(eventType: string): Promise<NewsletterTemplate | null> {
  const sb = getServerClient();
  const { data } = await sb
    .from('newsletter_templates')
    .select('*')
    .eq('event_type', eventType)
    .eq('active', true)
    .maybeSingle();
  return (data ?? null) as NewsletterTemplate | null;
}

/** List every template (admin UI). */
export async function listTemplates(): Promise<NewsletterTemplate[]> {
  const sb = getServerClient();
  const { data } = await sb
    .from('newsletter_templates')
    .select('*')
    .order('event_type', { ascending: true, nullsFirst: false })
    .order('template_key', { ascending: true });
  return (data ?? []) as NewsletterTemplate[];
}

/** Render a template against vars. Throws if the template is missing. */
export function renderTemplate(tpl: NewsletterTemplate, vars: TemplateVars): RenderedTemplate {
  return {
    subject: interpolate(tpl.subject_template, vars),
    body:    interpolate(tpl.body_html, vars),
  };
}

/** Render by event_type lookup + interpolation in one call. Returns null when no template exists. */
export async function renderForEvent(eventType: string, vars: TemplateVars): Promise<RenderedTemplate | null> {
  const tpl = await getTemplateByEvent(eventType);
  if (!tpl) return null;
  return renderTemplate(tpl, vars);
}

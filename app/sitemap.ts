import type { MetadataRoute } from 'next';
import { getServerClient } from '@/src/lib/shared/supabase';
import { PLATFORMS } from '@/src/config/platforms';

export const revalidate = 3600; // regenerate hourly

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL   ?? 'https://app.financialmodelerpro.com';

type Entry = MetadataRoute.Sitemap[number];

function s(url: string, priority: number, changeFrequency: Entry['changeFrequency'], lastModified?: Date): Entry {
  return { url, priority, changeFrequency, lastModified: lastModified ?? new Date() };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // ── Static main-domain pages ─────────────────────────────────────────────
  entries.push(
    s(`${MAIN_URL}/`,                       1.0, 'weekly'),
    s(`${MAIN_URL}/about/ahmad-din`,        0.9, 'monthly'),
    s(`${MAIN_URL}/book-a-meeting`,         0.8, 'monthly'),
    s(`${MAIN_URL}/contact`,                0.7, 'monthly'),
    s(`${MAIN_URL}/pricing`,                0.8, 'monthly'),
    s(`${MAIN_URL}/articles`,               0.9, 'weekly'),
    s(`${MAIN_URL}/training-sessions`,      0.9, 'weekly'),
    s(`${MAIN_URL}/verify`,                 0.5, 'yearly'),
    s(`${MAIN_URL}/testimonials/submit`,    0.4, 'yearly'),
  );

  // ── Training Hub landing ─────────────────────────────────────────────────
  entries.push(s(`${LEARN_URL}/training`, 0.95, 'weekly'));

  // ── Modeling Hub landing + platform pages ────────────────────────────────
  entries.push(s(`${APP_URL}/modeling`, 0.95, 'weekly'));
  for (const p of PLATFORMS) {
    entries.push(s(`${APP_URL}/modeling/${p.slug}`, p.status === 'live' ? 0.85 : 0.6, 'monthly'));
  }

  const sb = getServerClient();

  // ── Articles (published only) ────────────────────────────────────────────
  try {
    const { data: articles } = await sb
      .from('articles')
      .select('slug, updated_at, published_at')
      .eq('status', 'published');
    for (const a of articles ?? []) {
      const lm = a.updated_at ?? a.published_at ?? null;
      entries.push(s(
        `${MAIN_URL}/articles/${a.slug}`,
        0.7, 'monthly',
        lm ? new Date(lm) : undefined,
      ));
    }
  } catch { /* skip on failure */ }

  // ── Live sessions (published, both upcoming + recorded) ──────────────────
  try {
    const { data: sessions } = await sb
      .from('live_sessions')
      .select('id, updated_at, scheduled_datetime, session_type')
      .eq('is_published', true);
    for (const ls of sessions ?? []) {
      const isRecorded = ls.session_type === 'recorded';
      entries.push(s(
        `${MAIN_URL}/training-sessions/${ls.id}`,
        isRecorded ? 0.7 : 0.65,
        isRecorded ? 'monthly' : 'weekly',
        ls.updated_at ? new Date(ls.updated_at) : undefined,
      ));
    }
  } catch { /* skip on failure */ }

  // ── CMS pages (legal + custom) ───────────────────────────────────────────
  try {
    const { data: pages } = await sb
      .from('cms_pages')
      .select('slug, updated_at, status')
      .eq('status', 'published');
    for (const p of pages ?? []) {
      entries.push(s(
        `${MAIN_URL}/${p.slug}`,
        0.5, 'yearly',
        p.updated_at ? new Date(p.updated_at) : undefined,
      ));
    }
  } catch { /* skip on failure */ }

  return entries;
}

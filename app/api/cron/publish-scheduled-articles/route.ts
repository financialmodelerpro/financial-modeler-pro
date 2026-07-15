/**
 * GET /api/cron/publish-scheduled-articles
 *
 * Publishes articles whose scheduled_at has passed, so an article set to
 * "Scheduled" in the admin editor goes live on its own and appears on
 * /articles without anyone pressing Publish.
 *
 * Runs EVERY MINUTE (vercel.json), so an article is live within ~60s of its
 * scheduled time. The tick is cheap: one probe of the partial index added by
 * migration 198 (status='scheduled' AND scheduled_at <= now), which matches
 * nothing on the overwhelming majority of ticks.
 *
 * Idempotent on both effects:
 *   - The status flip re-asserts .eq('status','scheduled') as a claim guard, so
 *     two overlapping ticks cannot both publish the same row; the loser sees no
 *     updated row and skips.
 *   - sendAutoNewsletter dedupes on (source_type, source_id), so a subscriber
 *     cannot be emailed twice for one article even if the claim guard were lost.
 *
 * Secured by CRON_SECRET (same pattern as /api/cron/newsletter-scheduled).
 */
import { NextRequest } from 'next/server';
import { getServerClient } from '@/src/core/db/supabase';
import { sendAutoNewsletter } from '@/src/shared/newsletter/autoNotify';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

interface DueArticle {
  id:           string;
  title:        string;
  slug:         string;
  scheduled_at: string;
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getServerClient();
  const now = new Date().toISOString();

  const { data, error } = await sb
    .from('articles')
    .select('id, title, slug, scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .order('scheduled_at', { ascending: true })
    .limit(20);

  if (error) {
    // A missing scheduled_at column (migration 198 not yet applied) must not turn
    // the minutely cron into a minutely alert. Report it and stay quiet.
    console.error('[cron/publish-scheduled-articles] query failed:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const due = (data ?? []) as DueArticle[];
  if (due.length === 0) return Response.json({ ok: true, published: 0 });

  const results: Array<{ id: string; slug: string; published: boolean }> = [];

  for (const a of due) {
    try {
      // Claim + publish in one statement. published_at is the time the admin ASKED
      // for, not the tick that noticed it, so the article's public date reads as
      // intended rather than drifting by the cron's scheduling jitter.
      const { data: claimed, error: claimErr } = await sb
        .from('articles')
        .update({
          status:       'published',
          published_at: a.scheduled_at ?? now,
          scheduled_at: null,
          updated_at:   now,
        })
        .eq('id', a.id)
        .eq('status', 'scheduled')
        .select('id, title, slug, seo_description')
        .maybeSingle();

      if (claimErr) throw new Error(claimErr.message);
      if (!claimed) { results.push({ id: a.id, slug: a.slug, published: false }); continue; }

      void sendAutoNewsletter('article_published', claimed.id, {
        title:       claimed.title,
        description: claimed.seo_description ?? '',
        url:         `${MAIN_URL}/articles/${claimed.slug}`,
      });

      console.log(`[cron/publish-scheduled-articles] published ${claimed.slug} (due ${a.scheduled_at})`);
      results.push({ id: a.id, slug: a.slug, published: true });
    } catch (err) {
      // One bad article must not block the rest of the batch, and must not leave
      // the row stuck: it stays 'scheduled' and is retried on the next tick.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[cron/publish-scheduled-articles] publish failed for', a.slug, message);
      results.push({ id: a.id, slug: a.slug, published: false });
    }
  }

  return Response.json({
    ok: true,
    published: results.filter(r => r.published).length,
    results,
  });
}

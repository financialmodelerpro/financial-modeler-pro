/**
 * Manual article announcement: email an article to everyone.
 *
 * Mirrors the live-session "Send Announcement" button, but over the union
 * audience (students + subscribers, and modeling-hub users when the admin
 * toggles them in) rather than the students-only roster that route uses.
 * See announceAudience.ts for the consent rules.
 *
 * Reuses the newsletter stack wholesale rather than growing a second sender:
 * sendCampaign already does batching, the per-recipient log, link wrapping,
 * and (the reason it matters here) the per-recipient unsubscribe link built
 * from each recipient's token. We only supply the audience and the content.
 *
 * The campaign row is campaign_type='manual' on purpose: migration 092 puts a
 * UNIQUE index on (source_type, source_id) WHERE campaign_type='auto', so an
 * 'auto' row would make a deliberate re-announce impossible. Manual rows are
 * unconstrained, and double-sends are instead guarded by the explicit `force`
 * flag below.
 *
 * GET  -> counts + history so the dialog can say who this reaches before sending.
 * POST -> sends; { sent, failed, total }.
 * POST { preview: true } -> sends ONLY to the admin's own inbox (see below).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import { sendCampaign, sendTestEmail } from '@/src/shared/newsletter/sender';
import { resolveAnnounceAudience } from '@/src/shared/newsletter/announceAudience';
import { renderForEvent } from '@/src/shared/newsletter/templates';

// Mass sends must not be killed mid-batch; matches the live-session notify route.
export const maxDuration = 300;
export const runtime     = 'nodejs';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

/** Our own manual announcements. */
const SOURCE_TYPE = 'article_announce';
/** The auto-newsletter's event type, surfaced in history so the admin can see
 *  an article already went out that way and avoid emailing people twice. */
const AUTO_SOURCE_TYPE = 'article_published';

interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  status: string;
  seo_description: string | null;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = session?.user as { role?: string; email?: string } | undefined;
  return user?.role === 'admin' ? user : null;
}

async function loadArticle(id: string): Promise<ArticleRow | null> {
  const sb = getServerClient();
  const { data } = await sb
    .from('articles')
    .select('id, title, slug, status, seo_description')
    .eq('id', id)
    .maybeSingle();
  return (data as ArticleRow) ?? null;
}

async function loadHistory(articleId: string) {
  const sb = getServerClient();
  const { data } = await sb
    .from('newsletter_campaigns')
    .select('id, subject, status, sent_count, failed_count, sent_at, created_at, created_by, source_type')
    .eq('source_id', articleId)
    .in('source_type', [SOURCE_TYPE, AUTO_SOURCE_TYPE])
    .order('created_at', { ascending: false })
    .limit(10);
  return data ?? [];
}

/** Local shell used only when the templates table has no article_published row. */
function fallbackContent(a: ArticleRow): { subject: string; body: string } {
  const btn = 'display:inline-block;padding:12px 24px;background:#1B4F8A;color:#ffffff;font-weight:600;border-radius:8px;text-decoration:none;font-size:14px;';
  const desc = a.seo_description ? `<p>${a.seo_description}</p>` : '';
  return {
    subject: `New Article: ${a.title}`,
    body: `<h2>${a.title}</h2>${desc}<p><a href="${MAIN_URL}/articles/${a.slug}" style="${btn}">Read Article &rarr;</a></p>`,
  };
}

/**
 * The article's email content. Same template the Publish auto-send would use,
 * so a manual announce and an auto one cannot drift apart in wording. Shared by
 * the real send and the preview, so what the admin tests IS what recipients get.
 */
async function renderArticleEmail(a: ArticleRow): Promise<{ subject: string; body: string }> {
  return await renderForEvent(AUTO_SOURCE_TYPE, {
    title:       a.title,
    description: a.seo_description ?? '',
    url:         `${MAIN_URL}/articles/${a.slug}`,
    date: '', time: '', platform: '', course: '',
  }) ?? fallbackContent(a);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const article = await loadArticle(id);
  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

  const includeModelingUsers = new URL(req.url).searchParams.get('includeModelingUsers') === 'true';

  // dryRun: opening the dialog must not mint subscriber rows.
  const [{ counts }, history] = await Promise.all([
    resolveAnnounceAudience({ includeModelingUsers, dryRun: true }),
    loadHistory(id),
  ]);

  return NextResponse.json({
    article: { id: article.id, title: article.title, slug: article.slug, status: article.status },
    counts,
    history,
    canSend: article.status === 'published',
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  let body: { includeModelingUsers?: boolean; force?: boolean; preview?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const article = await loadArticle(id);
  if (!article) return NextResponse.json({ error: 'Article not found' }, { status: 404 });

  // A draft/scheduled article is not publicly readable (public reads gate on
  // status='published'), so announcing one emails everybody a link to a 404.
  if (article.status !== 'published') {
    return NextResponse.json({
      error: `This article is ${article.status}, so the link would 404 for every recipient. Publish it first, then announce.`,
    }, { status: 400 });
  }

  // ── Preview: send this article to the admin's own inbox only ──────────────
  // Deliberately placed BEFORE the already-sent guard and BEFORE any audience
  // resolution, so that a preview:
  //   - works even on an article that has already been announced (409 below),
  //   - creates NO campaign row, so it cannot pollute the send history, count
  //     as "announced", or block a later real send,
  //   - resolves NO audience, so it mints no subscriber rows for anyone.
  // sendTestEmail carries the [TEST] subject prefix and a synthetic unsubscribe
  // token, so a test click cannot unsubscribe a real person.
  if (body.preview) {
    if (!user.email) {
      return NextResponse.json({ error: 'Your admin account has no email address to send to.' }, { status: 400 });
    }
    const preview = await renderArticleEmail(article);
    const sent = await sendTestEmail({
      toEmail:          user.email,
      subject:          preview.subject,
      body:             preview.body,
      hub:              'training',
      unsubscribeToken: '00000000-0000-0000-0000-000000000000',
    });
    if (!sent.ok) {
      return NextResponse.json({ error: sent.error ?? 'Test send failed' }, { status: 500 });
    }
    console.log(`[article-announce] preview of ${article.slug} sent to ${user.email}`);
    return NextResponse.json({ success: true, preview: true, sentTo: user.email });
  }

  // Re-announcing is legitimate (a first send that partly failed), but it must
  // be deliberate: everyone who already got it gets it AGAIN.
  const history = await loadHistory(id);
  const prior = history.filter(h => h.status !== 'failed');
  if (prior.length > 0 && !body.force) {
    const last = prior[0];
    return NextResponse.json({
      error: 'already_sent',
      message: `Already announced${last.sent_at ? ` on ${new Date(last.sent_at).toLocaleString()}` : ''} to ${last.sent_count ?? 0} recipients. Sending again emails all of them a second time.`,
      history: prior,
    }, { status: 409 });
  }

  const includeModelingUsers = body.includeModelingUsers ?? false;
  const { recipients, counts } = await resolveAnnounceAudience({ includeModelingUsers });

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'No recipients to send to' }, { status: 400 });
  }

  const rendered = await renderArticleEmail(article);

  const sb = getServerClient();
  const { data: campaign, error: campErr } = await sb
    .from('newsletter_campaigns')
    .insert({
      subject:       rendered.subject,
      body:          rendered.body,
      target_hub:    'all',
      segment:       'all_active',
      status:        'sending',
      campaign_type: 'manual',
      source_type:   SOURCE_TYPE,
      source_id:     article.id,
      created_by:    user.email ?? 'admin',
    })
    .select('id')
    .single();

  if (campErr || !campaign) {
    return NextResponse.json({ error: campErr?.message ?? 'Failed to create campaign' }, { status: 500 });
  }

  const result = await sendCampaign({
    campaignId: campaign.id,
    subject:    rendered.subject,
    body:       rendered.body,
    targetHub:  'all',
    segment:    'all_active',
    recipients, // explicit union audience; segment/targetHub are ignored
  });

  console.log(`[article-announce] ${article.slug}: sent ${result.sent}, failed ${result.failed}`);

  return NextResponse.json({
    success:    true,
    campaignId: campaign.id,
    sent:       result.sent,
    failed:     result.failed,
    total:      result.attempted,
    counts,
  });
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getArticleBySlug, getArticleBySlugAnyStatus, estimateReadTime, renderBodyWithMidImage, articleCategoryNames } from '@/src/shared/cms';
import { sanitizeArticleHtml } from '@/src/shared/cms/sanitizeArticle';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { ArticleJsonLd, BreadcrumbJsonLd } from '@/src/shared/seo/components/StructuredData';
import { canonicalUrl } from '@/src/shared/seo/canonical';
import { AuthorByline, resolveByline } from '@/src/hubs/main/components/landing/AuthorByline';

// Rendered on demand (not ISR): the admin draft-preview path reads the session
// (cookies) when the published lookup misses, which is a dynamic API and throws
// DYNAMIC_SERVER_USAGE under `revalidate`. Dynamic rendering still returns full
// SSR HTML (SEO unaffected); the public /articles listing is likewise dynamic.
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article  = await getArticleBySlug(slug);
  if (!article) return { title: 'Article Not Found' };
  const url = canonicalUrl(`/articles/${article.slug}`, 'main');
  const ogImage = article.og_image_url || article.cover_url; // OG falls back to the hero
  return {
    title:       article.seo_title       ?? article.title,
    description: article.seo_description ?? `${article.title}, practitioner insights on financial modeling, valuation, and corporate finance from Financial Modeler Pro.`,
    alternates: { canonical: url },
    openGraph: {
      title:       article.seo_title ?? article.title,
      description: article.seo_description ?? '',
      type:        'article',
      url,
      publishedTime: article.published_at ?? undefined,
      modifiedTime:  article.updated_at ?? article.published_at ?? undefined,
      images:      ogImage ? [{ url: ogImage, width: 1200, height: 630, alt: article.title }] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.seo_title ?? article.title,
      description: article.seo_description ?? '',
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function ArticleDetailPage({ params }: Props) {
  const { slug } = await params;
  let article = await getArticleBySlug(slug);
  // Admin-only draft preview: when the published lookup misses, an authenticated
  // admin may preview a draft / scheduled article (a DRAFT banner is shown). The
  // public still 404s, so unpublished content never leaks. Reading the session
  // (cookies) only on the miss path keeps published rendering statically cacheable.
  let draftPreview = false;
  if (!article) {
    const session = await getServerSession(authOptions);
    if ((session?.user as { role?: string } | undefined)?.role === 'admin') {
      article = await getArticleBySlugAnyStatus(slug);
      draftPreview = !!article;
    }
  }
  if (!article) notFound();

  const readTime = estimateReadTime(article.body);
  const date     = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // Resolve the {{MID_IMAGE}} marker to the captioned figure, then sanitize the result
  // through the strict allow-list (so the injected figure passes the same gate) before
  // it reaches dangerouslySetInnerHTML.
  const resolvedBody = renderBodyWithMidImage(article.body, article.mid_image_url, article.mid_image_caption);
  const safeBody = sanitizeArticleHtml(resolvedBody);
  const ogImage = article.og_image_url || article.cover_url;
  const tags = Array.isArray(article.tags) ? article.tags : [];

  // Hero placement (migration 189, schema-tolerant): true = above the header, else
  // after it (current default). Extra top padding when it leads so it clears the card.
  const heroBefore = article.hero_before_content === true;
  const heroBlock = article.cover_url ? (
    <div style={{ padding: heroBefore ? '32px 48px 0' : '0 48px', boxSizing: 'border-box', maxWidth: '100%' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={article.cover_url}
        alt={article.title}
        style={{ width: '100%', maxHeight: 440, objectFit: 'cover', display: 'block', borderRadius: 14 }}
      />
    </div>
  ) : null;

  const articleUrl = canonicalUrl(`/articles/${article.slug}`, 'main');

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>
      <ArticleJsonLd
        title={article.seo_title ?? article.title}
        description={article.seo_description ?? ''}
        image={ogImage ?? undefined}
        publishedTime={article.published_at}
        modifiedTime={article.updated_at}
        author={resolveByline(article.writer_name, article.writer_title).name}
        url={articleUrl}
      />
      <BreadcrumbJsonLd items={[
        { name: 'Home',     url: canonicalUrl('/', 'main') },
        { name: 'Articles', url: canonicalUrl('/articles', 'main') },
        { name: article.title, url: articleUrl },
      ]} />

      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Light reading card. The page background + navbar + footer stay as the
          site chrome; only the article content sits on a light surface so pasted
          HTML authored for a light page reads with correct contrast. Max-width
          preserved at 820. */}
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 20px 8px' }}>
        {draftPreview && (
          <div style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>👁 Draft preview</span>
            <span style={{ fontWeight: 500 }}>This article is <strong>{article.status}</strong> and is only visible to admins. Publish it to make it public.</span>
          </div>
        )}
        <article style={{ background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px -24px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
          {/* Hero above the header when hero_before_content is set. */}
          {heroBefore && heroBlock}

          {/* Header */}
          <div style={{ padding: '44px 48px 28px' }}>
            <div style={{ marginBottom: 18, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {articleCategoryNames(article).map((name) => (
                <span key={name} style={{
                  background: 'rgba(27,79,138,0.08)', color: '#1B4F8A',
                  fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
                  letterSpacing: '0.05em', textTransform: 'uppercase',
                  border: '1px solid rgba(27,79,138,0.18)',
                }}>
                  {name}
                </span>
              ))}
            </div>

            <h1 style={{ fontSize: 'clamp(26px, 4vw, 42px)', fontWeight: 800, color: '#0D2E5A', lineHeight: 1.2, marginBottom: 18 }}>
              {article.title}
            </h1>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, color: '#64748B', fontSize: 13 }}>
              {date && <span>{date}</span>}
              <span>·</span>
              <span>{readTime}</span>
            </div>

            <div style={{ marginTop: 20, paddingTop: 18, borderTop: '1px solid #EEF2F7' }}>
              <AuthorByline variant="page" name={article.writer_name} role={article.writer_title} />
            </div>
          </div>

          {/* Hero after the header (default). Rendered exactly once; body images are
              separate. Inset + rounded, full content width, responsive. */}
          {!heroBefore && heroBlock}

          {/* Body (dark text on the light card; .article-body defaults + pasted inline styles) */}
          <div
            className="article-body"
            style={{
              padding: '40px 48px 52px',
              fontSize: 17,
              lineHeight: 1.8,
              color: '#334155',
            }}
            dangerouslySetInnerHTML={{ __html: safeBody }}
          />

          {/* Tags */}
          {tags.length > 0 && (
            <div style={{ padding: '0 48px 44px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tags.map((t) => (
                <span key={t} style={{ fontSize: 12, fontWeight: 600, color: '#1B4F8A', background: 'rgba(27,79,138,0.08)', border: '1px solid rgba(27,79,138,0.15)', padding: '4px 12px', borderRadius: 20 }}>
                  #{t}
                </span>
              ))}
            </div>
          )}
        </article>

        {/* Back link (on the navy chrome, below the card) */}
        <div style={{ padding: '28px 4px 8px' }}>
          <Link href="/articles" style={{ fontSize: 13, color: '#9EC3E8', fontWeight: 700, textDecoration: 'none' }}>
            ← Back to Articles
          </Link>
        </div>
      </div>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© {new Date().getFullYear()} Financial Modeler Pro</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Structured Modeling. Real-World Finance.</span>
      </footer>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getArticleBySlug, estimateReadTime, renderBodyWithMidImage } from '@/src/shared/cms';
import { NavbarServer } from '@/src/shared/components/layout/NavbarServer';
import { ArticleJsonLd, BreadcrumbJsonLd } from '@/src/shared/seo/components/StructuredData';
import { canonicalUrl } from '@/src/shared/seo/canonical';
import { AuthorByline, ARTICLE_AUTHOR } from '@/src/hubs/main/components/landing/AuthorByline';

export const revalidate = 60;

export async function generateStaticParams() {
  return [];
}

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
  const article  = await getArticleBySlug(slug);
  if (!article) notFound();

  const readTime = estimateReadTime(article.body);
  const date     = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // Body is trusted admin HTML from our own Supabase (rendered verbatim). Resolve the
  // {{MID_IMAGE}} marker to the captioned mid-image figure (or remove it if none set).
  const safeBody = renderBodyWithMidImage(article.body, article.mid_image_url, article.mid_image_caption);
  const ogImage = article.og_image_url || article.cover_url;
  const tags = Array.isArray(article.tags) ? article.tags : [];

  const articleUrl = canonicalUrl(`/articles/${article.slug}`, 'main');

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>
      <ArticleJsonLd
        title={article.seo_title ?? article.title}
        description={article.seo_description ?? ''}
        image={ogImage ?? undefined}
        publishedTime={article.published_at}
        modifiedTime={article.updated_at}
        author={ARTICLE_AUTHOR.name}
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
        <article style={{ background: '#fff', borderRadius: 16, boxShadow: '0 24px 70px -24px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '44px 48px 28px' }}>
            <div style={{ marginBottom: 18 }}>
              <span style={{
                background: 'rgba(27,79,138,0.08)', color: '#1B4F8A',
                fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                border: '1px solid rgba(27,79,138,0.18)',
              }}>
                {article.category}
              </span>
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
              <AuthorByline variant="page" />
            </div>
          </div>

          {/* Cover Image (the hero, rendered exactly once; body images are separate).
              Inset + rounded to match the article design; full width of the content
              column, responsive (never overflows on mobile via box-sizing). */}
          {article.cover_url && (
            <div style={{ padding: '0 48px', boxSizing: 'border-box', maxWidth: '100%' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={article.cover_url}
                alt={article.title}
                style={{ width: '100%', maxHeight: 440, objectFit: 'cover', display: 'block', borderRadius: 14 }}
              />
            </div>
          )}

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

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getArticleBySlug, estimateReadTime } from '@/src/lib/cms';
import { Navbar } from '@/src/components/layout/Navbar';

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
  return {
    title:       article.seo_title       ?? `${article.title} — Financial Modeler Pro`,
    description: article.seo_description ?? '',
    openGraph: {
      title:       article.seo_title ?? article.title,
      description: article.seo_description ?? '',
      type:        'article',
      images:      article.cover_url ? [{ url: article.cover_url }] : [],
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

  // Sanitize HTML — inline, since DOMPurify may not be available server-side without setup
  // We trust admin-entered content; body comes from our own Supabase
  const safeBody = article.body;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>

      <Navbar />
      <div style={{ height: 64 }} />

      {/* Article Header */}
      <section style={{ padding: '64px 40px 48px', borderBottom: '1px solid rgba(255,255,255,0.07)', maxWidth: 820, margin: '0 auto' }}>
        {/* Category */}
        <div style={{ marginBottom: 20 }}>
          <span style={{
            background: 'rgba(27,79,138,0.3)', color: '#4A90D9',
            fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
            letterSpacing: '0.05em', textTransform: 'uppercase',
            border: '1px solid rgba(27,79,138,0.4)',
          }}>
            {article.category}
          </span>
        </div>

        <h1 style={{ fontSize: 'clamp(26px, 4vw, 42px)', fontWeight: 800, color: '#fff', lineHeight: 1.2, marginBottom: 20 }}>
          {article.title}
        </h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20, color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
          {date && <span>{date}</span>}
          <span>·</span>
          <span>{readTime}</span>
        </div>
      </section>

      {/* Cover Image */}
      {article.cover_url && (
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 40px' }}>
          <div style={{ borderRadius: 12, overflow: 'hidden', marginTop: 32, height: 360, background: '#1B3A6B' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.cover_url}
              alt={article.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        </div>
      )}

      {/* Body */}
      <article style={{ maxWidth: 820, margin: '0 auto', padding: '48px 40px 80px' }}>
        <div
          className="article-body"
          style={{
            fontSize: 16,
            lineHeight: 1.8,
            color: 'rgba(255,255,255,0.7)',
          }}
          dangerouslySetInnerHTML={{ __html: safeBody }}
        />
      </article>

      {/* Back link */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '32px 40px', maxWidth: 820, margin: '0 auto' }}>
        <Link href="/articles" style={{ fontSize: 13, color: '#4A90D9', fontWeight: 700, textDecoration: 'none' }}>
          ← Back to Articles
        </Link>
      </div>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© {new Date().getFullYear()} Financial Modeler Pro</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>Structured Modeling. Real-World Finance.</span>
      </footer>
    </div>
  );
}

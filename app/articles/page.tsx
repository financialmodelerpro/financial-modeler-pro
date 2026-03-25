import type { Metadata } from 'next';
import { Suspense } from 'react';
import Link from 'next/link';
import { getPublishedArticles } from '@/src/lib/cms';
import { ArticleCard, ArticleCardPlaceholder } from '@/src/components/landing/ArticleCard';
import { CategoryFilter } from '@/src/components/landing/CategoryFilter';
import { NavbarServer } from '@/src/components/layout/NavbarServer';

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Articles & Insights — Financial Modeler Pro',
  description: 'Real estate financial modeling guides, tutorials, and industry insights from the Financial Modeler Pro team.',
};

interface Props {
  searchParams: Promise<{ category?: string }>;
}

export default async function ArticlesPage({ searchParams }: Props) {
  const params   = await searchParams;
  const articles = await getPublishedArticles();

  // Unique categories
  const categories = Array.from(new Set(articles.map((a) => a.category).filter(Boolean)));

  // Filter
  const activeCategory = params.category ?? 'All';
  const filtered = activeCategory === 'All'
    ? articles
    : articles.filter((a) => a.category === activeCategory);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>

      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ padding: '72px 40px 56px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>Insights</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: '#fff', marginBottom: 16 }}>
            Articles & Insights
          </h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65 }}>
            Real estate financial modeling guides, deal structuring tutorials, and industry insights.
          </p>
        </div>
      </section>

      {/* Category Filter + Grid */}
      <section style={{ padding: '56px 40px', maxWidth: 1100, margin: '0 auto' }}>
        {categories.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <Suspense>
              <CategoryFilter categories={categories} active={activeCategory} />
            </Suspense>
          </div>
        )}

        {filtered.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
            {filtered.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>📝</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 10 }}>Articles Coming Soon</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>
              We're working on in-depth guides for real estate financial modeling. Check back shortly.
            </p>
            <div style={{ marginTop: 32, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20, maxWidth: 900, margin: '32px auto 0' }}>
              {[0, 1, 2].map((i) => <ArticleCardPlaceholder key={i} index={i} />)}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 24px' }}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>No articles found in this category.</div>
          </div>
        )}
      </section>

      <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '24px 40px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>© {new Date().getFullYear()} Financial Modeler Pro</span>
        <Link href="/" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>← Home</Link>
      </footer>
    </div>
  );
}

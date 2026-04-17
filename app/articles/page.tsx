import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getPublishedArticles, getCmsContent, cms, estimateReadTime } from '@/src/lib/shared/cms';
import { NavbarServer } from '@/src/components/layout/NavbarServer';
import { SharedFooter } from '@/src/components/landing/SharedFooter';
import { ArticlesGrid, NewsletterForm } from './ArticlesClient';

export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Articles & Insights - Financial Modeler Pro',
  description: 'Real estate financial modeling guides, tutorials, and industry insights from the Financial Modeler Pro team.',
};

export default async function ArticlesPage() {
  const [articles, content] = await Promise.all([getPublishedArticles(), getCmsContent()]);

  const pageBadge    = cms(content, 'articles_page', 'badge',         'Knowledge Hub');
  const pageTitle    = cms(content, 'articles_page', 'title',         'Financial Modeling Insights');
  const pageSubtitle = cms(content, 'articles_page', 'subtitle',      'Expert guides, tutorials and market analysis from corporate finance professionals');

  const footerCompany   = cms(content, 'footer', 'company_line', 'Financial Modeler Pro is a product of PaceMakers Business Consultants');
  const footerFounder   = cms(content, 'footer', 'founder_line', 'Financial Modeler Pro Team');
  const footerCopyright = cms(content, 'footer', 'copyright', `${new Date().getFullYear()} Financial Modeler Pro. All rights reserved.`);

  // Featured article
  const featured = articles.find(a => a.featured);
  const nonFeatured = featured ? articles.filter(a => a.id !== featured.id) : articles;
  const categories = [...new Set(articles.map(a => a.category).filter(Boolean))];

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: '#0D2E5A', color: '#fff', minHeight: '100vh' }}>
      <NavbarServer />
      <div style={{ height: 64 }} />

      {/* Hero */}
      <section style={{ padding: '72px 40px 56px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#4A90D9', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 14 }}>{pageBadge}</div>
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, color: '#fff', marginBottom: 16 }}>{pageTitle}</h1>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65 }}>{pageSubtitle}</p>
        </div>
      </section>

      {/* Featured Article */}
      {featured && (
        <section style={{ padding: '56px 40px 0', maxWidth: 1100, margin: '0 auto' }}>
          <Link href={`/articles/${featured.slug}`} style={{ textDecoration: 'none', display: 'block' }}>
            <div style={{ background: '#fff', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 24px rgba(0,0,0,0.15)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
              <div style={{ position: 'relative', minHeight: 280, background: 'linear-gradient(135deg, #1B4F8A, #2D6BA8)' }}>
                {featured.cover_url ? (
                  <Image src={featured.cover_url} alt={featured.title} fill style={{ objectFit: 'cover' }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 48 }}>📊</div>
                )}
              </div>
              <div style={{ padding: '36px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#C9A84C', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Featured Article</div>
                {featured.category && (
                  <span style={{ display: 'inline-block', background: '#E8F0FB', color: '#1B4F8A', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginBottom: 12, width: 'fit-content' }}>{featured.category}</span>
                )}
                <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0D2E5A', marginBottom: 12, lineHeight: 1.3 }}>{featured.title}</h2>
                <p style={{ fontSize: 14, color: '#6B7280', lineHeight: 1.65, marginBottom: 16 }}>
                  {featured.body?.replace(/<[^>]*>/g, '').substring(0, 200)}...
                </p>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                  {featured.published_at ? new Date(featured.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''} · {estimateReadTime(featured.body)}
                </div>
              </div>
            </div>
          </Link>
        </section>
      )}

      {/* Articles Grid */}
      <section style={{ padding: '56px 40px', maxWidth: 1100, margin: '0 auto' }}>
        {articles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 24px' }}>
            <div style={{ fontSize: 48, marginBottom: 20 }}>📝</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>No articles published yet</h2>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', marginBottom: 32, lineHeight: 1.6 }}>
              Check back soon for expert financial modeling insights.
            </p>
          </div>
        ) : (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 24 }}>Latest Articles</h2>
            <ArticlesGrid articles={nonFeatured} categories={categories} />
          </>
        )}
      </section>

      {/* Newsletter */}
      <section style={{ background: 'rgba(255,255,255,0.03)', padding: '56px 40px', borderTop: '1px solid rgba(255,255,255,0.07)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>📬</div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Stay Updated</h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, marginBottom: 28 }}>
            Get the latest financial modeling insights delivered to your inbox.
          </p>
          <NewsletterForm />
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginTop: 16 }}>No spam. Unsubscribe anytime.</p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{ padding: '56px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 500, margin: '0 auto' }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 10 }}>Want to contribute?</h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.65, marginBottom: 24 }}>
            Share your financial modeling expertise with our community.
          </p>
          <Link href="/contact" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#1B4F8A', color: '#fff', fontWeight: 700, fontSize: 14, padding: '11px 28px', borderRadius: 8, textDecoration: 'none' }}>
            Contact Us →
          </Link>
        </div>
      </section>

      <SharedFooter company={footerCompany} founder={footerFounder} copyright={footerCopyright} />
    </div>
  );
}

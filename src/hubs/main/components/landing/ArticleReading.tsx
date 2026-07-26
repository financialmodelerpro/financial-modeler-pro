/**
 * ArticleReading.tsx, server components for the article detail reading experience:
 * a series banner (inside the light card), a full series-contents list, previous/
 * next navigation, and a "more in this category" strip (both on the navy chrome).
 *
 * All pure/server (no client JS): the series is guidance, not a gate, so every part
 * stays a plain link, which also keeps the internal linking SEO-friendly.
 *
 * No em dashes in this file.
 */

import Link from 'next/link';
import type { SeriesNav, NavLink } from '@/src/shared/cms/articleNav';
import type { RelatedArticle, SeriesInfo } from '@/src/shared/cms';
import { estimateReadTime } from '@/src/shared/cms';

type Series = SeriesNav & { info: SeriesInfo };

// ── Series banner (inside the white article card, at the top) ──────────────────

export function ArticleSeriesBanner({ series }: { series: Series }) {
  const partNo = series.currentIndex + 1;
  const firstPart = series.parts[0];
  const onFirst = series.currentIndex === 0;
  return (
    <div style={{ margin: '20px 48px 0', padding: '14px 18px', background: 'rgba(27,79,138,0.06)', border: '1px solid rgba(27,79,138,0.16)', borderRadius: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#1B4F8A', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          📚 Part {partNo} of {series.total}
        </span>
        <span style={{ color: '#94A3B8' }}>·</span>
        <Link href={`/articles/${firstPart.slug}`} style={{ fontSize: 13, fontWeight: 700, color: '#0D2E5A', textDecoration: 'none' }}>
          {series.info.title}
        </Link>
      </div>
      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
        {series.parts.map((p, i) => (
          <span key={p.id} title={`Part ${i + 1}: ${p.title}`} style={{
            width: i === series.currentIndex ? 22 : 9, height: 9, borderRadius: 5,
            background: i <= series.currentIndex ? '#1B4F8A' : 'rgba(27,79,138,0.2)',
            transition: 'width .2s',
          }} />
        ))}
      </div>
      {!onFirst && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: '#475569' }}>
          New to this series? Start with{' '}
          <Link href={`/articles/${firstPart.slug}`} style={{ color: '#1B4F8A', fontWeight: 700, textDecoration: 'none' }}>
            Part 1 &rarr;
          </Link>{' '}
          so the earlier concepts carry over.
        </div>
      )}
    </div>
  );
}

// ── Full series contents list (below the card, on the navy chrome) ─────────────

export function ArticleSeriesContents({ series }: { series: Series }) {
  return (
    <section style={{ marginTop: 28, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '22px 24px' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9EC3E8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>In this series</div>
      <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: '0 0 4px' }}>{series.info.title}</h3>
      {series.info.description && (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '0 0 12px' }}>{series.info.description}</p>
      )}
      <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)', margin: '0 0 14px' }}>
        {series.total} parts &middot; read in order for the full picture.
      </p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {series.parts.map((p, i) => {
          const current = i === series.currentIndex;
          return (
            <li key={p.id}>
              <Link href={`/articles/${p.slug}`} aria-current={current ? 'true' : undefined} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, textDecoration: 'none',
                background: current ? 'rgba(78,124,176,0.28)' : 'rgba(255,255,255,0.03)',
                border: current ? '1px solid rgba(158,195,232,0.5)' : '1px solid transparent',
              }}>
                <span style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 800, background: current ? '#9EC3E8' : 'rgba(255,255,255,0.1)', color: current ? '#0D2E5A' : 'rgba(255,255,255,0.7)',
                }}>{i + 1}</span>
                <span style={{ fontSize: 14, fontWeight: current ? 700 : 500, color: current ? '#fff' : 'rgba(255,255,255,0.82)', lineHeight: 1.4 }}>
                  {p.title}
                </span>
                {current && <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#9EC3E8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>You are here</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Previous / Next navigation (below the card) ────────────────────────────────

export function ArticlePrevNext({ prev, next, prevLabel = 'Previous', nextLabel = 'Next' }: { prev: NavLink | null; next: NavLink | null; prevLabel?: string; nextLabel?: string }) {
  if (!prev && !next) return null;
  const cell = (link: NavLink | null, side: 'prev' | 'next', label: string) => {
    if (!link) return <div style={{ flex: '1 1 240px' }} />;
    const alignEnd = side === 'next';
    return (
      <Link href={`/articles/${link.slug}`} style={{
        flex: '1 1 240px', minWidth: 0, textDecoration: 'none', display: 'block',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '16px 18px',
        textAlign: alignEnd ? 'right' : 'left',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#9EC3E8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
          {side === 'prev' ? '← ' : ''}{label}{side === 'next' ? ' →' : ''}
        </div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#fff', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {link.title}
        </div>
      </Link>
    );
  };
  return (
    <nav aria-label="Article navigation" style={{ marginTop: 20, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
      {cell(prev, 'prev', prevLabel)}
      {cell(next, 'next', nextLabel)}
    </nav>
  );
}

// ── More in this category (below the card) ─────────────────────────────────────

export function MoreInCategory({ category, articles }: { category: string; articles: RelatedArticle[] }) {
  if (!articles.length) return null;
  return (
    <section style={{ marginTop: 32 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: '#fff', margin: '0 0 16px' }}>
        More in <span style={{ color: '#9EC3E8' }}>{category}</span>
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 240px), 1fr))', gap: 16 }}>
        {articles.map((a) => (
          <Link key={a.id} href={`/articles/${a.slug}`} style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ height: 120, background: a.cover_url ? '#0A2447' : 'linear-gradient(135deg, #1B4F8A, #2D6BA8)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {a.cover_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={a.cover_url} alt={a.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 30 }}>📊</span>}
            </div>
            <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.4, marginBottom: 8, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
                {a.title}
              </div>
              <div style={{ marginTop: 'auto', fontSize: 11.5, color: 'rgba(255,255,255,0.45)' }}>
                {a.published_at ? new Date(a.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''} &middot; {estimateReadTime(a.body)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

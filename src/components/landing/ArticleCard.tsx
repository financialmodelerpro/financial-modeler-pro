import Link from 'next/link';
import Image from 'next/image';
import type { Article } from '@/src/lib/cms';
import { estimateReadTime } from '@/src/lib/cms';

export function ArticleCard({ article }: { article: Article }) {
  const readTime = estimateReadTime(article.body);
  const date = article.published_at
    ? new Date(article.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #E8F0FB', boxShadow: '0 2px 8px rgba(27,79,138,0.07)', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {article.cover_url ? (
        <div style={{ position: 'relative', width: '100%', height: 180, background: '#F4F7FC' }}>
          <Image src={article.cover_url} alt={article.title} fill style={{ objectFit: 'cover' }} />
        </div>
      ) : (
        <div style={{ width: '100%', height: 180, background: 'linear-gradient(135deg, #1B4F8A, #2D6BA8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
          📊
        </div>
      )}
      <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ background: '#E8F0FB', color: '#1B4F8A', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            {article.category}
          </span>
        </div>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 8, lineHeight: 1.4, flex: 1 }}>
          {article.title}
        </h3>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 11, color: '#6B7280' }}>{date} · {readTime}</span>
          <Link href={`/articles/${article.slug}`} style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 700, textDecoration: 'none' }}>
            Read More →
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ArticleCardPlaceholder({ index }: { index: number }) {
  const placeholders = [
    { title: 'Getting Started with Real Estate Financial Modeling', category: 'Real Estate' },
    { title: 'DCF Analysis: A Practitioner\'s Guide', category: 'Business Valuation' },
    { title: 'Building a Three-Statement Financial Model', category: 'FP&A' },
  ];
  const p = placeholders[index % placeholders.length];
  return (
    <div style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', border: '1px solid #E8F0FB', opacity: 0.6 }}>
      <div style={{ height: 180, background: 'linear-gradient(135deg, #E8F0FB, #F4F7FC)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>📝</div>
      <div style={{ padding: 16 }}>
        <span style={{ background: '#E8F0FB', color: '#1B4F8A', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20 }}>{p.category}</span>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginTop: 8, lineHeight: 1.4 }}>{p.title}</h3>
        <div style={{ marginTop: 12, padding: '6px 12px', background: '#F5F7FA', borderRadius: 6, fontSize: 12, color: '#6B7280', textAlign: 'center' }}>Coming Soon</div>
      </div>
    </div>
  );
}

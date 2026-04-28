import Link from 'next/link';
import { getServerClient } from '@/src/core/db/supabase';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

async function getAllArticles() {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('articles').select('id, title, slug, category, status, featured, published_at, created_at').order('created_at', { ascending: false });
    return data ?? [];
  } catch { return []; }
}

export default async function AdminArticlesPage() {
  const articles = await getAllArticles();

  const statusColors: Record<string, { bg: string; color: string }> = {
    published: { bg: '#E8F7EC', color: '#1A7A30' },
    draft:     { bg: '#F3F4F6', color: '#6B7280' },
    scheduled: { bg: '#FEF3C7', color: '#92400E' },
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/articles" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Articles</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>{articles.length} articles total</p>
          </div>
          <Link href="/admin/articles/new" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 20px', borderRadius: 7, textDecoration: 'none' }}>
            + New Article
          </Link>
        </div>

        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#1B4F8A' }}>
                {['Title', 'Category', 'Status', 'Date', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {articles.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '48px 16px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>No articles yet. <Link href="/admin/articles/new" style={{ color: '#1B4F8A' }}>Create the first one →</Link></td></tr>
              ) : articles.map((a: any, i: number) => {
                const sc = statusColors[a.status] ?? statusColors.draft;
                return (
                  <tr key={a.id} style={{ borderTop: '1px solid #E8F0FB', background: i % 2 === 1 ? '#F9FAFB' : '#fff' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1B3A6B' }}>{a.title}</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2, fontFamily: 'monospace' }}>/{a.slug}</div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: '#E8F0FB', color: '#1B4F8A' }}>{a.category}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: sc.bg, color: sc.color }}>
                        {a.status}{a.featured ? ' ⭐' : ''}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#6B7280' }}>
                      {a.published_at ? new Date(a.published_at).toLocaleDateString() : new Date(a.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Link href={`/admin/articles/${a.id}`} style={{ fontSize: 12, color: '#1B4F8A', fontWeight: 600, textDecoration: 'none' }}>Edit</Link>
                        <span style={{ color: '#E5E7EB' }}>|</span>
                        <Link href={`/articles/${a.slug}`} target="_blank" style={{ fontSize: 12, color: '#6B7280', textDecoration: 'none' }}>View ↗</Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

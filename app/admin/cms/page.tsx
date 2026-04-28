import { getServerClient } from '@/src/core/db/supabase';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import Link from 'next/link';
import { getServerSession } from 'next-auth';

async function getStats() {
  try {
    const sb = getServerClient();
    const [usersRes, articlesRes, coursesRes] = await Promise.all([
      sb.from('users').select('id', { count: 'exact', head: true }),
      sb.from('articles').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      sb.from('courses').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    ]);
    // Try projects table, might not exist
    let projectCount = 0;
    try {
      const { count } = await sb.from('projects').select('id', { count: 'exact', head: true });
      projectCount = count ?? 0;
    } catch { projectCount = 0; }
    return {
      users: usersRes.count ?? 0,
      articles: articlesRes.count ?? 0,
      courses: coursesRes.count ?? 0,
      projects: projectCount,
    };
  } catch {
    return { users: 0, articles: 0, courses: 0, projects: 0 };
  }
}

async function getRecentUsers() {
  try {
    const sb = getServerClient();
    const { data } = await sb.from('users').select('id, email, role, created_at').order('created_at', { ascending: false }).limit(5);
    return data ?? [];
  } catch { return []; }
}

export default async function AdminDashboardPage() {
  const [stats, recentUsers, session] = await Promise.all([getStats(), getRecentUsers(), getServerSession()]);
  const adminName = session?.user?.name ?? session?.user?.email ?? 'Admin';

  const kpis = [
    { label: 'Total Users',          value: stats.users,    icon: '👥', color: '#1B4F8A', bg: '#E8F0FB' },
    { label: 'Articles Published',   value: stats.articles, icon: '📰', color: '#1A7A30', bg: '#E8F7EC' },
    { label: 'Courses Published',    value: stats.courses,  icon: '🎓', color: '#92400E', bg: '#FEF3C7' },
    { label: 'Total Projects',       value: stats.projects, icon: '📁', color: '#1B3A6B', bg: '#F4F7FC' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/cms" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Welcome back, {adminName}</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 32 }}>Here is an overview of your platform.</p>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20, marginBottom: 40 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '20px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>{k.icon}</div>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>{k.label}</span>
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px', marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', marginBottom: 16 }}>Quick Actions</h2>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {[
              { label: 'New Article',      href: '/admin/articles/new', bg: '#1B4F8A' },
              { label: 'Add Course',       href: '/admin/training',     bg: '#1A7A30' },
              { label: 'Edit Hero Text',   href: '/admin/content',      bg: '#92400E' },
              { label: 'Training Site →',  href: '/training', target: '_blank', bg: '#1A5C3A' },
              { label: 'View Live Site →', href: '/', target: '_blank', bg: '#374151' },
            ].map((a) => (
              <Link key={a.label} href={a.href} target={(a as any).target} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: a.bg, color: '#fff', fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 7, textDecoration: 'none' }}>
                {a.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Recent Users */}
        <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '18px 24px', borderBottom: '1px solid #E8F0FB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B3A6B', margin: 0 }}>Recent Sign-ups</h2>
            <Link href="/admin/users" style={{ fontSize: 12, color: '#1B4F8A', textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['Email', 'Role', 'Joined'].map((h) => (
                  <th key={h} style={{ padding: '10px 24px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: '1px solid #E8F0FB' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentUsers.length === 0 ? (
                <tr><td colSpan={3} style={{ padding: '32px 24px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>No users yet.</td></tr>
              ) : recentUsers.map((u: any, i: number) => (
                <tr key={u.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '12px 24px', fontSize: 13, color: '#374151' }}>{u.email}</td>
                  <td style={{ padding: '12px 24px' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: u.role === 'admin' ? '#FEE2E2' : '#E8F0FB', color: u.role === 'admin' ? '#DC2626' : '#1B4F8A' }}>{u.role ?? 'user'}</span>
                  </td>
                  <td style={{ padding: '12px 24px', fontSize: 12, color: '#6B7280' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

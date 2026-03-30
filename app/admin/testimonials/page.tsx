'use client';

import { useEffect, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Testimonial {
  id: string;
  source: 'manual' | 'student';
  name: string;
  role: string;
  company: string;
  text: string;
  rating: number | null;
  status: 'pending' | 'approved' | 'rejected';
  testimonial_type: 'written' | 'video' | 'manual';
  is_featured: boolean;
  video_url: string | null;
  job_title: string | null;
  location: string | null;
  linkedin_url: string | null;
  course_name: string | null;
  registration_id: string | null;
  created_at: string;
  approved_at: string | null;
}

type Tab = 'all' | 'pending' | 'approved' | 'rejected' | 'video';

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', padding: '12px 20px', borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}>
      {message}
    </div>
  );
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending:  { bg: '#FEF3C7', color: '#92400E' },
  approved: { bg: '#E8F7EC', color: '#1A7A30' },
  rejected: { bg: '#FEE2E2', color: '#DC2626' },
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  written: { bg: '#EFF6FF', color: '#1D4ED8' },
  video:   { bg: '#F0FDF4', color: '#166534' },
  manual:  { bg: '#F3F4F6', color: '#6B7280' },
};

export default function AdminTestimonialsPage() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [tab, setTab]                   = useState<Tab>('all');
  const [loading, setLoading]           = useState(true);
  const [toast, setToast]               = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
  }

  async function fetchTestimonials() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/testimonials');
      const data = await res.json();
      setTestimonials(data.testimonials ?? []);
    } catch {
      showToast('Failed to load testimonials', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTestimonials(); }, []);

  async function updateStatus(id: string, source: string, status: string) {
    try {
      const res = await fetch('/api/admin/testimonials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source, status }),
      });
      if (!res.ok) throw new Error();
      showToast(`Testimonial ${status}`);
      await fetchTestimonials();
    } catch {
      showToast('Failed to update', 'error');
    }
  }

  async function toggleFeatured(id: string, source: string, current: boolean) {
    try {
      const res = await fetch('/api/admin/testimonials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source, is_featured: !current }),
      });
      if (!res.ok) throw new Error();
      showToast(!current ? 'Marked as featured' : 'Removed from featured');
      await fetchTestimonials();
    } catch {
      showToast('Failed to update', 'error');
    }
  }

  async function deleteTestimonial(id: string, source: string) {
    if (!confirm('Delete this testimonial? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/admin/testimonials?id=${id}&source=${source}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Deleted');
      await fetchTestimonials();
    } catch {
      showToast('Failed to delete', 'error');
    }
  }

  const counts = {
    all:      testimonials.length,
    pending:  testimonials.filter(t => t.status === 'pending').length,
    approved: testimonials.filter(t => t.status === 'approved').length,
    rejected: testimonials.filter(t => t.status === 'rejected').length,
    video:    testimonials.filter(t => t.testimonial_type === 'video').length,
  };

  const filtered = (() => {
    if (tab === 'video')    return testimonials.filter(t => t.testimonial_type === 'video');
    if (tab === 'all')      return testimonials;
    return testimonials.filter(t => t.status === tab);
  })();

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: 'all',      label: `All (${counts.all})` },
    { key: 'pending',  label: `Pending (${counts.pending})` },
    { key: 'approved', label: `Approved (${counts.approved})` },
    { key: 'rejected', label: `Rejected (${counts.rejected})` },
    { key: 'video',    label: `Video (${counts.video})` },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav
        active="/admin/testimonials"
        badges={counts.pending > 0 ? { '/admin/testimonials': counts.pending } : undefined}
      />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Testimonials</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>{testimonials.length} total · {counts.pending} pending review</p>
          </div>
          <button onClick={fetchTestimonials} disabled={loading}
            style={{ padding: '8px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#fff', padding: '6px', borderRadius: 10, border: '1px solid #E8F0FB', width: 'fit-content', flexWrap: 'wrap' }}>
          {TAB_LABELS.map(({ key, label }) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, background: tab === key ? '#1B4F8A' : 'transparent', color: tab === key ? '#fff' : '#6B7280', fontWeight: tab === key ? 700 : 500 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #E8F0FB', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#6B7280', fontSize: 14 }}>No testimonials in this category.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1B4F8A' }}>
                  {['Source', 'Type', 'Name / Course', 'Content', 'Rating', 'Status', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => {
                  const sc  = STATUS_COLORS[t.status] ?? STATUS_COLORS.pending;
                  const tc  = TYPE_COLORS[t.testimonial_type] ?? TYPE_COLORS.manual;
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFF' }}>
                      {/* Source */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: t.source === 'student' ? '#EFF6FF' : '#F3F4F6', color: t.source === 'student' ? '#1D4ED8' : '#6B7280' }}>
                          {t.source === 'student' ? 'Student' : 'Manual'}
                        </span>
                        {t.is_featured && (
                          <span style={{ display: 'block', marginTop: 4, fontSize: 9, fontWeight: 700, color: '#C9A84C' }}>★ Featured</span>
                        )}
                      </td>
                      {/* Type */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: tc.bg, color: tc.color }}>
                          {t.testimonial_type}
                        </span>
                      </td>
                      {/* Name / Course */}
                      <td style={{ padding: '12px 14px', fontSize: 12, minWidth: 140 }}>
                        <div style={{ fontWeight: 600, color: '#1B3A6B' }}>{t.name}</div>
                        {t.role && <div style={{ color: '#9CA3AF', fontSize: 11 }}>{t.role}{t.company ? ` · ${t.company}` : ''}</div>}
                        {t.location && <div style={{ color: '#9CA3AF', fontSize: 10 }}>{t.location}</div>}
                        {t.course_name && <div style={{ fontSize: 10, color: '#1B4F8A', marginTop: 2, fontWeight: 600 }}>{t.course_name}</div>}
                        {t.registration_id && <div style={{ fontSize: 9, color: '#D1D5DB', fontFamily: 'monospace' }}>{t.registration_id}</div>}
                      </td>
                      {/* Content */}
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#374151', maxWidth: 220 }}>
                        {t.testimonial_type === 'video' && t.video_url ? (
                          <a href={t.video_url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#166534', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
                            ▶ Watch Video ↗
                          </a>
                        ) : (
                          <span title={t.text}>{t.text.slice(0, 90)}{t.text.length > 90 ? '…' : ''}</span>
                        )}
                      </td>
                      {/* Rating */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        {t.rating != null ? (
                          Array.from({ length: 5 }).map((_, idx) => (
                            <span key={idx} style={{ fontSize: 12, color: idx < t.rating! ? '#F59E0B' : '#E5E7EB' }}>★</span>
                          ))
                        ) : <span style={{ color: '#E5E7EB', fontSize: 11 }}>—</span>}
                      </td>
                      {/* Status */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ background: sc.bg, color: sc.color, fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, textTransform: 'capitalize' }}>
                          {t.status}
                        </span>
                      </td>
                      {/* Date */}
                      <td style={{ padding: '12px 14px', fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                      {/* Actions */}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 160 }}>
                          {t.status === 'pending' && (
                            <>
                              <button onClick={() => updateStatus(t.id, t.source, 'approved')}
                                style={{ fontSize: 10, fontWeight: 700, background: '#E8F7EC', color: '#1A7A30', border: '1px solid #A3D9AE', borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                Approve
                              </button>
                              <button onClick={() => updateStatus(t.id, t.source, 'rejected')}
                                style={{ fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                Reject
                              </button>
                            </>
                          )}
                          {(t.status === 'approved' || t.status === 'rejected') && (
                            <button onClick={() => updateStatus(t.id, t.source, 'pending')}
                              style={{ fontSize: 10, fontWeight: 700, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              Reset
                            </button>
                          )}
                          {t.source === 'student' && (
                            <button onClick={() => toggleFeatured(t.id, t.source, t.is_featured)}
                              style={{ fontSize: 10, fontWeight: 700, background: t.is_featured ? '#FEF3C7' : '#F9FAFB', color: t.is_featured ? '#92400E' : '#6B7280', border: `1px solid ${t.is_featured ? '#FDE68A' : '#E5E7EB'}`, borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {t.is_featured ? '★ Unfeature' : '☆ Feature'}
                            </button>
                          )}
                          <button onClick={() => deleteTestimonial(t.id, t.source)}
                            style={{ fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

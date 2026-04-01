'use client';

import { useEffect, useState, useCallback } from 'react';
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
  hub: 'modeling' | 'training';
  show_on_landing: boolean;
  created_at: string;
  approved_at: string | null;
}

type StatusTab = 'all' | 'pending' | 'approved' | 'rejected' | 'video';
type HubTab    = 'all' | 'training' | 'modeling';

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

function buildShareText(t: Testimonial) {
  const quote = t.text.slice(0, 220) + (t.text.length > 220 ? '…' : '');
  const who   = [t.name, t.role, t.company].filter(Boolean).join(' · ');
  const course = t.course_name ? ` (${t.course_name})` : '';
  return `"${quote}" — ${who}${course}`;
}

function ShareButtons({ t, onCopied }: { t: Testimonial; onCopied: () => void }) {
  const origin      = typeof window !== 'undefined' ? window.location.origin : '';
  const hubPath     = t.hub === 'training' ? '/training' : '/modeling';
  const pageUrl     = `${origin}${hubPath}`;
  const shareText   = buildShareText(t);
  const fullMessage = `${shareText}\n\n${pageUrl}`;

  function openLinkedIn() {
    const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}&summary=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'width=600,height=500');
  }

  function openFacebook() {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}&quote=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'width=600,height=500');
  }

  function openWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(fullMessage)}`, '_blank');
  }

  function openYouTube() {
    if (t.video_url) {
      window.open(t.video_url, '_blank');
    } else {
      navigator.clipboard.writeText(fullMessage).then(onCopied);
    }
  }

  const btnBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '4px 8px', border: 'none',
    borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
      <button onClick={openLinkedIn} title="Share on LinkedIn"
        style={{ ...btnBase, background: '#0A66C2', color: '#fff' }}>in</button>
      <button onClick={openFacebook} title="Share on Facebook"
        style={{ ...btnBase, background: '#1877F2', color: '#fff' }}>fb</button>
      <button onClick={openWhatsApp} title="Share on WhatsApp"
        style={{ ...btnBase, background: '#25D366', color: '#fff' }}>wa</button>
      <button onClick={openYouTube}
        title={t.video_url ? 'Open YouTube video' : 'Copy text to clipboard'}
        style={{ ...btnBase, background: t.video_url ? '#FF0000' : '#6B7280', color: '#fff' }}>
        {t.video_url ? '▶yt' : '📋'}
      </button>
    </div>
  );
}

interface SharedProps {
  /** Pre-select a hub tab on mount. 'all' (default) shows all hubs. */
  defaultHub?: HubTab;
}

export default function AdminTestimonialsPage({ defaultHub = 'all' }: SharedProps) {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [statusTab, setStatusTab]       = useState<StatusTab>('all');
  const [hubTab,    setHubTab]          = useState<HubTab>(defaultHub);
  const [loading,   setLoading]         = useState(true);
  const [toast,     setToast]           = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const fetchTestimonials = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/testimonials');
      const data = await res.json() as { testimonials?: Testimonial[] };
      setTestimonials(data.testimonials ?? []);
    } catch {
      showToast('Failed to load testimonials', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchTestimonials(); }, [fetchTestimonials]);

  async function updateStatus(id: string, source: string, status: string) {
    try {
      const res = await fetch('/api/admin/testimonials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source, status }),
      });
      if (!res.ok) throw new Error();
      showToast(`Status set to ${status}`);
      await fetchTestimonials();
    } catch {
      showToast('Failed to update', 'error');
    }
  }

  async function updateHub(id: string, source: string, hub: string) {
    try {
      await fetch('/api/admin/testimonials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source, hub }),
      });
      await fetchTestimonials();
    } catch { showToast('Failed to update hub', 'error'); }
  }

  async function toggleLanding(id: string, source: string, current: boolean) {
    try {
      await fetch('/api/admin/testimonials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source, show_on_landing: !current }),
      });
      showToast(!current ? 'Added to landing page' : 'Removed from landing page');
      await fetchTestimonials();
    } catch { showToast('Failed to update', 'error'); }
  }

  async function toggleFeatured(id: string, source: string, current: boolean) {
    try {
      await fetch('/api/admin/testimonials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source, is_featured: !current }),
      });
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

  // Hub-filtered base
  const hubFiltered = hubTab === 'all' ? testimonials : testimonials.filter(t => t.hub === hubTab);

  const counts = {
    all:      hubFiltered.length,
    pending:  hubFiltered.filter(t => t.status === 'pending').length,
    approved: hubFiltered.filter(t => t.status === 'approved').length,
    rejected: hubFiltered.filter(t => t.status === 'rejected').length,
    video:    hubFiltered.filter(t => t.testimonial_type === 'video').length,
  };

  const hubCounts = {
    all:      testimonials.length,
    training: testimonials.filter(t => t.hub === 'training').length,
    modeling: testimonials.filter(t => t.hub === 'modeling').length,
  };

  const totalPending = testimonials.filter(t => t.status === 'pending').length;

  const filtered = (() => {
    if (statusTab === 'video')    return hubFiltered.filter(t => t.testimonial_type === 'video');
    if (statusTab === 'all')      return hubFiltered;
    return hubFiltered.filter(t => t.status === statusTab);
  })();

  const STATUS_TABS: { key: StatusTab; label: string }[] = [
    { key: 'all',      label: `All (${counts.all})` },
    { key: 'pending',  label: `Pending (${counts.pending})` },
    { key: 'approved', label: `Approved (${counts.approved})` },
    { key: 'rejected', label: `Rejected (${counts.rejected})` },
    { key: 'video',    label: `Video (${counts.video})` },
  ];

  const HUB_TABS: { key: HubTab; label: string; color: string }[] = [
    { key: 'all',      label: `All Hubs (${hubCounts.all})`,          color: '#1B4F8A' },
    { key: 'training', label: `Training Hub (${hubCounts.training})`,  color: '#2EAA4A' },
    { key: 'modeling', label: `Modeling Hub (${hubCounts.modeling})`,  color: '#1B4F8A' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav
        active={defaultHub === 'training' ? '/admin/testimonials/training' : defaultHub === 'modeling' ? '/admin/testimonials/modeling' : '/admin/testimonials'}
        badges={totalPending > 0 ? { '/admin/testimonials/training': totalPending } : undefined}
      />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Testimonials</h1>
            <p style={{ fontSize: 13, color: '#6B7280' }}>{testimonials.length} total · {totalPending} pending review</p>
          </div>
          <button onClick={fetchTestimonials} disabled={loading}
            style={{ padding: '8px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>

        {/* Hub tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {HUB_TABS.map(({ key, label, color }) => (
            <button key={key} onClick={() => { setHubTab(key); setStatusTab('all'); }}
              style={{ padding: '8px 18px', borderRadius: 8, border: `2px solid ${hubTab === key ? color : '#D1D5DB'}`, cursor: 'pointer', fontSize: 13, background: hubTab === key ? color : '#fff', color: hubTab === key ? '#fff' : '#6B7280', fontWeight: 700, transition: 'all 0.15s' }}>
              {label}
            </button>
          ))}
        </div>

        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: '#fff', padding: '6px', borderRadius: 10, border: '1px solid #E8F0FB', width: 'fit-content', flexWrap: 'wrap' }}>
          {STATUS_TABS.map(({ key, label }) => (
            <button key={key} onClick={() => setStatusTab(key)}
              style={{ padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 13, background: statusTab === key ? '#1B4F8A' : 'transparent', color: statusTab === key ? '#fff' : '#6B7280', fontWeight: statusTab === key ? 700 : 500 }}>
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
                  {['Source', 'Hub', 'Type', 'Name / Course', 'Content', 'Rating', 'Status', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => {
                  const sc = STATUS_COLORS[t.status] ?? STATUS_COLORS.pending;
                  const tc = TYPE_COLORS[t.testimonial_type] ?? TYPE_COLORS.manual;
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
                      {/* Hub */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <select
                          value={t.hub ?? (t.source === 'student' ? 'training' : 'modeling')}
                          onChange={e => updateHub(t.id, t.source, e.target.value)}
                          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid #D1D5DB', borderRadius: 5, background: '#fff', cursor: 'pointer' }}
                        >
                          <option value="modeling">Modeling</option>
                          <option value="training">Training</option>
                        </select>
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
                        {t.linkedin_url && (
                          <a href={t.linkedin_url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 9, color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}>in ↗</a>
                        )}
                      </td>
                      {/* Content */}
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#374151', maxWidth: 200 }}>
                        {t.testimonial_type === 'video' && t.video_url ? (
                          <a href={t.video_url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#166534', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
                            ▶ Watch Video ↗
                          </a>
                        ) : (
                          <span title={t.text}>{t.text.slice(0, 80)}{t.text.length > 80 ? '…' : ''}</span>
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
                        <select
                          value={t.status}
                          onChange={e => updateStatus(t.id, t.source, e.target.value)}
                          style={{ fontSize: 11, fontWeight: 700, padding: '4px 8px', border: `1.5px solid ${sc.color}60`, borderRadius: 6, background: sc.bg, color: sc.color, cursor: 'pointer', outline: 'none' }}
                        >
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </td>
                      {/* Date */}
                      <td style={{ padding: '12px 14px', fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                      {/* Actions */}
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 120 }}>
                          {/* Hide / Show */}
                          <button onClick={() => toggleLanding(t.id, t.source, t.show_on_landing ?? false)}
                            title={t.show_on_landing ? 'Visible — click to hide' : 'Hidden — click to show'}
                            style={{ fontSize: 10, fontWeight: 700, background: t.show_on_landing ? '#F0FFF4' : '#F3F4F6', color: t.show_on_landing ? '#1A7A30' : '#6B7280', border: `1px solid ${t.show_on_landing ? '#A3D9AE' : '#E5E7EB'}`, borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {t.show_on_landing ? '👁 Visible' : '🚫 Hidden'}
                          </button>
                          {/* Reset to pending */}
                          {(t.status === 'approved' || t.status === 'rejected') && (
                            <button onClick={() => updateStatus(t.id, t.source, 'pending')}
                              style={{ fontSize: 10, fontWeight: 700, background: '#F3F4F6', color: '#6B7280', border: '1px solid #E5E7EB', borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              Reset
                            </button>
                          )}
                          {/* Feature toggle (student only) */}
                          {t.source === 'student' && (
                            <button onClick={() => toggleFeatured(t.id, t.source, t.is_featured)}
                              style={{ fontSize: 10, fontWeight: 700, background: t.is_featured ? '#FEF3C7' : '#F9FAFB', color: t.is_featured ? '#92400E' : '#6B7280', border: `1px solid ${t.is_featured ? '#FDE68A' : '#E5E7EB'}`, borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {t.is_featured ? '★ Unfeature' : '☆ Feature'}
                            </button>
                          )}
                          {/* Delete */}
                          <button onClick={() => deleteTestimonial(t.id, t.source)}
                            style={{ fontSize: 10, fontWeight: 700, background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA', borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Delete
                          </button>
                        </div>
                        {/* Share buttons */}
                        <ShareButtons t={t} onCopied={() => showToast('Copied to clipboard')} />
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

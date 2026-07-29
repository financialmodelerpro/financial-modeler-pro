'use client';

import { useEffect, useState, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { normalizeLinkedInUrl } from '@/src/shared/utils/externalUrl';

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

const HUB_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  training: { bg: '#E8F7EC', color: '#1A7A30', label: 'Training' },
  modeling: { bg: '#EFF6FF', color: '#1B4F8A', label: 'Modeling' },
};

function buildShareText(t: Testimonial) {
  const quote = t.text.slice(0, 220) + (t.text.length > 220 ? '…' : '');
  const who   = [t.name, t.role, t.company].filter(Boolean).join(' · ');
  const course = t.course_name ? ` (${t.course_name})` : '';
  return `"${quote}" - ${who}${course}`;
}

function ShareButtons({ t, onCopied }: { t: Testimonial; onCopied: () => void }) {
  const origin      = typeof window !== 'undefined' ? window.location.origin : '';
  const hubPath     = t.hub === 'training' ? '/training' : '/modeling';
  const pageUrl     = `${origin}${hubPath}`;
  const shareText   = buildShareText(t);
  const fullMessage = `${shareText}\n\n${pageUrl}`;

  const btnBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, padding: '4px 8px', border: 'none',
    borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
  };

  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
      <button onClick={() => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}&summary=${encodeURIComponent(shareText)}`, '_blank', 'width=600,height=500')}
        style={{ ...btnBase, background: '#0A66C2', color: '#fff' }}>in</button>
      <button onClick={() => window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}&quote=${encodeURIComponent(shareText)}`, '_blank', 'width=600,height=500')}
        style={{ ...btnBase, background: '#1877F2', color: '#fff' }}>fb</button>
      <button onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(fullMessage)}`, '_blank')}
        style={{ ...btnBase, background: '#25D366', color: '#fff' }}>wa</button>
      <button onClick={() => t.video_url ? window.open(t.video_url, '_blank') : navigator.clipboard.writeText(fullMessage).then(onCopied)}
        style={{ ...btnBase, background: t.video_url ? '#FF0000' : '#6B7280', color: '#fff' }}>
        {t.video_url ? '▶yt' : '📋'}
      </button>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, idx) => (
        <span key={idx} style={{ fontSize: 15, color: idx < rating ? '#F59E0B' : '#E5E7EB' }}>★</span>
      ))}
    </>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12, lineHeight: 1.6 }}>
      <span style={{ minWidth: 92, color: '#9CA3AF', fontWeight: 600 }}>{label}</span>
      <span style={{ color: '#374151', flex: 1 }}>{children}</span>
    </div>
  );
}

/** Full-testimonial review modal, so an admin reads the whole thing before approving. */
function ReviewModal({
  t, onClose, onStatus, onToggleLanding, onToggleFeatured, onCopied,
}: {
  t: Testimonial;
  onClose: () => void;
  onStatus: (status: 'pending' | 'approved' | 'rejected') => void;
  onToggleLanding: () => void;
  onToggleFeatured: () => void;
  onCopied: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sc  = STATUS_COLORS[t.status] ?? STATUS_COLORS.pending;
  const hub = HUB_BADGE[t.hub] ?? HUB_BADGE.modeling;

  const actionBtn = (bg: string, color: string, border: string): React.CSSProperties => ({
    fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 7,
    border: `1px solid ${border}`, background: bg, color, cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, width: 'min(720px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.28)', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ padding: '18px 24px', borderBottom: '1px solid #E8F0FB', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800, color: '#1B3A6B' }}>{t.name}</h2>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: hub.bg, color: hub.color }}>{hub.label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: t.source === 'student' ? '#EFF6FF' : '#F3F4F6', color: t.source === 'student' ? '#1D4ED8' : '#6B7280' }}>
                {t.source === 'student' ? 'Student' : 'Manual'}
              </span>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: sc.bg, color: sc.color, textTransform: 'capitalize' }}>{t.status}</span>
            </div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>
              Submitted {new Date(t.created_at).toLocaleString()}
              {t.approved_at ? ` · approved ${new Date(t.approved_at).toLocaleDateString()}` : ''}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', fontSize: 22, lineHeight: 1, color: '#9CA3AF', cursor: 'pointer', padding: 2 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: 24, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {(t.role || t.company) && <MetaRow label="Role">{[t.role, t.company].filter(Boolean).join(' · ')}</MetaRow>}
            {t.course_name && <MetaRow label="Course">{t.course_name}</MetaRow>}
            {t.location && <MetaRow label="Location">{t.location}</MetaRow>}
            <MetaRow label="Type">{t.testimonial_type}</MetaRow>
            <MetaRow label="Rating">
              {t.rating != null ? <Stars rating={t.rating} /> : <span style={{ color: '#9CA3AF' }}>Not rated</span>}
            </MetaRow>
            {t.linkedin_url && (
              <MetaRow label="LinkedIn">
                {normalizeLinkedInUrl(t.linkedin_url) ? (
                  <a href={normalizeLinkedInUrl(t.linkedin_url)!} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', fontWeight: 600, textDecoration: 'none' }}>
                    {t.linkedin_url} ↗
                  </a>
                ) : (
                  <span style={{ color: '#92400E' }}>{t.linkedin_url} (not a usable link)</span>
                )}
              </MetaRow>
            )}
          </div>

          {t.video_url && (
            <a href={t.video_url} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', alignSelf: 'flex-start', background: '#FEE2E2', color: '#B91C1C', fontSize: 13, fontWeight: 700, padding: '9px 16px', borderRadius: 7, textDecoration: 'none' }}>
              ▶ Watch video testimonial ↗
            </a>
          )}

          {/* FULL text, no truncation */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
              Full testimonial{t.text ? ` · ${t.text.trim().split(/\s+/).length} words` : ''}
            </div>
            {t.text ? (
              <div style={{ background: '#F8FAFF', border: '1px solid #E8F0FB', borderRadius: 10, padding: '16px 18px', fontSize: 14, lineHeight: 1.75, color: '#1F2937', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {t.text}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#9CA3AF', fontStyle: 'italic' }}>No written content submitted.</div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div style={{ padding: '16px 24px', borderTop: '1px solid #E8F0FB', background: '#FAFBFF', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => onStatus('approved')} disabled={t.status === 'approved'}
            style={{ ...actionBtn('#1A7A30', '#fff', '#1A7A30'), opacity: t.status === 'approved' ? 0.5 : 1, cursor: t.status === 'approved' ? 'default' : 'pointer' }}>
            ✓ Approve
          </button>
          <button onClick={() => onStatus('rejected')} disabled={t.status === 'rejected'}
            style={{ ...actionBtn('#FEE2E2', '#DC2626', '#FECACA'), opacity: t.status === 'rejected' ? 0.5 : 1, cursor: t.status === 'rejected' ? 'default' : 'pointer' }}>
            ✕ Reject
          </button>
          {t.status !== 'pending' && (
            <button onClick={() => onStatus('pending')} style={actionBtn('#fff', '#6B7280', '#E5E7EB')}>Reset to pending</button>
          )}
          <button onClick={onToggleLanding}
            style={actionBtn(t.show_on_landing ? '#F0FFF4' : '#F3F4F6', t.show_on_landing ? '#1A7A30' : '#6B7280', t.show_on_landing ? '#A3D9AE' : '#E5E7EB')}>
            {t.show_on_landing ? '👁 Visible on site' : '🚫 Hidden'}
          </button>
          {t.source === 'student' && (
            <button onClick={onToggleFeatured}
              style={actionBtn(t.is_featured ? '#FEF3C7' : '#F9FAFB', t.is_featured ? '#92400E' : '#6B7280', t.is_featured ? '#FDE68A' : '#E5E7EB')}>
              {t.is_featured ? '★ Unfeature' : '☆ Feature'}
            </button>
          )}
          <div style={{ marginLeft: 'auto' }}>
            <ShareButtons t={t} onCopied={onCopied} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface SharedProps {
  defaultHub?: HubTab;
}

export default function AdminTestimonialsPage({ defaultHub = 'all' }: SharedProps) {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [statusTab, setStatusTab]       = useState<StatusTab>('all');
  const [hubTab,    setHubTab]          = useState<HubTab>(defaultHub);
  const [loading,   setLoading]         = useState(true);
  const [toast,     setToast]           = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  // Keyed (not a copy) so the open modal reflects the refetched row after every action.
  const [reviewKey, setReviewKey]       = useState<{ id: string; source: string } | null>(null);

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

  const reviewing = reviewKey
    ? testimonials.find(t => t.id === reviewKey.id && t.source === reviewKey.source) ?? null
    : null;

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
    if (statusTab === 'video') return hubFiltered.filter(t => t.testimonial_type === 'video');
    if (statusTab === 'all')   return hubFiltered;
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
    { key: 'all',      label: `All Hubs (${hubCounts.all})`,         color: '#1B4F8A' },
    { key: 'training', label: `Training Hub (${hubCounts.training})`, color: '#2EAA4A' },
    { key: 'modeling', label: `Modeling Hub (${hubCounts.modeling})`, color: '#1B4F8A' },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav
        active="/admin/testimonials"
        badges={totalPending > 0 ? { '/admin/testimonials': totalPending } : undefined}
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

        {/* Hub filter tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {HUB_TABS.map(({ key, label, color }) => (
            <button key={key} onClick={() => { setHubTab(key); setStatusTab('all'); }}
              style={{ padding: '8px 20px', borderRadius: 8, border: `2px solid ${hubTab === key ? color : '#D1D5DB'}`, cursor: 'pointer', fontSize: 13, background: hubTab === key ? color : '#fff', color: hubTab === key ? '#fff' : '#6B7280', fontWeight: 700, transition: 'all 0.15s' }}>
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
                  {['Hub', 'Name / Course', 'Content', 'Rating', 'Status', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => {
                  const sc  = STATUS_COLORS[t.status] ?? STATUS_COLORS.pending;
                  const hub = HUB_BADGE[t.hub] ?? HUB_BADGE.modeling;
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFF' }}>

                      {/* Hub - read-only badge */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: hub.bg, color: hub.color }}>
                          {hub.label}
                        </span>
                      </td>

                      {/* Name / Course */}
                      <td style={{ padding: '12px 14px', fontSize: 12, minWidth: 160 }}>
                        <div style={{ fontWeight: 600, color: '#1B3A6B' }}>{t.name}</div>
                        {(t.role || t.company) && (
                          <div style={{ color: '#9CA3AF', fontSize: 11 }}>{[t.role, t.company].filter(Boolean).join(' · ')}</div>
                        )}
                        {t.location && <div style={{ color: '#9CA3AF', fontSize: 10 }}>{t.location}</div>}
                        {t.course_name && <div style={{ fontSize: 10, color: '#1B4F8A', marginTop: 2, fontWeight: 600 }}>{t.course_name}</div>}
                        <div style={{ marginTop: 3, display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: t.source === 'student' ? '#EFF6FF' : '#F3F4F6', color: t.source === 'student' ? '#1D4ED8' : '#6B7280' }}>
                            {t.source === 'student' ? 'Student' : 'Manual'}
                          </span>
                          {t.is_featured && <span style={{ fontSize: 9, fontWeight: 700, color: '#C9A84C' }}>★ Featured</span>}
                          {normalizeLinkedInUrl(t.linkedin_url) && (
                            <a href={normalizeLinkedInUrl(t.linkedin_url)!} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 9, color: '#0A66C2', textDecoration: 'none', fontWeight: 600 }}>in ↗</a>
                          )}
                        </div>
                      </td>

                      {/* Content - click to read the whole thing before approving */}
                      <td style={{ padding: '12px 14px', fontSize: 12, color: '#374151', maxWidth: 240 }}>
                        {t.testimonial_type === 'video' && t.video_url && (
                          <a href={t.video_url} target="_blank" rel="noopener noreferrer"
                            style={{ display: 'inline-block', marginBottom: 4, color: '#166534', fontWeight: 700, fontSize: 11, textDecoration: 'none' }}>
                            ▶ Watch Video ↗
                          </a>
                        )}
                        {t.text && (
                          <div
                            onClick={() => setReviewKey({ id: t.id, source: t.source })}
                            style={{ cursor: 'pointer' }}
                          >
                            {t.text.slice(0, 90)}{t.text.length > 90 ? '…' : ''}
                          </div>
                        )}
                        <button
                          onClick={() => setReviewKey({ id: t.id, source: t.source })}
                          style={{ marginTop: 5, fontSize: 10, fontWeight: 700, background: t.status === 'pending' ? '#FEF3C7' : '#EFF6FF', color: t.status === 'pending' ? '#92400E' : '#1B4F8A', border: `1px solid ${t.status === 'pending' ? '#FDE68A' : '#DBEAFE'}`, borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          {t.status === 'pending' ? '🔍 Read & review' : '🔍 Read full'}
                        </button>
                      </td>

                      {/* Rating */}
                      <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                        {t.rating != null ? (
                          Array.from({ length: 5 }).map((_, idx) => (
                            <span key={idx} style={{ fontSize: 12, color: idx < t.rating! ? '#F59E0B' : '#E5E7EB' }}>★</span>
                          ))
                        ) : <span style={{ color: '#E5E7EB', fontSize: 11 }}>-</span>}
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
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', minWidth: 130 }}>
                          <button onClick={() => toggleLanding(t.id, t.source, t.show_on_landing ?? false)}
                            title={t.show_on_landing ? 'Visible on site - click to hide' : 'Hidden - click to show'}
                            style={{ fontSize: 10, fontWeight: 700, background: t.show_on_landing ? '#F0FFF4' : '#F3F4F6', color: t.show_on_landing ? '#1A7A30' : '#6B7280', border: `1px solid ${t.show_on_landing ? '#A3D9AE' : '#E5E7EB'}`, borderRadius: 5, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            {t.show_on_landing ? '👁 Visible' : '🚫 Hidden'}
                          </button>
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

      {reviewing && (
        <ReviewModal
          t={reviewing}
          onClose={() => setReviewKey(null)}
          onStatus={status => updateStatus(reviewing.id, reviewing.source, status)}
          onToggleLanding={() => toggleLanding(reviewing.id, reviewing.source, reviewing.show_on_landing ?? false)}
          onToggleFeatured={() => toggleFeatured(reviewing.id, reviewing.source, reviewing.is_featured)}
          onCopied={() => showToast('Copied to clipboard')}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

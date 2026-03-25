'use client';

import { useEffect, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Testimonial {
  id: string;
  name: string;
  role: string;
  company: string;
  text: string;
  rating: number;
  status: 'pending' | 'approved' | 'rejected';
  source: string;
  created_at: string;
  approved_at: string | null;
}

type Tab = 'all' | 'pending' | 'approved' | 'rejected';

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div style={{
      position:'fixed', bottom:24, right:24, zIndex:9999,
      background: type === 'success' ? '#1A7A30' : '#DC2626',
      color:'#fff', padding:'12px 20px', borderRadius:10, fontSize:13, fontWeight:600,
      boxShadow:'0 4px 24px rgba(0,0,0,0.2)',
    }}>
      {message}
    </div>
  );
}

export default function AdminTestimonialsPage() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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

  async function updateStatus(id: string, status: string) {
    try {
      const res = await fetch('/api/admin/testimonials', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error();
      showToast(`Testimonial ${status}`);
      await fetchTestimonials();
    } catch {
      showToast('Failed to update', 'error');
    }
  }

  async function deleteTestimonial(id: string) {
    if (!confirm('Delete this testimonial? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/admin/testimonials?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      showToast('Deleted');
      await fetchTestimonials();
    } catch {
      showToast('Failed to delete', 'error');
    }
  }

  const filtered = tab === 'all' ? testimonials : testimonials.filter(t => t.status === tab);
  const counts = {
    all: testimonials.length,
    pending: testimonials.filter(t => t.status === 'pending').length,
    approved: testimonials.filter(t => t.status === 'approved').length,
    rejected: testimonials.filter(t => t.status === 'rejected').length,
  };

  const TAB_LABELS: { key: Tab; label: string }[] = [
    { key: 'all',      label: `All (${counts.all})` },
    { key: 'pending',  label: `Pending (${counts.pending})` },
    { key: 'approved', label: `Approved (${counts.approved})` },
    { key: 'rejected', label: `Rejected (${counts.rejected})` },
  ];

  const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
    pending:  { bg: '#FEF3C7', color: '#92400E' },
    approved: { bg: '#E8F7EC', color: '#1A7A30' },
    rejected: { bg: '#FEE2E2', color: '#DC2626' },
  };

  return (
    <div style={{ display:'flex', minHeight:'100vh', fontFamily:"'Inter',sans-serif", background:'#F4F7FC' }}>
      <CmsAdminNav active="/admin/testimonials" />
      <main style={{ flex:1, padding:40, overflowY:'auto' }}>

        {/* Header */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:28, flexWrap:'wrap', gap:16 }}>
          <div>
            <h1 style={{ fontSize:24, fontWeight:800, color:'#1B3A6B', marginBottom:4 }}>Testimonials</h1>
            <p style={{ fontSize:13, color:'#6B7280' }}>{testimonials.length} total submissions</p>
          </div>
          <div style={{ background:'#E8F0FB', border:'1px solid #C7D9F2', borderRadius:10, padding:'12px 18px', fontSize:13, color:'#1B4F8A' }}>
            <span style={{ fontWeight:600 }}>Public submission link:</span>{' '}
            <a href="/testimonials/submit" target="_blank" rel="noopener noreferrer" style={{ color:'#1B4F8A', fontWeight:700 }}>
              /testimonials/submit ↗
            </a>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:24, background:'#fff', padding:'6px', borderRadius:10, border:'1px solid #E8F0FB', width:'fit-content' }}>
          {TAB_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding:'7px 16px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13,
                background: tab === key ? '#1B4F8A' : 'transparent',
                color: tab === key ? '#fff' : '#6B7280',
                fontWeight: tab === key ? 700 : 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ background:'#fff', borderRadius:12, border:'1px solid #E8F0FB', overflow:'hidden' }}>
          {loading ? (
            <div style={{ padding:'48px 24px', textAlign:'center', color:'#6B7280', fontSize:14 }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding:'48px 24px', textAlign:'center', color:'#6B7280', fontSize:14 }}>
              No testimonials in this category.
            </div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#1B4F8A' }}>
                  {['Name', 'Role / Company', 'Preview', 'Rating', 'Status', 'Date', 'Actions'].map(h => (
                    <th key={h} style={{ padding:'12px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:'#fff', letterSpacing:'0.05em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t, i) => {
                  const sc = STATUS_COLORS[t.status] ?? STATUS_COLORS.pending;
                  return (
                    <tr key={t.id} style={{ borderBottom:'1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFBFF' }}>
                      <td style={{ padding:'12px 14px', fontSize:13, fontWeight:600, color:'#1B3A6B', whiteSpace:'nowrap' }}>{t.name}</td>
                      <td style={{ padding:'12px 14px', fontSize:12, color:'#6B7280' }}>
                        <div>{t.role || '—'}</div>
                        <div style={{ color:'#9CA3AF' }}>{t.company || ''}</div>
                      </td>
                      <td style={{ padding:'12px 14px', fontSize:13, color:'#374151', maxWidth:220 }}>
                        <span title={t.text}>{t.text.slice(0, 80)}{t.text.length > 80 ? '…' : ''}</span>
                      </td>
                      <td style={{ padding:'12px 14px', whiteSpace:'nowrap' }}>
                        {Array.from({length:5}).map((_,idx) => (
                          <span key={idx} style={{ fontSize:13, color: idx < t.rating ? '#F59E0B' : '#E5E7EB' }}>★</span>
                        ))}
                      </td>
                      <td style={{ padding:'12px 14px' }}>
                        <span style={{ background:sc.bg, color:sc.color, fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:20, textTransform:'capitalize', letterSpacing:'0.04em' }}>
                          {t.status}
                        </span>
                      </td>
                      <td style={{ padding:'12px 14px', fontSize:12, color:'#9CA3AF', whiteSpace:'nowrap' }}>
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ display:'flex', gap:6, flexWrap:'nowrap' }}>
                          {t.status === 'pending' && (
                            <>
                              <button onClick={() => updateStatus(t.id, 'approved')}
                                style={{ fontSize:11, fontWeight:700, background:'#E8F7EC', color:'#1A7A30', border:'1px solid #A3D9AE', borderRadius:6, padding:'4px 10px', cursor:'pointer', whiteSpace:'nowrap' }}>
                                Approve
                              </button>
                              <button onClick={() => updateStatus(t.id, 'rejected')}
                                style={{ fontSize:11, fontWeight:700, background:'#FEE2E2', color:'#DC2626', border:'1px solid #FECACA', borderRadius:6, padding:'4px 10px', cursor:'pointer', whiteSpace:'nowrap' }}>
                                Reject
                              </button>
                            </>
                          )}
                          {t.status === 'approved' && (
                            <button onClick={() => updateStatus(t.id, 'pending')}
                              style={{ fontSize:11, fontWeight:700, background:'#F3F4F6', color:'#6B7280', border:'1px solid #E5E7EB', borderRadius:6, padding:'4px 10px', cursor:'pointer', whiteSpace:'nowrap' }}>
                              Undo
                            </button>
                          )}
                          {t.status === 'rejected' && (
                            <button onClick={() => updateStatus(t.id, 'pending')}
                              style={{ fontSize:11, fontWeight:700, background:'#F3F4F6', color:'#6B7280', border:'1px solid #E5E7EB', borderRadius:6, padding:'4px 10px', cursor:'pointer', whiteSpace:'nowrap' }}>
                              Undo
                            </button>
                          )}
                          <button onClick={() => deleteTestimonial(t.id)}
                            style={{ fontSize:11, fontWeight:700, background:'#FEE2E2', color:'#DC2626', border:'1px solid #FECACA', borderRadius:6, padding:'4px 10px', cursor:'pointer', whiteSpace:'nowrap' }}>
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

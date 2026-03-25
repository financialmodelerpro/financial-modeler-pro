'use client';

import { useEffect, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface Submission {
  id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  read: boolean;
  created_at: string;
}

type Tab = 'info' | 'submissions';

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

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontSize: 14,
  border: '1px solid #D1D5DB',
  borderRadius: 8,
  background: '#FFFBEB',
  color: '#374151',
  outline: 'none',
  boxSizing: 'border-box',
};

export default function AdminContactPage() {
  const [tab, setTab] = useState<Tab>('info');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Contact info fields
  const [infoFields, setInfoFields] = useState({ email: '', phone: '', address: '', maps_url: '' });
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [savingInfo, setSavingInfo] = useState(false);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type });
  }

  // Load contact info from CMS
  useEffect(() => {
    async function loadInfo() {
      try {
        const res = await fetch('/api/admin/content');
        const data = await res.json();
        const rows: { section: string; key: string; value: string }[] = data.rows ?? [];
        const map: Record<string, string> = {};
        for (const r of rows) {
          if (r.section === 'contact') map[r.key] = r.value;
        }
        setInfoFields({
          email:    map['email']    ?? '',
          phone:    map['phone']    ?? '',
          address:  map['address']  ?? '',
          maps_url: map['maps_url'] ?? '',
        });
      } catch {
        // ignore
      } finally {
        setLoadingInfo(false);
      }
    }
    loadInfo();
  }, []);

  async function saveInfo() {
    setSavingInfo(true);
    try {
      // PATCH each field individually using the existing admin content API
      const entries = Object.entries(infoFields) as [string, string][];
      await Promise.all(entries.map(([key, value]) =>
        fetch('/api/admin/content', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ section: 'contact', key, value }),
        })
      ));
      showToast('Contact info saved');
    } catch {
      showToast('Failed to save', 'error');
    } finally {
      setSavingInfo(false);
    }
  }

  async function loadSubmissions() {
    setLoadingSubs(true);
    try {
      const res = await fetch('/api/admin/contact-submissions');
      const data = await res.json();
      setSubmissions(data.submissions ?? []);
    } catch {
      showToast('Failed to load submissions', 'error');
    } finally {
      setLoadingSubs(false);
    }
  }

  useEffect(() => {
    if (tab === 'submissions') loadSubmissions();
  }, [tab]);

  async function markRead(id: string, read: boolean) {
    try {
      await fetch('/api/admin/contact-submissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, read }),
      });
      setSubmissions(prev => prev.map(s => s.id === id ? { ...s, read } : s));
    } catch {
      showToast('Failed to update', 'error');
    }
  }

  return (
    <div style={{ display:'flex', minHeight:'100vh', fontFamily:"'Inter',sans-serif", background:'#F4F7FC' }}>
      <CmsAdminNav active="/admin/contact" />
      <main style={{ flex:1, padding:40, overflowY:'auto' }}>

        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontSize:24, fontWeight:800, color:'#1B3A6B', marginBottom:4 }}>Contact</h1>
          <p style={{ fontSize:13, color:'#6B7280' }}>Manage contact information and view submissions.</p>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', gap:4, marginBottom:32, background:'#fff', padding:'6px', borderRadius:10, border:'1px solid #E8F0FB', width:'fit-content' }}>
          {([['info','Contact Info'],['submissions','Submissions']] as [Tab,string][]).map(([key,label]) => (
            <button key={key} onClick={() => setTab(key)}
              style={{ padding:'7px 18px', borderRadius:7, border:'none', cursor:'pointer', fontSize:13,
                background: tab === key ? '#1B4F8A' : 'transparent',
                color: tab === key ? '#fff' : '#6B7280',
                fontWeight: tab === key ? 700 : 500 }}>
              {label}
            </button>
          ))}
        </div>

        {/* Contact Info Tab */}
        {tab === 'info' && (
          <div style={{ background:'#fff', borderRadius:12, border:'1px solid #E8F0FB', padding:'32px 28px', maxWidth:600 }}>
            <h2 style={{ fontSize:16, fontWeight:700, color:'#1B3A6B', marginBottom:24 }}>Contact Details</h2>
            {loadingInfo ? (
              <div style={{ color:'#6B7280', fontSize:14 }}>Loading...</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
                {([
                  { key:'email',    label:'Email Address',   placeholder:'hello@example.com', type:'email' },
                  { key:'phone',    label:'Phone Number',    placeholder:'+1 (555) 000-0000',  type:'text'  },
                  { key:'address',  label:'Office Address',  placeholder:'City, Country',      type:'text'  },
                  { key:'maps_url', label:'Google Maps URL', placeholder:'https://maps.google.com/...', type:'url' },
                ] as { key: keyof typeof infoFields; label: string; placeholder: string; type: string }[]).map(f => (
                  <div key={f.key}>
                    <label style={{ display:'block', fontSize:13, fontWeight:600, color:'#374151', marginBottom:6 }}>{f.label}</label>
                    <input
                      type={f.type}
                      value={infoFields[f.key]}
                      onChange={e => setInfoFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder}
                      style={INPUT_STYLE}
                    />
                  </div>
                ))}
                <button
                  onClick={saveInfo}
                  disabled={savingInfo}
                  style={{ background: savingInfo ? '#9CA3AF' : '#1B4F8A', color:'#fff', fontSize:13, fontWeight:700, padding:'11px 24px', borderRadius:8, border:'none', cursor: savingInfo ? 'not-allowed' : 'pointer', width:'fit-content' }}>
                  {savingInfo ? 'Saving...' : 'Save Changes →'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Submissions Tab */}
        {tab === 'submissions' && (
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <p style={{ fontSize:13, color:'#6B7280' }}>{submissions.length} submissions</p>
              <button onClick={loadSubmissions} style={{ fontSize:12, color:'#1B4F8A', background:'none', border:'1px solid #C7D9F2', borderRadius:6, padding:'5px 12px', cursor:'pointer', fontWeight:600 }}>
                Refresh
              </button>
            </div>
            <div style={{ background:'#fff', borderRadius:12, border:'1px solid #E8F0FB', overflow:'hidden' }}>
              {loadingSubs ? (
                <div style={{ padding:'48px 24px', textAlign:'center', color:'#6B7280', fontSize:14 }}>Loading...</div>
              ) : submissions.length === 0 ? (
                <div style={{ padding:'48px 24px', textAlign:'center', color:'#6B7280', fontSize:14 }}>No submissions yet.</div>
              ) : (
                <table style={{ width:'100%', borderCollapse:'collapse' }}>
                  <thead>
                    <tr style={{ background:'#1B4F8A' }}>
                      {['Name', 'Email', 'Subject', 'Message', 'Date', 'Status'].map(h => (
                        <th key={h} style={{ padding:'12px 14px', textAlign:'left', fontSize:11, fontWeight:700, color:'#fff', letterSpacing:'0.05em', textTransform:'uppercase', whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s, i) => (
                      <tr key={s.id} style={{ borderBottom:'1px solid #F3F4F6', background: s.read ? (i%2===0?'#fff':'#FAFBFF') : '#FFFBEB' }}>
                        <td style={{ padding:'12px 14px', fontSize:13, fontWeight: s.read ? 400 : 700, color:'#1B3A6B', whiteSpace:'nowrap' }}>{s.name}</td>
                        <td style={{ padding:'12px 14px', fontSize:12, color:'#1B4F8A' }}>
                          <a href={`mailto:${s.email}`} style={{ color:'#1B4F8A', textDecoration:'none' }}>{s.email}</a>
                        </td>
                        <td style={{ padding:'12px 14px', fontSize:13, color:'#374151' }}>{s.subject || '—'}</td>
                        <td style={{ padding:'12px 14px', fontSize:13, color:'#374151', maxWidth:240 }}>
                          <span title={s.message}>{s.message.slice(0, 80)}{s.message.length > 80 ? '…' : ''}</span>
                        </td>
                        <td style={{ padding:'12px 14px', fontSize:12, color:'#9CA3AF', whiteSpace:'nowrap' }}>
                          {new Date(s.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          <button
                            onClick={() => markRead(s.id, !s.read)}
                            style={{
                              fontSize:11, fontWeight:700, borderRadius:6, padding:'4px 10px', cursor:'pointer', border:'1px solid',
                              background: s.read ? '#F3F4F6' : '#E8F0FB',
                              color: s.read ? '#6B7280' : '#1B4F8A',
                              borderColor: s.read ? '#E5E7EB' : '#C7D9F2',
                              whiteSpace:'nowrap',
                            }}>
                            {s.read ? 'Unread' : 'Mark Read'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

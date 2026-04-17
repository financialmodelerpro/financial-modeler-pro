'use client';

import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

const IS: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', outline: 'none', boxSizing: 'border-box' };
const LS: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 3 };
const TA: React.CSSProperties = { ...IS, resize: 'vertical' as const, minHeight: 60, fontFamily: 'monospace', fontSize: 12 };
const BTN: React.CSSProperties = { padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: '#2EAA4A', color: '#fff', border: 'none', cursor: 'pointer' };

interface Branding {
  logo_url: string; logo_width: number; logo_alt: string;
  signature_html: string; footer_text: string; primary_color: string;
}

interface Template {
  id: string; template_key: string; subject: string; body_html: string; is_active: boolean;
}

const TEMPLATE_LABELS: Record<string, string> = {
  session_announcement: 'New Session Announcement',
  session_reminder_24h: '24-Hour Reminder',
  session_reminder_1h: '1-Hour Reminder',
  session_recording_available: 'Recording Available',
};

const PLACEHOLDERS = '{{student_name}}, {{session_title}}, {{session_date}}, {{session_time}}, {{session_timezone}}, {{session_duration}}, {{session_description}}, {{instructor_name}}, {{join_url}}, {{view_url}}, {{youtube_url}}, {{registration_count}}';

export default function EmailSettingsPage() {
  const [branding, setBranding] = useState<Branding>({
    logo_url: '', logo_width: 180, logo_alt: 'Financial Modeler Pro',
    signature_html: '', footer_text: '', primary_color: '#1F3864',
  });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [saving, setSaving] = useState('');
  const [toast, setToast] = useState('');
  const [uploading, setUploading] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/email-templates');
    const data = await res.json();
    if (data.branding) setBranding(data.branding);
    if (data.templates) setTemplates(data.templates);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveBranding() {
    setSaving('branding');
    try {
      await fetch('/api/admin/email-templates/branding', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(branding),
      });
      showToast('Email branding saved');
    } catch { showToast('Save failed'); }
    finally { setSaving(''); }
  }

  async function saveTemplate(key: string) {
    const tpl = templates.find(t => t.template_key === key);
    if (!tpl) return;
    setSaving(key);
    try {
      await fetch(`/api/admin/email-templates/${key}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: tpl.subject, body_html: tpl.body_html, is_active: tpl.is_active }),
      });
      showToast(`Template "${TEMPLATE_LABELS[key]}" saved`);
    } catch { showToast('Save failed'); }
    finally { setSaving(''); }
  }

  async function sendTest(key: string) {
    setSaving(`test-${key}`);
    try {
      const res = await fetch(`/api/admin/email-templates/${key}/test`, { method: 'POST' });
      const data = await res.json();
      showToast(data.success ? `Test sent to ${data.sentTo}` : 'Test send failed');
    } catch { showToast('Test send failed'); }
    finally { setSaving(''); }
  }

  async function uploadLogo() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.svg';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('folder', 'email');
      try {
        const res = await fetch('/api/admin/site-settings', { method: 'POST', body: fd });
        const data = await res.json();
        if (data.url) setBranding(prev => ({ ...prev, logo_url: data.url }));
      } catch {}
      finally { setUploading(false); }
    };
    input.click();
  }

  function updateTemplate(key: string, field: string, value: unknown) {
    setTemplates(prev => prev.map(t => t.template_key === key ? { ...t, [field]: value } : t));
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '12px 24px', background: '#fff', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12 }}>
          <a href="/admin/training-hub/live-sessions" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none' }}>&larr; Live Sessions</a>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0D2E5A', flex: 1 }}>Email Settings</h1>
          {toast && <span style={{ fontSize: 12, fontWeight: 600, color: '#2EAA4A' }}>{toast}</span>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 24, display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900 }}>

          {/* ═══ SECTION A: Email Branding ═══ */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A', marginBottom: 4 }}>Email Branding</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>This logo and signature appear in ALL emails sent by the platform.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Logo */}
              <div>
                <label style={LS}>Logo URL</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={{ ...IS, flex: 1 }} value={branding.logo_url} onChange={e => setBranding(p => ({ ...p, logo_url: e.target.value }))} placeholder="https://..." />
                  <button disabled={uploading} onClick={uploadLogo} style={{ ...BTN, background: '#0D2E5A', fontSize: 11, padding: '7px 12px' }}>
                    {uploading ? '...' : 'Upload Logo'}
                  </button>
                </div>
                {branding.logo_url && (
                  <div style={{ marginTop: 8, padding: 12, background: '#1F3864', borderRadius: 8, display: 'inline-block' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={branding.logo_url} alt={branding.logo_alt} style={{ width: branding.logo_width, height: 'auto', display: 'block' }} />
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div><label style={LS}>Logo Width (px)</label><input style={IS} type="number" value={branding.logo_width} onChange={e => setBranding(p => ({ ...p, logo_width: Number(e.target.value) }))} /></div>
                <div><label style={LS}>Logo Alt Text</label><input style={IS} value={branding.logo_alt} onChange={e => setBranding(p => ({ ...p, logo_alt: e.target.value }))} /></div>
                <div>
                  <label style={LS}>Primary Color</label>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input type="color" value={branding.primary_color} onChange={e => setBranding(p => ({ ...p, primary_color: e.target.value }))} style={{ width: 28, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
                    <input style={IS} value={branding.primary_color} onChange={e => setBranding(p => ({ ...p, primary_color: e.target.value }))} />
                  </div>
                </div>
              </div>

              {/* Signature */}
              <div>
                <label style={LS}>Signature HTML</label>
                <textarea style={{ ...TA, minHeight: 100 }} value={branding.signature_html} onChange={e => setBranding(p => ({ ...p, signature_html: e.target.value }))} />
                <div style={{ fontSize: 10, fontWeight: 600, color: '#9CA3AF', marginTop: 4, marginBottom: 4 }}>Preview:</div>
                <div style={{ padding: 12, background: '#F9FAFB', borderRadius: 6, border: '1px solid #E5E7EB' }} dangerouslySetInnerHTML={{ __html: branding.signature_html }} />
              </div>

              {/* Footer */}
              <div>
                <label style={LS}>Footer Text</label>
                <input style={IS} value={branding.footer_text} onChange={e => setBranding(p => ({ ...p, footer_text: e.target.value }))} />
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Use {'{year}'} for current year</div>
              </div>

              <button onClick={saveBranding} disabled={saving === 'branding'} style={{ ...BTN, alignSelf: 'flex-start', background: saving === 'branding' ? '#9CA3AF' : '#2EAA4A' }}>
                {saving === 'branding' ? 'Saving...' : 'Save Branding'}
              </button>
            </div>
          </div>

          {/* ═══ SECTION B: Email Templates ═══ */}
          <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A', marginBottom: 4 }}>Live Session Email Templates</div>
            <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 16 }}>Customize the emails sent automatically for live sessions.</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {templates.map(tpl => (
                <div key={tpl.template_key} style={{
                  padding: 16, borderRadius: 8,
                  border: tpl.is_active ? '1px solid #BBF7D0' : '1px solid #E5E7EB',
                  background: tpl.is_active ? '#FAFFF8' : '#F9FAFB',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', flex: 1 }}>
                      {TEMPLATE_LABELS[tpl.template_key] ?? tpl.template_key}
                    </div>
                    <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="checkbox" checked={tpl.is_active} onChange={e => updateTemplate(tpl.template_key, 'is_active', e.target.checked)} />
                      Active
                    </label>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <label style={LS}>Subject Line</label>
                    <input style={IS} value={tpl.subject} onChange={e => updateTemplate(tpl.template_key, 'subject', e.target.value)} />
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <label style={LS}>Body HTML</label>
                    <textarea style={{ ...TA, minHeight: 160 }} value={tpl.body_html} onChange={e => updateTemplate(tpl.template_key, 'body_html', e.target.value)} />
                    <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                      Available placeholders: {PLACEHOLDERS}
                    </div>
                    <div style={{ fontSize: 10, color: '#9CA3AF' }}>
                      Conditional blocks: {'{{#key}}...content...{{/key}}'} - shown only if key has a value
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => saveTemplate(tpl.template_key)} disabled={saving === tpl.template_key}
                      style={{ ...BTN, fontSize: 12, padding: '6px 16px', background: saving === tpl.template_key ? '#9CA3AF' : '#2EAA4A' }}>
                      {saving === tpl.template_key ? 'Saving...' : 'Save Template'}
                    </button>
                    <button onClick={() => sendTest(tpl.template_key)} disabled={saving === `test-${tpl.template_key}`}
                      style={{ ...BTN, fontSize: 12, padding: '6px 16px', background: saving === `test-${tpl.template_key}` ? '#9CA3AF' : '#0D2E5A' }}>
                      {saving === `test-${tpl.template_key}` ? 'Sending...' : 'Send Test Email'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

/* ─── tab definitions ─── */
const TABS = [
  { id: 'basic',    label: 'Basic Info' },
  { id: 'summary',  label: 'Professional Summary' },
  { id: 'expertise',label: 'Expertise Tags' },
  { id: 'career',   label: 'Career Highlights' },
  { id: 'pacemakers',label: 'PaceMakers Info' },
  { id: 'social',   label: 'Social & Contact' },
];

/* ─── field definitions per tab ─── */
interface FieldDef { section: string; key: string; label: string; multiline?: boolean; placeholder?: string }

const FIELDS_BASIC: FieldDef[] = [
  { section: 'bio', key: 'name',         label: 'Full Name',        placeholder: 'Ahmad Din' },
  { section: 'bio', key: 'title',        label: 'Title / Role',     placeholder: 'Founder & Lead Instructor' },
  { section: 'bio', key: 'organisation', label: 'Organisation',     placeholder: 'CEO & Founder — Financial Modeler Pro | PaceMakers Business Consultants' },
  { section: 'bio', key: 'location',     label: 'Location',         placeholder: 'Lahore, Pakistan' },
  // photo_url is managed exclusively by the Upload widget below — omitting here prevents
  // saveTab() from overwriting the base64 value with whatever appears in a text input.
];

const FIELDS_SUMMARY: FieldDef[] = [
  { section: 'bio', key: 'short_bio', label: 'Short Bio (landing page preview)', multiline: true, placeholder: '2-3 sentence summary…' },
  { section: 'bio', key: 'long_bio',  label: 'Full Bio (about page)',            multiline: true, placeholder: 'Full biography…' },
  { section: 'philosophy', key: 'text', label: 'Modeling Philosophy Quote', multiline: true, placeholder: 'A good financial model is…' },
];

const FIELDS_EXPERTISE: FieldDef[] = [
  { section: 'expertise', key: 'tag_1', label: 'Tag 1', placeholder: 'Real Estate Financial Modeling' },
  { section: 'expertise', key: 'tag_2', label: 'Tag 2', placeholder: 'DCF & Valuation' },
  { section: 'expertise', key: 'tag_3', label: 'Tag 3', placeholder: 'Business Valuation' },
  { section: 'expertise', key: 'tag_4', label: 'Tag 4', placeholder: 'Project Finance' },
  { section: 'expertise', key: 'tag_5', label: 'Tag 5', placeholder: 'FP&A Modeling' },
  { section: 'expertise', key: 'tag_6', label: 'Tag 6', placeholder: 'Transaction Advisory' },
  { section: 'expertise', key: 'tag_7', label: 'Tag 7', placeholder: 'Financial Modeling Training' },
  { section: 'expertise', key: 'tag_8', label: 'Tag 8', placeholder: 'LBO Modeling' },
];

const FIELDS_CAREER: FieldDef[] = [
  { section: 'experience', key: 'item_1', label: 'Career Highlight 1', placeholder: 'Founded Financial Modeler Pro…' },
  { section: 'experience', key: 'item_2', label: 'Career Highlight 2', placeholder: 'CEO & Founder of PaceMakers…' },
  { section: 'experience', key: 'item_3', label: 'Career Highlight 3', placeholder: 'Delivered training across Middle East…' },
  { section: 'experience', key: 'item_4', label: 'Career Highlight 4', placeholder: 'Built models for residential towers…' },
  { section: 'experience', key: 'item_5', label: 'Career Highlight 5', placeholder: 'Expertise in real estate finance…' },
  { section: 'experience', key: 'item_6', label: 'Career Highlight 6 (optional)', placeholder: '' },
];

const FIELDS_PACEMAKERS: FieldDef[] = [
  { section: 'pacemakers', key: 'tagline',     label: 'PaceMakers Tagline',    placeholder: 'Transaction Advisory & Financial Modeling' },
  { section: 'pacemakers', key: 'description', label: 'About PaceMakers',      multiline: true, placeholder: 'PaceMakers Business Consultants is…' },
  { section: 'pacemakers', key: 'website',     label: 'Website URL',           placeholder: 'https://pacemakersbc.com' },
  { section: 'pacemakers', key: 'services',    label: 'Services (comma-separated)', placeholder: 'Financial Modeling, DCF Analysis, Feasibility Studies' },
];

const FIELDS_SOCIAL: FieldDef[] = [
  { section: 'bio', key: 'linkedin_url', label: 'LinkedIn URL',  placeholder: 'https://linkedin.com/in/…' },
  { section: 'bio', key: 'youtube_url',  label: 'YouTube Channel URL', placeholder: 'https://youtube.com/@…' },
  { section: 'social', key: 'twitter_url',  label: 'Twitter / X URL',  placeholder: 'https://twitter.com/…' },
  { section: 'social', key: 'email',        label: 'Contact Email',     placeholder: 'ahmad@…' },
  { section: 'social', key: 'calendly_url', label: 'Calendly / Booking URL', placeholder: 'https://calendly.com/…' },
];

const FIELDS_BY_TAB: Record<string, FieldDef[]> = {
  basic:      FIELDS_BASIC,
  summary:    FIELDS_SUMMARY,
  expertise:  FIELDS_EXPERTISE,
  career:     FIELDS_CAREER,
  pacemakers: FIELDS_PACEMAKERS,
  social:     FIELDS_SOCIAL,
};

export default function AdminFounderPage() {
  const [activeTab, setActiveTab] = useState('basic');
  const [values,    setValues]    = useState<Record<string, string>>({});
  const [saving,    setSaving]    = useState<Record<string, boolean>>({});
  const [saved,     setSaved]     = useState<Record<string, boolean>>({});
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState('');

  useEffect(() => {
    fetch('/api/admin/founder')
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, string> = {};
        for (const row of j.rows ?? []) {
          map[`${row.section}__${row.key}`] = row.value ?? '';
        }
        setValues(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function fkey(f: FieldDef) { return `${f.section}__${f.key}`; }

  async function saveField(f: FieldDef) {
    const k = fkey(f);
    setSaving((p) => ({ ...p, [k]: true }));
    try {
      await fetch('/api/admin/founder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: f.section, key: f.key, value: values[k] ?? '' }),
      });
      setSaved((p) => ({ ...p, [k]: true }));
      setTimeout(() => setSaved((p) => ({ ...p, [k]: false })), 2500);
      showToast('Saved!');
    } finally {
      setSaving((p) => ({ ...p, [k]: false }));
    }
  }

  async function saveTab() {
    const fields = FIELDS_BY_TAB[activeTab] ?? [];
    for (const f of fields) await saveField(f);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadPreview, setUploadPreview] = useState('');
  const [uploading, setUploading] = useState(false);

  function handlePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target?.result as string;
      setUploadPreview(base64);
      setValues(p => ({ ...p, 'bio__photo_url': base64 }));
    };
    reader.readAsDataURL(file);
  }

  async function savePhoto() {
    const val = values['bio__photo_url'] ?? '';
    if (!val) return;
    setUploading(true);
    try {
      await fetch('/api/admin/founder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'bio', key: 'photo_url', value: val }),
      });
      showToast('Photo saved!');
    } finally {
      setUploading(false);
    }
  }

  const fields = FIELDS_BY_TAB[activeTab] ?? [];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />

      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ maxWidth: 860 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>Founder Profile</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>
            Edit Ahmad's public profile. Changes reflect on the landing page and about section within 60 seconds.
          </p>

          {/* Tab Bar */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #E5E7EB', marginBottom: 28, overflowX: 'auto' }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                style={{
                  padding: '9px 18px', fontSize: 13, fontWeight: activeTab === t.id ? 700 : 500,
                  border: 'none', background: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  borderBottom: activeTab === t.id ? '2px solid #1B4F8A' : '2px solid transparent',
                  color: activeTab === t.id ? '#1B4F8A' : '#6B7280',
                  marginBottom: -2,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#6B7280' }}>Loading profile…</div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 28 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {fields.map((f) => {
                  const k = fkey(f);
                  return (
                    <div key={k}>
                      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                        {f.label}
                      </label>
                      {/* Expertise tags get chip preview */}
                      {activeTab === 'expertise' && values[k] && (
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ display: 'inline-block', background: '#EFF6FF', border: '1px solid #BFDBFE', color: '#1D4ED8', fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 12 }}>
                            {values[k]}
                          </span>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        {f.multiline ? (
                          <textarea
                            value={values[k] ?? ''}
                            placeholder={f.placeholder}
                            onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                            rows={5}
                            style={inputStyle}
                          />
                        ) : (
                          <input
                            value={values[k] ?? ''}
                            placeholder={f.placeholder}
                            onChange={(e) => setValues((p) => ({ ...p, [k]: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && saveField(f)}
                            style={inputStyle}
                          />
                        )}
                        <button
                          onClick={() => saveField(f)}
                          disabled={saving[k]}
                          style={{
                            padding: '8px 16px', fontSize: 12, fontWeight: 700,
                            borderRadius: 7, border: 'none', cursor: saving[k] ? 'not-allowed' : 'pointer', flexShrink: 0,
                            background: saved[k] ? '#1A7A30' : '#1B4F8A', color: '#fff',
                            opacity: saving[k] ? 0.7 : 1, transition: 'background 0.2s',
                          }}
                        >
                          {saving[k] ? '…' : saved[k] ? '✓ Saved' : 'Save'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Photo Upload — only shown on Basic Info tab */}
              {activeTab === 'basic' && (
                <div style={{ marginTop: 24, padding: 20, background: '#F4F7FC', border: '1px solid #E8F0FB', borderRadius: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Upload Profile Photo</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    {/* Preview */}
                    <div style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', position: 'relative', border: '2px solid #C7D9F2', background: '#E8F0FB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {(uploadPreview || values['bio__photo_url']) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={uploadPreview || values['bio__photo_url']} alt="Preview" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
                      ) : (
                        <span style={{ fontSize: 24, fontWeight: 800, color: '#1B4F8A' }}>AD</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handlePhotoFile} style={{ display: 'none' }} />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700, borderRadius: 7, border: '1px solid #C7D9F2', background: '#fff', cursor: 'pointer', color: '#1B4F8A' }}
                      >
                        Choose File…
                      </button>
                      <button
                        onClick={savePhoto}
                        disabled={uploading || !values['bio__photo_url']}
                        style={{ padding: '7px 18px', fontSize: 12, fontWeight: 700, borderRadius: 7, border: 'none', background: '#1B4F8A', color: '#fff', cursor: 'pointer', opacity: uploading || !values['bio__photo_url'] ? 0.5 : 1 }}
                      >
                        {uploading ? 'Saving…' : 'Save Photo'}
                      </button>
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', lineHeight: 1.5 }}>
                      JPG / PNG / WebP<br />Stored as base64 in DB.<br />Also paste a URL in the field above.
                    </div>
                  </div>
                </div>
              )}

              <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={saveTab}
                  style={{ padding: '10px 28px', fontSize: 13, fontWeight: 700, background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                >
                  Save All on This Tab
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1A7A30', color: '#fff', fontWeight: 700, fontSize: 13, padding: '10px 20px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1, padding: '8px 12px', fontSize: 13,
  border: '1px solid #D1D5DB', borderRadius: 7,
  background: '#FFFBEB', fontFamily: 'Inter, sans-serif',
  outline: 'none', color: '#374151', boxSizing: 'border-box',
  resize: 'vertical',
};

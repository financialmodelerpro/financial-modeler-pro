'use client';

import { useState, useRef } from 'react';

interface StudentProfileData {
  job_title?: string;
  company?: string;
  location?: string;
  linkedin_url?: string;
  notify_milestones?: boolean;
  notify_reminders?: boolean;
  display_name?: string;
  avatar_url?: string;
}

interface ProfileModalProps {
  registrationId: string;
  initial: StudentProfileData | null;
  onClose: () => void;
  onSave: (p: StudentProfileData) => void;
}

export function ProfileModal({ registrationId, initial, onClose, onSave }: ProfileModalProps) {
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [avatarUrl, setAvatarUrl]     = useState(initial?.avatar_url ?? '');
  const [avatarPreview, setAvatarPreview] = useState(initial?.avatar_url ?? '');
  const [jobTitle, setJobTitle]       = useState(initial?.job_title ?? '');
  const [company, setCompany]         = useState(initial?.company ?? '');
  const [location, setLocation]       = useState(initial?.location ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(initial?.linkedin_url ?? '');
  const [notifyM, setNotifyM]         = useState(initial?.notify_milestones ?? true);
  const [notifyR, setNotifyR]         = useState(initial?.notify_reminders ?? true);
  const [saving, setSaving]           = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading]     = useState(false);
  const fileRef                        = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: { target: { files: FileList | null } }) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError('');

    // Client-side validation
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      setUploadError('Invalid file type. Use JPG, PNG, or WebP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError('File too large. Maximum size is 2 MB.');
      return;
    }

    // Show preview immediately while uploading
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('regId', registrationId);
      const res = await fetch('/api/training/upload-avatar', { method: 'POST', body: fd });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setUploadError(data.error ?? 'Upload failed. Please try again.');
        setAvatarPreview(avatarUrl); // revert preview to saved url
      } else {
        // Cache-bust the URL so it refreshes immediately
        const busted = `${data.url}?v=${Date.now()}`;
        setAvatarUrl(busted);
        setAvatarPreview(busted);
      }
    } finally {
      setUploading(false);
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleSave() {
    setSaving(true);
    await fetch('/api/training/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationId, jobTitle, company, location, linkedinUrl, notifyMilestones: notifyM, notifyReminders: notifyR, displayName, avatarUrl }),
    });
    onSave({ job_title: jobTitle, company, location, linkedin_url: linkedinUrl, notify_milestones: notifyM, notify_reminders: notifyR, display_name: displayName, avatar_url: avatarUrl });
    setSaving(false);
  }

  const initials = displayName.split(' ').map((w: string) => w[0] ?? '').filter(Boolean).join('').toUpperCase().slice(0, 2) || 'ST';

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 650, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', padding: '24px', boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#0D2E5A' }}>👤 Edit Profile</div>
          <button onClick={onClose} style={{ fontSize: 18, background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280' }}>✕</button>
        </div>

        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#2EAA4A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, fontWeight: 800, color: '#fff', overflow: 'hidden', flexShrink: 0 }}>
            {avatarPreview ? <img src={avatarPreview} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials}
          </div>
          <div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
            <button onClick={() => fileRef.current?.click()}
              style={{ fontSize: 12, fontWeight: 700, color: '#1B4F8A', background: '#EEF2FF', border: '1px solid #C7D2FE', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', marginBottom: 4, display: 'block' }}>
              Upload Photo
            </button>
            <div style={{ fontSize: 10, color: '#9CA3AF' }}>JPG, PNG, GIF · Max 2MB</div>
          </div>
        </div>

        {/* Display Name */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>DISPLAY NAME</div>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Your full name"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 13, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
        </div>

        {/* Professional details */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Job Title', value: jobTitle, setter: setJobTitle, placeholder: 'e.g. Financial Analyst' },
            { label: 'Company',   value: company,  setter: setCompany,  placeholder: 'e.g. Goldman Sachs' },
            { label: 'Location',  value: location, setter: setLocation, placeholder: 'e.g. Lagos, Nigeria' },
            { label: 'LinkedIn',  value: linkedinUrl, setter: setLinkedinUrl, placeholder: 'https://linkedin.com/in/...' },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 4 }}>{f.label.toUpperCase()}</div>
              <input value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                style={{ width: '100%', padding: '7px 9px', border: '1px solid #E5E7EB', borderRadius: 6, fontSize: 12, fontFamily: 'Inter,sans-serif', boxSizing: 'border-box' }} />
            </div>
          ))}
        </div>

        <div style={{ borderTop: '1px solid #F3F4F6', paddingTop: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', marginBottom: 8 }}>NOTIFICATIONS</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <input type="checkbox" checked={notifyM} onChange={e => setNotifyM(e.target.checked)} />
            Progress milestone emails
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#374151' }}>
            <input type="checkbox" checked={notifyR} onChange={e => setNotifyR(e.target.checked)} />
            Study reminder emails
          </label>
        </div>

        {uploadError && (
          <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 12 }}>
            {uploadError}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} disabled={saving || uploading}
            style={{ flex: 1, padding: '10px', background: saving ? '#9CA3AF' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer' }}>
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
          <button onClick={onClose}
            style={{ padding: '10px 16px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, color: '#6B7280', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

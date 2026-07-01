'use client';

import React, { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useRequireAuth } from '@/src/shared/hooks/useRequireAuth';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ProfileData {
  name:          string | null;
  email:         string;
  company:       string | null;
  job_title:     string | null;
  phone:         string | null;
  city:          string | null;
  avatar_url:    string | null;
  projectsCount: number;
}

// ── Shared sub-styles ─────────────────────────────────────────────────────────
const S = {
  card: {
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    padding: 'var(--sp-4)',
    marginBottom: 'var(--sp-3)',
    boxShadow: 'var(--shadow-1)',
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 16, fontWeight: 700, color: 'var(--color-heading)',
    marginBottom: 20, paddingBottom: 12,
    borderBottom: '1px solid var(--color-border)',
  } as React.CSSProperties,
  label: {
    display: 'block', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', color: 'var(--color-muted)', marginBottom: 6,
  } as React.CSSProperties,
  input: {
    width: '100%', padding: '9px 12px', fontSize: 13,
    background: 'var(--color-warning-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    fontFamily: 'Inter, sans-serif',
    boxSizing: 'border-box' as const, outline: 'none',
  } as React.CSSProperties,
  fieldGroup: { marginBottom: 16 } as React.CSSProperties,
  row: { display: 'flex', gap: 10, alignItems: 'flex-end' } as React.CSSProperties,
  btnSave: {
    padding: '9px 20px', background: 'var(--color-primary)', color: '#fff',
    border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 13,
    fontWeight: 700, cursor: 'pointer', fontFamily: 'Inter, sans-serif',
    flexShrink: 0, height: 37,
  } as React.CSSProperties,
};

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'success' | 'error' }) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
      color: '#fff', background: type === 'success' ? '#166534' : '#991b1b',
      boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    }}>
      {type === 'success' ? '✓ ' : '✗ '}{msg}
    </div>
  );
}

// ── Inline form section ────────────────────────────────────────────────────────
function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 style={S.sectionTitle}>{children}</h2>;
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { loading: authLoading } = useRequireAuth();
  const { data: session, update: updateSession } = useSession();
  const router = useRouter();

  // ── Profile data (fetched from DB) ──────────────────────────────────────────
  const [profile,        setProfile]        = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // ── Form states ─────────────────────────────────────────────────────────────
  const [nameVal,          setNameVal]          = useState('');
  const [emailVal,         setEmailVal]          = useState('');
  const [emailPassword,    setEmailPassword]    = useState('');
  const [companyVal,       setCompanyVal]       = useState('');
  const [jobTitleVal,      setJobTitleVal]      = useState('');
  const [phoneVal,         setPhoneVal]         = useState('');
  const [cityVal,          setCityVal]          = useState('');
  const [avatarUrl,        setAvatarUrl]        = useState<string | null>(null);
  const [curPassword,      setCurPassword]      = useState('');
  const [newPassword,      setNewPassword]      = useState('');
  const [confirmPassword,  setConfirmPassword]  = useState('');
  const [deleteConfirm,    setDeleteConfirm]    = useState('');

  // ── Loading / feedback per section ──────────────────────────────────────────
  const [savingName,     setSavingName]     = useState(false);
  const [savingEmail,    setSavingEmail]    = useState(false);
  const [savingCompany,  setSavingCompany]  = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [deleting,       setDeleting]       = useState(false);
  const [signingOut,     setSigningOut]     = useState(false);
  const avatarInputRef = React.useRef<HTMLInputElement>(null);

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── Fetch profile on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    fetch('/api/user/profile')
      .then(r => r.json())
      .then((d: ProfileData) => {
        setProfile(d);
        setNameVal(d.name ?? '');
        setEmailVal(d.email);
        setCompanyVal(d.company ?? '');
        setJobTitleVal(d.job_title ?? '');
        setPhoneVal(d.phone ?? '');
        setCityVal(d.city ?? '');
        setAvatarUrl(d.avatar_url ?? null);
      })
      .catch(() => {})
      .finally(() => setProfileLoading(false));
  }, [session]);

  if (authLoading) return null;

  const user = session!.user;

  // ── Handlers ─────────────────────────────────────────────────────────────────
  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'name', name: nameVal }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Failed to save', 'error'); return; }
      setProfile(p => p ? { ...p, name: nameVal } : p);
      await updateSession();
      showToast('Name updated', 'success');
    } finally { setSavingName(false); }
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'email', email: emailVal, currentPassword: emailPassword }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Failed to save', 'error'); return; }
      setProfile(p => p ? { ...p, email: emailVal } : p);
      setEmailPassword('');
      showToast('Email updated - please sign in again to see it reflected', 'success');
    } finally { setSavingEmail(false); }
  }

  async function saveCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!companyVal.trim())  { showToast('Company is required', 'error'); return; }
    if (!jobTitleVal.trim()) { showToast('Job title is required', 'error'); return; }
    setSavingCompany(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'profile',
          company: companyVal, job_title: jobTitleVal, phone: phoneVal, city: cityVal,
        }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Failed to save', 'error'); return; }
      setProfile(p => p ? { ...p, company: companyVal, job_title: jobTitleVal, phone: phoneVal, city: cityVal } : p);
      showToast('Company details updated', 'success');
    } finally { setSavingCompany(false); }
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Image too large. Maximum size is 2 MB.', 'error'); return; }
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/user/avatar', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Upload failed', 'error'); return; }
      setAvatarUrl(j.url);
      setProfile(p => p ? { ...p, avatar_url: j.url } : p);
      showToast('Profile image updated', 'success');
    } finally {
      setUploadingAvatar(false);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) { showToast('New passwords do not match', 'error'); return; }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/user/password', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: curPassword, newPassword }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Failed to update', 'error'); return; }
      setCurPassword(''); setNewPassword(''); setConfirmPassword('');
      showToast('Password updated', 'success');
    } finally { setSavingPassword(false); }
  }

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (deleteConfirm !== 'DELETE') { showToast('Type DELETE to confirm', 'error'); return; }
    setDeleting(true);
    try {
      const res = await fetch('/api/user/account', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmText: 'DELETE' }),
      });
      const j = await res.json();
      if (!res.ok) { showToast(j.error ?? 'Deletion failed', 'error'); return; }
      await signOut({ callbackUrl: '/' });
    } finally { setDeleting(false); }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>

      {/* Top bar */}
      <header style={{
        background: 'var(--color-primary-deep)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        height: 52, display: 'flex', alignItems: 'center',
        padding: '0 var(--sp-4)', gap: 'var(--sp-2)',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <span style={{ fontSize: 16 }}>⚙️</span>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Settings
        </span>
        <div style={{ flex: 1 }} />
        <a href={`${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.financialmodelerpro.com'}/dashboard`} style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, textDecoration: 'none', marginRight: 16 }}>← Modeling Hub</a>
        <button
          onClick={async () => { setSigningOut(true); await signOut({ callbackUrl: '/' }); }}
          disabled={signingOut}
          style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
            color: '#fca5a5', borderRadius: 'var(--radius-sm)', padding: '5px 12px',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'Inter,sans-serif',
          }}
        >
          {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
      </header>

      <main style={{ maxWidth: 680, margin: '0 auto', padding: 'var(--sp-5) var(--sp-4)' }}>

        {/* ── SECTION A: Profile ── */}
        <div style={S.card}>
          <SectionHeader>👤 Profile</SectionHeader>

          {/* Avatar row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--color-primary)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: '#fff', fontWeight: 700, flexShrink: 0,
              overflow: 'hidden',
            }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                profileLoading ? '…' : (nameVal?.[0] ?? user.email[0]).toUpperCase()
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-heading)' }}>
                {profileLoading ? '…' : (profile?.name ?? 'No name set')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-meta)' }}>{user.email}</div>
            </div>
            <input
              ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp"
              onChange={uploadAvatar} style={{ display: 'none' }}
            />
            <button
              type="button" onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}
              style={{
                padding: '7px 14px', background: 'var(--color-surface)', color: 'var(--color-heading)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
                fontSize: 12, fontWeight: 700, cursor: uploadingAvatar ? 'default' : 'pointer',
                fontFamily: 'Inter, sans-serif', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {uploadingAvatar ? 'Uploading…' : avatarUrl ? 'Replace photo' : 'Upload photo'}
            </button>
          </div>

          {/* ── Name form ── */}
          <form onSubmit={saveName} style={{ marginBottom: 24 }}>
            <div style={S.fieldGroup}>
              <label style={S.label}>Full name</label>
              <div style={S.row}>
                <input
                  type="text" value={nameVal} onChange={e => setNameVal(e.target.value)}
                  required placeholder="Your full name" style={{ ...S.input, flex: 1 }}
                />
                <button type="submit" disabled={savingName} style={S.btnSave}>
                  {savingName ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </form>

          {/* ── Company details form ── */}
          <form onSubmit={saveCompany} style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 12 }}>
              Company details
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...S.fieldGroup, flex: 1, minWidth: 200 }}>
                <label style={S.label}>Company / Organization <span style={{ color: '#dc2626' }}>*</span></label>
                <input
                  type="text" value={companyVal} onChange={e => setCompanyVal(e.target.value)}
                  required placeholder="Your company" style={S.input}
                />
              </div>
              <div style={{ ...S.fieldGroup, flex: 1, minWidth: 200 }}>
                <label style={S.label}>Job title <span style={{ color: '#dc2626' }}>*</span></label>
                <input
                  type="text" value={jobTitleVal} onChange={e => setJobTitleVal(e.target.value)}
                  required placeholder="Your role" style={S.input}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ ...S.fieldGroup, flex: 1, minWidth: 200 }}>
                <label style={S.label}>Phone <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <input
                  type="tel" value={phoneVal} onChange={e => setPhoneVal(e.target.value)}
                  placeholder="+1 555 000 0000" style={S.input}
                />
              </div>
              <div style={{ ...S.fieldGroup, flex: 1, minWidth: 200 }}>
                <label style={S.label}>City <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <input
                  type="text" value={cityVal} onChange={e => setCityVal(e.target.value)}
                  placeholder="Your city" style={S.input}
                />
              </div>
            </div>
            <button type="submit" disabled={savingCompany} style={S.btnSave}>
              {savingCompany ? 'Saving…' : 'Save details'}
            </button>
          </form>

          {/* ── Email form ── */}
          <form onSubmit={saveEmail} style={{ marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 12 }}>
              Update email address
            </div>
            <div style={S.fieldGroup}>
              <label style={S.label}>New email address</label>
              <input
                type="email" value={emailVal} onChange={e => setEmailVal(e.target.value)}
                required placeholder="new@example.com" style={S.input}
              />
            </div>
            <div style={S.fieldGroup}>
              <label style={S.label}>Current password (required)</label>
              <div style={S.row}>
                <input
                  type="password" value={emailPassword} onChange={e => setEmailPassword(e.target.value)}
                  required placeholder="••••••••" style={{ ...S.input, flex: 1 }}
                />
                <button type="submit" disabled={savingEmail} style={S.btnSave}>
                  {savingEmail ? 'Saving…' : 'Update Email'}
                </button>
              </div>
            </div>
          </form>

          {/* ── Password form ── */}
          <form onSubmit={savePassword}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-heading)', marginBottom: 12 }}>
              Change password
            </div>
            <div style={S.fieldGroup}>
              <label style={S.label}>Current password</label>
              <input
                type="password" value={curPassword} onChange={e => setCurPassword(e.target.value)}
                required placeholder="••••••••" style={S.input}
              />
            </div>
            <div style={S.fieldGroup}>
              <label style={S.label}>New password <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(min 8 characters)</span></label>
              <input
                type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                required minLength={8} placeholder="••••••••" style={S.input}
              />
            </div>
            <div style={S.fieldGroup}>
              <label style={S.label}>Confirm new password</label>
              <div style={S.row}>
                <input
                  type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                  required minLength={8} placeholder="••••••••" style={{ ...S.input, flex: 1 }}
                />
                <button type="submit" disabled={savingPassword} style={S.btnSave}>
                  {savingPassword ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Subscription details live solely in the dashboard Billing tab (the
            single source of truth over the entitlement system); no plan display
            is duplicated here. */}

        {/* ── SECTION C: Danger Zone ── */}
        <div style={{ ...S.card, border: '1px solid #fecaca' }}>
          <SectionHeader>⚠️ Danger Zone</SectionHeader>

          {/* Sign out */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid #fecaca' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-heading)' }}>Sign out</div>
              <div style={{ fontSize: 12, color: 'var(--color-meta)' }}>You will be redirected to the home page.</div>
            </div>
            <button
              onClick={async () => { setSigningOut(true); await signOut({ callbackUrl: '/' }); }}
              disabled={signingOut}
              className="btn-danger"
            >
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          </div>

          {/* Delete account */}
          <form onSubmit={deleteAccount}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#991b1b', marginBottom: 6 }}>Delete account</div>
            <p style={{ fontSize: 12, color: 'var(--color-meta)', marginBottom: 14, lineHeight: 1.6 }}>
              This permanently deletes your account, all projects, and all data. This action cannot be undone.
            </p>
            <div style={S.fieldGroup}>
              <label style={{ ...S.label, color: '#991b1b' }}>Type DELETE to confirm</label>
              <div style={S.row}>
                <input
                  type="text" value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder="DELETE" style={{ ...S.input, flex: 1, background: '#fff5f5', border: '1px solid #fecaca' }}
                />
                <button
                  type="submit"
                  disabled={deleting || deleteConfirm !== 'DELETE'}
                  style={{
                    padding: '9px 20px', height: 37,
                    background: deleteConfirm === 'DELETE' ? '#dc2626' : '#9ca3af',
                    color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)',
                    fontSize: 13, fontWeight: 700, cursor: deleteConfirm === 'DELETE' ? 'pointer' : 'not-allowed',
                    fontFamily: 'Inter, sans-serif', flexShrink: 0,
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete Account'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {user.role === 'admin' && (
          <div style={{ textAlign: 'center', marginTop: 'var(--sp-3)' }}>
            <a href="/admin" style={{ fontSize: 13, color: 'var(--color-primary)', textDecoration: 'none', fontWeight: 600 }}>
              🛡️ Go to Admin Panel →
            </a>
          </div>
        )}
      </main>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

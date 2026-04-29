'use client';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { LaunchStatusCard } from '@/src/components/admin/LaunchStatusCard';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13,
  border: '1px solid #D1D5DB', borderRadius: 6,
  fontFamily: 'Inter,sans-serif', outline: 'none',
  background: '#FFFBEB', boxSizing: 'border-box', color: '#1B3A6B',
};

// Friendly labels for the model-submission gate keys. Used in toast copy
// + confirm dialog headings.
const LABEL_BY_KEY: Record<string, string> = {
  model_submission_announcement_only: 'Announcement Only',
  model_submission_required_3sfm:     'Require Model for 3SFM',
  model_submission_required_bvm:      'Require Model for BVM',
};


export default function TrainingSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [url, setUrl]           = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [toast, setToast]       = useState('');

  // Assessment settings (global shuffle) — migration 108
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions]     = useState(false);
  const [shuffleSaving, setShuffleSaving]       = useState(false);

  // Model-submission gate (migration 148) — three soft-launch flags. Audit-
  // logged via /api/admin/training-settings/model-submission-gate so every
  // cutover decision lands in admin_audit_log.
  const [msAnnouncementOnly, setMsAnnouncementOnly] = useState(true);
  const [msRequired3sfm,     setMsRequired3sfm]     = useState(false);
  const [msRequiredBvm,      setMsRequiredBvm]      = useState(false);
  const [msSavingKey,        setMsSavingKey]        = useState<string | null>(null);
  const [msConfirm,          setMsConfirm]          = useState<{
    key: 'model_submission_announcement_only' | 'model_submission_required_3sfm' | 'model_submission_required_bvm';
    nextValue: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    danger: boolean;
  } | null>(null);

  // F.1 - admin notification settings. Two K/V keys:
  //   model_submission_admin_notify_enabled - 'true' | 'false', default 'true'
  //   model_submission_admin_notify_email   - free-text recipient, default ''
  // Empty recipient is documented as "off" - the upload route logs + skips.
  const [msNotifyEnabled, setMsNotifyEnabled] = useState(true);
  const [msNotifyEmail,   setMsNotifyEmail]   = useState('');
  const [msNotifyEmailSavedAt, setMsNotifyEmailSavedAt] = useState('');
  const [msNotifySaving,  setMsNotifySaving]  = useState(false);

  // F.2 - per-course guidance text + optional sample template URL. Empty
  // guidance falls back to a baked default in the student card; empty
  // sample URL hides the download CTA.
  const [msGuidance3sfm,  setMsGuidance3sfm]  = useState('');
  const [msGuidanceBvm,   setMsGuidanceBvm]   = useState('');
  const [msSampleUrl3sfm, setMsSampleUrl3sfm] = useState('');
  const [msSampleUrlBvm,  setMsSampleUrlBvm]  = useState('');
  const [msGuidanceSavingKey, setMsGuidanceSavingKey] = useState<'3SFM' | 'BVM' | null>(null);

  // WhatsApp Group URL (migration 123)
  const [whatsappUrl, setWhatsappUrl]         = useState('');
  const [savedWhatsappUrl, setSavedWhatsappUrl] = useState('');
  const [whatsappSaving, setWhatsappSaving]   = useState(false);

  // Platform Walkthrough URL — shown as a "Watch Platform Walkthrough"
  // button on the student dashboard. Empty = button hidden.
  const [walkthroughUrl, setWalkthroughUrl]           = useState('');
  const [savedWalkthroughUrl, setSavedWalkthroughUrl] = useState('');
  const [walkthroughSaving, setWalkthroughSaving]     = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as any).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    fetch('/api/admin/training-settings').then(r => r.json()).catch(() => ({ settings: {} })).then((ts: { settings?: Record<string, string> }) => {
      const s = ts.settings ?? {};
      const u = s.apps_script_url ?? '';
      setUrl(u);
      setSavedUrl(u);
      setShuffleQuestions(s.shuffle_questions_enabled !== 'false');
      setShuffleOptions(s.shuffle_options_enabled === 'true');
      // Model-submission gate flags. announcement_only defaults true per
      // migration 148; required_<course> defaults false. Treat a missing
      // row as the documented default (matches the cert engine + UI gate).
      setMsAnnouncementOnly(s.model_submission_announcement_only !== 'false');
      setMsRequired3sfm(s.model_submission_required_3sfm === 'true');
      setMsRequiredBvm(s.model_submission_required_bvm === 'true');
      // Admin-alert email settings (F.1). Default enabled=true, recipient=''.
      // Empty recipient is documented as "off" - the upload route logs + skips.
      setMsNotifyEnabled(s.model_submission_admin_notify_enabled !== 'false');
      const recip = (s.model_submission_admin_notify_email ?? '').trim();
      setMsNotifyEmail(recip);
      setMsNotifyEmailSavedAt(recip);
      // F.2 per-course guidance + sample URL hydration. Strings stay empty
      // when unset; the student card backs out to a baked default per course.
      setMsGuidance3sfm(s.model_submission_guidance_3sfm ?? '');
      setMsGuidanceBvm(s.model_submission_guidance_bvm ?? '');
      setMsSampleUrl3sfm(s.model_submission_sample_url_3sfm ?? '');
      setMsSampleUrlBvm(s.model_submission_sample_url_bvm ?? '');
      const wa = (s.whatsapp_group_url ?? '').trim();
      setWhatsappUrl(wa);
      setSavedWhatsappUrl(wa);
      const wk = (s.platform_walkthrough_url ?? '').trim();
      setWalkthroughUrl(wk);
      setSavedWalkthroughUrl(wk);
      setLoading(false);
    });
  }, []);

  const saveShuffle = async (next: { shuffleQuestions?: boolean; shuffleOptions?: boolean }) => {
    setShuffleSaving(true);
    const payload: Record<string, string> = {};
    if (next.shuffleQuestions !== undefined) {
      payload.shuffle_questions_enabled = next.shuffleQuestions ? 'true' : 'false';
      setShuffleQuestions(next.shuffleQuestions);
    }
    if (next.shuffleOptions !== undefined) {
      payload.shuffle_options_enabled = next.shuffleOptions ? 'true' : 'false';
      setShuffleOptions(next.shuffleOptions);
    }
    try {
      const res = await fetch('/api/admin/training-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showToast(res.ok ? 'Assessment settings saved' : 'Save failed');
    } catch {
      showToast('Save failed');
    }
    setShuffleSaving(false);
  };

  // Audit-logged write for the model-submission gate flags. Returns true on
  // success so the caller can flip its local optimistic state once the
  // server has accepted the change.
  const saveModelGateFlag = async (
    key: 'model_submission_announcement_only' | 'model_submission_required_3sfm' | 'model_submission_required_bvm',
    nextValue: boolean,
  ): Promise<boolean> => {
    setMsSavingKey(key);
    try {
      const res = await fetch('/api/admin/training-settings/model-submission-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: nextValue ? 'true' : 'false' }),
      });
      const json = await res.json() as { ok?: boolean; error?: string; message?: string };
      if (!res.ok || !json.ok) {
        showToast(json.message ?? json.error ?? 'Save failed');
        return false;
      }
      // Apply locally only after the server confirms.
      if (key === 'model_submission_announcement_only') setMsAnnouncementOnly(nextValue);
      else if (key === 'model_submission_required_3sfm') setMsRequired3sfm(nextValue);
      else if (key === 'model_submission_required_bvm')  setMsRequiredBvm(nextValue);
      showToast(`${LABEL_BY_KEY[key]} → ${nextValue ? 'ON' : 'OFF'}`);
      return true;
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`);
      return false;
    } finally {
      setMsSavingKey(null);
    }
  };

  // F.1 - admin notification settings save. Writes both keys in one POST
  // through the generic /api/admin/training-settings endpoint. No audit
  // log entry: notification recipient is operational config, not a gate
  // change. Email format is loosely validated client-side; server upserts
  // whatever is sent so a typo can be corrected without a DB roundtrip.
  const saveNotifySettings = async () => {
    const trimmed = msNotifyEmail.trim();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      showToast('Enter a valid email address or leave empty');
      return;
    }
    setMsNotifySaving(true);
    try {
      const res = await fetch('/api/admin/training-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model_submission_admin_notify_enabled: msNotifyEnabled ? 'true' : 'false',
          model_submission_admin_notify_email:   trimmed,
        }),
      });
      if (res.ok) {
        setMsNotifyEmail(trimmed);
        setMsNotifyEmailSavedAt(trimmed);
        showToast(
          !msNotifyEnabled || !trimmed
            ? 'Saved. Admin alerts are OFF (toggle disabled or recipient empty).'
            : 'Admin alert settings saved',
        );
      } else {
        showToast('Save failed');
      }
    } catch {
      showToast('Save failed');
    }
    setMsNotifySaving(false);
  };

  // F.2 - per-course guidance + sample URL save. One POST per course so the
  // two cards save independently. URL is loosely validated (http/https only)
  // so a typo can be corrected without a DB roundtrip.
  const saveGuidance = async (course: '3SFM' | 'BVM') => {
    const guidance = (course === '3SFM' ? msGuidance3sfm : msGuidanceBvm).trim();
    const rawUrl   = (course === '3SFM' ? msSampleUrl3sfm : msSampleUrlBvm).trim();
    if (rawUrl && !/^https?:\/\//i.test(rawUrl)) {
      showToast('Sample URL must start with http:// or https://');
      return;
    }
    setMsGuidanceSavingKey(course);
    try {
      const lc = course.toLowerCase();
      const res = await fetch('/api/admin/training-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          [`model_submission_guidance_${lc}`]:   guidance,
          [`model_submission_sample_url_${lc}`]: rawUrl,
        }),
      });
      if (res.ok) {
        if (course === '3SFM') {
          setMsGuidance3sfm(guidance);
          setMsSampleUrl3sfm(rawUrl);
        } else {
          setMsGuidanceBvm(guidance);
          setMsSampleUrlBvm(rawUrl);
        }
        showToast(`${course} guidance saved`);
      } else {
        showToast('Save failed');
      }
    } catch {
      showToast('Save failed');
    }
    setMsGuidanceSavingKey(null);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const isValidWhatsappUrl = (v: string) => {
    const t = v.trim();
    if (t === '') return true;
    return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(t);
  };

  // Walkthrough URL is meant to be embedded in an iframe, so we accept
  // YouTube + Vimeo + a generic https:// fallback. The dashboard handles
  // the display; this gate just rejects obviously-broken input.
  const isValidWalkthroughUrl = (v: string) => {
    const t = v.trim();
    if (t === '') return true;
    return /^https:\/\/(?:[\w-]+\.)*(?:youtube\.com|youtu\.be|vimeo\.com)\//i.test(t)
      || /^https:\/\//i.test(t);
  };

  const saveWalkthrough = async () => {
    const trimmed = walkthroughUrl.trim();
    if (!isValidWalkthroughUrl(trimmed)) {
      showToast('Enter a valid https:// URL or leave empty');
      return;
    }
    setWalkthroughSaving(true);
    try {
      const res = await fetch('/api/admin/training-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform_walkthrough_url: trimmed }),
      });
      if (res.ok) {
        setSavedWalkthroughUrl(trimmed);
        setWalkthroughUrl(trimmed);
        showToast(trimmed ? 'Walkthrough video link saved' : 'Walkthrough video link cleared');
      } else {
        showToast('Save failed');
      }
    } catch {
      showToast('Save failed');
    }
    setWalkthroughSaving(false);
  };

  const saveWhatsapp = async () => {
    const trimmed = whatsappUrl.trim();
    if (!isValidWhatsappUrl(trimmed)) {
      showToast('Enter a valid https://chat.whatsapp.com/ link or leave empty');
      return;
    }
    setWhatsappSaving(true);
    try {
      const res = await fetch('/api/admin/training-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsapp_group_url: trimmed }),
      });
      if (res.ok) {
        setSavedWhatsappUrl(trimmed);
        setWhatsappUrl(trimmed);
        showToast(trimmed ? 'WhatsApp group link saved' : 'WhatsApp group link cleared');
      } else {
        showToast('Save failed');
      }
    } catch {
      showToast('Save failed');
    }
    setWhatsappSaving(false);
  };

  const save = async () => {
    setSaving(true);
    const res = await fetch('/api/admin/training-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apps_script_url: url.trim() }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedUrl(url.trim());
      setTestResult(null);
      showToast('Settings saved');
    } else {
      showToast('Save failed');
    }
  };

  const testConnection = async () => {
    const testUrl = url.trim() || savedUrl;
    if (!testUrl) { showToast('Enter a URL first'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const probe = new URL(testUrl);
      probe.searchParams.set('action', 'ping');
      const res = await fetch(`/api/training/proxy-ping?url=${encodeURIComponent(probe.toString())}`, {
        signal: AbortSignal.timeout(8000),
      });
      setTestResult(res.ok ? 'ok' : 'fail');
    } catch {
      setTestResult('fail');
    }
    setTesting(false);
  };

  const dirty = url.trim() !== savedUrl;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>⚙️ Training Settings</h1>
          <p style={{ fontSize: 13, color: '#6B7280' }}>
            Configure the Google Apps Script Web App URL that powers student registration, progress tracking, and certificates.
          </p>
        </div>

        {loading ? (
          <div style={{ color: '#6B7280', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {/* Apps Script URL Card */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>
                Google Apps Script Web App URL
              </div>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
                Deploy your Apps Script project as a Web App and paste the URL below. This replaces the <code style={{ background: '#F3F4F6', padding: '1px 5px', borderRadius: 3 }}>APPS_SCRIPT_URL</code> environment variable - no Vercel re-deploy needed.
              </div>

              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Web App URL</div>
                  <input
                    value={url}
                    onChange={e => { setUrl(e.target.value); setTestResult(null); }}
                    placeholder="https://script.google.com/macros/s/AKfy.../exec"
                    style={inputStyle}
                  />
                </div>
                <button
                  onClick={testConnection}
                  disabled={testing}
                  style={{ padding: '9px 16px', background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: testing ? 0.7 : 1 }}
                >
                  {testing ? 'Testing…' : '🔌 Test'}
                </button>
                <button
                  onClick={save}
                  disabled={saving || !dirty}
                  style={{ padding: '9px 20px', background: dirty ? '#1B4F8A' : '#F3F4F6', color: dirty ? '#fff' : '#9CA3AF', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', whiteSpace: 'nowrap', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>

              {/* Connection status */}
              {testResult && (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  {testResult === 'ok' ? (
                    <>
                      <span style={{ color: '#1A7A30', fontSize: 16 }}>✅</span>
                      <span style={{ color: '#1A7A30', fontWeight: 600 }}>Connection successful - Apps Script is reachable.</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: '#DC2626', fontSize: 16 }}>❌</span>
                      <span style={{ color: '#DC2626', fontWeight: 600 }}>Connection failed - check the URL or deployment permissions.</span>
                    </>
                  )}
                </div>
              )}

              {/* Current saved URL display */}
              {savedUrl && (
                <div style={{ marginTop: 12, fontSize: 11, color: '#6B7280' }}>
                  <strong>Currently saved:</strong> <span style={{ wordBreak: 'break-all' }}>{savedUrl}</span>
                </div>
              )}
              {!savedUrl && (
                <div style={{ marginTop: 12, fontSize: 11, color: '#F59E0B', fontWeight: 600 }}>
                  ⚠️ No URL saved - training registration and progress features are disabled.
                </div>
              )}
            </div>

            {/* Transcript Editor shortcut */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780, display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ fontSize: 36 }}>📄</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>Transcript Settings &amp; Editor</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>
                  Customise header text, footer, logo, and layout - with a live A4 preview where you can drag the logo to reposition it.
                </div>
              </div>
              <a href="/admin/transcript-editor"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 20px', background: '#1B4F8A', color: '#fff', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                Open Transcript Editor →
              </a>
            </div>

            {/* Community Links Card — WhatsApp Group */}
            {(() => {
              const trimmed = whatsappUrl.trim();
              const dirty = trimmed !== savedWhatsappUrl;
              const valid = isValidWhatsappUrl(trimmed);
              const showInvalid = trimmed !== '' && !valid;
              return (
                <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>
                    💬 WhatsApp Group Link
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
                    Paste a WhatsApp group invite URL (must start with <code style={{ background: '#F3F4F6', padding: '1px 5px', borderRadius: 3 }}>https://chat.whatsapp.com/</code>) to show a <strong>Join WhatsApp Group</strong> button in the student dashboard sidebar. Leave empty to hide the button.
                  </div>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invite URL</div>
                      <input
                        value={whatsappUrl}
                        onChange={e => setWhatsappUrl(e.target.value)}
                        placeholder="https://chat.whatsapp.com/XXXXXXXXXXXXXX"
                        style={{
                          ...inputStyle,
                          borderColor: showInvalid ? '#DC2626' : '#D1D5DB',
                          background: showInvalid ? '#FEF2F2' : '#FFFBEB',
                        }}
                      />
                    </div>
                    <button
                      onClick={saveWhatsapp}
                      disabled={whatsappSaving || !dirty || showInvalid}
                      style={{
                        padding: '9px 20px',
                        background: dirty && !showInvalid ? '#25D366' : '#F3F4F6',
                        color: dirty && !showInvalid ? '#fff' : '#9CA3AF',
                        border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
                        cursor: dirty && !showInvalid ? 'pointer' : 'default',
                        whiteSpace: 'nowrap', opacity: whatsappSaving ? 0.7 : 1,
                      }}
                    >
                      {whatsappSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>

                  {showInvalid && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#DC2626', fontWeight: 600 }}>
                      ⚠️ Must be a valid https://chat.whatsapp.com/ invite link.
                    </div>
                  )}

                  {savedWhatsappUrl ? (
                    <div style={{ marginTop: 12, fontSize: 11, color: '#065F46', background: '#D1FAE5', padding: '6px 10px', borderRadius: 6, display: 'inline-block' }}>
                      ✅ <strong>Active</strong> · Button visible on student dashboard
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 11, color: '#6B7280', background: '#F3F4F6', padding: '6px 10px', borderRadius: 6, display: 'inline-block' }}>
                      Button hidden · no URL set
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Platform Walkthrough Video Card */}
            {(() => {
              const trimmed = walkthroughUrl.trim();
              const dirty = trimmed !== savedWalkthroughUrl;
              const valid = isValidWalkthroughUrl(trimmed);
              const showInvalid = trimmed !== '' && !valid;
              return (
                <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>
                    🎥 Platform Walkthrough Video
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
                    Paste a YouTube (or Vimeo) URL to show a <strong>Watch Platform Walkthrough</strong> button on the student dashboard hero. The video opens in an embedded modal — students never leave the platform. Leave empty to hide the button.
                  </div>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Video URL</div>
                      <input
                        value={walkthroughUrl}
                        onChange={e => setWalkthroughUrl(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        style={{
                          ...inputStyle,
                          borderColor: showInvalid ? '#DC2626' : '#D1D5DB',
                          background: showInvalid ? '#FEF2F2' : '#FFFBEB',
                        }}
                      />
                    </div>
                    <button
                      onClick={saveWalkthrough}
                      disabled={walkthroughSaving || !dirty || showInvalid}
                      style={{
                        padding: '9px 20px',
                        background: dirty && !showInvalid ? '#1B4F8A' : '#F3F4F6',
                        color: dirty && !showInvalid ? '#fff' : '#9CA3AF',
                        border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
                        cursor: dirty && !showInvalid ? 'pointer' : 'default',
                        whiteSpace: 'nowrap', opacity: walkthroughSaving ? 0.7 : 1,
                      }}
                    >
                      {walkthroughSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>

                  {showInvalid && (
                    <div style={{ marginTop: 10, fontSize: 12, color: '#DC2626', fontWeight: 600 }}>
                      ⚠️ Must be a valid https:// URL.
                    </div>
                  )}

                  {savedWalkthroughUrl ? (
                    <div style={{ marginTop: 12, fontSize: 11, color: '#065F46', background: '#D1FAE5', padding: '6px 10px', borderRadius: 6, display: 'inline-block' }}>
                      ✅ <strong>Active</strong> · Button visible on student dashboard
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 11, color: '#6B7280', background: '#F3F4F6', padding: '6px 10px', borderRadius: 6, display: 'inline-block' }}>
                      Button hidden · no URL set
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Assessment Settings Card */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>📝 Assessment Settings</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
                Global shuffle controls for every assessment — 3SFM, BVM, and live sessions. Applied client-side after questions load so the same setting works uniformly regardless of where the questions come from.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>🔀 Shuffle Questions</div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>Each student sees questions in a random order.</div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: shuffleQuestions ? '#065F46' : '#6B7280' }}>
                      {shuffleQuestions ? 'ON' : 'OFF'}
                    </span>
                    <input
                      type="checkbox"
                      checked={shuffleQuestions}
                      onChange={e => saveShuffle({ shuffleQuestions: e.target.checked })}
                      disabled={shuffleSaving}
                    />
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>🎲 Shuffle Options</div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>Answer options (A / B / C / D) reorder within each question. Correct answer is remapped automatically so scoring stays accurate.</div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: shuffleOptions ? '#065F46' : '#6B7280' }}>
                      {shuffleOptions ? 'ON' : 'OFF'}
                    </span>
                    <input
                      type="checkbox"
                      checked={shuffleOptions}
                      onChange={e => saveShuffle({ shuffleOptions: e.target.checked })}
                      disabled={shuffleSaving}
                    />
                  </div>
                </label>
              </div>
            </div>

            {/* Model Submission Gate Card (migration 148, Phase E.2)
                Audit-logged via /api/admin/training-settings/model-submission-gate.
                Three soft-launch flags:
                  announcement_only: drives the dashboard banner (heads-up).
                  required_3sfm:     hard gate on 3SFM Final Exam.
                  required_bvm:      hard gate on BVM Final Exam.
                Both required toggles ship 'false' so this card is the only
                way to actually start enforcing without direct DB access. */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>📥 Model Submission Gate</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16, lineHeight: 1.55 }}>
                Controls whether students must upload a built financial model for admin review before the Final Exam unlocks. Soft-launch posture: keep <strong>Announcement Only</strong> ON for the notice period, then flip the per-course <strong>Require Model</strong> toggle to start enforcement. Every flip is recorded in the admin audit log.
              </div>

              {/* Current state pill row */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                <StatePill label="Announcement Only" on={msAnnouncementOnly} onLabel="ON" offLabel="OFF" tone={msAnnouncementOnly ? 'amber' : 'gray'} />
                <StatePill label="Require 3SFM" on={msRequired3sfm} onLabel="ENFORCING" offLabel="DORMANT" tone={msRequired3sfm ? 'red' : 'gray'} />
                <StatePill label="Require BVM"  on={msRequiredBvm}  onLabel="ENFORCING" offLabel="DORMANT" tone={msRequiredBvm  ? 'red' : 'gray'} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* announcement_only — flipping has no enforcement risk so no
                    confirm dialog. ON shows banner, OFF hides it. */}
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, cursor: msSavingKey ? 'not-allowed' : 'pointer' }}>
                  <div style={{ paddingRight: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>📢 Announcement Only (soft-launch banner)</div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.55 }}>
                      ON: dashboard shows an amber heads-up panel telling students that model submission is coming soon. OFF: panel hidden. Flipping this never blocks any student; it only changes what the dashboard looks like.
                    </div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: msAnnouncementOnly ? '#92400E' : '#6B7280' }}>
                      {msAnnouncementOnly ? 'ON' : 'OFF'}
                    </span>
                    <input
                      type="checkbox"
                      checked={msAnnouncementOnly}
                      onChange={e => void saveModelGateFlag('model_submission_announcement_only', e.target.checked)}
                      disabled={msSavingKey !== null}
                    />
                  </div>
                </label>

                {/* required_3sfm — confirm before flip. ON = enforce; OFF = remove gate. */}
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: msRequired3sfm ? '#FEF2F2' : '#F9FAFB', border: `1px solid ${msRequired3sfm ? '#FECACA' : '#E5E7EB'}`, borderRadius: 8, cursor: msSavingKey ? 'not-allowed' : 'pointer' }}>
                  <div style={{ paddingRight: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>🔒 Require Model for 3SFM Final Exam</div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.55 }}>
                      ON: every 3SFM student must upload an admin-approved model before the Final Exam unlocks. OFF: gate dormant, exam is gated only by completing the regular sessions. Server-enforced in three layers (UI lock, submit-assessment route, certificate engine).
                    </div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: msRequired3sfm ? '#991B1B' : '#6B7280' }}>
                      {msRequired3sfm ? 'ENFORCING' : 'DORMANT'}
                    </span>
                    <input
                      type="checkbox"
                      checked={msRequired3sfm}
                      onChange={e => {
                        const next = e.target.checked;
                        setMsConfirm({
                          key: 'model_submission_required_3sfm',
                          nextValue: next,
                          title: next ? 'Enforce 3SFM model gate?' : 'Remove 3SFM model gate?',
                          body: next
                            ? 'This will lock the 3SFM Final Exam for every student until they upload a model that you approve. Students currently at "Final Exam Ready" state will see the Final Exam SessionCard switch to a "Submit your model" lock immediately. Already-passed students keep their certificates; this only affects students who have not yet sat the Final Exam.'
                            : 'This will unlock the 3SFM Final Exam for every student regardless of whether they have submitted a model. Already-pending submissions stay in the queue and remain reviewable, but they no longer block the exam.',
                          confirmLabel: next ? 'Enforce gate' : 'Remove gate',
                          danger: next,
                        });
                      }}
                      disabled={msSavingKey !== null}
                    />
                  </div>
                </label>

                {/* required_bvm — same pattern as 3SFM. */}
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: msRequiredBvm ? '#FEF2F2' : '#F9FAFB', border: `1px solid ${msRequiredBvm ? '#FECACA' : '#E5E7EB'}`, borderRadius: 8, cursor: msSavingKey ? 'not-allowed' : 'pointer' }}>
                  <div style={{ paddingRight: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B' }}>🔒 Require Model for BVM Final Exam</div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, lineHeight: 1.55 }}>
                      ON: every BVM student must upload an admin-approved model before the Final Exam unlocks. OFF: gate dormant. Independent of the 3SFM toggle so you can stage the cutover one course at a time.
                    </div>
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: msRequiredBvm ? '#991B1B' : '#6B7280' }}>
                      {msRequiredBvm ? 'ENFORCING' : 'DORMANT'}
                    </span>
                    <input
                      type="checkbox"
                      checked={msRequiredBvm}
                      onChange={e => {
                        const next = e.target.checked;
                        setMsConfirm({
                          key: 'model_submission_required_bvm',
                          nextValue: next,
                          title: next ? 'Enforce BVM model gate?' : 'Remove BVM model gate?',
                          body: next
                            ? 'This will lock the BVM Final Exam for every student until they upload a model that you approve. Students currently at "Final Exam Ready" state will see the Final Exam SessionCard switch to a "Submit your model" lock immediately. Already-passed students keep their certificates; this only affects students who have not yet sat the Final Exam.'
                            : 'This will unlock the BVM Final Exam for every student regardless of whether they have submitted a model. Already-pending submissions stay in the queue and remain reviewable, but they no longer block the exam.',
                          confirmLabel: next ? 'Enforce gate' : 'Remove gate',
                          danger: next,
                        });
                      }}
                      disabled={msSavingKey !== null}
                    />
                  </div>
                </label>
              </div>

              {/* Cutover hint - mirrors the documented procedure from
                  migration 148's comment block. */}
              <div style={{ marginTop: 14, padding: '10px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 8, fontSize: 11.5, color: '#1E3A5F', lineHeight: 1.55 }}>
                <strong>Documented cutover:</strong> keep <em>Announcement Only</em> ON for the documented notice period, then flip the per-course <em>Require Model</em> toggle. Once enforcement is live you can flip <em>Announcement Only</em> OFF so the soft-launch banner stops showing alongside the live upload UI. Force-issue (<code>/admin/training-hub/certificates</code>) keeps bypassing the gate as an admin escape hatch.
              </div>

              {/* F.1 - Admin notification settings. Two K/V keys gating the
                  fire-and-forget alert email fired by POST /api/training/
                  model-submission. Empty recipient OR disabled toggle = OFF
                  (the upload route logs + skips). Default ON + empty so
                  alerts stay dormant until admin enters their address. */}
              <div style={{ marginTop: 18, padding: '14px 16px', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>📧 New-submission email alerts</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12, lineHeight: 1.55 }}>
                  When a student uploads a model, fire a fire-and-forget email to the recipient below so you do not have to refresh the queue to spot new arrivals. Disable the toggle <em>or</em> leave the recipient empty to turn alerts off; the submission row is still recorded either way.
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={msNotifyEnabled}
                    onChange={e => setMsNotifyEnabled(e.target.checked)}
                    disabled={msNotifySaving}
                  />
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#1B3A6B' }}>
                    {msNotifyEnabled ? 'Alerts enabled' : 'Alerts disabled'}
                  </span>
                </label>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <input
                    type="email"
                    placeholder="admin@example.com"
                    value={msNotifyEmail}
                    onChange={e => setMsNotifyEmail(e.target.value)}
                    disabled={msNotifySaving}
                    style={{
                      flex: '1 1 280px',
                      minWidth: 240,
                      padding: '8px 12px',
                      border: '1px solid #D1D5DB',
                      borderRadius: 6,
                      fontSize: 13,
                      color: '#1F2937',
                      background: msNotifySaving ? '#F3F4F6' : '#fff',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void saveNotifySettings()}
                    disabled={msNotifySaving}
                    style={{
                      padding: '8px 16px',
                      background: '#1B3A6B',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: msNotifySaving ? 'not-allowed' : 'pointer',
                      opacity: msNotifySaving ? 0.6 : 1,
                    }}
                  >
                    {msNotifySaving ? 'Saving...' : 'Save'}
                  </button>
                </div>

                <div style={{ marginTop: 8, fontSize: 11, color: msNotifyEnabled && msNotifyEmailSavedAt ? '#065F46' : '#92400E' }}>
                  {msNotifyEnabled && msNotifyEmailSavedAt
                    ? <>✓ Alerts will go to <strong>{msNotifyEmailSavedAt}</strong></>
                    : <>⚠ Alerts are <strong>OFF</strong> (toggle disabled or recipient empty)</>}
                </div>
              </div>

              {/* F.2 - Per-course guidance + sample template URL. Two
                  independent cards (3SFM + BVM) so each course can be
                  populated on its own timeline. Empty guidance falls back
                  to a baked default in the student card; empty sample URL
                  hides the download CTA. */}
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>📝 Per-course guidance + sample template</div>
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 12, lineHeight: 1.55 }}>
                  Tell students what to build for each course. Leave guidance empty to fall back to the platform default. The sample URL is optional - paste a Supabase storage link, Google Drive link, or any https URL pointing at a downloadable model template.
                </div>

                {(['3SFM', 'BVM'] as const).map(course => {
                  const guidance = course === '3SFM' ? msGuidance3sfm : msGuidanceBvm;
                  const setGuidance = course === '3SFM' ? setMsGuidance3sfm : setMsGuidanceBvm;
                  const sampleUrl = course === '3SFM' ? msSampleUrl3sfm : msSampleUrlBvm;
                  const setSampleUrl = course === '3SFM' ? setMsSampleUrl3sfm : setMsSampleUrlBvm;
                  const saving = msGuidanceSavingKey === course;
                  const courseLabel = course === '3SFM' ? '3-Statement Financial Modeling' : 'Business Valuation Modeling';

                  return (
                    <div
                      key={course}
                      style={{
                        marginBottom: 12,
                        padding: '14px 16px',
                        background: '#F9FAFB',
                        border: '1px solid #E5E7EB',
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A' }}>
                          {course} <span style={{ color: '#6B7280', fontWeight: 500 }}>· {courseLabel}</span>
                        </div>
                        {!guidance && (
                          <span style={{ fontSize: 10, color: '#92400E', background: '#FEF3C7', padding: '2px 8px', borderRadius: 10, fontWeight: 700 }}>
                            USING DEFAULT
                          </span>
                        )}
                      </div>

                      <label style={{ display: 'block', fontSize: 11, color: '#6B7280', fontWeight: 600, marginBottom: 4 }}>
                        Guidance text shown on the student card
                      </label>
                      <textarea
                        value={guidance}
                        onChange={e => setGuidance(e.target.value)}
                        disabled={saving}
                        rows={4}
                        maxLength={2000}
                        placeholder={`What should the student build for ${course}? Plain text, or a few bullet points. Empty = use the platform default copy.`}
                        style={{
                          width: '100%',
                          padding: '8px 10px',
                          border: '1px solid #D1D5DB',
                          borderRadius: 6,
                          fontSize: 12,
                          fontFamily: 'inherit',
                          resize: 'vertical',
                          marginBottom: 10,
                        }}
                      />

                      <label style={{ display: 'block', fontSize: 11, color: '#6B7280', fontWeight: 600, marginBottom: 4 }}>
                        Sample template download URL (optional)
                      </label>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <input
                          type="url"
                          placeholder="https://..."
                          value={sampleUrl}
                          onChange={e => setSampleUrl(e.target.value)}
                          disabled={saving}
                          style={{
                            flex: '1 1 280px',
                            minWidth: 240,
                            padding: '8px 10px',
                            border: '1px solid #D1D5DB',
                            borderRadius: 6,
                            fontSize: 12,
                            color: '#1F2937',
                            background: saving ? '#F3F4F6' : '#fff',
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void saveGuidance(course)}
                          disabled={saving}
                          style={{
                            padding: '8px 16px',
                            background: '#1B3A6B',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: saving ? 'not-allowed' : 'pointer',
                            opacity: saving ? 0.6 : 1,
                          }}
                        >
                          {saving ? 'Saving...' : `Save ${course}`}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Training Hub Launch Status - two independent toggles so
                signin + register can be controlled separately (migration 135).
                Typical pre-launch: signin OFF (existing students can log in),
                register ON (block new signups during QA). Bypass list
                applies to both independently. */}
            <div style={{ maxWidth: 780, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <LaunchStatusCard
                label="Training Hub - Sign In"
                icon="🎓"
                endpoint="/api/admin/training-coming-soon"
                previewUrl={(process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com') + '/signin'}
                onMessage={(msg) => showToast(msg)}
              />
              <LaunchStatusCard
                label="Training Hub - Register"
                icon="📝"
                endpoint="/api/admin/training-register-coming-soon"
                previewUrl={(process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com') + '/register'}
                onMessage={(msg) => showToast(msg)}
              />
            </div>

            {/* How-to guide */}
            <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: '20px 24px', maxWidth: 780 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1E40AF', marginBottom: 12 }}>📋 How to deploy your Apps Script</div>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#1E3A5F', lineHeight: 2 }}>
                <li>Open <strong>Google Drive</strong> and create or open your Apps Script project.</li>
                <li>In the script editor, click <strong>Deploy → New deployment</strong>.</li>
                <li>Select type: <strong>Web app</strong>.</li>
                <li>Set <em>Execute as</em>: <strong>Me</strong>, and <em>Who has access</em>: <strong>Anyone</strong>.</li>
                <li>Click <strong>Deploy</strong> and copy the Web App URL.</li>
                <li>Paste the URL above and click <strong>Save</strong>.</li>
                <li>Click <strong>🔌 Test</strong> to verify the connection.</li>
              </ol>
              <div style={{ marginTop: 12, fontSize: 12, color: '#1E40AF', background: '#DBEAFE', borderRadius: 6, padding: '8px 12px' }}>
                💡 <strong>Tip:</strong> If you redeploy the script, the URL changes. Always update it here after a new deployment. Using "Manage deployments" to update an existing deployment keeps the same URL.
              </div>
            </div>
          </>
        )}

      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: '#1B3A6B', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 999 }}>
          {toast}
        </div>
      )}

      {/* Model-submission gate confirm dialog (Phase E.2). Required for every
          required_<course> flip in either direction; announcement_only flips
          do not surface this dialog because they cannot block any student. */}
      {msConfirm && (
        <div
          onClick={() => msSavingKey === null && setMsConfirm(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(13,46,90,0.55)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Confirm cutover
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: msConfirm.danger ? '#991B1B' : '#1B3A6B', margin: '0 0 10px' }}>
              {msConfirm.danger ? '⚠️ ' : ''}{msConfirm.title}
            </h2>
            <p style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 14 }}>
              {msConfirm.body}
            </p>
            {msConfirm.danger && (
              <div style={{ marginBottom: 14, padding: '10px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#7F1D1D', lineHeight: 1.5 }}>
                <strong>Heads-up:</strong> students mid-attempt on the Final Exam right now are unaffected; the gate runs at start + submit, not during. Open submissions in the review queue stay valid - approve them and the matching student is unblocked immediately.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button
                onClick={() => setMsConfirm(null)}
                disabled={msSavingKey !== null}
                style={{ padding: '9px 16px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 13, fontWeight: 700, cursor: msSavingKey !== null ? 'not-allowed' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const ok = await saveModelGateFlag(msConfirm.key, msConfirm.nextValue);
                  if (ok) setMsConfirm(null);
                }}
                disabled={msSavingKey !== null}
                style={{ padding: '9px 18px', borderRadius: 6, border: 'none', background: msConfirm.danger ? '#DC2626' : '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: msSavingKey !== null ? 'not-allowed' : 'pointer' }}
              >
                {msSavingKey === msConfirm.key ? 'Saving...' : msConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatePill({ label, on, onLabel, offLabel, tone }: {
  label: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  tone: 'amber' | 'red' | 'gray';
}) {
  const palette = on
    ? (tone === 'amber' ? { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' }
      : tone === 'red'  ? { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' }
      :                   { bg: '#F3F4F6', fg: '#374151', border: '#E5E7EB' })
    : { bg: '#F3F4F6', fg: '#6B7280', border: '#E5E7EB' };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 12,
      background: palette.bg, color: palette.fg,
      border: `1px solid ${palette.border}`,
      fontSize: 11, fontWeight: 700,
    }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ letterSpacing: '0.04em' }}>· {on ? onLabel : offLabel}</span>
    </span>
  );
}
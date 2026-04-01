'use client';
import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: 13,
  border: '1px solid #D1D5DB', borderRadius: 6,
  fontFamily: 'Inter,sans-serif', outline: 'none',
  background: '#FFFBEB', boxSizing: 'border-box', color: '#1B3A6B',
};

const TRANSCRIPT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'transcript_header_title', label: 'Header Title',   placeholder: 'OFFICIAL ACADEMIC TRANSCRIPT' },
  { key: 'transcript_subtitle',     label: 'Subtitle',       placeholder: 'FMP Training Hub' },
  { key: 'transcript_footer_1',     label: 'Footer Line 1',  placeholder: 'This transcript is an official record issued by Financial Modeler Pro.' },
  { key: 'transcript_footer_2',     label: 'Footer Line 2',  placeholder: 'Verify certificate authenticity at certifier.io' },
  { key: 'transcript_instructor',   label: 'Instructor',     placeholder: 'Ahmad Din | Corporate Finance Expert' },
  { key: 'transcript_website_url',  label: 'Website URL',    placeholder: 'www.financialmodelerpro.com' },
];

const LOGO_SIZE_OPTIONS = [
  { value: '24', label: 'Small (24pt)' },
  { value: '32', label: 'Medium (32pt)' },
  { value: '48', label: 'Large (48pt)' },
  { value: '64', label: 'X-Large (64pt)' },
];

const LOGO_POSITION_OPTIONS = [
  { value: 'right',  label: 'Header Right — centered above subtitle (recommended)' },
  { value: 'left',   label: 'Header Left — inline with brand name' },
  { value: 'center', label: 'Header Center — stacked above brand name' },
  { value: 'none',   label: 'No Logo' },
];

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

  // Transcript settings
  const [transcriptFields, setTranscriptFields] = useState<Record<string, string>>({});
  const [transcriptSaving, setTranscriptSaving] = useState<Record<string, boolean>>({});
  // Logo upload
  const [logoUploading, setLogoUploading] = useState(false);

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session.user as any).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/training-settings').then(r => r.json()),
      fetch('/api/admin/content?section=transcript').then(r => r.json()),
    ]).then(([ts, cms]) => {
      const u = ts.settings?.apps_script_url ?? '';
      setUrl(u);
      setSavedUrl(u);
      // Build map of key → value from CMS rows
      const rows: { key: string; value: string }[] = Array.isArray(cms.rows) ? cms.rows : [];
      const map: Record<string, string> = {};
      rows.forEach(r => { map[r.key] = r.value; });
      setTranscriptFields(map);
      setLoading(false);
    });
  }, []);

  const saveTranscriptField = async (key: string, value: string) => {
    setTranscriptSaving(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: 'transcript', key, value }),
      });
      if (res.ok) {
        showToast('Saved');
      } else {
        showToast('Save failed');
      }
    } catch {
      showToast('Save failed');
    }
    setTranscriptSaving(prev => ({ ...prev, [key]: false }));
  };

  const uploadLogo = async (file: File) => {
    setLogoUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('bucket', 'cms-assets');
      form.append('folder', 'transcript-logos');
      const res = await fetch('/api/admin/media', { method: 'POST', body: form });
      if (!res.ok) { showToast('Upload failed'); return; }
      const { url } = await res.json() as { url: string };
      // Save URL to cms_content
      await saveTranscriptField('transcript_logo_url', url);
      setTranscriptFields(prev => ({ ...prev, transcript_logo_url: url }));
      showToast('Logo uploaded & saved');
    } catch {
      showToast('Upload failed');
    }
    setLogoUploading(false);
  };

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

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
                Deploy your Apps Script project as a Web App and paste the URL below. This replaces the <code style={{ background: '#F3F4F6', padding: '1px 5px', borderRadius: 3 }}>APPS_SCRIPT_URL</code> environment variable — no Vercel re-deploy needed.
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
                      <span style={{ color: '#1A7A30', fontWeight: 600 }}>Connection successful — Apps Script is reachable.</span>
                    </>
                  ) : (
                    <>
                      <span style={{ color: '#DC2626', fontSize: 16 }}>❌</span>
                      <span style={{ color: '#DC2626', fontWeight: 600 }}>Connection failed — check the URL or deployment permissions.</span>
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
                  ⚠️ No URL saved — training registration and progress features are disabled.
                </div>
              )}
            </div>

            {/* Transcript Settings Card */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px', marginBottom: 24, maxWidth: 780 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#1B3A6B', marginBottom: 4 }}>
                📄 Transcript Settings
              </div>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 20 }}>
                Customise the text fields that appear on student transcript PDFs.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {TRANSCRIPT_FIELDS.map(({ key, label, placeholder }) => {
                  const isSaving = transcriptSaving[key] ?? false;
                  const value    = transcriptFields[key] ?? '';
                  return (
                    <div key={key}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          value={value}
                          onChange={e => setTranscriptFields(prev => ({ ...prev, [key]: e.target.value }))}
                          placeholder={placeholder}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button
                          onClick={() => saveTranscriptField(key, value)}
                          disabled={isSaving}
                          style={{ padding: '9px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: isSaving ? 0.7 : 1 }}
                        >
                          {isSaving ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* ── Logo Settings ── */}
                <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 18, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#1B3A6B', marginBottom: 14, letterSpacing: '0.04em' }}>
                    🖼 Logo Settings
                  </div>

                  {/* Current logo preview */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Current Logo</div>
                    {transcriptFields['transcript_logo_url'] ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={transcriptFields['transcript_logo_url']}
                          alt="Transcript logo"
                          style={{ height: 48, maxWidth: 180, objectFit: 'contain', border: '1px solid #E5E7EB', borderRadius: 6, padding: 4, background: '#F9FAFB' }}
                        />
                        <button
                          onClick={async () => {
                            await saveTranscriptField('transcript_logo_url', '');
                            setTranscriptFields(prev => ({ ...prev, transcript_logo_url: '' }));
                          }}
                          style={{ fontSize: 11, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 5, padding: '5px 12px', cursor: 'pointer' }}
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>No logo set — branding config logo will be used as fallback</div>
                    )}
                  </div>

                  {/* Upload new logo */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Upload Logo</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <label style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '8px 18px', background: logoUploading ? '#F3F4F6' : '#1B4F8A',
                        color: logoUploading ? '#9CA3AF' : '#fff', borderRadius: 6,
                        fontSize: 12, fontWeight: 700, cursor: logoUploading ? 'default' : 'pointer',
                      }}>
                        {logoUploading ? 'Uploading…' : '📁 Choose File'}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/svg+xml,image/webp"
                          disabled={logoUploading}
                          style={{ display: 'none' }}
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.target.value = ''; }}
                        />
                      </label>
                      <span style={{ fontSize: 11, color: '#9CA3AF' }}>PNG, JPG, SVG or WebP — recommended size 200×200px or square</span>
                    </div>
                  </div>

                  {/* Logo size */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logo Size (in PDF)</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        value={transcriptFields['transcript_logo_width'] ?? '32'}
                        onChange={e => setTranscriptFields(prev => ({ ...prev, transcript_logo_width: e.target.value }))}
                        style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
                      >
                        {LOGO_SIZE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <button
                        onClick={() => saveTranscriptField('transcript_logo_width', transcriptFields['transcript_logo_width'] ?? '32')}
                        disabled={transcriptSaving['transcript_logo_width']}
                        style={{ padding: '9px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: transcriptSaving['transcript_logo_width'] ? 0.7 : 1 }}
                      >
                        {transcriptSaving['transcript_logo_width'] ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  {/* Logo position */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logo Position</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        value={transcriptFields['transcript_logo_position'] ?? 'left'}
                        onChange={e => setTranscriptFields(prev => ({ ...prev, transcript_logo_position: e.target.value }))}
                        style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
                      >
                        {LOGO_POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <button
                        onClick={() => saveTranscriptField('transcript_logo_position', transcriptFields['transcript_logo_position'] ?? 'left')}
                        disabled={transcriptSaving['transcript_logo_position']}
                        style={{ padding: '9px 18px', background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: transcriptSaving['transcript_logo_position'] ? 0.7 : 1 }}
                      >
                        {transcriptSaving['transcript_logo_position'] ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
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
    </div>
  );
}

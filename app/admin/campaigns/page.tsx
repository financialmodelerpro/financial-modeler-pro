'use client';

/**
 * /admin/campaigns - email the Modeling Hub users.
 *
 * Four steps in the order the decisions are actually made: choose WHO, choose
 * WHAT (a saved template, editable before sending), PREVIEW the rendered email
 * against a real recipient with the live count beside it, then CONFIRM a send
 * that names that count.
 *
 * The count shown always comes from the server's own audience resolution, the
 * same function the send uses, and the send re-resolves and refuses if the
 * number moved between preview and confirm. So the number an admin approves is
 * the number that receives it.
 *
 * Locked palette. No em dashes in this file.
 */
import { useCallback, useEffect, useState } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { useRequireAdmin } from '@/src/shared/hooks/useRequireAdmin';

const NAVY = '#1B3A6B';
const NAVY_MID = '#1B4F8A';
const NAVY_PALE = '#E8F0FB';
const GOLD_PALE = '#FDF6E3';
const GOLD = '#C9A84C';

interface Template {
  id: string; name: string; description: string | null;
  subject: string; body_html: string; is_seed: boolean;
}
interface MergeField { token: string; label: string }
interface UserRow { id: string; email: string; name: string | null; role: string; subscription_plan: string; subscription_status: string; works_in_real_estate?: boolean | null }
interface Preview {
  subject: string; html: string;
  previewFor: { email: string; name: string | null; company: string | null } | null;
  recipientCount: number; unsubscribedCount: number; adminsExcluded: number;
}
interface CampaignLog {
  campaignId: string; subject: string; templateName: string | null;
  sentBy: string; sentAt: string; sent: number; failed: number; skipped: number;
  rows: Array<{ email: string; status: string; error: string | null }>;
}

const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 800, color: '#6B7280', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 };
const input: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid #D1D5DB', borderRadius: 7, fontSize: 13, fontFamily: 'inherit', background: '#fff' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid ' + NAVY_PALE, borderRadius: 12, padding: 20, marginBottom: 20 };
const btn = (primary = false): React.CSSProperties => ({
  padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
  fontFamily: 'inherit', border: primary ? 'none' : '1px solid #D1D5DB',
  background: primary ? NAVY_MID : '#fff', color: primary ? '#fff' : '#374151',
});

export default function CampaignsPage() {
  const { loading: authLoading } = useRequireAdmin();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [mergeFields, setMergeFields] = useState<MergeField[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [logs, setLogs] = useState<CampaignLog[]>([]);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  // Audience
  const [mode, setMode] = useState<'filters' | 'selected'>('filters');
  const [plans, setPlans] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [industry, setIndustry] = useState<'all' | 'yes' | 'no' | 'unknown'>('all');
  const [picked, setPicked] = useState<string[]>([]);

  // Content
  const [templateId, setTemplateId] = useState<string>('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [saveAsName, setSaveAsName] = useState('');

  // Flow
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const say = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 5000); };

  const loadTemplates = useCallback(async () => {
    const res = await fetch('/api/admin/campaigns/templates');
    const j = await res.json();
    if (!res.ok) { setUnavailable(j.error ?? 'Templates unavailable'); return; }
    setTemplates(j.templates ?? []);
    setMergeFields(j.mergeFields ?? []);
  }, []);

  const loadLogs = useCallback(async () => {
    const res = await fetch('/api/admin/campaigns/log');
    if (!res.ok) return;
    const j = await res.json();
    setLogs(j.campaigns ?? []);
  }, []);

  useEffect(() => {
    void loadTemplates();
    void loadLogs();
    fetch('/api/admin/users?page=0&size=500')
      .then((r) => r.json())
      .then((j) => setUsers(j.users ?? []))
      .catch(() => {});
  }, [loadTemplates, loadLogs]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) { setSubject(t.subject); setBodyHtml(t.body_html); }
    setPreview(null); setConfirming(false);
  };

  const filters = () => (mode === 'selected'
    ? { userIds: picked }
    : { planKeys: plans, statuses, industry });

  const doPreview = async () => {
    setBusy(true); setConfirming(false);
    try {
      const res = await fetch('/api/admin/campaigns/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: filters(), subject, bodyHtml, meetingLink }),
      });
      const j = await res.json();
      if (!res.ok) { say(j.error ?? 'Preview failed', false); return; }
      setPreview(j as Preview);
    } finally { setBusy(false); }
  };

  const doSend = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/campaigns/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: filters(), subject, bodyHtml, meetingLink,
          templateId: templateId || null,
          templateName: templates.find((t) => t.id === templateId)?.name ?? null,
          confirm: true, expectedCount: preview.recipientCount,
        }),
      });
      const j = await res.json();
      if (!res.ok) { say(j.error ?? 'Send failed', false); return; }
      say(`Sent to ${j.sent} recipient${j.sent === 1 ? '' : 's'}${j.failed ? `, ${j.failed} failed` : ''}${j.skipped ? `, ${j.skipped} skipped (unsubscribed)` : ''}`);
      setConfirming(false); setPreview(null);
      void loadLogs();
    } finally { setBusy(false); }
  };

  const saveAsTemplate = async () => {
    const name = saveAsName.trim();
    if (!name) { say('Give the new template a name', false); return; }
    const res = await fetch('/api/admin/campaigns/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, subject, bodyHtml }),
    });
    const j = await res.json();
    if (!res.ok) { say(j.error ?? 'Could not save', false); return; }
    say(`Saved "${name}"`);
    setSaveAsName('');
    void loadTemplates();
  };

  const updateTemplate = async () => {
    if (!templateId) return;
    const res = await fetch('/api/admin/campaigns/templates', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: templateId, subject, bodyHtml }),
    });
    if (!res.ok) { say('Could not update the template', false); return; }
    say('Template updated');
    void loadTemplates();
  };

  if (authLoading) return null;

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const planOptions = [...new Set(users.map((u) => u.subscription_plan).filter(Boolean))].sort();
  const statusOptions = [...new Set(users.map((u) => u.subscription_status).filter(Boolean))].sort();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/campaigns" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }} data-testid="admin-campaigns">
        <h1 style={{ fontSize: 24, fontWeight: 800, color: NAVY, marginBottom: 4 }}>Email Campaigns</h1>
        <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 24 }}>
          Email Modeling Hub users, for example to offer a guided walkthrough. Sent from no-reply,
          replies go to ahmad.din@financialmodelerpro.com. Admins are never included unless you pick
          them yourself, and anyone who has unsubscribed is always excluded.
        </p>

        {unavailable && (
          <div style={{ ...card, background: GOLD_PALE, border: `1px solid ${GOLD}` }} data-testid="campaigns-unavailable">
            <strong>{unavailable}</strong>
          </div>
        )}

        {/* 1. Audience */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, color: NAVY, marginBottom: 12 }}>1. Who receives it</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['filters', 'selected'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setPreview(null); }} data-testid={`campaign-mode-${m}`}
                style={{ ...btn(mode === m), padding: '6px 14px', fontSize: 12 }}>
                {m === 'filters' ? 'Everyone matching filters' : `Selected users (${picked.length})`}
              </button>
            ))}
          </div>

          {mode === 'filters' ? (
            <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div>
                <label style={label}>Plan</label>
                {planOptions.map((p) => (
                  <label key={p} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={plans.includes(p)} onChange={() => { toggle(plans, p, setPlans); setPreview(null); }} />
                    {p}
                  </label>
                ))}
                <div style={{ fontSize: 11, color: '#6B7280' }}>None ticked means every plan.</div>
              </div>
              <div>
                <label style={label}>Status</label>
                {statusOptions.map((s) => (
                  <label key={s} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={statuses.includes(s)} onChange={() => { toggle(statuses, s, setStatuses); setPreview(null); }} />
                    {s}
                  </label>
                ))}
                <div style={{ fontSize: 11, color: '#6B7280' }}>None ticked means every status.</div>
              </div>
              <div>
                <label style={label}>Real estate / hospitality</label>
                <select value={industry} onChange={(e) => { setIndustry(e.target.value as typeof industry); setPreview(null); }} style={input} data-testid="campaign-industry">
                  <option value="all">Everyone</option>
                  <option value="yes">Works in real estate / hospitality</option>
                  <option value="no">Does not</option>
                  <option value="unknown">Never asked</option>
                </select>
              </div>
            </div>
          ) : (
            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #E5E7EB', borderRadius: 8 }}>
              {users.map((u) => (
                <label key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 12px', borderBottom: '1px solid #F3F4F6', fontSize: 13, cursor: 'pointer' }}>
                  <input type="checkbox" checked={picked.includes(u.id)} onChange={() => { toggle(picked, u.id, setPicked); setPreview(null); }} />
                  <span style={{ flex: 1 }}>{u.email}</span>
                  <span style={{ fontSize: 11, color: '#6B7280' }}>{u.subscription_plan}</span>
                  {u.role === 'admin' && <span style={{ fontSize: 10, fontWeight: 800, color: '#92400e', background: '#FEF3C7', padding: '2px 6px', borderRadius: 999 }}>ADMIN</span>}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* 2. Content */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, color: NAVY, marginBottom: 12 }}>2. What it says</div>
          <div style={{ marginBottom: 14 }}>
            <label style={label}>Template</label>
            <select value={templateId} onChange={(e) => applyTemplate(e.target.value)} style={input} data-testid="campaign-template">
              <option value="">Start from blank</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_seed ? ' (seeded)' : ''}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={label}>Subject</label>
            <input value={subject} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} style={input} data-testid="campaign-subject" />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={label}>Meeting link</label>
            <input value={meetingLink} onChange={(e) => { setMeetingLink(e.target.value); setPreview(null); }} style={input}
              placeholder="https://calendly.com/..." data-testid="campaign-meeting-link" />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={label}>Body</label>
            <textarea value={bodyHtml} onChange={(e) => { setBodyHtml(e.target.value); setPreview(null); }} rows={12}
              style={{ ...input, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.6, resize: 'vertical' }} data-testid="campaign-body" />
          </div>
          <div style={{ fontSize: 11.5, color: '#6B7280', marginBottom: 14 }}>
            Merge fields: {mergeFields.map((f) => <code key={f.token} title={f.label} style={{ background: NAVY_PALE, color: NAVY, padding: '1px 5px', borderRadius: 4, marginRight: 6 }}>{f.token}</code>)}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {templateId && <button onClick={() => void updateTemplate()} style={btn()} data-testid="campaign-update-template">Update this template</button>}
            <input value={saveAsName} onChange={(e) => setSaveAsName(e.target.value)} placeholder="Save edit as new template…"
              style={{ ...input, width: 240 }} data-testid="campaign-saveas-name" />
            <button onClick={() => void saveAsTemplate()} style={btn()} data-testid="campaign-saveas">Save as new</button>
          </div>
        </div>

        {/* 3. Preview + 4. Confirm */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, color: NAVY, marginBottom: 12 }}>3. Preview and send</div>
          <button onClick={() => void doPreview()} disabled={busy || !subject.trim() || !bodyHtml.trim()} style={btn(true)} data-testid="campaign-preview-btn">
            {busy ? 'Working…' : 'Preview'}
          </button>

          {preview && (
            <div style={{ marginTop: 18 }} data-testid="campaign-preview">
              <div style={{ background: NAVY_PALE, borderRadius: 8, padding: '12px 14px', fontSize: 13, color: NAVY, marginBottom: 12 }}>
                <strong data-testid="campaign-recipient-count">{preview.recipientCount}</strong> recipient{preview.recipientCount === 1 ? '' : 's'} will receive this.
                {preview.unsubscribedCount > 0 && <> {preview.unsubscribedCount} matched but have unsubscribed and are excluded.</>}
                {preview.adminsExcluded > 0 && <> {preview.adminsExcluded} admin account{preview.adminsExcluded === 1 ? '' : 's'} excluded.</>}
                {preview.previewFor && <> Rendered below for {preview.previewFor.email}.</>}
              </div>
              <div style={{ fontSize: 12.5, color: '#374151', marginBottom: 6 }}><strong>Subject:</strong> {preview.subject}</div>
              <iframe title="Email preview" srcDoc={preview.html} style={{ width: '100%', height: 460, border: '1px solid #E5E7EB', borderRadius: 8, background: '#fff' }} />

              {!confirming ? (
                <button onClick={() => setConfirming(true)} disabled={preview.recipientCount === 0} style={{ ...btn(true), marginTop: 14 }} data-testid="campaign-send-btn">
                  Send to {preview.recipientCount} recipient{preview.recipientCount === 1 ? '' : 's'}
                </button>
              ) : (
                <div style={{ marginTop: 14, background: GOLD_PALE, border: `1px solid ${GOLD}`, borderRadius: 8, padding: '14px 16px' }} data-testid="campaign-confirm">
                  <div style={{ fontSize: 13, color: '#0D2E5A', marginBottom: 12, lineHeight: 1.6 }}>
                    Send <strong>{preview.subject}</strong> to <strong>{preview.recipientCount}</strong> recipient
                    {preview.recipientCount === 1 ? '' : 's'} now? This cannot be recalled.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setConfirming(false)} style={btn()}>Cancel</button>
                    <button onClick={() => void doSend()} disabled={busy} style={{ ...btn(true), background: '#B45309' }} data-testid="campaign-confirm-send">
                      {busy ? 'Sending…' : `Yes, send to ${preview.recipientCount}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Log */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, color: NAVY, marginBottom: 12 }}>Send log</div>
          {logs.length === 0 ? (
            <div style={{ fontSize: 13, color: '#6B7280' }}>Nothing sent yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="campaign-log">
              <thead>
                <tr style={{ background: NAVY_MID }}>
                  {['Sent', 'Subject', 'Template', 'By', 'Sent to', 'Failed', 'Skipped'].map((h) => (
                    <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10.5, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((c, i) => (
                  <tr key={c.campaignId} style={{ borderTop: '1px solid ' + NAVY_PALE, background: i % 2 ? '#F9FAFB' : '#fff' }}>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap' }}>{new Date(c.sentAt).toLocaleString()}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#374151', fontWeight: 600 }}>{c.subject}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#6B7280' }}>{c.templateName ?? '-'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: '#6B7280' }}>{c.sentBy}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#166534', fontWeight: 700 }}>{c.sent}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12.5, color: c.failed ? '#B91C1C' : '#9CA3AF', fontWeight: 700 }}
                      title={c.rows.filter((r) => r.status === 'failed').map((r) => `${r.email}: ${r.error}`).join('\n') || undefined}>
                      {c.failed}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 12.5, color: '#6B7280' }}>{c.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {toast && (
          <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.ok ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 22px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999, maxWidth: 460 }}>
            {toast.msg}
          </div>
        )}
      </main>
    </div>
  );
}

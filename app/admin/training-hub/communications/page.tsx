'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

interface StudentRow {
  registrationId: string; name: string; email: string; course: string;
  daysSinceEnroll?: number | null; sessionsPassedCount?: number; totalSessions?: number;
  sessionsLeft?: number;
}
interface DropoutData {
  neverStarted: StudentRow[]; stalled: StudentRow[]; almostDone: StudentRow[];
}
interface EmailLog {
  id: string; campaign_name: string; recipient_email: string; email_type: string;
  subject: string | null; sent_at: string; status: string;
}

type TabType = 'send' | 'history' | 'share';
type GroupType = 'neverStarted' | 'stalled' | 'almostDone' | 'custom';

const GROUP_META: Record<GroupType, { label: string; color: string; bg: string; icon: string; desc: string }> = {
  neverStarted: { label: 'Never Started',  color: '#DC2626', bg: '#FEE2E2', icon: '🚫', desc: "Enrolled but haven't begun any sessions" },
  stalled:      { label: 'Stalled',        color: '#92400E', bg: '#FEF3C7', icon: '⏸️', desc: 'Started but not progressing or completed' },
  almostDone:   { label: 'Almost Done',    color: '#065F46', bg: '#D1FAE5', icon: '🏁', desc: '≥80% complete - nudge them to finish' },
  custom:       { label: 'Custom List',    color: '#1B4F8A', bg: '#EFF6FF', icon: '✏️', desc: 'Manually entered comma-separated emails' },
};

// Pre-built re-engagement templates per recipient group. Tokens
// {name} / {full_name} / {reg_id} / {email} are resolved server-side
// per recipient from training_registrations_meta (see communications
// POST route). Body intentionally avoids signing off with a name or
// "Financial Modeler Pro" because the branded email layout appends
// signature_html from email_branding underneath this content. A line
// that is just a URL renders as a gold CTA button (Outlook-safe).
const SIGNIN_URL = 'https://learn.financialmodelerpro.com/signin';
const TEMPLATES: Partial<Record<GroupType, { subject: string; message: string }>> = {
  neverStarted: {
    subject: 'Your training spot is waiting, {name}',
    message:
`Hi {name} ({reg_id}),

I noticed you signed up for the Financial Modeler Pro training but have not started any sessions yet. I wanted to check in personally.

The first session takes about 20 minutes and walks you through the structure of a clean three-statement model. Most students tell me it clicks faster than they expected.

If something is in the way (the platform, time, anything at all) just hit reply and I will help you get unstuck.

Otherwise, your dashboard is ready when you are:
${SIGNIN_URL}

Looking forward to seeing your progress.`,
  },
  stalled: {
    subject: 'Picking up where you left off, {name}',
    message:
`Hi {name} ({reg_id}),

You started the Financial Modeler Pro training and made real progress, but the dashboard tells me it has been a while since your last session. I wanted to send a quick nudge.

The sessions are short by design and build on each other, so one focused half-hour is usually enough to find your rhythm again. Your progress is saved exactly where you left it.

If something did not click, or you want me to suggest the right session to restart from, just reply to this email.

Ready when you are:
${SIGNIN_URL}`,
  },
  almostDone: {
    subject: 'You are almost certified, {name}',
    message:
`Hi {name} ({reg_id}),

You are within reach of your Financial Modeler Pro certification. Only the final exam stands between you and the credential.

The final is open-book and built on the same modeling work you have already practiced through the regular sessions. Most students who reach your stage clear it on the first attempt.

A few tips before you sit it: review the income statement to balance sheet linkage, and walk through the cash flow build once. That covers the bulk of what is tested.

If you would like to talk anything through before starting, just reply to this email.

Take the final exam:
${SIGNIN_URL}`,
  },
};

const TEMPLATE_VALUES = Object.values(TEMPLATES) as { subject: string; message: string }[];

export default function CommunicationsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [tab, setTab]               = useState<TabType>('send');
  const [shareTitle, setShareTitle] = useState('');
  const [shareMsg, setShareMsg]     = useState('');
  const [shareLoaded, setShareLoaded] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareToast, setShareToast]   = useState('');
  const [dropout, setDropout]       = useState<DropoutData | null>(null);
  const [logs, setLogs]             = useState<EmailLog[]>([]);
  const [loadingDropout, setLoadingDropout] = useState(false);
  const [loadingLogs, setLoadingLogs]       = useState(false);

  // Compose form state
  const [selectedGroup, setSelectedGroup] = useState<GroupType>('neverStarted');
  const [subject, setSubject]   = useState('');
  const [message, setMessage]   = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [customEmails, setCustomEmails] = useState('');
  const [sending, setSending]   = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);
  const [sendError, setSendError]   = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/admin'); return; }
    if (status === 'authenticated' && (session.user as { role?: string }).role !== 'admin') router.replace('/');
  }, [status, session, router]);

  // Auto-fill subject + message when admin selects a recipient group.
  // Skips 'custom' (no template). Preserves admin edits: only fills when
  // both fields are empty OR they currently match a known template
  // (i.e. the admin is cycling through templates without having typed
  // anything custom). Once edited, switching groups will not clobber.
  useEffect(() => {
    const tpl = TEMPLATES[selectedGroup];
    if (!tpl) return;
    const isUnedited = !subject.trim() && !message.trim();
    const matchesAnyTemplate = TEMPLATE_VALUES.some(t => t.subject === subject && t.message === message);
    if (isUnedited || matchesAnyTemplate) {
      setSubject(tpl.subject);
      setMessage(tpl.message);
    }
    // Only react to selectedGroup changes; subject/message are read but
    // intentionally not in deps to avoid a re-run loop after we setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup]);

  const applyTemplate = () => {
    const tpl = TEMPLATES[selectedGroup];
    if (!tpl) return;
    setSubject(tpl.subject);
    setMessage(tpl.message);
  };

  const fetchDropout = useCallback(async () => {
    setLoadingDropout(true);
    try {
      const res = await fetch('/api/admin/training-hub/communications?type=dropout');
      if (res.ok) setDropout(await res.json());
    } catch { /* ignore */ }
    setLoadingDropout(false);
  }, []);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch('/api/admin/training-hub/communications?type=history');
      if (res.ok) {
        const j = await res.json();
        setLogs(j.logs ?? []);
      }
    } catch { /* ignore */ }
    setLoadingLogs(false);
  }, []);

  useEffect(() => { fetchDropout(); }, [fetchDropout]);
  useEffect(() => { if (tab === 'history') fetchLogs(); }, [tab, fetchLogs]);

  const groupStudents = (): StudentRow[] => {
    if (!dropout) return [];
    if (selectedGroup === 'neverStarted') return dropout.neverStarted;
    if (selectedGroup === 'stalled')      return dropout.stalled;
    if (selectedGroup === 'almostDone')   return dropout.almostDone;
    return [];
  };

  const getRecipients = () => {
    if (selectedGroup === 'custom') {
      return customEmails.split(',').map(e => e.trim()).filter(Boolean).map(email => ({
        registrationId: email, email, name: email,
      }));
    }
    return groupStudents().map(s => ({
      registrationId: s.registrationId, email: s.email, name: s.name,
    }));
  };

  const handleSend = async () => {
    const recipients = getRecipients();
    if (!subject.trim()) { setSendError('Subject is required'); return; }
    if (!message.trim()) { setSendError('Message is required'); return; }
    if (!recipients.length) { setSendError('No recipients selected'); return; }
    setSendError('');
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/admin/training-hub/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName: campaignName || `${GROUP_META[selectedGroup].label} - ${new Date().toLocaleDateString()}`,
          subject,
          message,
          emailType: selectedGroup,
          recipients,
        }),
      });
      const j = await res.json();
      if (res.ok) {
        setSendResult({ sent: j.sent, failed: j.failed });
        setSubject('');
        setMessage('');
        setCampaignName('');
        setCustomEmails('');
      } else {
        setSendError(j.error ?? 'Send failed');
      }
    } catch {
      setSendError('Network error');
    }
    setSending(false);
  };

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700,
    color: '#fff', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
  };

  const students = groupStudents();
  const recipientCount = selectedGroup === 'custom'
    ? customEmails.split(',').map(e => e.trim()).filter(Boolean).length
    : students.length;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter',sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/training-hub/communications" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>

        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1B3A6B', marginBottom: 4 }}>✉️ Communications</h1>
          <p style={{ fontSize: 13, color: '#6B7280' }}>Send targeted emails to student groups and view campaign history</p>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 28, background: '#fff', padding: 4, borderRadius: 8, width: 'fit-content', border: '1px solid #E8F0FB' }}>
          {([['send', '✉️ Send Campaign'], ['history', '📜 Email History'], ['share', '🎉 Share Messages']] as const).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              style={{ padding: '7px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 700 : 500, background: tab === t ? '#1B4F8A' : 'transparent', color: tab === t ? '#fff' : '#6B7280' }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── SEND CAMPAIGN ── */}
        {tab === 'send' && (
          <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 24, alignItems: 'start' }}>

            {/* Left: recipient group picker */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Select Recipient Group</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(Object.keys(GROUP_META) as GroupType[]).map(g => {
                  const meta = GROUP_META[g];
                  const count = g === 'custom' ? null
                    : g === 'neverStarted' ? (dropout?.neverStarted.length ?? 0)
                    : g === 'stalled'      ? (dropout?.stalled.length ?? 0)
                    : (dropout?.almostDone.length ?? 0);
                  return (
                    <button key={g} onClick={() => setSelectedGroup(g)}
                      style={{
                        textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: `2px solid ${selectedGroup === g ? meta.color : '#E8F0FB'}`,
                        background: selectedGroup === g ? meta.bg : '#fff', cursor: 'pointer',
                      }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: meta.color }}>{meta.icon} {meta.label}</span>
                        {count !== null && (
                          <span style={{ fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.color, borderRadius: 20, padding: '1px 8px', border: `1px solid ${meta.color}` }}>
                            {loadingDropout ? '…' : count}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280' }}>{meta.desc}</div>
                    </button>
                  );
                })}
              </div>

              {/* Preview list */}
              {selectedGroup !== 'custom' && students.length > 0 && (
                <div style={{ marginTop: 16, background: '#fff', border: '1px solid #E8F0FB', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #F3F4F6' }}>
                    Recipients ({students.length})
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    {students.slice(0, 30).map(s => (
                      <div key={s.registrationId} style={{ padding: '8px 14px', borderBottom: '1px solid #F9FAFB', fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: '#1B3A6B' }}>{s.name}</div>
                        <div style={{ color: '#6B7280', fontSize: 11 }}>{s.email} · {s.course}</div>
                        {s.daysSinceEnroll != null && (
                          <div style={{ color: '#9CA3AF', fontSize: 10 }}>Enrolled {s.daysSinceEnroll}d ago</div>
                        )}
                      </div>
                    ))}
                    {students.length > 30 && (
                      <div style={{ padding: '8px 14px', fontSize: 11, color: '#9CA3AF', textAlign: 'center' }}>
                        +{students.length - 30} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right: compose form */}
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: '24px 28px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#1B3A6B' }}>Compose Email</div>
                {TEMPLATES[selectedGroup] && (
                  <button onClick={applyTemplate} type="button"
                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #C7D7EE', background: '#F4F8FE', color: '#1B4F8A', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                    title={`Replace subject + message with the ${GROUP_META[selectedGroup].label} re-engagement template`}>
                    ↻ Use {GROUP_META[selectedGroup].label} template
                  </button>
                )}
              </div>
              {TEMPLATES[selectedGroup] && (
                <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 16, padding: '10px 12px', background: '#F9FAFB', borderRadius: 6, border: '1px solid #F3F4F6', lineHeight: 1.6 }}>
                  Pre-filled with the <strong>{GROUP_META[selectedGroup].label}</strong> template. Edit freely. Available tokens (resolved per recipient from <code style={{ background: '#E5E7EB', padding: '0 4px', borderRadius: 3 }}>training_registrations_meta</code>):
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <span><code style={{ background: '#E5E7EB', padding: '0 4px', borderRadius: 3 }}>{'{name}'}</code> first name</span>
                    <span><code style={{ background: '#E5E7EB', padding: '0 4px', borderRadius: 3 }}>{'{full_name}'}</code> full name</span>
                    <span><code style={{ background: '#E5E7EB', padding: '0 4px', borderRadius: 3 }}>{'{reg_id}'}</code> e.g. FMP-2026-0001</span>
                    <span><code style={{ background: '#E5E7EB', padding: '0 4px', borderRadius: 3 }}>{'{email}'}</code> recipient address</span>
                  </div>
                  <div style={{ marginTop: 6, color: '#9CA3AF' }}>A line that is just a URL renders as a gold CTA button. Empty <code style={{ background: '#E5E7EB', padding: '0 4px', borderRadius: 3 }}>{'( )'}</code> from a missing reg ID is auto-stripped.</div>
                </div>
              )}

              {sendResult && (
                <div style={{ background: '#F0FFF4', border: '1px solid #86EFAC', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#15803D' }}>
                  ✅ Campaign sent - <strong>{sendResult.sent}</strong> delivered{sendResult.failed > 0 ? `, ${sendResult.failed} failed` : ''}
                </div>
              )}
              {sendError && (
                <div style={{ background: '#FFF5F5', border: '1px solid #FCA5A5', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#DC2626' }}>
                  {sendError}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Campaign Name (optional)</label>
                  <input value={campaignName} onChange={e => setCampaignName(e.target.value)}
                    placeholder={`${GROUP_META[selectedGroup].label} - ${new Date().toLocaleDateString()}`}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Subject *</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)}
                    placeholder="e.g. Don't miss out - your training awaits"
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>

                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Message *</label>
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={8}
                    placeholder="Write your message here. You can use the student's first name as {name}."
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                </div>

                {selectedGroup === 'custom' && (
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Email Addresses (comma-separated) *</label>
                    <textarea value={customEmails} onChange={e => setCustomEmails(e.target.value)} rows={3}
                      placeholder="student1@email.com, student2@email.com"
                      style={{ width: '100%', padding: '9px 12px', border: '1px solid #E5E7EB', borderRadius: 7, fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>
                    Sending to <strong style={{ color: '#1B3A6B' }}>{recipientCount}</strong> recipient{recipientCount !== 1 ? 's' : ''}
                  </div>
                  <button
                    onClick={handleSend}
                    disabled={sending || recipientCount === 0}
                    style={{
                      padding: '10px 24px', background: recipientCount === 0 ? '#E5E7EB' : '#1B4F8A',
                      color: recipientCount === 0 ? '#9CA3AF' : '#fff', border: 'none', borderRadius: 8,
                      fontSize: 13, fontWeight: 700, cursor: recipientCount === 0 ? 'not-allowed' : 'pointer',
                    }}>
                    {sending ? 'Sending…' : `✉️ Send to ${recipientCount}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── EMAIL HISTORY ── */}
        {tab === 'history' && (
          <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, overflow: 'hidden' }}>
            {loadingLogs ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#6B7280', fontSize: 14 }}>Loading…</div>
            ) : logs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF', fontSize: 14 }}>No emails sent yet.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#1B4F8A' }}>
                    {['Campaign', 'Type', 'Recipient', 'Subject', 'Sent At', 'Status'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, i) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #F3F4F6', background: i % 2 === 0 ? '#fff' : '#FAFAFA' }}>
                      <td style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#1B3A6B' }}>{log.campaign_name}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                          background: GROUP_META[log.email_type as GroupType]?.bg ?? '#F3F4F6',
                          color: GROUP_META[log.email_type as GroupType]?.color ?? '#6B7280' }}>
                          {GROUP_META[log.email_type as GroupType]?.label ?? log.email_type}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#374151' }}>{log.recipient_email}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: '#374151', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.subject ?? '-'}</td>
                      <td style={{ padding: '10px 14px', fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>
                        {new Date(log.sent_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                          background: log.status === 'sent' ? '#F0FFF4' : '#FFF5F5',
                          color:      log.status === 'sent' ? '#15803D' : '#DC2626' }}>
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Share Messages Tab ── */}
        {tab === 'share' && (
          <div style={{ maxWidth: 680 }}>
            {!shareLoaded ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6B7280' }}>
                {(() => {
                  // Load on first render of this tab
                  if (!shareLoaded) {
                    fetch('/api/admin/content')
                      .then(r => r.json())
                      .then(j => {
                        for (const row of (j.rows ?? []) as { section: string; key: string; value: string }[]) {
                          if (row.section === 'training' && row.key === 'share_achievement_title') setShareTitle(row.value);
                          if (row.section === 'training' && row.key === 'share_default_message') setShareMsg(row.value);
                        }
                        setShareLoaded(true);
                      })
                      .catch(() => setShareLoaded(true));
                  }
                  return 'Loading...';
                })()}
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 28 }}>
                <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 24, padding: '10px 14px', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 7 }}>
                  Controls the <strong>Share Achievement</strong> modal text shown to students after passing a session or earning a certificate. Use <code style={{ background: '#F3F4F6', padding: '1px 5px', borderRadius: 3 }}>{'{action}'}</code> for the achievement and <code style={{ background: '#F3F4F6', padding: '1px 5px', borderRadius: 3 }}>{'{course}'}</code> for the course name.
                </p>
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Share Modal Title</label>
                  <input style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #D1D5DB', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                    value={shareTitle || '🎉 Share Your Achievement'}
                    onChange={e => setShareTitle(e.target.value)}
                    placeholder="🎉 Share Your Achievement" />
                </div>
                <div style={{ marginBottom: 24 }}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Default Share Message</label>
                  <textarea style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #D1D5DB', borderRadius: 8, fontSize: 14, resize: 'vertical', minHeight: 120, fontFamily: 'inherit', boxSizing: 'border-box' }}
                    value={shareMsg || 'I just {action} at Financial Modeler Pro!\n\nBuilding institutional-grade financial models - Free certification program: https://financialmodelerpro.com/training\n\n#FinancialModeling #CorporateFinance #FinancialModelerPro'}
                    onChange={e => setShareMsg(e.target.value)} />
                  <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Supports {'{action}'} and {'{course}'} placeholders.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button onClick={async () => {
                    setShareSaving(true);
                    try {
                      await Promise.all([
                        fetch('/api/admin/content', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'training', key: 'share_achievement_title', value: shareTitle }) }),
                        fetch('/api/admin/content', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section: 'training', key: 'share_default_message', value: shareMsg }) }),
                      ]);
                      setShareToast('Saved');
                      setTimeout(() => setShareToast(''), 2500);
                    } catch { setShareToast('Failed'); }
                    finally { setShareSaving(false); }
                  }} disabled={shareSaving}
                    style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#1B4F8A', color: '#fff', fontSize: 13, fontWeight: 700, cursor: shareSaving ? 'not-allowed' : 'pointer' }}>
                    {shareSaving ? 'Saving...' : 'Save Share Messages'}
                  </button>
                  {shareToast && <span style={{ fontSize: 12, fontWeight: 600, color: '#2EAA4A' }}>{shareToast}</span>}
                </div>
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

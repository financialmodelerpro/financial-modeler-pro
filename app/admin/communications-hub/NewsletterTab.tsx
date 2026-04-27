'use client';

/**
 * Newsletter admin surface (5 sub-tabs):
 *
 *   Subscribers         - search/filter/CSV export of newsletter_subscribers
 *   Compose             - send a one-off campaign or schedule one for later;
 *                         template OR direct subject+body, segment dropdown,
 *                         live recipient count, "send to my inbox" test
 *   Templates           - DB-backed templates (newsletter_templates) editable
 *                         in place; powers manual sends + auto-notify
 *   Campaigns           - history with per-recipient analytics modal
 *                         (sent/opened/clicked/bounced/complained, retry
 *                         failed, CSV export, cancel scheduled)
 *   Auto Notifications  - per-event-type toggles (existing)
 *
 * The shared subject+body+segment+scheduledAt model and template engine
 * live in src/lib/newsletter/. This file is just glue.
 */

import { useState, useEffect, useCallback } from 'react';
import { RichTextEditor } from '@/src/components/admin/RichTextEditor';

const NAVY  = '#0D2E5A';
const GREEN = '#2EAA4A';
const BLUE  = '#1B4F8A';

interface Subscriber {
  id: string;
  email: string;
  hub: string;
  status: string;
  subscribed_at: string;
  unsubscribed_at: string | null;
}

interface Campaign {
  id: string;
  subject: string;
  body: string;
  target_hub: string;
  segment?: string | null;
  status: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
  scheduled_at?: string | null;
  created_by: string;
  campaign_type?: string;
  source_type?: string;
  source_id?: string;
}

interface Stats {
  totalActive: number;
  trainingActive: number;
  modelingActive: number;
  unsubscribed: number;
}

interface SegmentMeta {
  key: string;
  label: string;
  description: string;
}

interface NewsletterTemplate {
  id: string;
  template_key: string;
  name: string;
  subject_template: string;
  body_html: string;
  event_type: string | null;
  active: boolean;
  updated_at?: string;
}

interface RecipientRow {
  id: string;
  email: string;
  status: string;
  resend_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
}

interface CampaignAnalytics {
  campaign: Campaign;
  recipients: RecipientRow[];
  totals: {
    sent: number;
    failed: number;
    bounced: number;
    complained: number;
    opened: number;
    clicked: number;
    pending: number;
    total: number;
  };
  openRate: number;
  clickRate: number;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: '16px 20px', flex: '1 1 140px', minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function HubBadge({ hub }: { hub: string }) {
  const bg = hub === 'training' ? '#DCFCE7' : hub === 'modeling' ? '#DBEAFE' : '#F3F4F6';
  const fg = hub === 'training' ? '#166534' : hub === 'modeling' ? '#1E40AF' : '#374151';
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: bg, color: fg }}>{hub}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === 'active';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: isActive ? '#DCFCE7' : '#FEE2E2', color: isActive ? '#166534' : '#991B1B' }}>
      {status}
    </span>
  );
}

function RecipientStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    pending:    { bg: '#F3F4F6', fg: '#6B7280' },
    sent:       { bg: '#DCFCE7', fg: '#166534' },
    opened:     { bg: '#DBEAFE', fg: '#1E40AF' },
    clicked:    { bg: '#EDE9FE', fg: '#7C3AED' },
    failed:     { bg: '#FEE2E2', fg: '#991B1B' },
    bounced:    { bg: '#FED7AA', fg: '#9A3412' },
    complained: { bg: '#FECACA', fg: '#991B1B' },
  };
  const c = map[status] ?? map.pending;
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: c.bg, color: c.fg }}>{status}</span>;
}

export function NewsletterTab() {
  const [tab, setTab] = useState<'subscribers' | 'compose' | 'templates' | 'campaigns' | 'auto'>('subscribers');

  const tabLabels: Record<string, string> = {
    subscribers: 'Subscribers',
    compose:     'Compose',
    templates:   'Templates',
    campaigns:   'Campaigns',
    auto:        'Auto Notifications',
  };

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #E5E7EB', paddingBottom: 0, flexWrap: 'wrap' }}>
        {(['subscribers', 'compose', 'templates', 'campaigns', 'auto'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
            background: tab === t ? '#fff' : 'transparent', color: tab === t ? NAVY : '#9CA3AF',
            borderBottom: tab === t ? `2px solid ${NAVY}` : '2px solid transparent',
            borderRadius: '8px 8px 0 0', marginBottom: -2,
          }}>
            {tabLabels[t]}
          </button>
        ))}
      </div>

      {tab === 'subscribers' && <SubscribersTab />}
      {tab === 'compose'     && <ComposeTab onSent={() => setTab('campaigns')} />}
      {tab === 'templates'   && <TemplatesTab />}
      {tab === 'campaigns'   && <CampaignsTab />}
      {tab === 'auto'        && <AutoNotificationsTab />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subscribers
// ─────────────────────────────────────────────────────────────────────────

function SubscribersTab() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<Stats>({ totalActive: 0, trainingActive: 0, modelingActive: 0, unsubscribed: 0 });
  const [hub, setHub] = useState('all');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ hub, status, search, page: String(page), limit: String(limit) });
    const res = await fetch(`/api/admin/newsletter/subscribers?${params}`);
    const data = await res.json();
    setSubscribers(data.subscribers ?? []);
    setTotal(data.total ?? 0);
    setStats(data.stats ?? stats);
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, status, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalPages = Math.ceil(total / limit);
  const selectStyle: React.CSSProperties = { padding: '7px 12px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 13, background: '#fff', color: '#374151' };

  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Total Active" value={stats.totalActive} color={GREEN} />
        <StatCard label="Training Hub" value={stats.trainingActive} color="#166534" />
        <StatCard label="Modeling Hub" value={stats.modelingActive} color="#1E40AF" />
        <StatCard label="Unsubscribed" value={stats.unsubscribed} color="#9CA3AF" />
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={hub} onChange={e => { setHub(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="all">All Hubs</option>
          <option value="training">Training</option>
          <option value="modeling">Modeling</option>
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} style={selectStyle}>
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="all">All Status</option>
        </select>
        <input
          type="text"
          placeholder="Search email..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ ...selectStyle, minWidth: 200 }}
        />
        <a
          href={`/api/admin/newsletter/export?hub=${hub}&status=${status}`}
          style={{ padding: '7px 14px', borderRadius: 6, background: NAVY, color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}
        >
          Export CSV
        </a>
        <span style={{ fontSize: 12, color: '#9CA3AF', marginLeft: 'auto' }}>{total} result{total !== 1 ? 's' : ''}</span>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Email</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Hub</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Status</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Subscribed</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>Loading...</td></tr>
            ) : subscribers.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>No subscribers found.</td></tr>
            ) : subscribers.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '10px 16px', color: '#374151' }}>{s.email}</td>
                <td style={{ padding: '10px 16px' }}><HubBadge hub={s.hub} /></td>
                <td style={{ padding: '10px 16px' }}><StatusBadge status={s.status} /></td>
                <td style={{ padding: '10px 16px', color: '#9CA3AF', fontSize: 12 }}>
                  {new Date(s.subscribed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1, fontSize: 12 }}>
            Previous
          </button>
          <span style={{ padding: '6px 12px', fontSize: 12, color: '#6B7280' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', cursor: page === totalPages ? 'default' : 'pointer', opacity: page === totalPages ? 0.4 : 1, fontSize: 12 }}>
            Next
          </button>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Compose
// ─────────────────────────────────────────────────────────────────────────

function ComposeTab({ onSent }: { onSent: () => void }) {
  const [templates, setTemplates] = useState<NewsletterTemplate[]>([]);
  const [segments, setSegments]   = useState<SegmentMeta[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  const [subject, setSubject] = useState('');
  const [body,    setBody]    = useState('');
  const [targetHub, setTargetHub] = useState<'training' | 'modeling' | 'all'>('all');
  const [segment, setSegment] = useState<string>('all_active');
  const [scheduledAt, setScheduledAt] = useState('');

  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [testSending, setTestSending] = useState(false);

  // Load templates + segments once
  useEffect(() => {
    fetch('/api/admin/newsletter/templates')
      .then(r => r.json())
      .then((d: { templates: NewsletterTemplate[] }) => setTemplates(d.templates ?? []))
      .catch(() => setTemplates([]));
  }, []);

  // Recipient count refreshes whenever segment OR hub changes
  useEffect(() => {
    const params = new URLSearchParams({ segment, targetHub });
    fetch(`/api/admin/newsletter/segments?${params}`)
      .then(r => r.json())
      .then((d: { count: number; segments: SegmentMeta[] }) => {
        setRecipientCount(d.count ?? 0);
        if (d.segments) setSegments(d.segments);
      })
      .catch(() => setRecipientCount(0));
  }, [segment, targetHub]);

  // When a template is picked, prefill subject + body
  useEffect(() => {
    if (!templateKey) return;
    const tpl = templates.find(t => t.template_key === templateKey);
    if (!tpl) return;
    setSubject(tpl.subject_template);
    setBody(tpl.body_html);
    setTemplateVars({});
  }, [templateKey, templates]);

  async function handleEnhance() {
    if (!body.trim()) return;
    setEnhancing(true);
    try {
      const res = await fetch('/api/admin/newsletter/enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: body }),
      });
      const data = await res.json();
      if (data.enhanced) setBody(data.enhanced);
      else alert(data.error ?? 'Enhancement failed');
    } catch {
      alert('AI enhancement failed');
    } finally {
      setEnhancing(false);
    }
  }

  async function handleTestSend() {
    setTestSending(true);
    try {
      const res = await fetch('/api/admin/newsletter/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject, body,
          hub: targetHub === 'all' ? 'training' : targetHub,
        }),
      });
      const data = await res.json();
      if (data.ok) alert(`Test sent to ${data.sentTo}`);
      else alert(data.error ?? 'Test send failed');
    } catch {
      alert('Test send failed');
    } finally {
      setTestSending(false);
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        subject, body, targetHub, segment,
      };
      if (scheduledAt) payload.scheduledAt = new Date(scheduledAt).toISOString();
      const res = await fetch('/api/admin/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) onSent();
      else alert(data.error ?? 'Failed to send');
    } catch {
      alert('Failed to send newsletter');
    } finally {
      setSending(false);
      setConfirmSend(false);
    }
  }

  const selectStyle: React.CSSProperties = { padding: '8px 14px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 13, background: '#fff', color: '#374151' };
  const isScheduled = !!scheduledAt;

  return (
    <div style={{ maxWidth: 800 }}>

      {/* Template picker */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>
          Start from template (optional)
        </label>
        <select value={templateKey} onChange={e => setTemplateKey(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
          <option value="">- Custom (no template) -</option>
          {templates.map(t => (
            <option key={t.template_key} value={t.template_key}>
              {t.name} {t.event_type ? `(${t.event_type})` : ''} {!t.active && '· inactive'}
            </option>
          ))}
        </select>
      </div>

      {/* Subject */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Subject</label>
        <input
          type="text"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Newsletter subject line..."
          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 14, color: '#111827', boxSizing: 'border-box' }}
        />
      </div>

      {/* Body */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Body</label>
          <button
            onClick={handleEnhance}
            disabled={!body.trim() || enhancing}
            style={{
              padding: '4px 12px', borderRadius: 6, border: '1px solid #E5E7EB', background: enhancing ? '#F3F4F6' : '#FFFBF0',
              fontSize: 12, fontWeight: 600, color: enhancing ? '#9CA3AF' : '#92400E', cursor: 'pointer',
            }}
          >
            {enhancing ? 'Enhancing...' : '✨ Enhance with AI'}
          </button>
        </div>
        <RichTextEditor value={body} onChange={setBody} />
        {templateKey && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#9CA3AF' }}>
            Tokens like <code style={{ background: '#F3F4F6', padding: '0 4px', borderRadius: 3 }}>{'{title}'}</code> stay in the source until send time. Edit the template under Templates to change the default.
          </div>
        )}
      </div>

      {/* Targeting */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginBottom: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Hub</label>
          <select value={targetHub} onChange={e => setTargetHub(e.target.value as typeof targetHub)} style={{ ...selectStyle, width: '100%' }}>
            <option value="all">All Subscribers</option>
            <option value="training">Training Hub only</option>
            <option value="modeling">Modeling Hub only</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Segment</label>
          <select value={segment} onChange={e => setSegment(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
            {segments.length === 0 ? (
              <option value="all_active">All active subscribers</option>
            ) : segments.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {segments.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
              {segments.find(s => s.key === segment)?.description ?? ''}
            </div>
          )}
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Schedule (optional)</label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={e => setScheduledAt(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 13, color: '#374151' }}
          />
          <div style={{ marginTop: 4, fontSize: 11, color: '#9CA3AF' }}>
            {scheduledAt ? 'Will send at this time. Leave blank to send immediately.' : 'Sends now when you click Send.'}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 20, fontSize: 12, color: '#6B7280' }}>
        Recipients: <strong style={{ color: '#374151' }}>{recipientCount ?? '...'}</strong> subscriber{recipientCount !== 1 ? 's' : ''}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setPreview(true)} disabled={!body}
          style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
          Preview
        </button>
        <button onClick={handleTestSend} disabled={!subject.trim() || !body.trim() || testSending}
          style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
          {testSending ? 'Sending test...' : 'Send test to my inbox'}
        </button>
        <button
          onClick={() => setConfirmSend(true)}
          disabled={!subject.trim() || !body.trim() || sending}
          style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: isScheduled ? BLUE : GREEN, color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            opacity: !subject.trim() || !body.trim() || sending ? 0.5 : 1,
          }}
        >
          {sending ? 'Working...' : isScheduled ? 'Schedule Send' : 'Send Newsletter'}
        </button>
      </div>

      {preview && (
        <div onClick={() => setPreview(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: 0 }}>Email Preview</h3>
              <button onClick={() => setPreview(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280' }}>✕</button>
            </div>
            <div style={{ padding: '12px 16px', background: '#F9FAFB', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#6B7280' }}>Subject:</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{subject || '(no subject)'}</div>
            </div>
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }} dangerouslySetInnerHTML={{ __html: body }} />
          </div>
        </div>
      )}

      {confirmSend && (
        <div onClick={() => setConfirmSend(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 440, width: '100%', textAlign: 'center' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 12 }}>{isScheduled ? 'Confirm Schedule' : 'Confirm Send'}</h3>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 20 }}>
              {isScheduled
                ? <>Schedule &quot;{subject}&quot; for <strong>{new Date(scheduledAt).toLocaleString()}</strong> to <strong>{recipientCount ?? '...'}</strong> subscriber{recipientCount !== 1 ? 's' : ''}?</>
                : <>Send &quot;{subject}&quot; to <strong>{recipientCount ?? '...'}</strong> subscriber{recipientCount !== 1 ? 's' : ''} now?</>
              }
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmSend(false)} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSend} disabled={sending} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: isScheduled ? BLUE : '#DC2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {sending ? 'Working...' : isScheduled ? 'Schedule' : 'Confirm Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Render templateVars dropdown placeholder reference - keep state alive
          to prevent React from complaining about unused setter; the explicit
          per-token form is intentionally NOT shown for v1 of the rebuild. */}
      <span style={{ display: 'none' }}>{Object.keys(templateVars).length}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState<NewsletterTemplate[]>([]);
  const [variables, setVariables] = useState<Record<string, string[]>>({});
  const [editing, setEditing]     = useState<NewsletterTemplate | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/newsletter/templates');
    const data = await res.json() as { templates: NewsletterTemplate[]; variables: Record<string, string[]> };
    setTemplates(data.templates ?? []);
    setVariables(data.variables ?? {});
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/newsletter/templates/${editing.template_key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:             editing.name,
          subject_template: editing.subject_template,
          body_html:        editing.body_html,
          event_type:       editing.event_type,
          active:           editing.active,
        }),
      });
      const data = await res.json();
      if (!data.template) { alert(data.error ?? 'Save failed'); return; }
      await fetchAll();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 24, color: '#9CA3AF' }}>Loading templates...</div>;

  if (editing) {
    const tokens = editing.event_type ? (variables[editing.event_type] ?? []) : [];
    return (
      <div style={{ maxWidth: 800 }}>
        <button onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', fontSize: 13, color: NAVY, cursor: 'pointer', marginBottom: 16 }}>← Back to template list</button>

        <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 240px' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Name</label>
            <input type="text" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 13 }} />
          </div>
          <div style={{ flex: '0 0 140px' }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Active</label>
            <button onClick={() => setEditing({ ...editing, active: !editing.active })}
              style={{
                padding: '7px 14px', borderRadius: 6, border: '1px solid #E5E7EB',
                background: editing.active ? '#DCFCE7' : '#FEE2E2',
                color: editing.active ? '#166534' : '#991B1B',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%',
              }}>
              {editing.active ? 'ACTIVE' : 'INACTIVE'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Event type (used by auto-notify)</label>
          <input type="text" value={editing.event_type ?? ''} onChange={e => setEditing({ ...editing, event_type: e.target.value || null })}
            placeholder="e.g. article_published"
            style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 13 }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Subject template</label>
          <input type="text" value={editing.subject_template} onChange={e => setEditing({ ...editing, subject_template: e.target.value })}
            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 14 }} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Body</label>
          <RichTextEditor value={editing.body_html} onChange={v => setEditing({ ...editing, body_html: v })} />
        </div>

        {tokens.length > 0 && (
          <div style={{ marginBottom: 18, padding: 12, background: '#F9FAFB', borderRadius: 8, fontSize: 12 }}>
            <div style={{ fontWeight: 600, color: '#374151', marginBottom: 6 }}>Available tokens:</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {tokens.map(t => (
                <code key={t} style={{ background: '#fff', border: '1px solid #E5E7EB', padding: '2px 8px', borderRadius: 4, fontSize: 11, color: NAVY }}>
                  {`{${t}}`}
                </code>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setEditing(null)}
            style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: GREEN, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            {saving ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
        These templates power both manual sends (Compose tab) and auto-notify (Auto Notifications tab). One source of truth for every newsletter email.
      </p>
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Name</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Key</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Event Type</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Active</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#6B7280' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>No templates yet.</td></tr>
            ) : templates.map(t => (
              <tr key={t.template_key} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '10px 16px', color: '#374151', fontWeight: 600 }}>{t.name}</td>
                <td style={{ padding: '10px 16px', color: '#9CA3AF', fontFamily: 'monospace', fontSize: 12 }}>{t.template_key}</td>
                <td style={{ padding: '10px 16px', color: '#6B7280', fontSize: 12 }}>{t.event_type ?? '-'}</td>
                <td style={{ padding: '10px 16px' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: t.active ? '#DCFCE7' : '#FEE2E2', color: t.active ? '#166534' : '#991B1B' }}>
                    {t.active ? 'active' : 'inactive'}
                  </span>
                </td>
                <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                  <button onClick={() => setEditing(t)}
                    style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', fontSize: 12, fontWeight: 600, color: NAVY, cursor: 'pointer' }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Campaigns + analytics
// ─────────────────────────────────────────────────────────────────────────

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/newsletter/campaigns');
    const d = await res.json();
    setCampaigns(d.campaigns ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const statusColor: Record<string, { bg: string; fg: string }> = {
    draft:     { bg: '#F3F4F6', fg: '#6B7280' },
    scheduled: { bg: '#DBEAFE', fg: '#1E40AF' },
    sending:   { bg: '#FEF3C7', fg: '#92400E' },
    sent:      { bg: '#DCFCE7', fg: '#166534' },
    failed:    { bg: '#FEE2E2', fg: '#991B1B' },
    cancelled: { bg: '#F3F4F6', fg: '#9CA3AF' },
  };

  return (
    <>
      <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Subject</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Target</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Status</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Sent</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Failed</th>
              <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>Loading...</td></tr>
            ) : campaigns.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>No campaigns yet.</td></tr>
            ) : campaigns.map(c => {
              const sc = statusColor[c.status] ?? statusColor.draft;
              const dateLabel = c.sent_at
                ? new Date(c.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : c.scheduled_at
                  ? `Scheduled ${new Date(c.scheduled_at).toLocaleString()}`
                  : new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return (
                <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 16px', color: '#374151', fontWeight: 600, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.campaign_type === 'auto' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#EDE9FE', color: '#7C3AED', marginRight: 6, verticalAlign: 'middle' }}>AUTO</span>}
                    {c.subject}
                  </td>
                  <td style={{ padding: '10px 16px' }}><HubBadge hub={c.target_hub} /></td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: sc.bg, color: sc.fg }}>{c.status}</span>
                  </td>
                  <td style={{ padding: '10px 16px', color: GREEN, fontWeight: 600 }}>{c.sent_count}</td>
                  <td style={{ padding: '10px 16px', color: c.failed_count > 0 ? '#DC2626' : '#9CA3AF' }}>{c.failed_count}</td>
                  <td style={{ padding: '10px 16px', color: '#9CA3AF', fontSize: 12 }}>{dateLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && <CampaignAnalyticsModal id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />}
    </>
  );
}

function CampaignAnalyticsModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData]   = useState<CampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/newsletter/campaigns/${id}`);
    const d = await res.json() as CampaignAnalytics;
    setData(d);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function retry() {
    if (!confirm('Retry sending to every failed/bounced recipient?')) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/newsletter/campaigns/${id}/retry`, { method: 'POST' });
      const r = await res.json();
      if (r.ok) { await load(); onChanged(); }
      else alert(r.error ?? 'Retry failed');
    } finally { setWorking(false); }
  }

  async function cancel() {
    if (!confirm('Cancel this scheduled campaign?')) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/newsletter/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const r = await res.json();
      if (r.ok) { await load(); onChanged(); }
      else alert(r.error ?? 'Cancel failed');
    } finally { setWorking(false); }
  }

  async function remove() {
    if (!confirm('Delete this campaign and all per-recipient log rows? This cannot be undone.')) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/newsletter/campaigns/${id}`, { method: 'DELETE' });
      const r = await res.json();
      if (r.ok) { onClose(); onChanged(); }
      else alert(r.error ?? 'Delete failed');
    } finally { setWorking(false); }
  }

  function exportCsv() {
    if (!data) return;
    const header = ['email', 'status', 'sent_at', 'opened_at', 'clicked_at', 'error_message'];
    const rows = data.recipients.map(r => [
      r.email,
      r.status,
      r.sent_at ?? '',
      r.opened_at ?? '',
      r.clicked_at ?? '',
      (r.error_message ?? '').replace(/"/g, '""'),
    ]);
    const csv = [header, ...rows].map(row => row.map(v => `"${String(v)}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `campaign-${id}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 920, width: '100%', maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: NAVY, margin: 0 }}>Campaign Details</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}>✕</button>
        </div>

        {loading || !data ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#9CA3AF' }}>Loading analytics...</div>
        ) : (
          <>
            <div style={{ padding: '12px 16px', background: '#F9FAFB', borderRadius: 8, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 }}>{data.campaign.subject}</div>
              <div style={{ fontSize: 12, color: '#6B7280', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>Target: <HubBadge hub={data.campaign.target_hub} /></span>
                <span>Segment: <code style={{ background: '#fff', padding: '0 5px', borderRadius: 3 }}>{data.campaign.segment ?? 'all_active'}</code></span>
                <span>Status: <strong>{data.campaign.status}</strong></span>
                {data.campaign.scheduled_at && <span>Scheduled: {new Date(data.campaign.scheduled_at).toLocaleString()}</span>}
                <span>By: {data.campaign.created_by}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', marginBottom: 16 }}>
              <StatCard label="Sent"       value={data.totals.sent}       color={GREEN} />
              <StatCard label="Opened"     value={data.totals.opened}     color="#1E40AF" />
              <StatCard label="Clicked"    value={data.totals.clicked}    color="#7C3AED" />
              <StatCard label="Failed"     value={data.totals.failed}     color="#DC2626" />
              <StatCard label="Bounced"    value={data.totals.bounced}    color="#B45309" />
              <StatCard label="Complained" value={data.totals.complained} color="#991B1B" />
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 18, fontSize: 13 }}>
              <span><strong style={{ color: '#1E40AF' }}>{data.openRate}%</strong> open rate</span>
              <span><strong style={{ color: '#7C3AED' }}>{data.clickRate}%</strong> click rate</span>
              <span style={{ color: '#9CA3AF' }}>{data.totals.total} total recipient{data.totals.total !== 1 ? 's' : ''}</span>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              {data.totals.failed + data.totals.bounced > 0 && (
                <button onClick={retry} disabled={working}
                  style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: '#DC2626', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {working ? 'Retrying...' : `Retry ${data.totals.failed + data.totals.bounced} Failed`}
                </button>
              )}
              {data.campaign.status === 'scheduled' && (
                <button onClick={cancel} disabled={working}
                  style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel scheduled send
                </button>
              )}
              <button onClick={exportCsv}
                style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', color: NAVY, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Export recipients (CSV)
              </button>
              <button onClick={remove} disabled={working}
                style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid #FECACA', background: '#fff', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginLeft: 'auto' }}>
                Delete campaign
              </button>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'auto', maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Email</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Status</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Sent</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Opened</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Clicked</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#6B7280' }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recipients.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 16, textAlign: 'center', color: '#9CA3AF' }}>No recipient log rows yet.</td></tr>
                  ) : data.recipients.map(r => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '8px 12px', color: '#374151' }}>{r.email}</td>
                      <td style={{ padding: '8px 12px' }}><RecipientStatusBadge status={r.status} /></td>
                      <td style={{ padding: '8px 12px', color: '#9CA3AF' }}>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '-'}</td>
                      <td style={{ padding: '8px 12px', color: '#9CA3AF' }}>{r.opened_at ? new Date(r.opened_at).toLocaleString() : '-'}</td>
                      <td style={{ padding: '8px 12px', color: '#9CA3AF' }}>{r.clicked_at ? new Date(r.clicked_at).toLocaleString() : '-'}</td>
                      <td style={{ padding: '8px 12px', color: '#DC2626', fontSize: 11 }}>{r.error_message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Auto Notifications
// ─────────────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, { label: string; desc: string }> = {
  article_published:       { label: 'Article Published',       desc: 'Sends when a new article is published' },
  live_session_scheduled:  { label: 'Live Session Scheduled',  desc: 'Sends when a live session is published' },
  live_session_recording:  { label: 'Recording Available',     desc: 'Sends when a session becomes recorded' },
  new_course_session:      { label: 'New Course Session',      desc: 'Sends when a new course session is added' },
  platform_launch:         { label: 'Platform Launch',         desc: 'Sends when a new platform launches' },
  new_modeling_module:     { label: 'New Modeling Module',     desc: 'Sends when a new module is added' },
};

interface AutoSetting { id: string; event_type: string; enabled: boolean; target_hub: string }

function AutoNotificationsTab() {
  const [settings, setSettings] = useState<AutoSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/newsletter/auto-settings')
      .then(r => r.json())
      .then(d => { setSettings(d.settings ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function toggle(eventType: string, enabled: boolean) {
    setToggling(eventType);
    try {
      await fetch('/api/admin/newsletter/auto-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: eventType, enabled }),
      });
      setSettings(prev => prev.map(s => s.event_type === eventType ? { ...s, enabled } : s));
    } catch { /* ignore */ }
    setToggling(null);
  }

  if (loading) return <div style={{ padding: 24, color: '#9CA3AF' }}>Loading...</div>;

  return (
    <div>
      <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 20 }}>
        When enabled, newsletter emails are sent automatically to subscribers when content is published. Each event can only trigger one email per content item (no duplicates).
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {settings.map(s => {
          const meta = EVENT_LABELS[s.event_type] ?? { label: s.event_type, desc: '' };
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB' }}>
              <button
                onClick={() => toggle(s.event_type, !s.enabled)}
                disabled={toggling === s.event_type}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
                  background: s.enabled ? GREEN : '#D1D5DB', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3,
                  left: s.enabled ? 23 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{meta.label}</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>{meta.desc}</div>
              </div>
              <HubBadge hub={s.target_hub} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

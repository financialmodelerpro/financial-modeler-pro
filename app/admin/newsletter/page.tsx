'use client';

import { useState, useEffect, useCallback } from 'react';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { RichTextEditor } from '@/src/components/admin/RichTextEditor';

const NAVY = '#0D2E5A';

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
  status: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
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

// ── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: '16px 20px', flex: '1 1 140px', minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#9CA3AF', marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── Hub Badge ────────────────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════════
export default function AdminNewsletterPage() {
  const [tab, setTab] = useState<'subscribers' | 'compose' | 'campaigns' | 'auto'>('subscribers');

  const tabLabels: Record<string, string> = { subscribers: 'Subscribers', compose: 'Compose', campaigns: 'Campaigns', auto: 'Auto Notifications' };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F9FAFB' }}>
      <CmsAdminNav />
      <div style={{ flex: 1, padding: '32px 40px', maxWidth: 1100 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY, marginBottom: 24 }}>Newsletter</h1>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #E5E7EB', paddingBottom: 0 }}>
          {(['subscribers', 'compose', 'campaigns', 'auto'] as const).map(t => (
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
        {tab === 'compose' && <ComposeTab onSent={() => setTab('campaigns')} />}
        {tab === 'campaigns' && <CampaignsTab />}
        {tab === 'auto' && <AutoNotificationsTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1: SUBSCRIBERS
// ═══════════════════════════════════════════════════════════════════════════════
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
      {/* Stats */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <StatCard label="Total Active" value={stats.totalActive} color="#2EAA4A" />
        <StatCard label="Training Hub" value={stats.trainingActive} color="#166534" />
        <StatCard label="Modeling Hub" value={stats.modelingActive} color="#1E40AF" />
        <StatCard label="Unsubscribed" value={stats.unsubscribed} color="#9CA3AF" />
      </div>

      {/* Filters */}
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

      {/* Table */}
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

      {/* Pagination */}
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

// ── Announcement types ──────────────────────────────────────────────────────
const ANNOUNCE_TYPES = [
  { value: 'custom',               label: 'Custom Announcement' },
  { value: 'live_session',         label: 'Live Session Announcement' },
  { value: 'live_recording',       label: 'Recording Available' },
  { value: 'article',              label: 'New Article Published' },
  { value: 'platform_update',      label: 'Platform Update' },
  { value: 'certification_update', label: 'Certification Milestone' },
] as const;

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

interface ContentItem { id: string; label: string; data: Record<string, unknown> }

function generateContent(type: string, item: ContentItem): { subject: string; body: string; hub: string } {
  const d = item.data;
  if (type === 'live_session') {
    const title = (d.title as string) || '';
    const desc = (d.description as string) || '';
    const dt = d.scheduled_datetime ? new Date(d.scheduled_datetime as string) : null;
    const date = dt ? dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
    const time = dt ? dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '';
    const tz = (d.timezone as string) || '';
    const platform = (d.platform as string) || 'YouTube';
    const url = (d.live_url as string) || '';
    return {
      subject: `Live Session: ${title}`,
      hub: 'training',
      body: `<h2>${title}</h2>${desc ? `<p>${desc}</p>` : ''}<p><strong>Date:</strong> ${date}</p><p><strong>Time:</strong> ${time}${tz ? ` (${tz})` : ''}</p><p><strong>Platform:</strong> ${platform}</p>${url ? `<p><a href="${url}" style="color:#1B4F8A;font-weight:600;">Join Session &rarr;</a></p>` : ''}`,
    };
  }
  if (type === 'live_recording') {
    const title = (d.title as string) || '';
    const desc = (d.description as string) || '';
    const url = (d.recording_url as string) || '';
    return {
      subject: `Recording Available: ${title}`,
      hub: 'training',
      body: `<h2>Recording Now Available</h2><p>The recording for <strong>${title}</strong> is now available.</p>${desc ? `<p>${desc}</p>` : ''}${url ? `<p><a href="${url}" style="color:#1B4F8A;font-weight:600;">Watch Recording &rarr;</a></p>` : ''}`,
    };
  }
  if (type === 'article') {
    const title = (d.title as string) || '';
    const excerpt = (d.excerpt as string) || '';
    const slug = (d.slug as string) || '';
    return {
      subject: `New Article: ${title}`,
      hub: 'all',
      body: `<h2>${title}</h2>${excerpt ? `<p>${excerpt}</p>` : ''}<p><a href="${MAIN_URL}/articles/${slug}" style="color:#1B4F8A;font-weight:600;">Read Full Article &rarr;</a></p>`,
    };
  }
  if (type === 'certification_update') {
    const students = (d.totalStudents as number) ?? 0;
    const certified = (d.totalCertified as number) ?? 0;
    return {
      subject: 'Certification Program Milestone',
      hub: 'training',
      body: `<h2>Certification Program Update</h2><p>Our free certification program continues to grow:</p><ul><li><strong>${students.toLocaleString()}</strong> students enrolled</li><li><strong>${certified.toLocaleString()}</strong> certifications issued</li></ul><p>Start your free certification today at <a href="${LEARN_URL}" style="color:#1B4F8A;font-weight:600;">learn.financialmodelerpro.com</a></p>`,
    };
  }
  return { subject: '', body: '', hub: 'all' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: COMPOSE
// ═══════════════════════════════════════════════════════════════════════════════
function ComposeTab({ onSent }: { onSent: () => void }) {
  const [announceType, setAnnounceType] = useState('custom');
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [targetHub, setTargetHub] = useState('all');
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  // Fetch content items when type changes
  useEffect(() => {
    if (announceType === 'custom' || announceType === 'platform_update') {
      setContentItems([]);
      setSelectedItemId('');
      return;
    }
    fetch(`/api/admin/newsletter/content-items?type=${announceType}`)
      .then(r => r.json())
      .then(d => setContentItems(d.items ?? []))
      .catch(() => setContentItems([]));
  }, [announceType]);

  // Auto-populate on item selection
  useEffect(() => {
    if (!selectedItemId || announceType === 'custom' || announceType === 'platform_update') return;
    const item = contentItems.find(i => i.id === selectedItemId);
    if (!item) return;
    const gen = generateContent(announceType, item);
    setSubject(gen.subject);
    setBody(gen.body);
    setTargetHub(gen.hub);
  }, [selectedItemId, announceType, contentItems]);

  // Fetch subscriber count
  useEffect(() => {
    fetch(`/api/admin/newsletter/subscribers?hub=${targetHub}&status=active&limit=1`)
      .then(r => r.json())
      .then(d => {
        if (targetHub === 'all') setRecipientCount(d.stats?.totalActive ?? 0);
        else if (targetHub === 'training') setRecipientCount(d.stats?.trainingActive ?? 0);
        else setRecipientCount(d.stats?.modelingActive ?? 0);
      })
      .catch(() => {});
  }, [targetHub]);

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

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch('/api/admin/newsletter/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, targetHub }),
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
  const needsItemSelect = announceType !== 'custom' && announceType !== 'platform_update';

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Announcement type */}
      <div style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Type:</label>
        <select value={announceType} onChange={e => { setAnnounceType(e.target.value); setSelectedItemId(''); setSubject(''); setBody(''); }} style={selectStyle}>
          {ANNOUNCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {/* Content item selector */}
      {needsItemSelect && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6B7280', marginBottom: 6 }}>Select content:</label>
          <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
            <option value="">- Choose -</option>
            {contentItems.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </div>
      )}

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
      </div>

      {/* Target hub */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: '#6B7280' }}>Send to:</label>
        <select value={targetHub} onChange={e => setTargetHub(e.target.value)} style={selectStyle}>
          <option value="all">All Subscribers</option>
          <option value="training">Training Hub</option>
          <option value="modeling">Modeling Hub</option>
        </select>
        <span style={{ fontSize: 12, color: '#9CA3AF' }}>
          This will be sent to <strong style={{ color: '#374151' }}>{recipientCount ?? '...'}</strong> subscriber{recipientCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => setPreview(true)} disabled={!body}
          style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
          Preview
        </button>
        <button
          onClick={() => setConfirmSend(true)}
          disabled={!subject.trim() || !body.trim() || sending}
          style={{
            padding: '10px 20px', borderRadius: 8, border: 'none', background: '#2EAA4A', color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !subject.trim() || !body.trim() || sending ? 0.5 : 1,
          }}
        >
          {sending ? 'Sending...' : 'Send Newsletter'}
        </button>
      </div>

      {/* Preview modal */}
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

      {/* Confirm send dialog */}
      {confirmSend && (
        <div onClick={() => setConfirmSend(false)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 28, maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Confirm Send</h3>
            <p style={{ fontSize: 14, color: '#6B7280', marginBottom: 20 }}>
              Send &quot;{subject}&quot; to <strong>{recipientCount ?? '...'}</strong> subscriber{recipientCount !== 1 ? 's' : ''}?
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <button onClick={() => setConfirmSend(false)} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', fontSize: 13, fontWeight: 600, color: '#374151', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSend} disabled={sending} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#DC2626', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {sending ? 'Sending...' : 'Confirm Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════════
function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewCampaign, setViewCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    fetch('/api/admin/newsletter/campaigns')
      .then(r => r.json())
      .then(d => { setCampaigns(d.campaigns ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const statusColor: Record<string, { bg: string; fg: string }> = {
    draft: { bg: '#F3F4F6', fg: '#6B7280' },
    sending: { bg: '#FEF3C7', fg: '#92400E' },
    sent: { bg: '#DCFCE7', fg: '#166534' },
    failed: { bg: '#FEE2E2', fg: '#991B1B' },
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
              return (
                <tr key={c.id} onClick={() => setViewCampaign(c)} style={{ borderBottom: '1px solid #F3F4F6', cursor: 'pointer' }}>
                  <td style={{ padding: '10px 16px', color: '#374151', fontWeight: 600, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.campaign_type === 'auto' && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 6, background: '#EDE9FE', color: '#7C3AED', marginRight: 6, verticalAlign: 'middle' }}>AUTO</span>}
                    {c.subject}
                  </td>
                  <td style={{ padding: '10px 16px' }}><HubBadge hub={c.target_hub} /></td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: sc.bg, color: sc.fg }}>{c.status}</span>
                  </td>
                  <td style={{ padding: '10px 16px', color: '#2EAA4A', fontWeight: 600 }}>{c.sent_count}</td>
                  <td style={{ padding: '10px 16px', color: c.failed_count > 0 ? '#DC2626' : '#9CA3AF' }}>{c.failed_count}</td>
                  <td style={{ padding: '10px 16px', color: '#9CA3AF', fontSize: 12 }}>
                    {c.sent_at ? new Date(c.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Campaign detail modal */}
      {viewCampaign && (
        <div onClick={() => setViewCampaign(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 24, maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: 0 }}>Campaign Details</h3>
              <button onClick={() => setViewCampaign(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280' }}>✕</button>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16, fontSize: 12, color: '#6B7280' }}>
              <span>Target: <HubBadge hub={viewCampaign.target_hub} /></span>
              <span>Sent: <strong style={{ color: '#2EAA4A' }}>{viewCampaign.sent_count}</strong></span>
              <span>Failed: <strong style={{ color: '#DC2626' }}>{viewCampaign.failed_count}</strong></span>
              <span>By: {viewCampaign.created_by}</span>
            </div>
            <div style={{ padding: '12px 16px', background: '#F9FAFB', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{viewCampaign.subject}</div>
            </div>
            <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }} dangerouslySetInnerHTML={{ __html: viewCampaign.body }} />
          </div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: AUTO NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════
const EVENT_LABELS: Record<string, { label: string; desc: string }> = {
  article_published:       { label: 'Article Published',       desc: 'Sends when a new article is published' },
  live_session_scheduled:  { label: 'Live Session Scheduled',  desc: 'Sends when a live session is published' },
  live_session_recording:  { label: 'Recording Available',     desc: 'Sends when a session becomes recorded' },
  new_course_session:      { label: 'New Course Session',      desc: 'Sends when a new course session is added' },
  platform_launch:         { label: 'Platform Launch',         desc: 'Sends when a new platform launches' },
  new_modeling_module:     { label: 'New Modeling Module',      desc: 'Sends when a new module is added' },
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
              {/* Toggle */}
              <button
                onClick={() => toggle(s.event_type, !s.enabled)}
                disabled={toggling === s.event_type}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer', position: 'relative', flexShrink: 0,
                  background: s.enabled ? '#2EAA4A' : '#D1D5DB', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3,
                  left: s.enabled ? 23 : 3, transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
              {/* Info */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{meta.label}</div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>{meta.desc}</div>
              </div>
              {/* Hub badge */}
              <HubBadge hub={s.target_hub} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

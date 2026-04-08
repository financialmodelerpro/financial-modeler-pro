'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

/* ── Types ─────────────────────────────────────────────────────── */

interface Playlist {
  id: string;
  name: string;
  session_count?: number;
}

interface LiveSession {
  id: string;
  title: string;
  description?: string;
  category?: string;
  playlist_id?: string;
  playlist_name?: string;
  type: 'UPCOMING' | 'LIVE' | 'RECORDED';
  date?: string;
  time?: string;
  timezone?: string;
  live_url?: string;
  youtube_url?: string;
  published: boolean;
  announcement_sent?: boolean;
  announcement_count?: number;
  announcement_date?: string;
  reminder_sent?: boolean;
  reminder_count?: number;
  reminder_date?: string;
  created_at?: string;
}

interface Attachment {
  id: string;
  file_name: string;
  file_url: string;
  created_at?: string;
}

/* ── Constants ─────────────────────────────────────────────────── */

const NAVY = '#0D2E5A';
const BLUE = '#1B4F8A';
const GREEN = '#2EAA4A';
const BORDER = '#E5E7EB';
const LIGHT_BG = '#F5F7FA';

const TIMEZONES = [
  { value: 'Asia/Riyadh', label: 'Asia/Riyadh (AST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
];

const TYPE_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  LIVE:      { bg: '#FEE2E2', color: '#DC2626', label: 'Live' },
  UPCOMING:  { bg: '#DBEAFE', color: '#1D4ED8', label: 'Upcoming' },
  RECORDED:  { bg: '#F3F4F6', color: '#6B7280', label: 'Recorded' },
};

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: '#374151',
  display: 'block', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB',
  borderRadius: 6, background: '#F9FAFB', width: '100%',
  boxSizing: 'border-box', fontFamily: 'Inter, sans-serif',
};

const btnPrimary: React.CSSProperties = {
  background: GREEN, color: '#fff', border: 'none', borderRadius: 6,
  padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
};

const btnSecondary: React.CSSProperties = {
  background: '#fff', color: NAVY, border: `1px solid ${BORDER}`,
  borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
};

const btnDanger: React.CSSProperties = {
  background: '#fff', color: '#DC2626', border: '1px solid #FCA5A5',
  borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
};

const cardStyle: React.CSSProperties = {
  background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10,
  padding: 20, marginBottom: 16,
};

/* ── Toast ─────────────────────────────────────────────────────── */

function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'ok' | 'err' } | null>(null);
  const show = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);
  const el = toast ? (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      padding: '12px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
      color: '#fff', fontFamily: 'Inter, sans-serif',
      background: toast.type === 'ok' ? GREEN : '#DC2626',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    }}>
      {toast.msg}
    </div>
  ) : null;
  return { show, el };
}

/* ── Component ─────────────────────────────────────────────────── */

export default function LiveSessionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { show: toast, el: toastEl } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Data state ── */
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── UI state ── */
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [editPlaylistName, setEditPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  /* ── Editor state ── */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editSession, setEditSession] = useState<LiveSession | null>(null);
  const [form, setForm] = useState({
    title: '', description: '', category: '', playlist_id: '',
    type: 'UPCOMING' as 'UPCOMING' | 'LIVE' | 'RECORDED',
    date: '', time: '', timezone: 'Asia/Riyadh',
    live_url: '', youtube_url: '', published: false,
  });
  const [saving, setSaving] = useState(false);

  /* ── Attachments ── */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  /* ── Confirm dialog ── */
  const [confirm, setConfirm] = useState<{ msg: string; onOk: () => void } | null>(null);

  /* ── Auth guard ── */
  useEffect(() => {
    if (status === 'unauthenticated') { router.replace('/login'); return; }
    if (status === 'authenticated' && (session?.user as { role?: string })?.role !== 'admin') router.replace('/');
  }, [status, session, router]);

  /* ── Fetch data ── */
  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/live-sessions');
      if (res.ok) { const j = await res.json(); setSessions(j.sessions ?? []); }
    } catch { /* ignore */ }
  }, []);

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/live-playlists');
      if (res.ok) { const j = await res.json(); setPlaylists(j.playlists ?? []); }
    } catch { /* ignore */ }
  }, []);

  const fetchAttachments = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/admin/attachments?tabKey=LIVE_${sessionId}`);
      if (res.ok) { const j = await res.json(); setAttachments(j.attachments ?? j ?? []); }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchSessions(), fetchPlaylists()]);
      setLoading(false);
    })();
  }, [fetchSessions, fetchPlaylists]);

  /* ── Playlist CRUD ── */
  const createPlaylist = async () => {
    if (!newPlaylistName.trim()) return;
    setCreatingPlaylist(true);
    try {
      const res = await fetch('/api/admin/live-playlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPlaylistName.trim() }),
      });
      if (res.ok) {
        toast('Playlist created');
        setNewPlaylistName(''); setShowNewPlaylist(false);
        await fetchPlaylists();
      } else toast('Failed to create playlist', 'err');
    } catch { toast('Error creating playlist', 'err'); }
    setCreatingPlaylist(false);
  };

  const updatePlaylist = async (pl: Playlist, name: string) => {
    try {
      const res = await fetch('/api/admin/live-playlists', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pl.id, name }),
      });
      if (res.ok) { toast('Playlist updated'); await fetchPlaylists(); setEditingPlaylist(null); }
      else toast('Failed to update playlist', 'err');
    } catch { toast('Error updating playlist', 'err'); }
  };

  const deletePlaylist = async (pl: Playlist) => {
    setConfirm({
      msg: `Delete playlist "${pl.name}"? Sessions in it won't be deleted.`,
      onOk: async () => {
        setConfirm(null);
        try {
          const res = await fetch('/api/admin/live-playlists', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: pl.id }),
          });
          if (res.ok) {
            toast('Playlist deleted');
            if (selectedPlaylist === pl.id) setSelectedPlaylist(null);
            await fetchPlaylists(); await fetchSessions();
          } else toast('Failed to delete playlist', 'err');
        } catch { toast('Error deleting playlist', 'err'); }
      },
    });
  };

  /* ── Session CRUD ── */
  const openNewSession = () => {
    setEditSession(null);
    setForm({
      title: '', description: '', category: '', playlist_id: selectedPlaylist ?? '',
      type: 'UPCOMING', date: '', time: '', timezone: 'Asia/Riyadh',
      live_url: '', youtube_url: '', published: false,
    });
    setAttachments([]);
    setEditorOpen(true);
  };

  const openEditSession = async (s: LiveSession) => {
    setEditSession(s);
    setForm({
      title: s.title, description: s.description ?? '', category: s.category ?? '',
      playlist_id: s.playlist_id ?? '', type: s.type,
      date: s.date ?? '', time: s.time ?? '', timezone: s.timezone ?? 'Asia/Riyadh',
      live_url: s.live_url ?? '', youtube_url: s.youtube_url ?? '',
      published: s.published,
    });
    setEditorOpen(true);
    await fetchAttachments(s.id);
  };

  const saveSession = async () => {
    if (!form.title.trim()) { toast('Title is required', 'err'); return; }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (form.type === 'RECORDED') { delete payload.date; delete payload.time; delete payload.timezone; delete payload.live_url; }
      else { delete payload.youtube_url; }

      let res: Response;
      if (editSession) {
        res = await fetch(`/api/admin/live-sessions/${editSession.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch('/api/admin/live-sessions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (res.ok) {
        const j = await res.json();
        toast(editSession ? 'Session updated' : 'Session created');
        await fetchSessions();
        if (!editSession && j.session?.id) {
          setEditSession(j.session);
        }
      } else {
        const j = await res.json().catch(() => ({}));
        toast(j.error ?? 'Failed to save session', 'err');
      }
    } catch { toast('Error saving session', 'err'); }
    setSaving(false);
  };

  const deleteSession = (s: LiveSession) => {
    setConfirm({
      msg: `Delete session "${s.title}"? This cannot be undone.`,
      onOk: async () => {
        setConfirm(null);
        try {
          const res = await fetch(`/api/admin/live-sessions/${s.id}`, { method: 'DELETE' });
          if (res.ok) {
            toast('Session deleted');
            if (editSession?.id === s.id) { setEditorOpen(false); setEditSession(null); }
            await fetchSessions();
          } else toast('Failed to delete session', 'err');
        } catch { toast('Error deleting session', 'err'); }
      },
    });
  };

  /* ── Notifications ── */
  const sendNotify = (s: LiveSession, type: 'announcement' | 'reminder') => {
    const label = type === 'announcement' ? 'Announcement' : 'Reminder';
    setConfirm({
      msg: `Send ${label} for "${s.title}" to all enrolled students?`,
      onOk: async () => {
        setConfirm(null);
        try {
          const res = await fetch(`/api/admin/live-sessions/${s.id}/notify`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
          });
          if (res.ok) { toast(`${label} sent`); await fetchSessions(); }
          else { const j = await res.json().catch(() => ({})); toast(j.error ?? `Failed to send ${label}`, 'err'); }
        } catch { toast(`Error sending ${label}`, 'err'); }
      },
    });
  };

  /* ── Attachments ── */
  const uploadAttachment = async (file: File) => {
    if (!editSession) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('tabKey', `LIVE_${editSession.id}`);
      fd.append('course', 'live');
      const res = await fetch('/api/admin/attachments', { method: 'POST', body: fd });
      if (res.ok) { toast('File uploaded'); await fetchAttachments(editSession.id); }
      else toast('Upload failed', 'err');
    } catch { toast('Upload error', 'err'); }
    setUploading(false);
  };

  const deleteAttachment = (att: Attachment) => {
    setConfirm({
      msg: `Delete attachment "${att.file_name}"?`,
      onOk: async () => {
        setConfirm(null);
        try {
          const res = await fetch('/api/admin/attachments', {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: att.id }),
          });
          if (res.ok) { toast('Attachment deleted'); if (editSession) await fetchAttachments(editSession.id); }
          else toast('Failed to delete attachment', 'err');
        } catch { toast('Error', 'err'); }
      },
    });
  };

  /* ── Filtered sessions ── */
  const filtered = selectedPlaylist
    ? sessions.filter(s => s.playlist_id === selectedPlaylist)
    : sessions;

  /* ── Render guards ── */
  if (status === 'loading' || loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
        <CmsAdminNav />
        <main style={{ flex: 1, padding: 32, background: LIGHT_BG }}>
          <p style={{ color: '#6B7280', fontSize: 14 }}>Loading...</p>
        </main>
      </div>
    );
  }

  /* ── Render ── */
  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <CmsAdminNav />
      <main style={{ flex: 1, padding: 32, background: LIGHT_BG, overflowY: 'auto' }}>
        {toastEl}

        {/* ── Confirm Dialog ── */}
        {confirm && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ background: '#fff', borderRadius: 10, padding: 28, maxWidth: 420, width: '90%', boxShadow: '0 8px 30px rgba(0,0,0,0.18)' }}>
              <p style={{ fontSize: 14, color: '#1F2937', marginBottom: 20, lineHeight: 1.5 }}>{confirm.msg}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button style={btnSecondary} onClick={() => setConfirm(null)}>Cancel</button>
                <button style={{ ...btnPrimary, background: '#DC2626' }} onClick={confirm.onOk}>Confirm</button>
              </div>
            </div>
          </div>
        )}

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: NAVY, margin: 0 }}>Live Sessions</h1>
          <div style={{ display: 'flex', gap: 10 }}>
            <button style={btnSecondary} onClick={() => { setShowNewPlaylist(v => !v); setEditingPlaylist(null); }}>
              + New Playlist
            </button>
            <button style={btnPrimary} onClick={openNewSession}>+ New Session</button>
          </div>
        </div>

        {/* ── NEW PLAYLIST FORM ── */}
        {showNewPlaylist && (
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12 }}>
            <label style={{ ...labelStyle, marginBottom: 0, whiteSpace: 'nowrap' }}>Playlist Name</label>
            <input
              style={{ ...inputStyle, maxWidth: 300 }}
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              placeholder="e.g. Week 1 Sessions"
              onKeyDown={e => e.key === 'Enter' && createPlaylist()}
            />
            <button style={btnPrimary} onClick={createPlaylist} disabled={creatingPlaylist}>
              {creatingPlaylist ? 'Creating...' : 'Create'}
            </button>
            <button style={btnSecondary} onClick={() => setShowNewPlaylist(false)}>Cancel</button>
          </div>
        )}

        {/* ── PLAYLISTS ROW ── */}
        <div style={{ ...cardStyle, padding: 12 }}>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {/* All tab */}
            <button
              onClick={() => setSelectedPlaylist(null)}
              style={{
                ...btnSecondary,
                background: selectedPlaylist === null ? NAVY : '#fff',
                color: selectedPlaylist === null ? '#fff' : NAVY,
                whiteSpace: 'nowrap', minWidth: 60,
              }}
            >
              All ({sessions.length})
            </button>

            {playlists.map(pl => {
              const active = selectedPlaylist === pl.id;
              const count = sessions.filter(s => s.playlist_id === pl.id).length;

              if (editingPlaylist?.id === pl.id) {
                return (
                  <div key={pl.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      style={{ ...inputStyle, width: 160, fontSize: 12 }}
                      value={editPlaylistName}
                      onChange={e => setEditPlaylistName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && updatePlaylist(pl, editPlaylistName)}
                      autoFocus
                    />
                    <button style={{ ...btnPrimary, padding: '5px 10px', fontSize: 11 }} onClick={() => updatePlaylist(pl, editPlaylistName)}>Save</button>
                    <button style={{ ...btnSecondary, padding: '5px 10px', fontSize: 11 }} onClick={() => setEditingPlaylist(null)}>X</button>
                  </div>
                );
              }

              return (
                <div key={pl.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={() => setSelectedPlaylist(active ? null : pl.id)}
                    style={{
                      ...btnSecondary,
                      background: active ? BLUE : '#fff',
                      color: active ? '#fff' : NAVY,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {pl.name} ({count})
                  </button>
                  <button
                    title="Edit playlist"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2 }}
                    onClick={() => { setEditingPlaylist(pl); setEditPlaylistName(pl.name); }}
                  >✏️</button>
                  <button
                    title="Delete playlist"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 2 }}
                    onClick={() => deletePlaylist(pl)}
                  >🗑️</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── SESSIONS TABLE ── */}
        <div style={cardStyle}>
          {filtered.length === 0 ? (
            <p style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: 24 }}>
              No sessions found. Click "+ New Session" to create one.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                  {['Title', 'Type', 'Date / Time', 'Playlist', 'Published', 'Notifications', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: NAVY, fontWeight: 700, fontSize: 11, textTransform: 'uppercase' as const }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const badge = TYPE_BADGE[s.type] || TYPE_BADGE.RECORDED;
                  return (
                    <tr key={s.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '10px 10px', fontWeight: 600, color: '#1F2937' }}>{s.title}</td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 10px',
                          borderRadius: 20, background: badge.bg, color: badge.color,
                        }}>{badge.label}</span>
                      </td>
                      <td style={{ padding: '10px 10px', color: '#6B7280', fontSize: 12 }}>
                        {s.type !== 'RECORDED' && s.date ? `${s.date} ${s.time ?? ''} ${s.timezone ?? ''}` : '-'}
                      </td>
                      <td style={{ padding: '10px 10px', color: '#6B7280', fontSize: 12 }}>
                        {s.playlist_name ?? '-'}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '3px 10px',
                          borderRadius: 20,
                          background: s.published ? '#D1FAE5' : '#F3F4F6',
                          color: s.published ? '#065F46' : '#9CA3AF',
                        }}>{s.published ? 'Yes' : 'No'}</span>
                      </td>
                      <td style={{ padding: '10px 10px', fontSize: 11, color: '#6B7280' }}>
                        {s.announcement_sent ? `📢 ${s.announcement_count ?? 0} sent` : '—'}
                        {s.reminder_sent ? ` · ⏰ ${s.reminder_count ?? 0} sent` : ''}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => openEditSession(s)}>Edit</button>
                          <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => sendNotify(s, 'announcement')}>Notify</button>
                          <button style={{ ...btnDanger, padding: '4px 10px', fontSize: 11 }} onClick={() => deleteSession(s)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── SESSION EDITOR ── */}
        {editorOpen && (
          <div style={{ ...cardStyle, borderLeft: `4px solid ${BLUE}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: 0 }}>
                {editSession ? `Edit: ${editSession.title}` : 'New Session'}
              </h2>
              <button style={btnSecondary} onClick={() => { setEditorOpen(false); setEditSession(null); }}>Close</button>
            </div>

            {/* ── A. Basic Info ── */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Basic Info</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>Title</label>
                  <input style={inputStyle} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Session title" />
                </div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <input style={inputStyle} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Fundamentals" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Description</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Brief description..."
                  />
                </div>
                <div>
                  <label style={labelStyle}>Playlist</label>
                  <select style={inputStyle} value={form.playlist_id} onChange={e => setForm(f => ({ ...f, playlist_id: e.target.value }))}>
                    <option value="">None</option>
                    {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 18 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Published</label>
                  <button
                    onClick={() => setForm(f => ({ ...f, published: !f.published }))}
                    style={{
                      width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                      background: form.published ? GREEN : '#D1D5DB',
                      position: 'relative', transition: 'background 0.2s',
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 3, left: form.published ? 23 : 3,
                      width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </button>
                </div>
              </div>
            </div>

            {/* ── B. Session Type ── */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Session Type</h3>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                {(['UPCOMING', 'LIVE', 'RECORDED'] as const).map(t => {
                  const b = TYPE_BADGE[t];
                  const active = form.type === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setForm(f => ({ ...f, type: t }))}
                      style={{
                        padding: '7px 18px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer',
                        border: active ? `2px solid ${b.color}` : `1px solid ${BORDER}`,
                        background: active ? b.bg : '#fff',
                        color: active ? b.color : '#6B7280',
                        fontFamily: 'Inter, sans-serif',
                      }}
                    >{b.label}</button>
                  );
                })}
              </div>

              {(form.type === 'UPCOMING' || form.type === 'LIVE') && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Date</label>
                    <input type="date" style={inputStyle} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Time</label>
                    <input type="time" style={inputStyle} value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
                  </div>
                  <div>
                    <label style={labelStyle}>Timezone</label>
                    <select style={inputStyle} value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}>
                      {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Live URL</label>
                    <input style={inputStyle} value={form.live_url} onChange={e => setForm(f => ({ ...f, live_url: e.target.value }))} placeholder="https://zoom.us/..." />
                  </div>
                </div>
              )}

              {form.type === 'RECORDED' && (
                <div style={{ maxWidth: 500 }}>
                  <label style={labelStyle}>YouTube URL</label>
                  <input style={inputStyle} value={form.youtube_url} onChange={e => setForm(f => ({ ...f, youtube_url: e.target.value }))} placeholder="https://youtube.com/watch?v=..." />
                </div>
              )}
            </div>

            {/* ── C. Attachments ── */}
            {editSession && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Attachments</h3>
                <input
                  ref={fileRef}
                  type="file"
                  style={{ display: 'none' }}
                  onChange={e => { if (e.target.files?.[0]) uploadAttachment(e.target.files[0]); e.target.value = ''; }}
                />
                <button style={btnSecondary} onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? 'Uploading...' : '📎 Upload File'}
                </button>
                {attachments.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    {attachments.map(att => (
                      <div key={att.id} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 10px', borderRadius: 6, background: LIGHT_BG, marginBottom: 4,
                      }}>
                        <a href={att.file_url} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontSize: 12, textDecoration: 'none' }}>
                          {att.file_name}
                        </a>
                        <button style={{ ...btnDanger, padding: '2px 8px', fontSize: 11 }} onClick={() => deleteAttachment(att)}>Delete</button>
                      </div>
                    ))}
                  </div>
                )}
                {attachments.length === 0 && (
                  <p style={{ color: '#9CA3AF', fontSize: 12, marginTop: 8 }}>No attachments yet.</p>
                )}
              </div>
            )}

            {/* ── D. Notifications ── */}
            {editSession && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Notifications</h3>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {/* Announcement */}
                  <div style={{ background: LIGHT_BG, borderRadius: 8, padding: '12px 16px', minWidth: 220 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Announcement</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {editSession.announcement_sent
                        ? `Sent to ${editSession.announcement_count ?? 0} students${editSession.announcement_date ? ` on ${editSession.announcement_date}` : ''}`
                        : 'Not sent yet'}
                    </div>
                    <button style={btnPrimary} onClick={() => sendNotify(editSession, 'announcement')}>
                      📢 Send Announcement
                    </button>
                  </div>
                  {/* Reminder */}
                  <div style={{ background: LIGHT_BG, borderRadius: 8, padding: '12px 16px', minWidth: 220 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Reminder</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {editSession.reminder_sent
                        ? `Sent to ${editSession.reminder_count ?? 0} students${editSession.reminder_date ? ` on ${editSession.reminder_date}` : ''}`
                        : 'Not sent yet'}
                    </div>
                    <button style={{ ...btnPrimary, background: BLUE }} onClick={() => sendNotify(editSession, 'reminder')}>
                      ⏰ Send Reminder
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Save bar ── */}
            <div style={{ display: 'flex', gap: 10, paddingTop: 12, borderTop: `1px solid ${BORDER}` }}>
              <button style={btnPrimary} onClick={saveSession} disabled={saving}>
                {saving ? 'Saving...' : editSession ? 'Update Session' : 'Create Session'}
              </button>
              <button style={btnSecondary} onClick={() => { setEditorOpen(false); setEditSession(null); }}>Cancel</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

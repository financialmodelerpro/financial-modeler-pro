'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { LiveSessionAssessmentEditor } from '@/src/components/admin/LiveSessionAssessmentEditor';
import { InstructorPicker } from '@/src/components/admin/InstructorPicker';

/* ── Types ─────────────────────────────────────────────────────── */

interface Playlist {
  id: string;
  name: string;
  is_published: boolean;
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
  banner_url?: string;
  duration_minutes?: number;
  max_attendees?: number;
  difficulty_level?: string;
  prerequisites?: string;
  instructor_id?: string | null;
  instructor_name?: string;
  instructor_title?: string;
  tags?: string[];
  is_featured?: boolean;
  live_password?: string;
  registration_url?: string;
  youtube_embed?: boolean;
  show_like_button?: boolean;
  announcement_send_mode?: string;
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
  { value: 'Pacific/Baker', label: 'UTC-12:00 - Baker Island' },
  { value: 'Pacific/Pago_Pago', label: 'UTC-11:00 - Samoa' },
  { value: 'Pacific/Honolulu', label: 'UTC-10:00 - Hawaii' },
  { value: 'America/Anchorage', label: 'UTC-09:00 - Alaska' },
  { value: 'America/Los_Angeles', label: 'UTC-08:00 - Pacific Time (US)' },
  { value: 'America/Denver', label: 'UTC-07:00 - Mountain Time (US)' },
  { value: 'America/Chicago', label: 'UTC-06:00 - Central Time (US)' },
  { value: 'America/New_York', label: 'UTC-05:00 - Eastern Time (US)' },
  { value: 'America/Halifax', label: 'UTC-04:00 - Atlantic' },
  { value: 'America/Sao_Paulo', label: 'UTC-03:00 - Brazil' },
  { value: 'Atlantic/South_Georgia', label: 'UTC-02:00 - South Georgia' },
  { value: 'Atlantic/Azores', label: 'UTC-01:00 - Azores' },
  { value: 'Europe/London', label: 'UTC+00:00 - London (GMT)' },
  { value: 'Europe/Paris', label: 'UTC+01:00 - Central European' },
  { value: 'Africa/Cairo', label: 'UTC+02:00 - Eastern European' },
  { value: 'Asia/Riyadh', label: 'UTC+03:00 - Arabian Standard' },
  { value: 'Asia/Tehran', label: 'UTC+03:30 - Iran' },
  { value: 'Asia/Dubai', label: 'UTC+04:00 - Gulf' },
  { value: 'Asia/Kabul', label: 'UTC+04:30 - Afghanistan' },
  { value: 'Asia/Karachi', label: 'UTC+05:00 - Pakistan' },
  { value: 'Asia/Kolkata', label: 'UTC+05:30 - India' },
  { value: 'Asia/Kathmandu', label: 'UTC+05:45 - Nepal' },
  { value: 'Asia/Dhaka', label: 'UTC+06:00 - Bangladesh' },
  { value: 'Asia/Yangon', label: 'UTC+06:30 - Myanmar' },
  { value: 'Asia/Bangkok', label: 'UTC+07:00 - Indochina' },
  { value: 'Asia/Singapore', label: 'UTC+08:00 - Singapore' },
  { value: 'Asia/Tokyo', label: 'UTC+09:00 - Japan' },
  { value: 'Australia/Darwin', label: 'UTC+09:30 - Central Australia' },
  { value: 'Australia/Sydney', label: 'UTC+10:00 - Eastern Australia' },
  { value: 'Pacific/Guadalcanal', label: 'UTC+11:00 - Solomon Islands' },
  { value: 'Pacific/Auckland', label: 'UTC+12:00 - New Zealand' },
  { value: 'Pacific/Apia', label: 'UTC+13:00 - Samoa' },
  { value: 'Pacific/Kiritimati', label: 'UTC+14:00 - Line Islands' },
];

const DIFFICULTY_LEVELS = ['All Levels', 'Beginner', 'Intermediate', 'Advanced'];

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

/* ── Toggle Switch ────────────────────────────────────────────── */

function ToggleSwitch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {label && <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>}
      <button
        type="button"
        onClick={() => onChange(!value)}
        style={{
          width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
          background: value ? GREEN : '#D1D5DB',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: value ? 23 : 3,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  );
}

/* ── Tag Input ────────────────────────────────────────────────── */

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter(t => t !== tag));
  };

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: tags.length > 0 ? 8 : 0 }}>
        {tags.map(tag => (
          <span key={tag} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: '#EFF6FF', color: BLUE, fontSize: 11, fontWeight: 600,
            padding: '3px 10px', borderRadius: 20, border: '1px solid #BFDBFE',
          }}>
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: '#6B7280', fontSize: 13, padding: 0, lineHeight: 1,
              }}
            >x</button>
          </span>
        ))}
      </div>
      <input
        style={inputStyle}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); addTag(); }
        }}
        placeholder="Type a tag and press Enter"
      />
    </div>
  );
}

/* ── Form state type ──────────────────────────────────────────── */

interface FormState {
  title: string;
  description: string;
  category: string;
  playlist_id: string;
  type: 'UPCOMING' | 'LIVE' | 'RECORDED';
  date: string;
  time: string;
  timezone: string;
  live_url: string;
  youtube_url: string;
  published: boolean;
  duration_minutes: string;
  max_attendees: string;
  difficulty_level: string;
  prerequisites: string;
  instructor_id: string;
  instructor_name: string;
  instructor_title: string;
  tags: string[];
  is_featured: boolean;
  live_password: string;
  registration_url: string;
  youtube_embed: boolean;
  show_like_button: boolean;
  announcement_send_mode: 'auto' | 'manual';
}

const defaultForm: FormState = {
  title: '', description: '', category: '', playlist_id: '',
  type: 'UPCOMING', date: '', time: '', timezone: 'Asia/Riyadh',
  live_url: '', youtube_url: '', published: false,
  duration_minutes: '', max_attendees: '', difficulty_level: 'All Levels',
  prerequisites: '', instructor_id: '', instructor_name: '', instructor_title: '', tags: [],
  is_featured: false, live_password: '', registration_url: '',
  youtube_embed: false, show_like_button: true, announcement_send_mode: 'auto',
};

/* ── Component ─────────────────────────────────────────────────── */

export default function LiveSessionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { show: toast, el: toastEl } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

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

  /* ── Filter state ── */
  const [filterType, setFilterType] = useState<'ALL' | 'UPCOMING' | 'LIVE' | 'RECORDED'>('ALL');
  const [filterPlaylist, setFilterPlaylist] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PUBLISHED' | 'DRAFT'>('ALL');

  /* ── Editor state ── */
  const [editorOpen, setEditorOpen] = useState(false);
  const [editSession, setEditSession] = useState<LiveSession | null>(null);
  const [form, setForm] = useState<FormState>({ ...defaultForm });
  const [saving, setSaving] = useState(false);
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  /* ── Inline playlist creation in editor ── */
  const [inlinePlaylistOpen, setInlinePlaylistOpen] = useState(false);
  const [inlinePlaylistName, setInlinePlaylistName] = useState('');
  const [creatingInlinePlaylist, setCreatingInlinePlaylist] = useState(false);

  /* ── Notification targeting ── */
  const [notifyTarget, setNotifyTarget] = useState<'all' | '3sfm' | 'bvm'>('all');
  const [previewSent, setPreviewSent] = useState(false);

  /* ── Mark as Recorded ── */
  const [markRecordedOpen, setMarkRecordedOpen] = useState(false);
  const [previewSession, setPreviewSession] = useState<LiveSession | null>(null);
  const [regModal, setRegModal] = useState<{ sessionId: string; title: string } | null>(null);
  const [regList, setRegList] = useState<{ student_reg_id: string; student_name: string; student_email: string; registered_at: string; attended: boolean }[]>([]);
  const [regLoading, setRegLoading] = useState(false);

  async function openRegModal(s: LiveSession) {
    setRegModal({ sessionId: s.id, title: s.title });
    setRegLoading(true);
    try {
      const r = await fetch(`/api/admin/live-sessions/${s.id}/registrations`);
      const d = await r.json();
      setRegList(d.registrations ?? []);
    } catch { setRegList([]); }
    setRegLoading(false);
  }

  async function toggleAttended(regId: string, attended: boolean) {
    if (!regModal) return;
    await fetch(`/api/admin/live-sessions/${regModal.sessionId}/registrations`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regId, attended }),
    });
    setRegList(prev => prev.map(r => r.student_reg_id === regId ? { ...r, attended } : r));
  }

  async function markAllAttended() {
    if (!regModal) return;
    await fetch(`/api/admin/live-sessions/${regModal.sessionId}/registrations`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    });
    setRegList(prev => prev.map(r => ({ ...r, attended: true })));
  }

  function exportRegCsv() {
    const rows = [['Reg ID', 'Name', 'Email', 'Registered At', 'Attended'].join(',')];
    for (const r of regList) rows.push([r.student_reg_id, r.student_name, r.student_email, r.registered_at, r.attended ? 'Yes' : 'No'].join(','));
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `registrations-${regModal?.sessionId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  const [markRecordedUrl, setMarkRecordedUrl] = useState('');
  const [markingRecorded, setMarkingRecorded] = useState(false);

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
      if (res.ok) {
        const j = await res.json();
        // Map DB fields → component fields
        const mapped = (j.sessions ?? []).map((s: Record<string, unknown>) => ({
          ...s,
          type: ((s.session_type as string) ?? 'recorded').toUpperCase(),
          published: s.is_published ?? false,
          date: s.scheduled_datetime ? new Date(s.scheduled_datetime as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined,
          time: s.scheduled_datetime ? new Date(s.scheduled_datetime as string).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : undefined,
          playlist_name: (s.live_playlists as Record<string, unknown> | null)?.name ?? undefined,
          announcement_sent: s.notification_sent,
          announcement_count: s.notification_sent_count,
          announcement_date: s.notification_sent_at,
          reminder_count: s.reminder_sent_count,
          reminder_date: s.reminder_sent_at,
        })) as LiveSession[];
        setSessions(mapped);
      }
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

  const createInlinePlaylist = async () => {
    if (!inlinePlaylistName.trim()) return;
    setCreatingInlinePlaylist(true);
    try {
      const res = await fetch('/api/admin/live-playlists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inlinePlaylistName.trim() }),
      });
      if (res.ok) {
        const j = await res.json();
        toast('Playlist created');
        await fetchPlaylists();
        const newId = j.playlist?.id ?? j.id ?? '';
        if (newId) setForm(f => ({ ...f, playlist_id: newId }));
        setInlinePlaylistName(''); setInlinePlaylistOpen(false);
      } else toast('Failed to create playlist', 'err');
    } catch { toast('Error creating playlist', 'err'); }
    setCreatingInlinePlaylist(false);
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
  const sessionToForm = (s: LiveSession): FormState => {
    // Extract date/time from scheduled_datetime for form inputs
    const raw = (s as unknown as Record<string, unknown>).scheduled_datetime as string | null;
    let dateVal = '';
    let timeVal = '';
    if (raw) {
      const dt = new Date(raw);
      dateVal = dt.toISOString().split('T')[0]; // YYYY-MM-DD for input[type=date]
      timeVal = dt.toTimeString().slice(0, 5);   // HH:MM for input[type=time]
    }
    return {
    title: s.title,
    description: s.description ?? '',
    category: s.category ?? '',
    playlist_id: s.playlist_id ?? '',
    type: s.type,
    date: dateVal,
    time: timeVal,
    timezone: s.timezone ?? 'Asia/Riyadh',
    live_url: s.live_url ?? '',
    youtube_url: s.youtube_url ?? '',
    published: s.published,
    duration_minutes: s.duration_minutes != null ? String(s.duration_minutes) : '',
    max_attendees: s.max_attendees != null ? String(s.max_attendees) : '',
    difficulty_level: s.difficulty_level ?? 'All Levels',
    prerequisites: s.prerequisites ?? '',
    instructor_id: s.instructor_id ?? '',
    instructor_name: s.instructor_name ?? '',
    instructor_title: s.instructor_title ?? '',
    tags: s.tags ?? [],
    is_featured: s.is_featured ?? false,
    live_password: s.live_password ?? '',
    registration_url: s.registration_url ?? '',
    youtube_embed: s.youtube_embed ?? false,
    show_like_button: s.show_like_button ?? true,
    announcement_send_mode: (s.announcement_send_mode === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual',
  };};

  const openNewSession = () => {
    setEditSession(null);
    setForm({ ...defaultForm, playlist_id: selectedPlaylist ?? '' });
    setAttachments([]);
    setBannerPreview(null);
    setPreviewSent(false);
    setNotifyTarget('all');
    setMarkRecordedOpen(false);
    setInlinePlaylistOpen(false);
    setEditorOpen(true);
  };

  const openEditSession = async (s: LiveSession) => {
    setEditSession(s);
    setForm(sessionToForm(s));
    setBannerPreview(s.banner_url ?? null);
    setPreviewSent(false);
    setNotifyTarget('all');
    setMarkRecordedOpen(false);
    setInlinePlaylistOpen(false);
    setEditorOpen(true);
    await fetchAttachments(s.id);
  };

  const duplicateSession = (s: LiveSession) => {
    setEditSession(null);
    const dup = sessionToForm(s);
    dup.title = `${s.title} (Copy)`;
    dup.published = false;
    dup.date = '';
    dup.time = '';
    setForm(dup);
    setAttachments([]);
    setBannerPreview(null);
    setPreviewSent(false);
    setNotifyTarget('all');
    setMarkRecordedOpen(false);
    setInlinePlaylistOpen(false);
    setEditorOpen(true);
    toast('Session duplicated as draft - save to create');
  };

  const saveSession = async () => {
    if (!form.title.trim()) { toast('Title is required', 'err'); return; }
    setSaving(true);
    try {
      // Map form fields → API fields
      const scheduled = form.date && form.time
        ? new Date(`${form.date}T${form.time}`).toISOString()
        : form.date ? new Date(form.date).toISOString() : null;

      const payload: Record<string, unknown> = {
        title:              form.title,
        description:        form.description,
        category:           form.category,
        playlist_id:        form.playlist_id || null,
        session_type:       form.type.toLowerCase(),  // UPCOMING → upcoming
        scheduled_datetime: scheduled,
        timezone:           form.timezone,
        live_url:           form.live_url,
        youtube_url:        form.youtube_url,
        is_published:       form.published,
        duration_minutes:   form.duration_minutes ? parseInt(form.duration_minutes, 10) : null,
        max_attendees:      form.max_attendees ? parseInt(form.max_attendees, 10) : null,
        difficulty_level:   form.difficulty_level,
        prerequisites:      form.prerequisites,
        instructor_id:      form.instructor_id || null,
        instructor_name:    form.instructor_name,
        instructor_title:   form.instructor_title || null,
        tags:               form.tags,
        is_featured:        form.is_featured,
        live_password:      form.live_password,
        registration_url:   form.registration_url,
        youtube_embed:      form.youtube_embed,
        show_like_button:   form.show_like_button,
        announcement_send_mode: form.announcement_send_mode,
      };

      // For recorded sessions: keep scheduled_datetime (original live date) but clear live_url
      if (form.type === 'RECORDED') {
        payload.live_url = '';
      }

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

  /* ── Banner Upload ── */
  const uploadBanner = async (file: File) => {
    if (!editSession) { toast('Save the session first before uploading a banner', 'err'); return; }
    setUploadingBanner(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('sessionId', editSession.id);
      const res = await fetch('/api/admin/live-sessions', { method: 'PUT', body: fd });
      if (res.ok) {
        const j = await res.json();
        toast('Banner uploaded');
        setBannerPreview(j.banner_url ?? j.url ?? null);
        await fetchSessions();
      } else toast('Banner upload failed', 'err');
    } catch { toast('Banner upload error', 'err'); }
    setUploadingBanner(false);
  };

  /* ── Mark as Recorded ── */
  const handleMarkRecorded = async () => {
    if (!editSession) return;
    setMarkingRecorded(true);
    try {
      const res = await fetch(`/api/admin/live-sessions/${editSession.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'RECORDED', youtube_url: markRecordedUrl || undefined }),
      });
      if (res.ok) {
        toast('Session marked as recorded');
        setForm(f => ({ ...f, type: 'RECORDED', youtube_url: markRecordedUrl }));
        setMarkRecordedOpen(false);
        setMarkRecordedUrl('');
        await fetchSessions();
        // Update editSession reference
        const updated = await fetch('/api/admin/live-sessions');
        if (updated.ok) {
          const j = await updated.json();
          const found = (j.sessions ?? []).find((s: LiveSession) => s.id === editSession.id);
          if (found) setEditSession(found);
        }
      } else toast('Failed to update session type', 'err');
    } catch { toast('Error updating session', 'err'); }
    setMarkingRecorded(false);
  };

  /* ── Notifications ── */
  const sendNotify = (s: LiveSession, type: 'announcement' | 'reminder', target?: string, preview?: boolean) => {
    const label = type === 'announcement' ? 'Announcement' : 'Reminder';
    const doSend = async () => {
      try {
        const res = await fetch(`/api/admin/live-sessions/${s.id}/notify`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, target: target ?? 'all', preview: preview ?? false }),
        });
        if (res.ok) {
          if (preview) {
            toast('Preview sent to meetahmadch@gmail.com');
            setPreviewSent(true);
          } else {
            toast(`${label} sent`);
          }
          await fetchSessions();
        } else {
          const j = await res.json().catch(() => ({}));
          toast(j.error ?? `Failed to send ${label}`, 'err');
        }
      } catch { toast(`Error sending ${label}`, 'err'); }
    };

    if (preview) {
      doSend();
    } else {
      const targetLabel = target === '3sfm' ? '3SFM students' : target === 'bvm' ? 'BVM students' : 'all enrolled students';
      setConfirm({
        msg: `Send ${label} for "${s.title}" to ${targetLabel}?`,
        onOk: async () => { setConfirm(null); await doSend(); },
      });
    }
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
  const filtered = sessions.filter(s => {
    if (filterType !== 'ALL' && s.type !== filterType) return false;
    if (filterPlaylist && s.playlist_id !== filterPlaylist) return false;
    if (filterStatus === 'PUBLISHED' && !s.published) return false;
    if (filterStatus === 'DRAFT' && s.published) return false;
    if (selectedPlaylist && s.playlist_id !== selectedPlaylist) return false;
    return true;
  });

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

  /* ── Filter button helper ── */
  const filterBtn = (label: string, active: boolean, onClick: () => void): React.ReactNode => (
    <button
      key={label}
      onClick={onClick}
      style={{
        ...btnSecondary,
        padding: '5px 14px', fontSize: 11,
        background: active ? NAVY : '#fff',
        color: active ? '#fff' : NAVY,
      }}
    >{label}</button>
  );

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
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <a href="/admin/training-hub/live-sessions/email-settings"
              style={{ fontSize: 12, fontWeight: 600, color: '#2E75B6', textDecoration: 'none', padding: '6px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff' }}>
              Email Settings
            </a>
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
                    onClick={async () => {
                      const next = !pl.is_published;
                      await fetch('/api/admin/live-playlists', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pl.id, is_published: next }) });
                      setPlaylists(prev => prev.map(p => p.id === pl.id ? { ...p, is_published: next } : p));
                      toast(next ? 'Playlist visible' : 'Playlist hidden');
                    }}
                    style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', fontSize: 10, padding: '2px 8px', color: pl.is_published ? '#15803D' : '#9CA3AF' }}
                  >{pl.is_published ? 'Hide' : 'Show'}</button>
                  <button
                    onClick={() => { setEditingPlaylist(pl); setEditPlaylistName(pl.name); }}
                    style={{ background: 'none', border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', fontSize: 10, padding: '2px 8px', color: '#374151' }}
                  >Edit</button>
                  <button
                    onClick={() => deletePlaylist(pl)}
                    style={{ background: 'none', border: '1px solid #FECACA', borderRadius: 4, cursor: 'pointer', fontSize: 10, padding: '2px 8px', color: '#DC2626' }}
                  >Delete</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── FILTER ROW ── */}
        <div style={{ ...cardStyle, padding: 12, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Type filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>Type:</span>
            {filterBtn('All', filterType === 'ALL', () => setFilterType('ALL'))}
            {filterBtn('Upcoming', filterType === 'UPCOMING', () => setFilterType('UPCOMING'))}
            {filterBtn('Live', filterType === 'LIVE', () => setFilterType('LIVE'))}
            {filterBtn('Recorded', filterType === 'RECORDED', () => setFilterType('RECORDED'))}
          </div>

          {/* Playlist filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>Playlist:</span>
            <select
              style={{ ...inputStyle, width: 'auto', minWidth: 140, fontSize: 11, padding: '5px 8px' }}
              value={filterPlaylist}
              onChange={e => setFilterPlaylist(e.target.value)}
            >
              <option value="">All Playlists</option>
              {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
            </select>
          </div>

          {/* Status filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#374151' }}>Status:</span>
            {filterBtn('All', filterStatus === 'ALL', () => setFilterStatus('ALL'))}
            {filterBtn('Published', filterStatus === 'PUBLISHED', () => setFilterStatus('PUBLISHED'))}
            {filterBtn('Draft', filterStatus === 'DRAFT', () => setFilterStatus('DRAFT'))}
          </div>
        </div>

        {/* ── SESSIONS TABLE ── */}
        <div style={cardStyle}>
          {filtered.length === 0 ? (
            <p style={{ color: '#9CA3AF', fontSize: 13, textAlign: 'center', padding: 24 }}>
              No sessions found. Click &quot;+ New Session&quot; to create one.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${BORDER}` }}>
                  {['Title', 'Type', 'Date / Time', 'Playlist', 'Registered', 'YouTube', 'Published', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: NAVY, fontWeight: 700, fontSize: 11, textTransform: 'uppercase' as const }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => {
                  const badge = TYPE_BADGE[s.type] || TYPE_BADGE.RECORDED;
                  return (
                    <tr key={s.id} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '10px 10px', fontWeight: 600, color: '#1F2937' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {s.title}
                          {s.is_featured && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, padding: '2px 6px',
                              borderRadius: 10, background: '#FEF3C7', color: '#92400E',
                            }}>FEATURED</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 10px',
                          borderRadius: 20, background: badge.bg, color: badge.color,
                        }}>{badge.label}</span>
                      </td>
                      <td style={{ padding: '10px 10px', color: '#6B7280', fontSize: 12 }}>
                        {s.date ? `${s.date} ${s.time ?? ''}` : <span style={{ color: '#D1D5DB' }}>No date set</span>}
                      </td>
                      <td style={{ padding: '10px 10px', color: '#6B7280', fontSize: 12 }}>
                        {s.playlist_name ?? '-'}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <button onClick={() => openRegModal(s)} style={{ fontSize: 11, color: '#1B4F8A', background: 'none', border: '1px solid #C7D9F2', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontWeight: 600 }}>
                          View
                        </button>
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        {s.youtube_url ? (
                          <button
                            title={s.youtube_embed ? 'Embedded: plays within platform. Click to switch to external.' : 'External: opens YouTube in new tab. Click to switch to embedded.'}
                            onClick={async () => {
                              const next = !s.youtube_embed;
                              await fetch(`/api/admin/live-sessions/${s.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ youtube_embed: next }),
                              });
                              setSessions(prev => prev.map(x => x.id === s.id ? { ...x, youtube_embed: next } : x));
                              toast(next ? 'Switched to embedded' : 'Switched to external YouTube');
                            }}
                            style={{ fontSize: 11, background: 'none', border: '1px solid #D1D5DB', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', color: '#374151', fontWeight: 600 }}>
                            {s.youtube_embed ? '\u{1F4FA} Embed' : '\u{1F517} External'}
                          </button>
                        ) : (
                          <span style={{ fontSize: 10, color: '#D1D5DB' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <span style={{
                          display: 'inline-block', fontSize: 11, fontWeight: 600, padding: '3px 10px',
                          borderRadius: 20,
                          background: s.published ? '#D1FAE5' : '#F3F4F6',
                          color: s.published ? '#065F46' : '#9CA3AF',
                        }}>{s.published ? 'Yes' : 'No'}</span>
                      </td>
                      <td style={{ padding: '10px 10px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => setPreviewSession(s)}>Preview</button>
                          <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => openEditSession(s)}>Edit</button>
                          <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => duplicateSession(s)}>Duplicate</button>
                          <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => sendNotify(s, 'announcement')}>Notify</button>
                          <button style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }} onClick={() => {
                            const next = !s.published;
                            fetch(`/api/admin/live-sessions/${s.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_published: next }) })
                              .then(() => { toast(next ? 'Published' : 'Hidden'); fetchSessions(); });
                          }}>{s.published ? 'Hide' : 'Show'}</button>
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

                {/* Playlist with inline creation */}
                <div>
                  <label style={labelStyle}>Playlist</label>
                  <select
                    style={inputStyle}
                    value={form.playlist_id}
                    onChange={e => {
                      if (e.target.value === '__create__') {
                        setInlinePlaylistOpen(true);
                      } else {
                        setForm(f => ({ ...f, playlist_id: e.target.value }));
                      }
                    }}
                  >
                    <option value="">None</option>
                    {playlists.map(pl => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
                    <option value="__create__">[+ Create New Playlist]</option>
                  </select>
                  {inlinePlaylistOpen && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                      <input
                        style={{ ...inputStyle, flex: 1 }}
                        value={inlinePlaylistName}
                        onChange={e => setInlinePlaylistName(e.target.value)}
                        placeholder="New playlist name"
                        onKeyDown={e => e.key === 'Enter' && createInlinePlaylist()}
                        autoFocus
                      />
                      <button style={{ ...btnPrimary, padding: '6px 12px', fontSize: 11 }} onClick={createInlinePlaylist} disabled={creatingInlinePlaylist}>
                        {creatingInlinePlaylist ? '...' : 'Create'}
                      </button>
                      <button style={{ ...btnSecondary, padding: '6px 12px', fontSize: 11 }} onClick={() => { setInlinePlaylistOpen(false); setInlinePlaylistName(''); setForm(f => ({ ...f, playlist_id: '' })); }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* Instructor */}
                <div>
                  <label style={labelStyle}>Instructor</label>
                  <InstructorPicker
                    value={form.instructor_id}
                    onChange={(id, ins) => setForm(f => ({
                      ...f,
                      instructor_id: id,
                      instructor_name: ins?.name ?? '',
                      instructor_title: ins?.title ?? '',
                    }))}
                    onMessage={(msg, type) => toast(msg, type === 'success' ? 'ok' : 'err')}
                  />
                </div>

                {/* Duration + Max Attendees */}
                <div>
                  <label style={labelStyle}>Duration (min)</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={form.duration_minutes}
                    onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))}
                    placeholder="e.g. 60"
                    min={0}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Max Attendees</label>
                  <input
                    type="number"
                    style={inputStyle}
                    value={form.max_attendees}
                    onChange={e => setForm(f => ({ ...f, max_attendees: e.target.value }))}
                    placeholder="Optional"
                    min={0}
                  />
                </div>

                {/* Difficulty Level */}
                <div>
                  <label style={labelStyle}>Difficulty Level</label>
                  <select style={inputStyle} value={form.difficulty_level} onChange={e => setForm(f => ({ ...f, difficulty_level: e.target.value }))}>
                    {DIFFICULTY_LEVELS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                {/* Session Password */}
                <div>
                  <label style={labelStyle}>Session Password</label>
                  <input style={inputStyle} value={form.live_password} onChange={e => setForm(f => ({ ...f, live_password: e.target.value }))} placeholder="Optional" />
                </div>

                {/* Registration URL */}
                <div>
                  <label style={labelStyle}>Registration URL</label>
                  <input style={inputStyle} value={form.registration_url} onChange={e => setForm(f => ({ ...f, registration_url: e.target.value }))} placeholder="https://forms.google.com/... or Zoom registration link" />
                </div>

                {/* Prerequisites */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Prerequisites</label>
                  <textarea
                    style={{ ...inputStyle, minHeight: 50, resize: 'vertical' }}
                    value={form.prerequisites}
                    onChange={e => setForm(f => ({ ...f, prerequisites: e.target.value }))}
                    placeholder="Any prerequisites for this session..."
                  />
                </div>

                {/* Tags */}
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Tags</label>
                  <TagInput tags={form.tags} onChange={tags => setForm(f => ({ ...f, tags }))} />
                </div>

                {/* Published + Featured toggles */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, paddingTop: 8, flexWrap: 'wrap' }}>
                  <ToggleSwitch label="Published" value={form.published} onChange={v => setForm(f => ({ ...f, published: v }))} />
                  <ToggleSwitch label="Featured" value={form.is_featured} onChange={v => setForm(f => ({ ...f, is_featured: v }))} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Announce on publish:</label>
                    <select style={{ padding: '3px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #D1D5DB' }}
                      value={form.announcement_send_mode}
                      onChange={e => setForm(f => ({ ...f, announcement_send_mode: e.target.value as 'auto' | 'manual' }))}>
                      <option value="auto">Auto</option>
                      <option value="manual">Manual</option>
                    </select>
                  </div>
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

              <div style={{ display: 'grid', gridTemplateColumns: form.type === 'RECORDED' ? '1fr 1fr 1fr' : '1fr 1fr 1fr 1fr', gap: 14 }}>
                <div>
                  <label style={labelStyle}>{form.type === 'RECORDED' ? 'Session Date' : 'Date'}</label>
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
                {form.type !== 'RECORDED' && (
                  <div>
                    <label style={labelStyle}>Live URL</label>
                    <input style={inputStyle} value={form.live_url} onChange={e => setForm(f => ({ ...f, live_url: e.target.value }))} placeholder="https://zoom.us/..." />
                  </div>
                )}
              </div>

              {/* YouTube URL - always visible */}
              <div style={{ maxWidth: 500, marginTop: 14 }}>
                <label style={labelStyle}>YouTube URL</label>
                <input
                  style={{
                    ...inputStyle,
                    ...(form.type !== 'RECORDED' ? { color: '#9CA3AF' } : {}),
                  }}
                  value={form.youtube_url}
                  onChange={e => setForm(f => ({ ...f, youtube_url: e.target.value }))}
                  placeholder={form.type !== 'RECORDED' ? 'Paste YouTube URL after session is recorded' : 'https://youtube.com/watch?v=...'}
                />
              </div>

              {/* YouTube Playback Mode */}
              {form.youtube_url && (
                <div style={{ maxWidth: 500, marginTop: 14, padding: '14px 16px', borderRadius: 10, background: '#F9FAFB', border: '1px solid #E5E7EB' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8 }}>YouTube Playback Mode</div>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', marginBottom: 6 }}>
                    <input type="radio" name="yt_embed" checked={!form.youtube_embed} onChange={() => setForm(f => ({ ...f, youtube_embed: false }))} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Open on YouTube (recommended)</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF' }}>Students watch on YouTube - helps with channel views and monetization</div>
                    </div>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                    <input type="radio" name="yt_embed" checked={form.youtube_embed} onChange={() => setForm(f => ({ ...f, youtube_embed: true }))} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>Embed in Platform</div>
                      <div style={{ fontSize: 11, color: '#9CA3AF' }}>Video plays within the dashboard</div>
                    </div>
                  </label>
                </div>
              )}

              {/* Like Button Toggle */}
              {form.youtube_url && form.youtube_embed && (
                <div style={{ maxWidth: 500, marginTop: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={form.show_like_button}
                      onChange={e => setForm(f => ({ ...f, show_like_button: e.target.checked }))}
                    />
                    <span style={{ fontSize: 13, color: '#374151' }}>
                      Show &quot;Like on YouTube&quot; button on session page
                    </span>
                  </label>
                </div>
              )}

              {/* Mark as Recorded button for upcoming/live */}
              {editSession && (form.type === 'UPCOMING' || form.type === 'LIVE') && (
                <div style={{ marginTop: 14 }}>
                  {!markRecordedOpen ? (
                    <button
                      style={{ ...btnSecondary, background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D' }}
                      onClick={() => setMarkRecordedOpen(true)}
                    >
                      Mark as Recorded
                    </button>
                  ) : (
                    <div style={{ background: '#FFFBEB', border: '1px solid #FCD34D', borderRadius: 8, padding: 14, maxWidth: 500 }}>
                      <p style={{ fontSize: 12, color: '#92400E', marginBottom: 10, fontWeight: 600 }}>
                        This will change the session type to Recorded.
                      </p>
                      <label style={labelStyle}>YouTube URL (optional)</label>
                      <input
                        style={{ ...inputStyle, marginBottom: 10 }}
                        value={markRecordedUrl}
                        onChange={e => setMarkRecordedUrl(e.target.value)}
                        placeholder="https://youtube.com/watch?v=..."
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={{ ...btnPrimary, background: '#D97706' }} onClick={handleMarkRecorded} disabled={markingRecorded}>
                          {markingRecorded ? 'Updating...' : 'Confirm'}
                        </button>
                        <button style={btnSecondary} onClick={() => { setMarkRecordedOpen(false); setMarkRecordedUrl(''); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── B2. Banner Image ── */}
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Banner Image</h3>
              <input
                ref={bannerRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.[0]) uploadBanner(e.target.files[0]); e.target.value = ''; }}
              />
              {editSession ? (
                <button style={btnSecondary} onClick={() => bannerRef.current?.click()} disabled={uploadingBanner}>
                  {uploadingBanner ? 'Uploading...' : bannerPreview ? 'Change Banner' : 'Upload Banner'}
                </button>
              ) : (
                <p style={{ fontSize: 12, color: '#9CA3AF' }}>Save the session first to upload a banner image.</p>
              )}
              {bannerPreview && (
                <div style={{ marginTop: 10 }}>
                  <img
                    src={bannerPreview}
                    alt="Session banner"
                    style={{ maxWidth: 400, maxHeight: 200, borderRadius: 8, border: `1px solid ${BORDER}`, objectFit: 'cover' }}
                  />
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
                  {uploading ? 'Uploading...' : 'Upload File'}
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

            {/* ── C2. Assessment ── */}
            {editSession && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Assessment</h3>
                <LiveSessionAssessmentEditor
                  sessionId={editSession.id}
                  onMessage={(msg, type) => toast(msg, type === 'success' ? 'ok' : 'err')}
                />
              </div>
            )}

            {/* ── D. Notifications ── */}
            {editSession && (
              <div style={{ marginBottom: 20 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: NAVY, marginBottom: 12 }}>Notifications</h3>

                {/* Target selector */}
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Target Audience</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {([
                      { value: 'all' as const, label: 'All Students' },
                      { value: '3sfm' as const, label: '3SFM Only' },
                      { value: 'bvm' as const, label: 'BVM Only' },
                    ]).map(opt => (
                      <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#374151', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="notifyTarget"
                          checked={notifyTarget === opt.value}
                          onChange={() => { setNotifyTarget(opt.value); setPreviewSent(false); }}
                          style={{ accentColor: BLUE }}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {/* Announcement */}
                  <div style={{ background: LIGHT_BG, borderRadius: 8, padding: '12px 16px', minWidth: 260 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Announcement</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {editSession.announcement_sent
                        ? `Sent to ${editSession.announcement_count ?? 0} students${editSession.announcement_date ? ` on ${editSession.announcement_date}` : ''}`
                        : 'Not sent yet'}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        style={{ ...btnSecondary, padding: '5px 12px', fontSize: 11 }}
                        onClick={() => sendNotify(editSession, 'announcement', notifyTarget, true)}
                      >
                        Preview Email
                      </button>
                      <button
                        style={{
                          ...btnPrimary, padding: '5px 12px', fontSize: 11,
                          opacity: previewSent ? 1 : 0.5,
                          cursor: previewSent ? 'pointer' : 'not-allowed',
                        }}
                        onClick={() => previewSent && sendNotify(editSession, 'announcement', notifyTarget)}
                        disabled={!previewSent}
                        title={!previewSent ? 'Send a Preview Email first' : ''}
                      >
                        Send Announcement
                      </button>
                    </div>
                    {!previewSent && (
                      <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6 }}>Send a preview first to enable Send All.</p>
                    )}
                  </div>
                  {/* Reminder */}
                  <div style={{ background: LIGHT_BG, borderRadius: 8, padding: '12px 16px', minWidth: 260 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Reminder</div>
                    <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>
                      {editSession.reminder_sent
                        ? `Sent to ${editSession.reminder_count ?? 0} students${editSession.reminder_date ? ` on ${editSession.reminder_date}` : ''}`
                        : 'Not sent yet'}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        style={{ ...btnSecondary, padding: '5px 12px', fontSize: 11 }}
                        onClick={() => sendNotify(editSession, 'reminder', notifyTarget, true)}
                      >
                        Preview Email
                      </button>
                      <button
                        style={{
                          ...btnPrimary, background: BLUE, padding: '5px 12px', fontSize: 11,
                          opacity: previewSent ? 1 : 0.5,
                          cursor: previewSent ? 'pointer' : 'not-allowed',
                        }}
                        onClick={() => previewSent && sendNotify(editSession, 'reminder', notifyTarget)}
                        disabled={!previewSent}
                        title={!previewSent ? 'Send a Preview Email first' : ''}
                      >
                        Send Reminder
                      </button>
                    </div>
                    {!previewSent && (
                      <p style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6 }}>Send a preview first to enable Send All.</p>
                    )}
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

      {/* ── Preview Modal ── */}
      {/* ── Registrations Modal ── */}
      {regModal && (
        <div onClick={e => { if (e.target === e.currentTarget) setRegModal(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 750, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>Registrations - {regModal.title}</div>
                <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{regList.length} registered / {regList.filter(r => r.attended).length} attended</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={markAllAttended} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', cursor: 'pointer', color: '#374151', fontWeight: 600 }}>Mark All Present</button>
                <button onClick={exportRegCsv} style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', cursor: 'pointer', color: '#374151', fontWeight: 600 }}>Export CSV</button>
                <button onClick={() => setRegModal(null)} style={{ width: 28, height: 28, borderRadius: 6, background: '#F3F4F6', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6B7280' }}>x</button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {regLoading ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>Loading...</div>
              ) : regList.length === 0 ? (
                <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF' }}>No registrations yet.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
                      {['Name', 'Reg ID', 'Email', 'Registered', 'Attended'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase' as const }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {regList.map(r => (
                      <tr key={r.student_reg_id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1F2937' }}>{r.student_name}</td>
                        <td style={{ padding: '8px 12px', color: '#6B7280', fontFamily: 'monospace', fontSize: 11 }}>{r.student_reg_id}</td>
                        <td style={{ padding: '8px 12px', color: '#6B7280' }}>{r.student_email}</td>
                        <td style={{ padding: '8px 12px', color: '#9CA3AF', fontSize: 11 }}>{new Date(r.registered_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                        <td style={{ padding: '8px 12px' }}>
                          <input type="checkbox" checked={r.attended} onChange={e => toggleAttended(r.student_reg_id, e.target.checked)}
                            style={{ width: 16, height: 16, cursor: 'pointer' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Preview Modal ── */}
      {previewSession && (() => {
        const ps = previewSession;
        const rawDt = (ps as unknown as Record<string, unknown>).scheduled_datetime as string | null;
        const sessionTime = rawDt ? new Date(rawDt) : null;
        const now = new Date();
        const isLiveNow = ps.type === 'LIVE' && sessionTime && sessionTime <= now && now.getTime() <= sessionTime.getTime() + 3 * 3600000;
        const isUpcoming = ps.type === 'UPCOMING' || (sessionTime && sessionTime > now && ps.type !== 'RECORDED');
        const isRecorded = ps.type === 'RECORDED';
        const badgeLabel = isLiveNow ? 'LIVE NOW' : isUpcoming ? 'UPCOMING' : 'RECORDED';
        const badgeBg = isLiveNow ? '#FEF2F2' : isUpcoming ? '#EFF6FF' : '#F3F4F6';
        const badgeColor = isLiveNow ? '#DC2626' : isUpcoming ? '#1D4ED8' : '#6B7280';
        const ytId = ps.youtube_url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1];

        return (
          <div onClick={e => { if (e.target === e.currentTarget) setPreviewSession(null); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
            <div style={{ background: '#fff', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

              {/* Branded header */}
              <div style={{ background: NAVY, padding: '0 24px', display: 'flex', alignItems: 'center', height: 52, gap: 14, flexShrink: 0 }}>
                <div style={{ width: 24, height: 24, borderRadius: 4, background: GREEN, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 800 }}>F</div>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Financial Modeler Pro</span>
                <span style={{ color: '#475569' }}>|</span>
                <span style={{ fontSize: 12, color: '#94A3B8' }}>Live Sessions</span>
                <span style={{ color: '#475569' }}>|</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#fff', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ps.title}</span>
                <span style={{ fontSize: 10, color: '#6B7280', background: 'rgba(255,255,255,0.1)', padding: '3px 10px', borderRadius: 10, flexShrink: 0 }}>Preview</span>
                <button onClick={() => setPreviewSession(null)} style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', fontSize: 14, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>x</button>
              </div>

              {/* Scrollable content */}
              <div style={{ overflowY: 'auto', flex: 1 }}>

                {/* Banner or gradient placeholder */}
                {ps.banner_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ps.banner_url} alt={ps.title} style={{ width: '100%', height: 'auto', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: 220, background: 'linear-gradient(135deg, #0D2E5A 0%, #1B4F8A 50%, #2E75B6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
                    <span style={{ fontSize: 28, fontWeight: 800, color: '#fff', textAlign: 'center', lineHeight: 1.3 }}>{ps.title}</span>
                  </div>
                )}

                <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 40px' }}>
                  {/* Badges */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, background: badgeBg, color: badgeColor }}>{badgeLabel}</span>
                    {ps.difficulty_level && ps.difficulty_level !== 'All Levels' && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#F3F4F6', color: '#6B7280' }}>{ps.difficulty_level}</span>
                    )}
                    {ps.category && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: '#F3F4F6', color: '#6B7280' }}>{ps.category}</span>}
                    {ps.is_featured && <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: '#FEF3C7', color: '#B45309' }}>FEATURED</span>}
                  </div>

                  {/* Title + instructor */}
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: NAVY, margin: '0 0 4px', lineHeight: 1.3 }}>{ps.title}</h2>
                  {ps.instructor_name && <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 10 }}>{ps.instructor_name}</div>}

                  {/* Date/time */}
                  {ps.date && (
                    <div style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
                      {ps.date} {ps.time ?? ''} ({ps.timezone ?? ''})
                    </div>
                  )}

                  {/* Duration + capacity */}
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, fontSize: 12, color: '#6B7280' }}>
                    {ps.duration_minutes ? <span>{ps.duration_minutes} minutes</span> : null}
                    {ps.max_attendees ? <span>Limited to {ps.max_attendees} seats</span> : null}
                  </div>

                  {/* Tags */}
                  {ps.tags && ps.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
                      {ps.tags.map(t => <span key={t} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1B4F8A', fontWeight: 600 }}>{t}</span>)}
                    </div>
                  )}

                  {/* Description */}
                  {ps.description && (
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #F3F4F6' }}>
                      {ps.description}
                    </div>
                  )}

                  {/* Prerequisites */}
                  {ps.prerequisites && (
                    <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
                      <strong style={{ color: '#92400E' }}>Prerequisites: </strong><span style={{ color: '#374151' }}>{ps.prerequisites}</span>
                    </div>
                  )}

                  {/* YouTube embed for recorded */}
                  {isRecorded && ytId && (
                    <div style={{ marginBottom: 14, borderRadius: 10, overflow: 'hidden', background: '#000', aspectRatio: '16/9' }}>
                      <iframe src={`https://www.youtube.com/embed/${ytId}`} width="100%" height="100%" style={{ border: 'none' }} allowFullScreen />
                    </div>
                  )}

                  {/* Action buttons */}
                  {!isRecorded && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ background: '#F0F7FF', border: '1.5px solid #93C5FD', borderRadius: 10, padding: 16, marginBottom: 10 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 24px', borderRadius: 8, background: GREEN, color: '#fff', fontWeight: 700, fontSize: 13 }}>Register for This Session</span>
                        <div style={{ fontSize: 12, color: '#6B7280', marginTop: 8 }}>Join link will be available 30 minutes before the session starts</div>
                      </div>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 8, border: '1.5px solid #D1D5DB', background: '#fff', color: '#374151', fontWeight: 600, fontSize: 12 }}>Add to Calendar ▾</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div style={{ padding: '10px 24px', borderTop: '1px solid #E5E7EB', background: '#F9FAFB', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#9CA3AF', fontStyle: 'italic' }}>Preview only - public Live Sessions page coming soon. Enrolled students can view this in their Training Hub dashboard at learn.financialmodelerpro.com/training/live-sessions</span>
                <button onClick={() => setPreviewSession(null)} style={{ padding: '5px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: NAVY, color: '#fff', border: 'none', cursor: 'pointer' }}>Close Preview</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

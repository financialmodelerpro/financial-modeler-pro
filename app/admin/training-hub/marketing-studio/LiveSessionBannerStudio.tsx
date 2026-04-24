'use client';

import React, { useEffect, useState } from 'react';
import type { LiveSessionBannerContent } from '@/src/lib/marketing-studio/types';
import { DIMENSIONS } from '@/src/lib/marketing-studio/types';
import {
  StudioShell, Field, BackgroundPicker,
  inputStyle, textareaStyle, selectStyle, cardStyle,
  PrimaryButton, SecondaryButton, PreviewFrame,
  renderToBlobUrl, downloadBlobUrl,
} from './studio-shared';

interface SessionRow {
  id: string;
  title: string;
  scheduled_datetime: string | null;
  timezone: string | null;
  duration_minutes: number | null;
  instructor_name: string | null;
  instructor_title: string | null;
  session_type: string | null;
}

const DEFAULTS: LiveSessionBannerContent = {
  template: 'live-1200',
  badge: 'LIVE SESSION',
  title: 'Pick a session above to auto-fill',
  scheduledAtISO: new Date().toISOString(),
  timezone: 'Asia/Karachi',
  durationMinutes: 60,
  instructorName: '',
  instructorTitle: '',
  cta: 'Register now',
};

export function LiveSessionBannerStudio() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState<LiveSessionBannerContent>(DEFAULTS);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/admin/training-hub/marketing-studio/live-sessions')
      .then(r => r.json())
      .then((j: { sessions: SessionRow[] }) => setSessions(j.sessions ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void handleGenerate();
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof LiveSessionBannerContent>(key: K, value: LiveSessionBannerContent[K]) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  function applySession(id: string) {
    setSelectedId(id);
    if (!id) return;
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    setContent(prev => ({
      ...prev,
      badge: s.session_type === 'recorded' ? 'NEW RECORDING' : 'LIVE SESSION',
      title: s.title || prev.title,
      scheduledAtISO: s.scheduled_datetime || prev.scheduledAtISO,
      timezone: s.timezone || prev.timezone,
      durationMinutes: s.duration_minutes ?? prev.durationMinutes,
      instructorName: s.instructor_name || '',
      instructorTitle: s.instructor_title || '',
    }));
  }

  async function handleGenerate() {
    setGenerating(true); setError('');
    try {
      const url = await renderToBlobUrl({ type: 'live-session', content });
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) {
      setError((e as Error).message);
    }
    setGenerating(false);
  }

  function handleDownload() {
    if (!blobUrl) return;
    downloadBlobUrl(blobUrl, `fmp-live-session-${selectedId || 'custom'}.png`);
  }

  // Format the ISO datetime for the datetime-local input. The input expects
  // YYYY-MM-DDTHH:mm in local time.
  const dtLocal = (() => {
    try {
      const d = new Date(content.scheduledAtISO);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  })();

  const dims = DIMENSIONS[content.template];

  return (
    <StudioShell
      title="Live Session Banner"
      description="Pick a session, edit any field, export. Pulls from live_sessions: title, datetime, timezone, duration, instructor."
      controls={
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Pick session" hint={`${sessions.length} sessions available`}>
              <select value={selectedId} onChange={e => applySession(e.target.value)} style={selectStyle}>
                <option value="">— Custom (no auto-fill) —</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    [{s.session_type === 'recorded' ? 'REC' : 'LIVE'}] {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Badge text">
              <input value={content.badge} onChange={e => set('badge', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Title">
              <textarea value={content.title} onChange={e => set('title', e.target.value)} style={textareaStyle} rows={2} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Date / time">
                <input type="datetime-local" value={dtLocal}
                  onChange={e => set('scheduledAtISO', new Date(e.target.value).toISOString())}
                  style={inputStyle} />
              </Field>
              <Field label="Duration (min)">
                <input type="number" min={0} value={content.durationMinutes}
                  onChange={e => set('durationMinutes', parseInt(e.target.value, 10) || 0)} style={inputStyle} />
              </Field>
            </div>
            <Field label="Timezone">
              <input value={content.timezone} onChange={e => set('timezone', e.target.value)} style={inputStyle}
                placeholder="e.g. Asia/Karachi" />
            </Field>
            <Field label="Instructor name (optional override)">
              <input value={content.instructorName} onChange={e => set('instructorName', e.target.value)} style={inputStyle}
                placeholder="Defaults to brand pack" />
            </Field>
            <Field label="Instructor title (optional override)">
              <input value={content.instructorTitle} onChange={e => set('instructorTitle', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="CTA">
              <input value={content.cta} onChange={e => set('cta', e.target.value)} style={inputStyle} />
            </Field>
            <BackgroundPicker selectedUrl={content.backgroundUrl} onChange={url => set('backgroundUrl', url)} />
          </div>
        </div>
      }
      preview={
        <div>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#6B7280' }}>Preview · {dims.width} × {dims.height}px</div>
          <PreviewFrame blobUrl={blobUrl} error={error} generating={generating} aspectRatio={dims.width / dims.height} />
        </div>
      }
      exportButton={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PrimaryButton onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : '⟳ Generate Preview'}
          </PrimaryButton>
          <SecondaryButton onClick={handleDownload} disabled={!blobUrl || generating}>⬇ Download PNG</SecondaryButton>
        </div>
      }
    />
  );
}

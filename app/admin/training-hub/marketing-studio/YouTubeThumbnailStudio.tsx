'use client';

import React, { useEffect, useState } from 'react';
import type { YouTubeThumbnailContent } from '@/src/lib/marketing-studio/types';
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
  session_type: string | null;
}

const DEFAULTS: YouTubeThumbnailContent = {
  template: 'thumb-1280',
  badge: 'NEW',
  title: 'Pick a session to auto-fill the title',
  subtitle: 'Practitioner Financial Modeling',
};

export function YouTubeThumbnailStudio() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState<YouTubeThumbnailContent>(DEFAULTS);
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

  function set<K extends keyof YouTubeThumbnailContent>(key: K, value: YouTubeThumbnailContent[K]) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  function applySession(id: string) {
    setSelectedId(id);
    if (!id) return;
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    setContent(prev => ({ ...prev, title: s.title || prev.title }));
  }

  async function handleGenerate() {
    setGenerating(true); setError('');
    try {
      const url = await renderToBlobUrl({ type: 'youtube-thumbnail', content });
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) {
      setError((e as Error).message);
    }
    setGenerating(false);
  }

  function handleDownload() {
    if (!blobUrl) return;
    downloadBlobUrl(blobUrl, `fmp-youtube-thumb-${selectedId || 'custom'}.png`);
  }

  const dims = DIMENSIONS[content.template];

  return (
    <StudioShell
      title="YouTube Thumbnail"
      description="1280 × 720 thumbnail. Pulls the title from a chosen live session, or you can type any custom title. Brand elements are fixed."
      controls={
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Pick session (optional)">
              <select value={selectedId} onChange={e => applySession(e.target.value)} style={selectStyle}>
                <option value="">— Custom title —</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </Field>
            <Field label="Badge">
              <input value={content.badge} onChange={e => set('badge', e.target.value)} style={inputStyle} placeholder="e.g. NEW, PART 3" />
            </Field>
            <Field label="Title (large text)">
              <textarea value={content.title} onChange={e => set('title', e.target.value)} style={textareaStyle} rows={3} />
            </Field>
            <Field label="Subtitle">
              <input value={content.subtitle} onChange={e => set('subtitle', e.target.value)} style={inputStyle} />
            </Field>
            <BackgroundPicker selectedUrl={content.backgroundUrl} onChange={url => set('backgroundUrl', url)} />
          </div>
        </div>
      }
      preview={
        <div>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#6B7280' }}>Preview · {dims.width} × {dims.height}px (16:9)</div>
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

'use client';

import React, { useEffect, useState } from 'react';
import type { YouTubeThumbnailContent, LayoutOverrides } from '@/src/features/marketing-studio/types';
import { DIMENSIONS } from '@/src/features/marketing-studio/types';
import { YOUTUBE_THUMB_LAYOUT } from '@/src/features/marketing-studio/templates/youtube-thumbnail';
import {
  StudioShell, Field, BackgroundPicker, ZoneVisibilityPanel,
  inputStyle, textareaStyle, selectStyle, cardStyle,
  PrimaryButton, SecondaryButton,
  useAutoRender, downloadBlobUrl,
} from './studio-shared';
import { InstructorPicker } from './InstructorPicker';
import { LayoutEditor } from './LayoutEditor';

interface SessionRow {
  id: string;
  title: string;
  instructor_id: string | null;
  session_type: string | null;
}

const DEFAULTS: YouTubeThumbnailContent = {
  template: 'thumb-1280',
  badge: 'NEW',
  title: 'Pick a session to auto-fill the title',
  subtitle: 'Practitioner Financial Modeling',
  instructorIds: [],
  layout: {},
  hiddenZones: [],
};

export function YouTubeThumbnailStudio() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [content, setContent] = useState<YouTubeThumbnailContent>(DEFAULTS);
  const { blobUrl, generating, error } = useAutoRender({ type: 'youtube-thumbnail', content });

  useEffect(() => {
    void fetch('/api/admin/training-hub/marketing-studio/live-sessions')
      .then(r => r.json())
      .then((j: { sessions: SessionRow[] }) => setSessions(j.sessions ?? []))
      .catch(() => {});
  }, []);

  function set<K extends keyof YouTubeThumbnailContent>(key: K, value: YouTubeThumbnailContent[K]) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  function setLayout(next: LayoutOverrides) { setContent(prev => ({ ...prev, layout: next })); }
  function resetLayout() { setContent(prev => ({ ...prev, layout: {} })); }
  function setHiddenZones(next: string[]) { setContent(prev => ({ ...prev, hiddenZones: next })); }

  function applySession(id: string) {
    setSelectedId(id);
    if (!id) return;
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    setContent(prev => ({
      ...prev,
      title: s.title || prev.title,
      instructorIds: s.instructor_id ? [s.instructor_id] : prev.instructorIds,
    }));
  }

  function handleDownload() {
    if (!blobUrl) return;
    downloadBlobUrl(blobUrl, `fmp-youtube-thumb-${selectedId || 'custom'}.png`);
  }

  const dims = DIMENSIONS[content.template];

  return (
    <StudioShell
      title="YouTube Thumbnail"
      description="1280 × 720. Pick a session to auto-fill title + instructor, or customize. Drag/resize the title and trainer circle."
      controls={
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Pick session (optional)">
              <select value={selectedId} onChange={e => applySession(e.target.value)} style={selectStyle}>
                <option value="">— Custom title —</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </Field>
            <InstructorPicker
              value={content.instructorIds ?? []}
              onChange={ids => set('instructorIds', ids)}
              hint={(content.instructorIds ?? []).length > 1
                ? 'YouTube thumbnail shows the FIRST picked instructor only'
                : 'Empty = default trainer from brand pack'}
            />
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
            <ZoneVisibilityPanel templateLayout={YOUTUBE_THUMB_LAYOUT} hiddenZones={content.hiddenZones ?? []} onChange={setHiddenZones} />
          </div>
        </div>
      }
      preview={
        <div>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#6B7280' }}>
            Preview · {dims.width} × {dims.height}px (16:9) {generating && '· regenerating…'} {error && <span style={{ color: '#DC2626' }}>· {error}</span>}
          </div>
          <LayoutEditor
            templateLayout={YOUTUBE_THUMB_LAYOUT}
            overrides={content.layout ?? {}}
            hiddenZones={content.hiddenZones ?? []}
            previewBlobUrl={blobUrl}
            generating={generating}
            onLayoutChange={setLayout}
            onReset={resetLayout}
          />
        </div>
      }
      exportButton={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PrimaryButton onClick={handleDownload} disabled={!blobUrl || generating}>
            ⬇ Download PNG
          </PrimaryButton>
          <SecondaryButton onClick={resetLayout} disabled={Object.keys(content.layout ?? {}).length === 0}>
            ↺ Reset layout to defaults
          </SecondaryButton>
        </div>
      }
    />
  );
}

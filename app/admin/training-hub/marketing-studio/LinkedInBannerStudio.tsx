'use client';

import React, { useEffect, useState } from 'react';
import type { LinkedInBannerContent } from '@/src/lib/marketing-studio/types';
import { DIMENSIONS } from '@/src/lib/marketing-studio/types';
import {
  StudioShell, Field, BackgroundPicker,
  inputStyle, textareaStyle, selectStyle, cardStyle,
  PrimaryButton, SecondaryButton, PreviewFrame,
  renderToBlobUrl, downloadBlobUrl,
} from './studio-shared';

const TEMPLATES: { value: LinkedInBannerContent['template']; label: string; description: string }[] = [
  { value: 'profile-1584', label: 'Profile cover (1584 × 396)',  description: 'Wide LinkedIn profile banner with trainer card on the right.' },
  { value: 'post-1200',    label: 'Post share (1200 × 627)',     description: 'Square-ish post layout with bottom trainer strip.' },
  { value: 'quote-1200',   label: 'Quote / insight (1200 × 627)', description: 'Centered quote card with founder credentials.' },
];

const DEFAULTS: LinkedInBannerContent = {
  template: 'profile-1584',
  title: 'Practitioner Financial Modeling Training',
  subtitle: 'Free certification courses built by working analysts. 3-Statement, Valuation, Real Estate.',
  cta: 'Free certification',
};

export function LinkedInBannerStudio() {
  const [content, setContent] = useState<LinkedInBannerContent>(DEFAULTS);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Auto-generate on first mount
  useEffect(() => {
    void handleGenerate();
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof LinkedInBannerContent>(key: K, value: LinkedInBannerContent[K]) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  async function handleGenerate() {
    setGenerating(true);
    setError('');
    try {
      const url = await renderToBlobUrl({ type: 'linkedin-banner', content });
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) {
      setError((e as Error).message);
    }
    setGenerating(false);
  }

  function handleDownload() {
    if (!blobUrl) return;
    const dims = DIMENSIONS[content.template];
    downloadBlobUrl(blobUrl, `fmp-linkedin-${content.template}-${dims.width}x${dims.height}.png`);
  }

  const dims = DIMENSIONS[content.template];

  return (
    <StudioShell
      title="LinkedIn Banners"
      description="Three brand-locked layouts. Trainer photo, name, credentials, and FMP logo are pulled from the active brand pack and cannot be moved."
      controls={
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Template">
              <select value={content.template} onChange={e => set('template', e.target.value as LinkedInBannerContent['template'])} style={selectStyle}>
                {TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div style={{ marginTop: 6, fontSize: 11, color: '#6B7280' }}>{TEMPLATES.find(t => t.value === content.template)?.description}</div>
            </Field>
            <Field label="Headline">
              <textarea value={content.title} onChange={e => set('title', e.target.value)} style={textareaStyle} rows={2} />
            </Field>
            <Field label="Subtitle">
              <textarea value={content.subtitle} onChange={e => set('subtitle', e.target.value)} style={textareaStyle} rows={3} />
            </Field>
            <Field label="CTA / Tag">
              <input value={content.cta} onChange={e => set('cta', e.target.value)} style={inputStyle} placeholder="e.g. Free certification" />
            </Field>
            <BackgroundPicker selectedUrl={content.backgroundUrl} onChange={url => set('backgroundUrl', url)} />
          </div>
        </div>
      }
      preview={
        <div>
          <div style={{ marginBottom: 8, fontSize: 12, color: '#6B7280' }}>
            Preview · {dims.width} × {dims.height}px
          </div>
          <PreviewFrame blobUrl={blobUrl} error={error} generating={generating} aspectRatio={dims.width / dims.height} />
        </div>
      }
      exportButton={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PrimaryButton onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : '⟳ Generate Preview'}
          </PrimaryButton>
          <SecondaryButton onClick={handleDownload} disabled={!blobUrl || generating}>
            ⬇ Download PNG
          </SecondaryButton>
        </div>
      }
    />
  );
}

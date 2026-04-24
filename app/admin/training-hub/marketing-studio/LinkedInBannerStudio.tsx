'use client';

import React, { useMemo, useState } from 'react';
import type { LinkedInBannerContent, LayoutOverrides } from '@/src/lib/marketing-studio/types';
import { DIMENSIONS } from '@/src/lib/marketing-studio/types';
import {
  LINKEDIN_PROFILE_LAYOUT, LINKEDIN_POST_LAYOUT, LINKEDIN_QUOTE_LAYOUT,
} from '@/src/lib/marketing-studio/templates/linkedin-banner';
import {
  StudioShell, Field, BackgroundPicker,
  inputStyle, textareaStyle, selectStyle, cardStyle,
  PrimaryButton, SecondaryButton,
  useAutoRender, downloadBlobUrl,
} from './studio-shared';
import { InstructorPicker } from './InstructorPicker';
import { LayoutEditor } from './LayoutEditor';

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
  instructorIds: [],
  layout: {},
};

export function LinkedInBannerStudio() {
  const [content, setContent] = useState<LinkedInBannerContent>(DEFAULTS);
  const { blobUrl, generating, error } = useAutoRender({ type: 'linkedin-banner', content });

  function set<K extends keyof LinkedInBannerContent>(key: K, value: LinkedInBannerContent[K]) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  function setLayout(next: LayoutOverrides) { setContent(prev => ({ ...prev, layout: next })); }
  function resetLayout() { setContent(prev => ({ ...prev, layout: {} })); }

  function handleDownload() {
    if (!blobUrl) return;
    const dims = DIMENSIONS[content.template];
    downloadBlobUrl(blobUrl, `fmp-linkedin-${content.template}-${dims.width}x${dims.height}.png`);
  }

  const dims = DIMENSIONS[content.template];
  const templateLayout = useMemo(() => {
    if (content.template === 'profile-1584') return LINKEDIN_PROFILE_LAYOUT;
    if (content.template === 'post-1200') return LINKEDIN_POST_LAYOUT;
    return LINKEDIN_QUOTE_LAYOUT;
  }, [content.template]);

  return (
    <StudioShell
      title="LinkedIn Banners"
      description="Three brand-locked layouts. Pick instructors, fill text, then drag/resize zones in the preview to fine-tune."
      controls={
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Template">
              <select value={content.template} onChange={e => { set('template', e.target.value as LinkedInBannerContent['template']); setLayout({}); }} style={selectStyle}>
                {TEMPLATES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div style={{ marginTop: 6, fontSize: 11, color: '#6B7280' }}>{TEMPLATES.find(t => t.value === content.template)?.description}</div>
            </Field>
            <InstructorPicker value={content.instructorIds ?? []} onChange={ids => set('instructorIds', ids)} />
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
            Preview · {dims.width} × {dims.height}px {generating && '· regenerating…'} {error && <span style={{ color: '#DC2626' }}>· {error}</span>}
          </div>
          <LayoutEditor
            templateLayout={templateLayout}
            overrides={content.layout ?? {}}
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

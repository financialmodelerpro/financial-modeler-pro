'use client';

import React, { useEffect, useState } from 'react';
import type { ArticleBannerContent, LayoutOverrides } from '@/src/lib/marketing-studio/types';
import { DIMENSIONS } from '@/src/lib/marketing-studio/types';
import { ARTICLE_BANNER_LAYOUT } from '@/src/lib/marketing-studio/templates/article-banner';
import {
  StudioShell, Field, BackgroundPicker,
  inputStyle, textareaStyle, selectStyle, cardStyle,
  PrimaryButton, SecondaryButton,
  useAutoRender, downloadBlobUrl,
} from './studio-shared';
import { InstructorPicker } from './InstructorPicker';
import { LayoutEditor } from './LayoutEditor';

interface ArticleRow {
  slug: string;
  title: string;
  category: string | null;
}

const DEFAULTS: ArticleBannerContent = {
  template: 'article-1200',
  category: 'INSIGHTS',
  title: 'Pick an article to auto-fill',
  author: '',
  instructorIds: [],
  layout: {},
};

export function ArticleBannerStudio() {
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [content, setContent] = useState<ArticleBannerContent>(DEFAULTS);
  const { blobUrl, generating, error } = useAutoRender({ type: 'article-banner', content });

  useEffect(() => {
    void fetch('/api/admin/training-hub/marketing-studio/articles')
      .then(r => r.json())
      .then((j: { articles: ArticleRow[] }) => setArticles(j.articles ?? []))
      .catch(() => {});
  }, []);

  function set<K extends keyof ArticleBannerContent>(key: K, value: ArticleBannerContent[K]) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

  function setLayout(next: LayoutOverrides) { setContent(prev => ({ ...prev, layout: next })); }
  function resetLayout() { setContent(prev => ({ ...prev, layout: {} })); }

  function applyArticle(slug: string) {
    setSelectedSlug(slug);
    if (!slug) return;
    const a = articles.find(x => x.slug === slug);
    if (!a) return;
    setContent(prev => ({
      ...prev,
      title: a.title || prev.title,
      category: (a.category || 'Insights').toUpperCase(),
    }));
  }

  function handleDownload() {
    if (!blobUrl) return;
    downloadBlobUrl(blobUrl, `fmp-article-${selectedSlug || 'custom'}.png`);
  }

  const dims = DIMENSIONS[content.template];

  return (
    <StudioShell
      title="Article Banner"
      description="1200 × 630. Pick an article to auto-fill title + category. Pick an instructor as the author byline (or override with text)."
      controls={
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Field label="Pick article" hint={`${articles.length} published`}>
              <select value={selectedSlug} onChange={e => applyArticle(e.target.value)} style={selectStyle}>
                <option value="">— Custom (no auto-fill) —</option>
                {articles.map(a => (
                  <option key={a.slug} value={a.slug}>
                    [{(a.category || '?').slice(0, 12)}] {a.title}
                  </option>
                ))}
              </select>
            </Field>
            <InstructorPicker
              value={content.instructorIds ?? []}
              onChange={ids => set('instructorIds', ids)}
              hint={(content.instructorIds ?? []).length > 0
                ? 'Article banner uses the FIRST picked instructor as author'
                : 'Empty = default trainer (or use Author Override below)'}
            />
            <Field label="Category">
              <input value={content.category} onChange={e => set('category', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Headline">
              <textarea value={content.title} onChange={e => set('title', e.target.value)} style={textareaStyle} rows={3} />
            </Field>
            <Field label="Author override (optional)">
              <input value={content.author} onChange={e => set('author', e.target.value)} style={inputStyle}
                placeholder="Leave blank to use picked instructor's name" />
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
            templateLayout={ARTICLE_BANNER_LAYOUT}
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

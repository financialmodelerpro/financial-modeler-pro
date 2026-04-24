'use client';

import React, { useEffect, useState } from 'react';
import type { ArticleBannerContent } from '@/src/lib/marketing-studio/types';
import { DIMENSIONS } from '@/src/lib/marketing-studio/types';
import {
  StudioShell, Field, BackgroundPicker,
  inputStyle, textareaStyle, selectStyle, cardStyle,
  PrimaryButton, SecondaryButton, PreviewFrame,
  renderToBlobUrl, downloadBlobUrl,
} from './studio-shared';

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
};

export function ArticleBannerStudio() {
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [content, setContent] = useState<ArticleBannerContent>(DEFAULTS);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/admin/training-hub/marketing-studio/articles')
      .then(r => r.json())
      .then((j: { articles: ArticleRow[] }) => setArticles(j.articles ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void handleGenerate();
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof ArticleBannerContent>(key: K, value: ArticleBannerContent[K]) {
    setContent(prev => ({ ...prev, [key]: value }));
  }

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

  async function handleGenerate() {
    setGenerating(true); setError('');
    try {
      const url = await renderToBlobUrl({ type: 'article-banner', content });
      setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) {
      setError((e as Error).message);
    }
    setGenerating(false);
  }

  function handleDownload() {
    if (!blobUrl) return;
    downloadBlobUrl(blobUrl, `fmp-article-${selectedSlug || 'custom'}.png`);
  }

  const dims = DIMENSIONS[content.template];

  return (
    <StudioShell
      title="Article Banner"
      description="1200 × 630 article share banner. Pull title + category from a published article, or type custom."
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
            <Field label="Category">
              <input value={content.category} onChange={e => set('category', e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Headline">
              <textarea value={content.title} onChange={e => set('title', e.target.value)} style={textareaStyle} rows={3} />
            </Field>
            <Field label="Author (optional override)">
              <input value={content.author} onChange={e => set('author', e.target.value)} style={inputStyle}
                placeholder="Defaults to brand pack" />
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

'use client';

import { useState } from 'react';
import type { Article } from '@/src/shared/cms';
import { ArticleCard } from '@/src/hubs/main/components/landing/ArticleCard';

interface Props {
  articles: Article[];
  categories: string[];
}

export function ArticlesGrid({ articles, categories }: Props) {
  const [active, setActive] = useState('All');
  const filtered = active === 'All' ? articles : articles.filter(a => a.category === active);

  return (
    <>
      {/* Category tabs */}
      {categories.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 40, flexWrap: 'wrap' }}>
          {['All', ...categories].map(cat => (
            <button key={cat} onClick={() => setActive(cat)} style={{
              padding: '8px 18px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: active === cat ? 700 : 500,
              background: active === cat ? '#1B4F8A' : 'rgba(255,255,255,0.1)',
              color: active === cat ? '#fff' : 'rgba(255,255,255,0.6)',
            }}>
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 ? (
        // I4: minmax(300, 1fr) forced 1 column at 320px with 20px
        // overhead — cards clipped. min(100%, 280px) drops to full-width
        // on narrow viewports and 280+ otherwise.
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 24 }}>
          {filtered.map(article => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)' }}>No articles found in this category.</div>
        </div>
      )}
    </>
  );
}

export function NewsletterForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, source: 'articles' }),
      });
      const data = await res.json() as { success: boolean; message: string };
      setStatus(data.success ? 'success' : 'error');
      setMessage(data.message);
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  // I5: inputs used flex:2 1 200px / 1 1 140px which stacked awkwardly
  // at 320px with the nowrap button wrapping last. flex:1 1 100% makes
  // each input a full row on mobile while staying flexible at desktop
  // (the maxWidth:520 cap on the form still keeps things tidy).
  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 520, margin: '0 auto' }}>
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" style={{
        flex: '1 1 100%', minWidth: 0, padding: '12px 16px', fontSize: 14, border: '1.5px solid #D1D5DB', borderRadius: 8, outline: 'none', background: '#fff', boxSizing: 'border-box',
      }} />
      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" style={{
        flex: '2 1 220px', minWidth: 0, padding: '12px 16px', fontSize: 14, border: '1.5px solid #D1D5DB', borderRadius: 8, outline: 'none', background: '#fff', boxSizing: 'border-box',
      }} />
      <button type="submit" disabled={status === 'loading'} style={{
        flex: '1 1 auto', padding: '12px 24px', fontSize: 14, fontWeight: 700, background: '#1B4F8A', color: '#fff', border: 'none', borderRadius: 8, cursor: status === 'loading' ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      }}>
        {status === 'loading' ? 'Subscribing...' : 'Subscribe →'}
      </button>
      {status !== 'idle' && status !== 'loading' && (
        <div style={{ width: '100%', textAlign: 'center', marginTop: 8, fontSize: 13, fontWeight: 600, color: status === 'success' ? '#15803D' : '#DC2626' }}>
          {status === 'success' ? '✓' : '✗'} {message}
        </div>
      )}
    </form>
  );
}

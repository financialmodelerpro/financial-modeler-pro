'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

const CATEGORIES = ['Real Estate', 'Business Valuation', 'FP&A', 'Market Insights', 'Career', 'Case Studies', 'Platform Tutorials'];

function slugify(str: string) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function AdminArticleEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [category, setCategory] = useState('Real Estate');
  const [coverUrl, setCoverUrl] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'scheduled'>('draft');
  const [featured, setFeatured] = useState(false);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDesc, setSeoDesc] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastAutoSaved, setLastAutoSaved] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: '',
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      setWordCount(text.split(/\s+/).filter(Boolean).length);
    },
  });

  useEffect(() => {
    fetch(`/api/admin/articles?id=${id}`)
      .then(r => r.json())
      .then(j => {
        const a = j.article;
        if (!a) return;
        setTitle(a.title ?? '');
        setSlug(a.slug ?? '');
        setCategory(a.category ?? 'Real Estate');
        setCoverUrl(a.cover_url ?? '');
        setStatus(a.status ?? 'draft');
        setFeatured(a.featured ?? false);
        setSeoTitle(a.seo_title ?? '');
        setSeoDesc(a.seo_description ?? '');
        if (a.body && editor) {
          editor.commands.setContent(a.body);
          const text = editor.getText();
          setWordCount(text.split(/\s+/).filter(Boolean).length);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id, editor]);

  const doSave = useCallback(async (showToast = true) => {
    if (!editor) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/articles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, title, slug, category, cover_url: coverUrl, body: editor.getHTML(), status, featured, seo_title: seoTitle, seo_description: seoDesc }),
      });
      if (!res.ok) throw new Error('Save failed');
      if (showToast) { setToast({ msg: 'Saved', type: 'success' }); setTimeout(() => setToast(null), 2500); }
      else setLastAutoSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch {
      if (showToast) { setToast({ msg: 'Save failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
    } finally { setSaving(false); }
  }, [editor, id, title, slug, category, coverUrl, status, featured, seoTitle, seoDesc]);

  useEffect(() => {
    autoSaveRef.current = setInterval(() => { if (!loading) doSave(false); }, 60000);
    return () => { if (autoSaveRef.current) clearInterval(autoSaveRef.current); };
  }, [doSave, loading]);

  async function handleDelete() {
    if (!confirm('Delete this article permanently?')) return;
    setDeleting(true);
    try {
      await fetch(`/api/admin/articles?id=${id}`, { method: 'DELETE' });
      router.push('/admin/articles');
    } catch { setToast({ msg: 'Delete failed', type: 'error' }); setTimeout(() => setToast(null), 2500); }
    finally { setDeleting(false); }
  }

  const readTime = Math.max(1, Math.round(wordCount / 200));
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', fontSize: 13, border: '1px solid #D1D5DB', borderRadius: 7, background: '#FFFBEB', fontFamily: 'Inter, sans-serif', color: '#374151', boxSizing: 'border-box' };

  if (loading) return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/articles" />
      <main style={{ flex: 1, padding: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6B7280' }}>Loading article…</main>
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'Inter', sans-serif", background: '#F4F7FC' }}>
      <CmsAdminNav active="/admin/articles" />
      <main style={{ flex: 1, padding: 40, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <Link href="/admin/articles" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none' }}>← Back to Articles</Link>
          {lastAutoSaved && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Auto-saved at {lastAutoSaved}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'flex-start' }}>
          {/* Main editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 28 }}>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title…" style={{ width: '100%', fontSize: 24, fontWeight: 800, color: '#1B3A6B', border: 'none', outline: 'none', marginBottom: 12, fontFamily: 'Inter, sans-serif', boxSizing: 'border-box', background: 'transparent' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <span style={{ fontSize: 12, color: '#6B7280' }}>Slug:</span>
                <input value={slug} onChange={e => setSlug(e.target.value)} style={{ flex: 1, padding: '4px 8px', fontSize: 12, border: '1px solid #E5E7EB', borderRadius: 5, fontFamily: 'monospace', color: '#374151', background: '#FFFBEB' }} />
                <button onClick={() => setSlug(slugify(title))} style={{ fontSize: 11, padding: '4px 10px', border: '1px solid #D1D5DB', borderRadius: 5, cursor: 'pointer', background: '#fff', color: '#374151' }}>Generate</button>
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Cover Image URL</label>
                <input value={coverUrl} onChange={e => setCoverUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
                {coverUrl && <img src={coverUrl} alt="Cover preview" style={{ marginTop: 8, maxHeight: 120, borderRadius: 6, objectFit: 'cover', width: '100%' }} />}
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 28 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, borderBottom: '1px solid #E8F0FB', paddingBottom: 10 }}>
                {[
                  { label: 'B', cmd: () => editor?.chain().focus().toggleBold().run(), active: () => editor?.isActive('bold') },
                  { label: 'I', cmd: () => editor?.chain().focus().toggleItalic().run(), active: () => editor?.isActive('italic') },
                  { label: 'H2', cmd: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), active: () => editor?.isActive('heading', { level: 2 }) },
                  { label: 'H3', cmd: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), active: () => editor?.isActive('heading', { level: 3 }) },
                  { label: '• List', cmd: () => editor?.chain().focus().toggleBulletList().run(), active: () => editor?.isActive('bulletList') },
                  { label: '1. List', cmd: () => editor?.chain().focus().toggleOrderedList().run(), active: () => editor?.isActive('orderedList') },
                  { label: 'Quote', cmd: () => editor?.chain().focus().toggleBlockquote().run(), active: () => editor?.isActive('blockquote') },
                ].map((btn) => (
                  <button key={btn.label} onClick={btn.cmd} style={{ padding: '4px 10px', fontSize: 12, fontWeight: btn.active?.() ? 700 : 500, border: '1px solid #D1D5DB', borderRadius: 5, cursor: 'pointer', background: btn.active?.() ? '#1B4F8A' : '#fff', color: btn.active?.() ? '#fff' : '#374151' }}>{btn.label}</button>
                ))}
              </div>
              <EditorContent editor={editor} style={{ minHeight: 300, fontSize: 14, lineHeight: 1.7, color: '#374151', outline: 'none' }} />
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1B3A6B', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Publish</div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value as any)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="scheduled">Scheduled</option>
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Category</label>
                <select value={category} onChange={e => setCategory(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
                <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} />
                Featured ⭐
              </label>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 16 }}>
                {wordCount} words · {readTime} min read
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => doSave()} disabled={saving} style={{ background: status === 'published' ? '#1A7A30' : '#1B4F8A', color: '#fff', border: 'none', borderRadius: 7, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
                  {saving ? 'Saving…' : status === 'published' ? '✓ Update Article' : '💾 Save Draft'}
                </button>
                <button onClick={handleDelete} disabled={deleting} style={{ background: 'transparent', color: '#DC2626', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 7, padding: '8px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer', width: '100%' }}>
                  {deleting ? 'Deleting…' : '🗑 Delete Article'}
                </button>
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E8F0FB', borderRadius: 12, padding: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#1B3A6B', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.05em' }}>SEO</div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>SEO Title</label>
                <input value={seoTitle} onChange={e => setSeoTitle(e.target.value)} style={inputStyle} placeholder="Leave blank to use article title" />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 }}>Meta Description <span style={{ color: seoDesc.length > 160 ? '#DC2626' : '#9CA3AF' }}>({seoDesc.length}/160)</span></label>
                <textarea value={seoDesc} onChange={e => setSeoDesc(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} maxLength={180} />
              </div>
            </div>
          </div>
        </div>
      </main>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, background: toast.type === 'success' ? '#1A7A30' : '#DC2626', color: '#fff', fontWeight: 700, fontSize: 13, padding: '12px 24px', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', zIndex: 9999 }}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}
    </div>
  );
}

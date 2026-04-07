'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';

// ── Types ────────────────────────────────────────────────────────────────────

interface Section {
  id: string;
  page_slug: string;
  section_type: string;
  content: Record<string, unknown>;
  display_order: number;
  visible: boolean;
  styles: Record<string, unknown>;
}

interface CmsPage {
  id: string;
  slug: string;
  title: string;
  seo_title: string;
  seo_description: string;
  status: string;
  is_system: boolean;
}

const SECTION_TYPES = [
  { value: 'hero',       label: 'Hero',           icon: '🎯', desc: 'Large banner with headline, subtitle, and CTAs' },
  { value: 'text',       label: 'Text',           icon: '📝', desc: 'Simple heading + body text' },
  { value: 'rich_text',  label: 'Rich Text',      icon: '📄', desc: 'HTML content with badge + heading' },
  { value: 'image',      label: 'Image',          icon: '🖼️', desc: 'Single image with caption' },
  { value: 'text_image', label: 'Text + Image',   icon: '📰', desc: 'Side-by-side text and image' },
  { value: 'columns',    label: 'Columns',        icon: '▤',  desc: '2-4 column grid layout' },
  { value: 'cards',      label: 'Cards',          icon: '🃏', desc: 'Grid of icon + title + description cards' },
  { value: 'cta',        label: 'Call to Action',  icon: '📢', desc: 'Colored banner with buttons' },
  { value: 'faq',        label: 'FAQ',            icon: '❓', desc: 'Accordion Q&A section' },
  { value: 'stats',      label: 'Stats Bar',      icon: '📊', desc: 'Horizontal stats with values + labels' },
  { value: 'list',       label: 'List',           icon: '📋', desc: 'Vertical or horizontal item list' },
] as const;

const TYPE_LABELS: Record<string, string> = Object.fromEntries(SECTION_TYPES.map(t => [t.value, `${t.icon} ${t.label}`]));

// Default content for each section type
const DEFAULT_CONTENT: Record<string, Record<string, unknown>> = {
  hero:       { badge: '', headline: 'Page Title', subtitle: 'Subtitle text here', cta1Text: '', cta1Url: '', cta2Text: '', cta2Url: '' },
  text:       { heading: 'Section Heading', body: 'Your text content here.' },
  rich_text:  { badge: '', heading: 'Section Heading', html: '<p>Rich text content here.</p>' },
  image:      { src: '', alt: 'Image description', caption: '' },
  text_image: { heading: 'Heading', html: '<p>Text content next to image.</p>', imageSrc: '', imageAlt: '', imagePosition: 'right', imageWidth: '45%' },
  columns:    { heading: 'Columns Section', columns: [{ heading: 'Column 1', html: 'Content', icon: '' }, { heading: 'Column 2', html: 'Content', icon: '' }], count: 2 },
  cards:      { heading: 'Cards Section', cards: [{ icon: '⭐', title: 'Card 1', description: 'Description' }] },
  cta:        { heading: 'Ready to get started?', subtitle: 'Join us today.', buttonText: 'Get Started', buttonUrl: '/' },
  faq:        { heading: 'Frequently Asked Questions', items: [{ question: 'Question?', answer: 'Answer.' }] },
  stats:      { items: [{ value: '100+', label: 'Users' }, { value: '50+', label: 'Courses' }] },
  list:       { heading: 'Features', layout: 'vertical', items: [{ icon: '✓', title: 'Feature 1', description: 'Description' }] },
};

// ── Shared styles ────────────────────────────────────────────────────────────

const IS: React.CSSProperties = { width: '100%', padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #D1D5DB', background: '#F9FAFB', outline: 'none', boxSizing: 'border-box' };
const LS: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 3 };
const TA: React.CSSProperties = { ...IS, resize: 'vertical' as const, minHeight: 60, fontFamily: 'inherit' };

// ── Section content editors ──────────────────────────────────────────────────

function HeroEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Badge</label><input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} placeholder="e.g. Free Certification" />
      <label style={{ ...LS, marginTop: 10 }}>Headline</label><input style={IS} value={(content.headline as string) ?? ''} onChange={e => set('headline', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Subtitle</label><textarea style={TA} value={(content.subtitle as string) ?? ''} onChange={e => set('subtitle', e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div><label style={LS}>CTA 1 Text</label><input style={IS} value={(content.cta1Text as string) ?? ''} onChange={e => set('cta1Text', e.target.value)} /></div>
        <div><label style={LS}>CTA 1 URL</label><input style={IS} value={(content.cta1Url as string) ?? ''} onChange={e => set('cta1Url', e.target.value)} /></div>
        <div><label style={LS}>CTA 2 Text</label><input style={IS} value={(content.cta2Text as string) ?? ''} onChange={e => set('cta2Text', e.target.value)} /></div>
        <div><label style={LS}>CTA 2 URL</label><input style={IS} value={(content.cta2Url as string) ?? ''} onChange={e => set('cta2Url', e.target.value)} /></div>
      </div>
    </>
  );
}

function TextEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Body</label><textarea style={{ ...TA, minHeight: 100 }} value={(content.body as string) ?? ''} onChange={e => set('body', e.target.value)} />
    </>
  );
}

function RichTextEditor2({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Badge</label><input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>HTML Content</label><textarea style={{ ...TA, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} value={(content.html as string) ?? ''} onChange={e => set('html', e.target.value)} />
    </>
  );
}

function ImageEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Image URL</label><input style={IS} value={(content.src as string) ?? ''} onChange={e => set('src', e.target.value)} placeholder="https://..." />
      <label style={{ ...LS, marginTop: 10 }}>Alt Text</label><input style={IS} value={(content.alt as string) ?? ''} onChange={e => set('alt', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Caption</label><input style={IS} value={(content.caption as string) ?? ''} onChange={e => set('caption', e.target.value)} />
    </>
  );
}

function TextImageEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>HTML Content</label><textarea style={{ ...TA, minHeight: 80, fontFamily: 'monospace', fontSize: 12 }} value={(content.html as string) ?? ''} onChange={e => set('html', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Image URL</label><input style={IS} value={(content.imageSrc as string) ?? ''} onChange={e => set('imageSrc', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Image Alt</label><input style={IS} value={(content.imageAlt as string) ?? ''} onChange={e => set('imageAlt', e.target.value)} />
      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <div>
          <label style={LS}>Image Position</label>
          <select style={IS} value={(content.imagePosition as string) ?? 'right'} onChange={e => set('imagePosition', e.target.value)}>
            <option value="left">Left</option><option value="right">Right</option>
          </select>
        </div>
        <div>
          <label style={LS}>Image Width</label>
          <input style={IS} value={(content.imageWidth as string) ?? '45%'} onChange={e => set('imageWidth', e.target.value)} placeholder="45%" />
        </div>
      </div>
    </>
  );
}

function CtaEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Subtitle</label><textarea style={TA} value={(content.subtitle as string) ?? ''} onChange={e => set('subtitle', e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div><label style={LS}>Button Text</label><input style={IS} value={(content.buttonText as string) ?? ''} onChange={e => set('buttonText', e.target.value)} /></div>
        <div><label style={LS}>Button URL</label><input style={IS} value={(content.buttonUrl as string) ?? ''} onChange={e => set('buttonUrl', e.target.value)} /></div>
        <div><label style={LS}>Button 2 Text</label><input style={IS} value={(content.button2Text as string) ?? ''} onChange={e => set('button2Text', e.target.value)} /></div>
        <div><label style={LS}>Button 2 URL</label><input style={IS} value={(content.button2Url as string) ?? ''} onChange={e => set('button2Url', e.target.value)} /></div>
      </div>
    </>
  );
}

function StatsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.items as { value: string; label: string }[]) ?? [];
  const setItems = (next: { value: string; label: string }[]) => onChange({ ...content, items: next });
  return (
    <>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <div style={{ flex: 1 }}><label style={LS}>Value</label><input style={IS} value={item.value} onChange={e => { const n = [...items]; n[i] = { ...n[i], value: e.target.value }; setItems(n); }} /></div>
          <div style={{ flex: 1 }}><label style={LS}>Label</label><input style={IS} value={item.label} onChange={e => { const n = [...items]; n[i] = { ...n[i], label: e.target.value }; setItems(n); }} /></div>
          <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>X</button>
        </div>
      ))}
      <button onClick={() => setItems([...items, { value: '0', label: 'Label' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Stat</button>
    </>
  );
}

function CardsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const cards = (content.cards as { icon: string; title: string; description: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setCards = (next: typeof cards) => onChange({ ...content, cards: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={LS}>Badge</label><input style={{ ...IS, marginBottom: 10 }} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      {cards.map((card, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 60 }}><label style={LS}>Icon</label><input style={IS} value={card.icon} onChange={e => { const n = [...cards]; n[i] = { ...n[i], icon: e.target.value }; setCards(n); }} /></div>
            <div style={{ flex: 1 }}><label style={LS}>Title</label><input style={IS} value={card.title} onChange={e => { const n = [...cards]; n[i] = { ...n[i], title: e.target.value }; setCards(n); }} /></div>
            <button onClick={() => setCards(cards.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, alignSelf: 'end' }}>X</button>
          </div>
          <label style={LS}>Description</label><textarea style={{ ...TA, minHeight: 40 }} value={card.description} onChange={e => { const n = [...cards]; n[i] = { ...n[i], description: e.target.value }; setCards(n); }} />
        </div>
      ))}
      <button onClick={() => setCards([...cards, { icon: '⭐', title: 'New Card', description: 'Description' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Card</button>
    </>
  );
}

function ColumnsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const columns = (content.columns as { heading: string; html: string; icon: string }[]) ?? [];
  const set = (k: string, v: unknown) => onChange({ ...content, [k]: v });
  const setCols = (next: typeof columns) => onChange({ ...content, columns: next, count: next.length });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={{ ...LS, marginTop: 6 }}>Badge</label><input style={{ ...IS, marginBottom: 10 }} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      {columns.map((col, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 60 }}><label style={LS}>Icon</label><input style={IS} value={col.icon} onChange={e => { const n = [...columns]; n[i] = { ...n[i], icon: e.target.value }; setCols(n); }} /></div>
            <div style={{ flex: 1 }}><label style={LS}>Heading</label><input style={IS} value={col.heading} onChange={e => { const n = [...columns]; n[i] = { ...n[i], heading: e.target.value }; setCols(n); }} /></div>
            <button onClick={() => setCols(columns.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, alignSelf: 'end' }}>X</button>
          </div>
          <label style={LS}>Content (HTML)</label><textarea style={{ ...TA, minHeight: 40, fontFamily: 'monospace', fontSize: 12 }} value={col.html} onChange={e => { const n = [...columns]; n[i] = { ...n[i], html: e.target.value }; setCols(n); }} />
        </div>
      ))}
      <button onClick={() => setCols([...columns, { heading: 'New Column', html: 'Content', icon: '' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Column</button>
    </>
  );
}

function FaqEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.items as { question: string; answer: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setItems = (next: typeof items) => onChange({ ...content, items: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={{ ...IS, marginBottom: 10 }} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      {items.map((item, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 6 }}>
            <div style={{ flex: 1 }}><label style={LS}>Question</label><input style={IS} value={item.question} onChange={e => { const n = [...items]; n[i] = { ...n[i], question: e.target.value }; setItems(n); }} /></div>
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11 }}>X</button>
          </div>
          <label style={LS}>Answer</label><textarea style={{ ...TA, minHeight: 50 }} value={item.answer} onChange={e => { const n = [...items]; n[i] = { ...n[i], answer: e.target.value }; setItems(n); }} />
        </div>
      ))}
      <button onClick={() => setItems([...items, { question: 'New question?', answer: 'Answer here.' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add FAQ</button>
    </>
  );
}

function ListEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.items as { icon: string; title: string; description: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setItems = (next: typeof items) => onChange({ ...content, items: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <div style={{ display: 'flex', gap: 8, marginTop: 6, marginBottom: 10 }}>
        <label style={LS}>Layout</label>
        <select style={{ ...IS, width: 'auto' }} value={(content.layout as string) ?? 'vertical'} onChange={e => set('layout', e.target.value)}>
          <option value="vertical">Vertical</option><option value="horizontal">Horizontal (steps)</option>
        </select>
      </div>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <div style={{ width: 50 }}><label style={LS}>Icon</label><input style={IS} value={item.icon} onChange={e => { const n = [...items]; n[i] = { ...n[i], icon: e.target.value }; setItems(n); }} /></div>
          <div style={{ flex: 1 }}><label style={LS}>Title</label><input style={IS} value={item.title} onChange={e => { const n = [...items]; n[i] = { ...n[i], title: e.target.value }; setItems(n); }} /></div>
          <div style={{ flex: 2 }}><label style={LS}>Description</label><input style={IS} value={item.description} onChange={e => { const n = [...items]; n[i] = { ...n[i], description: e.target.value }; setItems(n); }} /></div>
          <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>X</button>
        </div>
      ))}
      <button onClick={() => setItems([...items, { icon: '✓', title: 'Item', description: 'Description' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Item</button>
    </>
  );
}

const EDITORS: Record<string, React.ComponentType<{ content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }>> = {
  hero: HeroEditor, text: TextEditor, rich_text: RichTextEditor2, image: ImageEditor,
  text_image: TextImageEditor, cta: CtaEditor, stats: StatsEditor, cards: CardsEditor,
  columns: ColumnsEditor, faq: FaqEditor, list: ListEditor,
};

// ── Style editor (shared across all section types) ───────────────────────────

function StyleEditor({ styles, onChange }: { styles: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...styles, [k]: v });
  return (
    <div style={{ marginTop: 12, padding: 10, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Style Overrides</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label style={LS}>Background</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="color" value={(styles.bgColor as string) ?? '#ffffff'} onChange={e => set('bgColor', e.target.value)} style={{ width: 28, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
            <input style={IS} value={(styles.bgColor as string) ?? ''} onChange={e => set('bgColor', e.target.value)} placeholder="#ffffff" />
          </div>
        </div>
        <div>
          <label style={LS}>Text Color</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="color" value={(styles.textColor as string) ?? '#374151'} onChange={e => set('textColor', e.target.value)} style={{ width: 28, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
            <input style={IS} value={(styles.textColor as string) ?? ''} onChange={e => set('textColor', e.target.value)} placeholder="#374151" />
          </div>
        </div>
        <div><label style={LS}>Padding Y</label><input style={IS} value={(styles.paddingY as string) ?? ''} onChange={e => set('paddingY', e.target.value)} placeholder="clamp(48px,7vw,80px)" /></div>
        <div><label style={LS}>Max Width</label><input style={IS} value={(styles.maxWidth as string) ?? ''} onChange={e => set('maxWidth', e.target.value)} placeholder="1000px" /></div>
        <div><label style={LS}>Text Align</label>
          <select style={IS} value={(styles.textAlign as string) ?? ''} onChange={e => set('textAlign', e.target.value)}>
            <option value="">Default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PageBuilderEditorPage() {
  const params = useParams();
  const router = useRouter();
  const slug   = params.slug as string;

  const [page, setPage]             = useState<CmsPage | null>(null);
  const [sections, setSections]     = useState<Section[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState('');
  const [activeId, setActiveId]     = useState<string | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showSeo, setShowSeo]       = useState(false);

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000); }

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/page-sections?slug=${encodeURIComponent(slug)}`);
      const d = await res.json() as { page?: CmsPage; sections?: Section[] };
      setPage(d.page ?? null);
      setSections(d.sections ?? []);
    } catch {}
    finally { setLoading(false); }
  }, [slug]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Drag & drop reorder ──
  function onDragEnd(result: DropResult) {
    if (!result.destination) return;
    const items = Array.from(sections);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    const reordered = items.map((s, i) => ({ ...s, display_order: i }));
    setSections(reordered);
    // Save reorder
    fetch('/api/admin/page-sections', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reorder', items: reordered.map(s => ({ id: s.id, display_order: s.display_order })) }),
    }).catch(() => {});
  }

  // ── Add section ──
  async function addSection(type: string) {
    setShowTypePicker(false);
    try {
      const res = await fetch('/api/admin/page-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_slug: slug, section_type: type, content: DEFAULT_CONTENT[type] ?? {} }),
      });
      const d = await res.json() as { section?: Section };
      if (d.section) {
        setSections(prev => [...prev, d.section!]);
        setActiveId(d.section!.id);
        showToast('Section added');
      }
    } catch { showToast('Failed to add'); }
  }

  // ── Save section content ──
  async function saveSection(section: Section) {
    setSaving(true);
    try {
      await fetch('/api/admin/page-sections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: section.id, content: section.content, styles: section.styles, visible: section.visible }),
      });
      showToast('Saved');
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  }

  // ── Delete section ──
  async function deleteSection(id: string) {
    if (!confirm('Delete this section?')) return;
    try {
      await fetch('/api/admin/page-sections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSections(prev => prev.filter(s => s.id !== id));
      if (activeId === id) setActiveId(null);
      showToast('Deleted');
    } catch { showToast('Delete failed'); }
  }

  // ── Toggle visibility ──
  function toggleVisibility(id: string) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, visible: !s.visible } : s));
  }

  // ── Update section locally ──
  function updateSection(id: string, updates: Partial<Section>) {
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }

  // ── Save SEO ──
  async function saveSeo() {
    if (!page) return;
    setSaving(true);
    try {
      await fetch('/api/admin/page-sections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_page', id: page.id, seo_title: page.seo_title, seo_description: page.seo_description }),
      });
      showToast('SEO saved');
    } catch { showToast('Save failed'); }
    finally { setSaving(false); }
  }

  const activeSection = sections.find(s => s.id === activeId);
  const ActiveEditor  = activeSection ? EDITORS[activeSection.section_type] : null;

  if (loading) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA' }}>
        <CmsAdminNav />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#F5F7FA', fontFamily: "'Inter', sans-serif" }}>
      <CmsAdminNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: '12px 24px', background: '#fff', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/admin/page-builder" style={{ fontSize: 13, color: '#6B7280', textDecoration: 'none' }}>← Pages</Link>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0D2E5A' }}>{page?.title ?? slug}</h1>
            <span style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' }}>/{slug}</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {toast && <span style={{ fontSize: 12, fontWeight: 600, color: '#2EAA4A' }}>{toast}</span>}
            <button onClick={() => setShowSeo(!showSeo)}
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid #D1D5DB', background: showSeo ? '#EFF6FF' : '#fff', color: '#374151', cursor: 'pointer' }}>
              SEO
            </button>
            <a href={`/${slug === 'home' ? '' : slug}`} target="_blank" rel="noopener noreferrer"
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, border: '1px solid #D1D5DB', background: '#fff', color: '#374151', textDecoration: 'none' }}>
              Preview ↗
            </a>
          </div>
        </div>

        {/* SEO panel */}
        {showSeo && page && (
          <div style={{ padding: '12px 24px', background: '#FFFBEB', borderBottom: '1px solid #FDE68A' }}>
            <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><label style={LS}>SEO Title</label><input style={IS} value={page.seo_title} onChange={e => setPage({ ...page, seo_title: e.target.value })} /></div>
              <div><label style={LS}>SEO Description</label><textarea style={{ ...IS, resize: 'vertical', minHeight: 48 }} value={page.seo_description} onChange={e => setPage({ ...page, seo_description: e.target.value })} /></div>
              <button onClick={saveSeo} disabled={saving} style={{ alignSelf: 'flex-start', padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#0D2E5A', color: '#fff', border: 'none', cursor: 'pointer' }}>Save SEO</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* ── Left: section list (drag & drop) ── */}
          <div style={{ width: 320, background: '#fff', borderRight: '1px solid #E5E7EB', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #F3F4F6' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Sections ({sections.length})
              </div>
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="sections">
                {(provided) => (
                  <div ref={provided.innerRef} {...provided.droppableProps} style={{ flex: 1, padding: '8px 12px' }}>
                    {sections.map((section, idx) => (
                      <Draggable key={section.id} draggableId={section.id} index={idx}>
                        {(prov, snap) => (
                          <div
                            ref={prov.innerRef}
                            {...prov.draggableProps}
                            onClick={() => setActiveId(section.id)}
                            style={{
                              ...prov.draggableProps.style,
                              padding: '10px 12px',
                              marginBottom: 6,
                              borderRadius: 8,
                              border: `1.5px solid ${activeId === section.id ? '#1B4F8A' : '#E5E7EB'}`,
                              background: snap.isDragging ? '#EFF6FF' : activeId === section.id ? '#F0F7FF' : '#fff',
                              cursor: 'pointer',
                              opacity: section.visible ? 1 : 0.5,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8,
                            }}
                          >
                            <span {...prov.dragHandleProps} style={{ cursor: 'grab', fontSize: 14, color: '#9CA3AF', flexShrink: 0 }}>⠿</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 700, color: '#0D2E5A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {TYPE_LABELS[section.section_type] ?? section.section_type}
                              </div>
                              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {(section.content.heading as string) || (section.content.headline as string) || (section.content.body as string)?.slice(0, 40) || '—'}
                              </div>
                            </div>
                            <button onClick={e => { e.stopPropagation(); toggleVisibility(section.id); }} title={section.visible ? 'Hide' : 'Show'}
                              style={{ padding: '2px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, color: section.visible ? '#6B7280' : '#D1D5DB' }}>
                              {section.visible ? '👁' : '👁‍🗨'}
                            </button>
                            <button onClick={e => { e.stopPropagation(); deleteSection(section.id); }} title="Delete"
                              style={{ padding: '2px 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 11, color: '#FCA5A5' }}>
                              ✕
                            </button>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            {/* Add section button */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid #F3F4F6' }}>
              {showTypePicker ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>Choose section type:</div>
                  {SECTION_TYPES.map(t => (
                    <button key={t.value} onClick={() => addSection(t.value)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{t.icon}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#0D2E5A' }}>{t.label}</div>
                        <div style={{ fontSize: 10, color: '#9CA3AF' }}>{t.desc}</div>
                      </div>
                    </button>
                  ))}
                  <button onClick={() => setShowTypePicker(false)}
                    style={{ padding: '6px 0', fontSize: 12, color: '#6B7280', background: 'transparent', border: 'none', cursor: 'pointer', marginTop: 4 }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowTypePicker(true)}
                  style={{ width: '100%', padding: '10px 0', borderRadius: 8, fontSize: 13, fontWeight: 700, background: '#EFF6FF', color: '#1B4F8A', border: '1.5px dashed #1B4F8A', cursor: 'pointer' }}>
                  + Add Section
                </button>
              )}
            </div>
          </div>

          {/* ── Right: section editor ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24, background: '#F5F7FA' }}>
            {activeSection && ActiveEditor ? (
              <div style={{ maxWidth: 700, background: '#fff', borderRadius: 10, border: '1px solid #E5E7EB', padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0D2E5A' }}>
                    {TYPE_LABELS[activeSection.section_type]}
                  </div>
                  <button
                    onClick={() => saveSection(activeSection)}
                    disabled={saving}
                    style={{ padding: '7px 20px', borderRadius: 6, fontSize: 13, fontWeight: 700, background: saving ? '#9CA3AF' : '#2EAA4A', color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer' }}>
                    {saving ? 'Saving...' : 'Save Section'}
                  </button>
                </div>
                <ActiveEditor
                  content={activeSection.content}
                  onChange={c => updateSection(activeSection.id, { content: c })}
                />
                <StyleEditor
                  styles={activeSection.styles}
                  onChange={s => updateSection(activeSection.id, { styles: s })}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9CA3AF' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>🧱</div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Select a section to edit</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Or click "+ Add Section" to create one</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

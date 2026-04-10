'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { CmsAdminNav } from '@/src/components/admin/CmsAdminNav';
import { RichTextEditor } from '@/src/components/admin/RichTextEditor';
import { MediaPickerButton } from '@/src/components/admin/MediaPicker';

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
  { value: 'hero',          label: 'Hero',            icon: '🎯', desc: 'Large banner with headline, subtitle, and CTAs' },
  { value: 'text',          label: 'Text',            icon: '📝', desc: 'Simple heading + body text' },
  { value: 'rich_text',     label: 'Rich Text',       icon: '📄', desc: 'HTML content with badge + heading' },
  { value: 'image',         label: 'Image',           icon: '🖼️', desc: 'Single image with caption' },
  { value: 'text_image',    label: 'Text + Image',    icon: '📰', desc: 'Side-by-side text and image' },
  { value: 'columns',       label: 'Columns',         icon: '▤',  desc: '2-4 column grid layout' },
  { value: 'cards',         label: 'Cards',           icon: '🃏', desc: 'Grid of icon + title + description cards' },
  { value: 'cta',           label: 'Call to Action',   icon: '📢', desc: 'Colored banner with buttons' },
  { value: 'faq',           label: 'FAQ',             icon: '❓', desc: 'Accordion Q&A section' },
  { value: 'stats',         label: 'Stats Bar',       icon: '📊', desc: 'Horizontal stats with values + labels' },
  { value: 'list',          label: 'List',            icon: '📋', desc: 'Vertical or horizontal item list' },
  { value: 'testimonials',  label: 'Testimonials',    icon: '💬', desc: 'Customer testimonial cards with photo + quote' },
  { value: 'pricing_table', label: 'Pricing Table',   icon: '💰', desc: 'Pricing tiers with features and CTA' },
  { value: 'video',         label: 'Video',           icon: '🎬', desc: 'Embedded YouTube/Vimeo video' },
  { value: 'banner',        label: 'Banner',          icon: '🔔', desc: 'Thin announcement bar with optional link' },
  { value: 'spacer',        label: 'Spacer',          icon: '↕️', desc: 'Adjustable whitespace between sections' },
  { value: 'embed',         label: 'Embed',           icon: '🧩', desc: 'Raw HTML/iframe embed (forms, maps, widgets)' },
  { value: 'team',          label: 'Team',            icon: '👥', desc: 'Team member grid with photo, name, role, bio' },
  { value: 'timeline',      label: 'Timeline',        icon: '📅', desc: 'Vertical timeline with dates and descriptions' },
  { value: 'logo_grid',     label: 'Logo Grid',       icon: '🏢', desc: 'Client/partner logo grid' },
  { value: 'countdown',     label: 'Countdown',       icon: '⏱️', desc: 'Countdown timer to a date with CTA' },
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
  stats:         { items: [{ value: '100+', label: 'Users' }, { value: '50+', label: 'Courses' }] },
  list:          { heading: 'Features', layout: 'vertical', items: [{ icon: '✓', title: 'Feature 1', description: 'Description' }] },
  testimonials:  { heading: 'What Our Students Say', badge: 'Testimonials', items: [{ photo: '', name: 'Jane Doe', role: 'Financial Analyst', quote: 'This platform transformed my modeling skills.' }] },
  pricing_table: { heading: 'Choose Your Plan', badge: 'Pricing', tiers: [{ name: 'Free', price: '$0', period: 'forever', description: 'Get started', features: ['Basic access', 'Community support'], cta_text: 'Start Free', cta_url: '/register', highlighted: false }, { name: 'Pro', price: '$49', period: 'month', description: 'For professionals', features: ['Full access', 'Priority support', 'Export tools'], cta_text: 'Go Pro', cta_url: '/pricing', highlighted: true }] },
  video:         { url: '', caption: '' },
  banner:        { text: 'New feature available!', url: '' },
  spacer:        { height: '60px' },
  embed:         { heading: '', html: '' },
  team:          { heading: 'Our Team', badge: 'Team', members: [{ photo: '', name: 'Team Member', role: 'Role', bio: 'Short bio here.' }] },
  timeline:      { heading: 'Our Journey', badge: 'Timeline', items: [{ date: '2024', title: 'Founded', description: 'Started building the platform.' }] },
  logo_grid:     { heading: 'Trusted By', badge: 'Partners', logos: [{ src: '', alt: 'Logo', url: '' }], logoHeight: '48px' },
  countdown:     { heading: 'Launching Soon', subtitle: 'Something big is coming.', targetDate: '', ctaText: 'Get Notified', ctaUrl: '/register', expiredText: 'This event has passed.' },
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
      <label style={{ ...LS, marginTop: 10 }}>Content</label>
      <RichTextEditor value={(content.html as string) ?? ''} onChange={v => set('html', v)} />
    </>
  );
}

function ImageEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Image URL</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={{ ...IS, flex: 1 }} value={(content.src as string) ?? ''} onChange={e => set('src', e.target.value)} placeholder="https://..." />
        <MediaPickerButton onSelect={url => set('src', url)} />
      </div>
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
      <label style={{ ...LS, marginTop: 10 }}>Content</label>
      <RichTextEditor value={(content.html as string) ?? ''} onChange={v => set('html', v)} compact />
      <label style={{ ...LS, marginTop: 10 }}>Image URL</label>
      <div style={{ display: 'flex', gap: 6 }}>
        <input style={{ ...IS, flex: 1 }} value={(content.imageSrc as string) ?? ''} onChange={e => set('imageSrc', e.target.value)} />
        <MediaPickerButton onSelect={url => set('imageSrc', url)} />
      </div>
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

function TestimonialsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.items as { photo: string; name: string; role: string; quote: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setItems = (next: typeof items) => onChange({ ...content, items: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={LS}>Badge</label><input style={{ ...IS, marginBottom: 10 }} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      {items.map((t, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1 }}><label style={LS}>Name</label><input style={IS} value={t.name} onChange={e => { const n = [...items]; n[i] = { ...n[i], name: e.target.value }; setItems(n); }} /></div>
            <div style={{ flex: 1 }}><label style={LS}>Role</label><input style={IS} value={t.role} onChange={e => { const n = [...items]; n[i] = { ...n[i], role: e.target.value }; setItems(n); }} /></div>
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, alignSelf: 'end' }}>X</button>
          </div>
          <label style={LS}>Photo URL</label><input style={{ ...IS, marginBottom: 6 }} value={t.photo} onChange={e => { const n = [...items]; n[i] = { ...n[i], photo: e.target.value }; setItems(n); }} placeholder="https://..." />
          <label style={LS}>Quote</label><textarea style={{ ...TA, minHeight: 50 }} value={t.quote} onChange={e => { const n = [...items]; n[i] = { ...n[i], quote: e.target.value }; setItems(n); }} />
        </div>
      ))}
      <button onClick={() => setItems([...items, { photo: '', name: 'Name', role: 'Role', quote: 'Quote' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Testimonial</button>
    </>
  );
}

function PricingTableEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const tiers = (content.tiers as { name: string; price: string; period: string; description: string; features: string[]; cta_text: string; cta_url: string; highlighted: boolean }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setTiers = (next: typeof tiers) => onChange({ ...content, tiers: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={LS}>Badge</label><input style={{ ...IS, marginBottom: 10 }} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      {tiers.map((tier, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: tier.highlighted ? '2px solid #2EAA4A' : '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'end' }}>
            <div style={{ flex: 1 }}><label style={LS}>Plan Name</label><input style={IS} value={tier.name} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], name: e.target.value }; setTiers(n); }} /></div>
            <div style={{ width: 80 }}><label style={LS}>Price</label><input style={IS} value={tier.price} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], price: e.target.value }; setTiers(n); }} /></div>
            <div style={{ width: 70 }}><label style={LS}>Period</label><input style={IS} value={tier.period} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], period: e.target.value }; setTiers(n); }} placeholder="month" /></div>
            <label style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={tier.highlighted} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], highlighted: e.target.checked }; setTiers(n); }} /> Popular
            </label>
            <button onClick={() => setTiers(tiers.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11 }}>X</button>
          </div>
          <label style={LS}>Description</label><input style={{ ...IS, marginBottom: 6 }} value={tier.description} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], description: e.target.value }; setTiers(n); }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
            <div><label style={LS}>CTA Text</label><input style={IS} value={tier.cta_text} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], cta_text: e.target.value }; setTiers(n); }} /></div>
            <div><label style={LS}>CTA URL</label><input style={IS} value={tier.cta_url} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], cta_url: e.target.value }; setTiers(n); }} /></div>
          </div>
          <label style={LS}>Features (one per line)</label>
          <textarea style={{ ...TA, minHeight: 60 }} value={tier.features.join('\n')} onChange={e => { const n = [...tiers]; n[i] = { ...n[i], features: e.target.value.split('\n') }; setTiers(n); }} />
        </div>
      ))}
      <button onClick={() => setTiers([...tiers, { name: 'Plan', price: '$0', period: 'month', description: '', features: ['Feature 1'], cta_text: 'Get Started', cta_url: '/', highlighted: false }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Tier</button>
    </>
  );
}

function VideoEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>YouTube or Vimeo URL</label><input style={IS} value={(content.url as string) ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://youtube.com/watch?v=..." />
      <label style={{ ...LS, marginTop: 10 }}>Caption</label><input style={IS} value={(content.caption as string) ?? ''} onChange={e => set('caption', e.target.value)} />
    </>
  );
}

function BannerEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Banner Text</label><input style={IS} value={(content.text as string) ?? ''} onChange={e => set('text', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Link URL (optional)</label><input style={IS} value={(content.url as string) ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://..." />
    </>
  );
}

function SpacerEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Height</label><input style={IS} value={(content.height as string) ?? '60px'} onChange={e => set('height', e.target.value)} placeholder="60px" />
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Use px, rem, or vh units (e.g. 80px, 5rem, 10vh)</div>
    </>
  );
}

function EmbedEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Heading (optional)</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>HTML / Iframe Code</label>
      <textarea style={{ ...TA, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} value={(content.html as string) ?? ''} onChange={e => set('html', e.target.value)} placeholder='<iframe src="..."></iframe>' />
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Paste embed code for Google Maps, forms, calendars, etc.</div>
    </>
  );
}

function TeamEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const members = (content.members as { photo: string; name: string; role: string; bio: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setMembers = (next: typeof members) => onChange({ ...content, members: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={LS}>Badge</label><input style={{ ...IS, marginBottom: 10 }} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      {members.map((m, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'end' }}>
            <div style={{ flex: 1 }}><label style={LS}>Name</label><input style={IS} value={m.name} onChange={e => { const n = [...members]; n[i] = { ...n[i], name: e.target.value }; setMembers(n); }} /></div>
            <div style={{ flex: 1 }}><label style={LS}>Role</label><input style={IS} value={m.role} onChange={e => { const n = [...members]; n[i] = { ...n[i], role: e.target.value }; setMembers(n); }} /></div>
            <button onClick={() => setMembers(members.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11 }}>X</button>
          </div>
          <label style={LS}>Photo URL</label><input style={{ ...IS, marginBottom: 6 }} value={m.photo} onChange={e => { const n = [...members]; n[i] = { ...n[i], photo: e.target.value }; setMembers(n); }} placeholder="https://..." />
          <label style={LS}>Bio</label><textarea style={{ ...TA, minHeight: 40 }} value={m.bio} onChange={e => { const n = [...members]; n[i] = { ...n[i], bio: e.target.value }; setMembers(n); }} />
        </div>
      ))}
      <button onClick={() => setMembers([...members, { photo: '', name: 'Name', role: 'Role', bio: 'Bio' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Member</button>
    </>
  );
}

function TimelineEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.items as { date: string; title: string; description: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setItems = (next: typeof items) => onChange({ ...content, items: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={LS}>Badge</label><input style={{ ...IS, marginBottom: 10 }} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <div style={{ width: 90 }}><label style={LS}>Date</label><input style={IS} value={item.date} onChange={e => { const n = [...items]; n[i] = { ...n[i], date: e.target.value }; setItems(n); }} /></div>
          <div style={{ flex: 1 }}><label style={LS}>Title</label><input style={IS} value={item.title} onChange={e => { const n = [...items]; n[i] = { ...n[i], title: e.target.value }; setItems(n); }} /></div>
          <div style={{ flex: 2 }}><label style={LS}>Description</label><input style={IS} value={item.description} onChange={e => { const n = [...items]; n[i] = { ...n[i], description: e.target.value }; setItems(n); }} /></div>
          <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>X</button>
        </div>
      ))}
      <button onClick={() => setItems([...items, { date: '2024', title: 'Event', description: 'Description' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Event</button>
    </>
  );
}

function LogoGridEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const logos = (content.logos as { src: string; alt: string; url: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setLogos = (next: typeof logos) => onChange({ ...content, logos: next });
  return (
    <>
      <label style={LS}>Section Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={LS}>Badge</label><input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      <label style={{ ...LS, marginTop: 6 }}>Logo Height</label><input style={{ ...IS, marginBottom: 10 }} value={(content.logoHeight as string) ?? '48px'} onChange={e => set('logoHeight', e.target.value)} placeholder="48px" />
      {logos.map((logo, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end' }}>
          <div style={{ flex: 2 }}><label style={LS}>Image URL</label><input style={IS} value={logo.src} onChange={e => { const n = [...logos]; n[i] = { ...n[i], src: e.target.value }; setLogos(n); }} placeholder="https://..." /></div>
          <div style={{ flex: 1 }}><label style={LS}>Alt</label><input style={IS} value={logo.alt} onChange={e => { const n = [...logos]; n[i] = { ...n[i], alt: e.target.value }; setLogos(n); }} /></div>
          <div style={{ flex: 1 }}><label style={LS}>Link URL</label><input style={IS} value={logo.url} onChange={e => { const n = [...logos]; n[i] = { ...n[i], url: e.target.value }; setLogos(n); }} /></div>
          <button onClick={() => setLogos(logos.filter((_, j) => j !== i))} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>X</button>
        </div>
      ))}
      <button onClick={() => setLogos([...logos, { src: '', alt: 'Logo', url: '' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Logo</button>
    </>
  );
}

function CountdownEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <label style={LS}>Heading</label><input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Subtitle</label><textarea style={TA} value={(content.subtitle as string) ?? ''} onChange={e => set('subtitle', e.target.value)} />
      <label style={{ ...LS, marginTop: 10 }}>Target Date & Time</label><input style={IS} type="datetime-local" value={(content.targetDate as string) ?? ''} onChange={e => set('targetDate', e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <div><label style={LS}>CTA Text</label><input style={IS} value={(content.ctaText as string) ?? ''} onChange={e => set('ctaText', e.target.value)} /></div>
        <div><label style={LS}>CTA URL</label><input style={IS} value={(content.ctaUrl as string) ?? ''} onChange={e => set('ctaUrl', e.target.value)} /></div>
      </div>
      <label style={{ ...LS, marginTop: 10 }}>Expired Text</label><input style={IS} value={(content.expiredText as string) ?? ''} onChange={e => set('expiredText', e.target.value)} placeholder="This event has passed." />
    </>
  );
}

const EDITORS: Record<string, React.ComponentType<{ content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }>> = {
  hero: HeroEditor, text: TextEditor, rich_text: RichTextEditor2, image: ImageEditor,
  text_image: TextImageEditor, cta: CtaEditor, stats: StatsEditor, cards: CardsEditor,
  columns: ColumnsEditor, faq: FaqEditor, list: ListEditor,
  testimonials: TestimonialsEditor, pricing_table: PricingTableEditor, video: VideoEditor,
  banner: BannerEditor, spacer: SpacerEditor, embed: EmbedEditor, team: TeamEditor,
  timeline: TimelineEditor, logo_grid: LogoGridEditor, countdown: CountdownEditor,
};

// ── Style editor (shared across all section types) ───────────────────────────

function StyleEditor({ styles, onChange }: { styles: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...styles, [k]: v });
  const colorInput = (label: string, key: string, placeholder: string, defaultVal: string) => (
    <div>
      <label style={LS}>{label}</label>
      <div style={{ display: 'flex', gap: 4 }}>
        <input type="color" value={(styles[key] as string) ?? defaultVal} onChange={e => set(key, e.target.value)} style={{ width: 28, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
        <input style={IS} value={(styles[key] as string) ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder} />
      </div>
    </div>
  );
  return (
    <div style={{ marginTop: 12, padding: 10, background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Style Overrides</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {/* Background */}
        {colorInput('Background', 'bgColor', '#ffffff or gradient', '#ffffff')}
        {colorInput('Text Color', 'textColor', '#374151', '#374151')}

        {/* Background extras */}
        <div>
          <label style={LS}>BG Type</label>
          <select style={IS} value={(styles.bgType as string) ?? 'solid'} onChange={e => set('bgType', e.target.value)}>
            <option value="solid">Solid Color</option><option value="gradient">Gradient</option><option value="image">Image</option>
          </select>
        </div>
        {(styles.bgType === 'gradient') && (
          <>
            {colorInput('Gradient End', 'bgColor2', '#0D2E5A', '#0D2E5A')}
            <div><label style={LS}>Direction</label>
              <select style={IS} value={(styles.bgDirection as string) ?? '135deg'} onChange={e => set('bgDirection', e.target.value)}>
                <option value="135deg">Diagonal (135)</option><option value="180deg">Top to Bottom</option><option value="90deg">Left to Right</option><option value="0deg">Bottom to Top</option><option value="270deg">Right to Left</option>
              </select>
            </div>
          </>
        )}
        {(styles.bgType === 'image') && (
          <>
            <div style={{ gridColumn: '1 / -1' }}><label style={LS}>Background Image URL</label><input style={IS} value={(styles.bgImage as string) ?? ''} onChange={e => set('bgImage', e.target.value)} placeholder="https://..." /></div>
            <div><label style={LS}>Overlay Opacity (0-1)</label><input style={IS} type="number" min="0" max="1" step="0.1" value={(styles.bgOverlay as string) ?? '0.5'} onChange={e => set('bgOverlay', e.target.value)} /></div>
          </>
        )}

        {/* Padding */}
        <div><label style={LS}>Padding Top</label><input style={IS} value={(styles.paddingTop as string) ?? ''} onChange={e => set('paddingTop', e.target.value)} placeholder="48px" /></div>
        <div><label style={LS}>Padding Bottom</label><input style={IS} value={(styles.paddingBottom as string) ?? ''} onChange={e => set('paddingBottom', e.target.value)} placeholder="48px" /></div>
        <div><label style={LS}>Padding Left</label><input style={IS} value={(styles.paddingLeft as string) ?? ''} onChange={e => set('paddingLeft', e.target.value)} placeholder="40px" /></div>
        <div><label style={LS}>Padding Right</label><input style={IS} value={(styles.paddingRight as string) ?? ''} onChange={e => set('paddingRight', e.target.value)} placeholder="40px" /></div>

        {/* Layout */}
        <div><label style={LS}>Max Width</label>
          <select style={IS} value={(styles.maxWidth as string) ?? ''} onChange={e => set('maxWidth', e.target.value)}>
            <option value="">Default</option><option value="100%">Full</option><option value="1200px">Wide (1200)</option><option value="1000px">Normal (1000)</option><option value="700px">Narrow (700)</option>
          </select>
        </div>
        <div><label style={LS}>Text Align</label>
          <select style={IS} value={(styles.textAlign as string) ?? ''} onChange={e => set('textAlign', e.target.value)}>
            <option value="">Default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </div>

        {/* Border Radius */}
        <div><label style={LS}>Border Radius</label><input style={IS} value={(styles.borderRadius as string) ?? ''} onChange={e => set('borderRadius', e.target.value)} placeholder="0px" /></div>

        {/* Animation */}
        <div><label style={LS}>Animation</label>
          <select style={IS} value={(styles.animation as string) ?? 'none'} onChange={e => set('animation', e.target.value)}>
            <option value="none">None</option><option value="fade-in">Fade In</option><option value="slide-up">Slide Up</option>
          </select>
        </div>

        {/* Custom CSS class */}
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={LS}>Custom CSS Class</label>
          <input style={IS} value={(styles.customClass as string) ?? ''} onChange={e => set('customClass', e.target.value)} placeholder="my-custom-section" />
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

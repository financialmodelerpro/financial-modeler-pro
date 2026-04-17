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

// ── Visibility-aware field wrapper ───────────────────────────────────────────

const VCS: React.CSSProperties = { width: 14, height: 14, cursor: 'pointer', accentColor: '#1B4F8A', margin: 0, flexShrink: 0 };
const WIDTH_OPTIONS = ['100%', '80%', '70%', '60%', '50%', 'auto'] as const;
const ALIGN_OPTIONS = ['left', 'center', 'right', 'justify'] as const;
const MINI_SELECT: React.CSSProperties = { padding: '2px 4px', fontSize: 10, borderRadius: 4, border: '1px solid #D1D5DB', background: '#F9FAFB', cursor: 'pointer', outline: 'none' };

function VF({ label, fieldKey, content, onChange, children, showLayout }: {
  label: string; fieldKey: string; content: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void; children: React.ReactNode; showLayout?: boolean;
}) {
  const visKey = `${fieldKey}_visible`;
  const wKey = `${fieldKey}_width`;
  const aKey = `${fieldKey}_align`;
  const visible = content[visKey] !== false;
  return (
    <div style={{ marginTop: 8, opacity: visible ? 1 : 0.4, transition: 'opacity 0.15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        <label style={{ ...LS, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none', margin: 0, flex: 1 }}>
          <input type="checkbox" style={VCS} checked={visible} onChange={e => onChange({ ...content, [visKey]: e.target.checked })} />
          {label}
        </label>
        {showLayout && (
          <>
            <select style={MINI_SELECT} value={(content[wKey] as string) ?? '100%'} onChange={e => onChange({ ...content, [wKey]: e.target.value })} title="Width">
              {WIDTH_OPTIONS.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
            <select style={MINI_SELECT} value={(content[aKey] as string) ?? 'center'} onChange={e => onChange({ ...content, [aKey]: e.target.value })} title="Align">
              {ALIGN_OPTIONS.map(a => <option key={a} value={a}>{a.charAt(0).toUpperCase() + a.slice(1)}</option>)}
            </select>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Section content editors ──────────────────────────────────────────────────

interface HeroCustomField { id: string; label: string; value: string; visible: boolean; insertAfter: string }
const HERO_POSITIONS = [
  { value: 'top', label: 'Top (before badge)' },
  { value: 'badge', label: 'After Badge' },
  { value: 'headline', label: 'After Headline' },
  { value: 'subtitle', label: 'After Subtitle' },
  { value: 'powerStatement', label: 'After Power Statement' },
  { value: 'softCta', label: 'After Soft CTA' },
  { value: 'trustLine', label: 'After Trust Line' },
  { value: 'tags', label: 'After Tags' },
  { value: 'end', label: 'End (after everything)' },
];

function HeroEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...content, [k]: v });
  const customFields = ((content.customFields as HeroCustomField[]) ?? []).map(f => ({ ...f, id: f.id || `field_${Math.random().toString(36).slice(2, 9)}` }));
  const setFields = (next: HeroCustomField[]) => onChange({ ...content, customFields: next });
  const handleCFDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const items = Array.from(customFields);
    const [removed] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, removed);
    setFields(items);
  };
  const align = (content.textAlign as string) ?? 'center';
  return (
    <>
      {/* Text alignment */}
      <div style={{ marginBottom: 10 }}>
        <label style={LS}>Content Alignment</label>
        <div style={{ display: 'flex', gap: 0 }}>
          {(['left', 'center', 'right'] as const).map(a => (
            <button key={a} onClick={() => set('textAlign', a)} style={{
              flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: align === a ? '#1B4F8A' : '#F9FAFB', color: align === a ? '#fff' : '#374151',
              border: '1px solid #D1D5DB', borderRadius: a === 'left' ? '6px 0 0 6px' : a === 'right' ? '0 6px 6px 0' : 0,
              textTransform: 'capitalize',
            }}>{a}</button>
          ))}
        </div>
      </div>

      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange} showLayout>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} placeholder="e.g. Free Certification" />
      </VF>
      <VF label="Headline" fieldKey="headline" content={content} onChange={onChange} showLayout>
        <input style={IS} value={(content.headline as string) ?? ''} onChange={e => set('headline', e.target.value)} />
      </VF>
      <VF label="Subtitle" fieldKey="subtitle" content={content} onChange={onChange} showLayout>
        <textarea style={TA} value={(content.subtitle as string) ?? ''} onChange={e => set('subtitle', e.target.value)} />
      </VF>
      <VF label="Power Statement" fieldKey="powerStatement" content={content} onChange={onChange} showLayout>
        <textarea style={{ ...TA, minHeight: 50 }} value={(content.powerStatement as string) ?? ''} onChange={e => set('powerStatement', e.target.value)} placeholder="Highlighted blockquote line" />
      </VF>
      <VF label="Soft CTA" fieldKey="softCta" content={content} onChange={onChange} showLayout>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={LS}>Text</label><input style={IS} value={(content.softCta as string) ?? ''} onChange={e => set('softCta', e.target.value)} placeholder="Explore the platform" /></div>
          <div><label style={LS}>URL</label><input style={IS} value={(content.softCtaUrl as string) ?? ''} onChange={e => set('softCtaUrl', e.target.value)} placeholder="#stats-bar" /></div>
        </div>
      </VF>
      <VF label="Trust Line" fieldKey="trustLine" content={content} onChange={onChange} showLayout>
        <input style={IS} value={(content.trustLine as string) ?? ''} onChange={e => set('trustLine', e.target.value)} placeholder="Designed by Investment & Corporate Finance Experts..." />
      </VF>
      <VF label="Tags" fieldKey="tags" content={content} onChange={onChange} showLayout>
        <input style={IS} value={(content.tags as string) ?? ''} onChange={e => set('tags', e.target.value)} placeholder="Real Estate Models, Business Valuation, ..." />
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>Separate tags with commas</div>
      </VF>
      <VF label="CTA 1" fieldKey="cta1" content={content} onChange={onChange} showLayout>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={LS}>Text</label><input style={IS} value={(content.cta1Text as string) ?? ''} onChange={e => set('cta1Text', e.target.value)} /></div>
          <div><label style={LS}>URL</label><input style={IS} value={(content.cta1Url as string) ?? ''} onChange={e => set('cta1Url', e.target.value)} /></div>
        </div>
      </VF>
      <VF label="CTA 2" fieldKey="cta2" content={content} onChange={onChange} showLayout>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={LS}>Text</label><input style={IS} value={(content.cta2Text as string) ?? ''} onChange={e => set('cta2Text', e.target.value)} /></div>
          <div><label style={LS}>URL</label><input style={IS} value={(content.cta2Url as string) ?? ''} onChange={e => set('cta2Url', e.target.value)} /></div>
        </div>
      </VF>

      {/* Additional custom fields */}
      <div style={{ marginTop: 14, padding: 10, background: '#F0F4FF', borderRadius: 8, border: '1px solid #C7D2FE' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Additional Fields</div>
        <DragDropContext onDragEnd={handleCFDragEnd}>
          <Droppable droppableId="hero-custom-fields">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {customFields.map((field, i) => (
                  <Draggable key={field.id} draggableId={field.id} index={i}>
                    {(prov) => (
                      <div ref={prov.innerRef} {...prov.draggableProps} style={{ display:'flex', gap:6, marginBottom:6, alignItems:'end', background:'#fff', borderRadius:6, padding:'6px 4px', border:'1px solid #E5E7EB', ...prov.draggableProps.style }}>
                        <span {...prov.dragHandleProps} style={{ cursor:'grab', color:'#9CA3AF', fontSize:16, flexShrink:0, padding:'0 2px', alignSelf:'center' }}>⠿</span>
                        <input type="checkbox" style={VCS} checked={field.visible !== false} onChange={e => { const n = [...customFields]; n[i] = { ...n[i], visible: e.target.checked }; setFields(n); }} />
                        <div style={{ flex: 1 }}><label style={LS}>Label</label><input style={IS} value={field.label} onChange={e => { const n = [...customFields]; n[i] = { ...n[i], label: e.target.value }; setFields(n); }} /></div>
                        <div style={{ flex: 2 }}><label style={LS}>Value</label><input style={IS} value={field.value} onChange={e => { const n = [...customFields]; n[i] = { ...n[i], value: e.target.value }; setFields(n); }} /></div>
                        <div style={{ width: 120, flexShrink: 0 }}>
                          <label style={LS}>Position</label>
                          <select style={{ ...IS, fontSize: 11 }} value={field.insertAfter || 'end'} onChange={e => { const n = [...customFields]; n[i] = { ...n[i], insertAfter: e.target.value }; setFields(n); }}>
                            {HERO_POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                          </select>
                        </div>
                        <button onClick={() => setFields(customFields.filter((_, j) => j !== i))} style={{ padding:'7px 10px', borderRadius:6, border:'1px solid #FECACA', background:'#FEF2F2', color:'#DC2626', cursor:'pointer', fontSize:12, flexShrink:0 }}>X</button>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        <button onClick={() => setFields([...customFields, { id: `field_${Date.now()}`, label: '', value: '', visible: true, insertAfter: 'end' }])} style={{ padding:'5px 12px', borderRadius:6, border:'1px solid #C7D2FE', background:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, color:'#4F46E5', marginTop: 6 }}>+ Add Field</button>
      </div>
    </>
  );
}

function TextEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <VF label="Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Body" fieldKey="body" content={content} onChange={onChange}>
        <textarea style={{ ...TA, minHeight: 100 }} value={(content.body as string) ?? ''} onChange={e => set('body', e.target.value)} />
      </VF>
    </>
  );
}

function RichTextEditor2({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
      <VF label="Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Content" fieldKey="html" content={content} onChange={onChange}>
        <RichTextEditor value={(content.html as string) ?? ''} onChange={v => set('html', v)} />
      </VF>
    </>
  );
}

function ImageEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <VF label="Image" fieldKey="src" content={content} onChange={onChange}>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...IS, flex: 1 }} value={(content.src as string) ?? ''} onChange={e => set('src', e.target.value)} placeholder="https://..." />
          <MediaPickerButton onSelect={url => set('src', url)} />
        </div>
        <label style={{ ...LS, marginTop: 6 }}>Alt Text</label><input style={IS} value={(content.alt as string) ?? ''} onChange={e => set('alt', e.target.value)} />
      </VF>
      <VF label="Caption" fieldKey="caption" content={content} onChange={onChange}>
        <input style={IS} value={(content.caption as string) ?? ''} onChange={e => set('caption', e.target.value)} />
      </VF>
    </>
  );
}

function TextImageEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const imgSrc = (content.imageSrc as string) ?? '';
  const bgImg = (content.bgImageUrl as string) ?? '';
  const hasBg = !!bgImg;
  const OVERLAY_OPTIONS = [
    { label: '0%', value: 'rgba(15,35,70,0)' },
    { label: '25%', value: 'rgba(15,35,70,0.25)' },
    { label: '50%', value: 'rgba(15,35,70,0.50)' },
    { label: '60%', value: 'rgba(15,35,70,0.60)' },
    { label: '75%', value: 'rgba(15,35,70,0.75)' },
    { label: '85%', value: 'rgba(15,35,70,0.85)' },
  ];
  return (
    <>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} placeholder="e.g. OUR MISSION" />
      </VF>
      <VF label="Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Body" fieldKey="body" content={content} onChange={onChange}>
        <textarea style={{ ...TA, minHeight: 100 }} value={(content.body as string) ?? ''} onChange={e => set('body', e.target.value)} />
      </VF>
      {/* Audience cards (used by modeling hub "What is" section) */}
      {Array.isArray(content.audience) && (() => {
        const audience = content.audience as { icon: string; role: string; desc: string }[];
        const setAudience = (next: typeof audience) => onChange({ ...content, audience: next });
        return (
          <div style={{ marginTop: 10, padding: 10, background: '#EFF6FF', borderRadius: 8, border: '1px solid #BFDBFE' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Audience Cards</div>
            {audience.map((a, i) => (
              <div key={i} style={{ background: '#fff', borderRadius: 8, padding: 8, marginBottom: 6, border: '1px solid #E5E7EB' }}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 50 }}><label style={LS}>Icon</label><input style={IS} value={a.icon} onChange={e => { const n = [...audience]; n[i] = { ...n[i], icon: e.target.value }; setAudience(n); }} /></div>
                  <div style={{ flex: 1 }}><label style={LS}>Title</label><input style={IS} value={a.role} onChange={e => { const n = [...audience]; n[i] = { ...n[i], role: e.target.value }; setAudience(n); }} /></div>
                  <button onClick={() => setAudience(audience.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, alignSelf: 'end' }}>X</button>
                </div>
                <label style={LS}>Description</label><input style={IS} value={a.desc} onChange={e => { const n = [...audience]; n[i] = { ...n[i], desc: e.target.value }; setAudience(n); }} />
              </div>
            ))}
            <button onClick={() => setAudience([...audience, { icon: '📌', role: 'New Audience', desc: 'Description' }])} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #BFDBFE', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#1D4ED8' }}>+ Add Audience Card</button>
          </div>
        );
      })()}

      {/* Background image */}
      <div style={{ marginTop: 10, padding: 10, background: '#EFF6FF', borderRadius: 8, border: '1px solid #BFDBFE' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#1D4ED8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Background Image <span style={{ fontWeight: 400, textTransform: 'none', color: '#6B7280' }}>(covers full section)</span></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...IS, flex: 1 }} value={bgImg} onChange={e => set('bgImageUrl', e.target.value)} placeholder="https://... or upload →" />
          <MediaPickerButton onSelect={url => set('bgImageUrl', url)} />
        </div>
        {bgImg && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bgImg} alt="" style={{ marginTop: 6, maxWidth: 200, maxHeight: 80, borderRadius: 6, objectFit: 'cover', border: '1px solid #E5E7EB' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label style={LS}>Overlay Opacity</label>
                <select style={IS} value={(content.bgOverlay as string) || 'rgba(15,35,70,0.75)'} onChange={e => set('bgOverlay', e.target.value)}>
                  {OVERLAY_OPTIONS.map(o => <option key={o.label} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <button onClick={() => { onChange({ ...content, bgImageUrl: '', bgOverlay: '', bgImagePaddingTop: '', bgImagePaddingBottom: '', bgImagePaddingLeft: '', bgImagePaddingRight: '', bgImageRadius: '', bgImagePosition: '' }); }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>✕ Remove</button>
            </div>
            {/* Padding + position */}
            {(() => {
              const PAD_OPTS = ['0px','8px','16px','24px','32px','40px','48px','64px','80px'];
              const POS_OPTS = ['center','top','bottom','left','right','top left','top right','bottom left','bottom right'];
              return (
                <div style={{ marginTop: 8 }}>
                  <label style={LS}>Image Padding (from edges)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div><label style={{ ...LS, fontSize: 10 }}>Top</label><select style={IS} value={(content.bgImagePaddingTop as string) || '0px'} onChange={e => set('bgImagePaddingTop', e.target.value)}>{PAD_OPTS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div><label style={{ ...LS, fontSize: 10 }}>Bottom</label><select style={IS} value={(content.bgImagePaddingBottom as string) || '0px'} onChange={e => set('bgImagePaddingBottom', e.target.value)}>{PAD_OPTS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div><label style={{ ...LS, fontSize: 10 }}>Left</label><select style={IS} value={(content.bgImagePaddingLeft as string) || '0px'} onChange={e => set('bgImagePaddingLeft', e.target.value)}>{PAD_OPTS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                    <div><label style={{ ...LS, fontSize: 10 }}>Right</label><select style={IS} value={(content.bgImagePaddingRight as string) || '0px'} onChange={e => set('bgImagePaddingRight', e.target.value)}>{PAD_OPTS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                    <div><label style={LS}>Image Radius</label><input style={IS} value={(content.bgImageRadius as string) || '0px'} onChange={e => set('bgImageRadius', e.target.value)} placeholder="0px" /></div>
                    <div><label style={LS}>Image Position</label><select style={IS} value={(content.bgImagePosition as string) || 'center'} onChange={e => set('bgImagePosition', e.target.value)}>{POS_OPTS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}</select></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                    <div>
                      <label style={LS}>Image Fit</label>
                      <select style={IS} value={(content.bgImageFit as string) || 'contain'} onChange={e => set('bgImageFit', e.target.value)}>
                        <option value="contain">Contain (full image)</option>
                        <option value="cover">Cover (may crop)</option>
                        <option value="fill">Fill (stretch)</option>
                        <option value="none">Auto (natural size)</option>
                      </select>
                    </div>
                    <div>
                      <label style={LS}>BG Color (behind image)</label>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input type="color" value={(content.bgColor as string) || '#0D2E5A'} onChange={e => set('bgColor', e.target.value)} style={{ width: 28, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
                        <input style={IS} value={(content.bgColor as string) || ''} onChange={e => set('bgColor', e.target.value)} placeholder="#0D2E5A" />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* Side image - always visible */}
      <div style={{ marginTop: 10, padding: 10, background: '#F0FFF4', borderRadius: 8, border: '1px solid #BBF7D0' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#15803D', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Side Image <span style={{ fontWeight: 400, textTransform: 'none', color: '#6B7280' }}>(shown beside text content)</span></div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input style={{ ...IS, flex: 1 }} value={imgSrc} onChange={e => set('imageSrc', e.target.value)} placeholder="https://... or upload →" />
          <MediaPickerButton onSelect={url => set('imageSrc', url)} />
        </div>
        {imgSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imgSrc} alt="" style={{ marginTop: 6, maxWidth: 200, maxHeight: 120, borderRadius: 6, objectFit: 'cover', border: '1px solid #E5E7EB' }} />
        )}
        <label style={{ ...LS, marginTop: 6 }}>Alt Text</label><input style={IS} value={(content.imageAlt as string) ?? ''} onChange={e => set('imageAlt', e.target.value)} />
        <label style={{ ...LS, marginTop: 6 }}>Placeholder Text</label><input style={IS} value={(content.imagePlaceholder as string) ?? ''} onChange={e => set('imagePlaceholder', e.target.value)} placeholder="e.g. Platform Screenshot" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
          <div>
            <label style={LS}>Position</label>
            <select style={IS} value={(content.imagePosition as string) ?? 'right'} onChange={e => set('imagePosition', e.target.value)}>
              <option value="left">Left</option><option value="right">Right</option>
            </select>
          </div>
          <div>
            <label style={LS}>Width</label>
            <select style={IS} value={(content.imageWidth as string) ?? '45%'} onChange={e => set('imageWidth', e.target.value)}>
              <option value="100%">100%</option><option value="90%">90%</option><option value="80%">80%</option>
              <option value="70%">70%</option><option value="60%">60%</option><option value="50%">50%</option>
              <option value="45%">45%</option><option value="40%">40%</option>
            </select>
          </div>
          <div>
            <label style={LS}>Height</label>
            <select style={IS} value={(content.imageHeight as string) ?? 'auto'} onChange={e => set('imageHeight', e.target.value)}>
              <option value="auto">Auto</option><option value="200px">200px</option><option value="240px">240px</option>
              <option value="280px">280px</option><option value="320px">320px</option><option value="360px">360px</option>
              <option value="400px">400px</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
          <div>
            <label style={LS}>Object Fit</label>
            <select style={IS} value={(content.imageFit as string) ?? 'cover'} onChange={e => set('imageFit', e.target.value)}>
              <option value="cover">Cover</option><option value="contain">Contain</option><option value="fill">Fill</option>
            </select>
          </div>
          <div>
            <label style={LS}>Border Radius</label>
            <input style={IS} value={(content.imageRadius as string) ?? '12px'} onChange={e => set('imageRadius', e.target.value)} placeholder="12px" />
          </div>
        </div>
      </div>

      {/* Checklist items (shown when no image uploaded) */}
      {(() => {
        const items = Array.isArray(content.items) ? (content.items as string[]) : [];
        const setItems = (next: string[]) => onChange({ ...content, items: next });
        return (
          <div style={{ marginTop: 10, padding: 10, background: '#F0FFF4', borderRadius: 8, border: '1px solid #BBF7D0' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#15803D', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Checklist Items</div>
            <VF label="Checklist Heading" fieldKey="itemsHeading" content={content} onChange={onChange}>
              <input style={IS} value={(content.itemsHeading as string) ?? ''} onChange={e => set('itemsHeading', e.target.value)} placeholder="e.g. What You Get" />
            </VF>
            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <span style={{ color: '#9CA3AF', fontSize: 14, flexShrink: 0 }}>✓</span>
                <input style={{ ...IS, flex: 1 }} value={item} onChange={e => { const n = [...items]; n[i] = e.target.value; setItems(n); }} />
                <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '5px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>X</button>
              </div>
            ))}
            <button onClick={() => setItems([...items, 'New item'])} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #BBF7D0', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#15803D' }}>+ Add Item</button>
          </div>
        );
      })()}
    </>
  );
}

function CtaEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <VF label="Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Subtitle" fieldKey="subtitle" content={content} onChange={onChange}>
        <textarea style={TA} value={(content.subtitle as string) ?? ''} onChange={e => set('subtitle', e.target.value)} />
      </VF>
      <VF label="Button 1" fieldKey="buttonText" content={content} onChange={onChange}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={LS}>Text</label><input style={IS} value={(content.buttonText as string) ?? ''} onChange={e => set('buttonText', e.target.value)} /></div>
          <div><label style={LS}>URL</label><input style={IS} value={(content.buttonUrl as string) ?? ''} onChange={e => set('buttonUrl', e.target.value)} /></div>
        </div>
      </VF>
      <VF label="Button 2" fieldKey="button2Text" content={content} onChange={onChange}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={LS}>Text</label><input style={IS} value={(content.button2Text as string) ?? ''} onChange={e => set('button2Text', e.target.value)} /></div>
          <div><label style={LS}>URL</label><input style={IS} value={(content.button2Url as string) ?? ''} onChange={e => set('button2Url', e.target.value)} /></div>
        </div>
      </VF>
    </>
  );
}

function StatsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = ((content.items as { id?: string; value: string; label: string; visible?: boolean }[]) ?? []).map(it => ({ ...it, id: it.id || `stat_${Math.random().toString(36).slice(2, 9)}` }));
  const setItems = (next: typeof items) => onChange({ ...content, items: next });
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const arr = Array.from(items);
    const [removed] = arr.splice(result.source.index, 1);
    arr.splice(result.destination.index, 0, removed);
    setItems(arr);
  };
  return (
    <>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="stats-items">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              {items.map((item, i) => (
                <Draggable key={item.id} draggableId={item.id} index={i}>
                  {(prov) => (
                    <div ref={prov.innerRef} {...prov.draggableProps} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'end', background: '#fff', borderRadius: 6, padding: '6px 4px', border: '1px solid #E5E7EB', ...prov.draggableProps.style }}>
                      <span {...prov.dragHandleProps} style={{ cursor: 'grab', color: '#9CA3AF', fontSize: 16, flexShrink: 0, padding: '0 2px', alignSelf: 'center' }}>⠿</span>
                      <input type="checkbox" style={VCS} checked={item.visible !== false} onChange={e => { const n = [...items]; n[i] = { ...n[i], visible: e.target.checked }; setItems(n); }} />
                      <div style={{ flex: 1 }}><label style={LS}>Value</label><input style={IS} value={item.value} onChange={e => { const n = [...items]; n[i] = { ...n[i], value: e.target.value }; setItems(n); }} /></div>
                      <div style={{ flex: 2 }}><label style={LS}>Label</label><input style={IS} value={item.label} onChange={e => { const n = [...items]; n[i] = { ...n[i], label: e.target.value }; setItems(n); }} /></div>
                      <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>X</button>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      <button onClick={() => setItems([...items, { id: `stat_${Date.now()}`, value: '0', label: 'Label', visible: true }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Stat</button>
    </>
  );
}

function CardsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  // Smart detection: benefits[] (modeling why section), cards[] (generic)
  const isDynamic = !!(content as Record<string, unknown>)?._dynamic;
  const arrayKey = content.benefits ? 'benefits' : 'cards';
  const rawItems = (content[arrayKey] as { icon: string; title: string; desc?: string; description?: string }[]) ?? [];
  // Normalize: support both desc and description field names
  const cards = rawItems.map(c => ({ icon: c.icon ?? '', title: c.title ?? '', description: c.description ?? c.desc ?? '' }));
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setCards = (next: { icon: string; title: string; description: string }[]) => {
    // Write back using the original key; for benefits, store as {icon, title, desc}
    const stored = arrayKey === 'benefits'
      ? next.map(c => ({ icon: c.icon, title: c.title, desc: c.description }))
      : next;
    onChange({ ...content, [arrayKey]: stored });
  };
  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
      {content.description !== undefined && (
        <VF label="Description" fieldKey="description" content={content} onChange={onChange}>
          <textarea style={{ ...TA, minHeight: 40 }} value={(content.description as string) ?? ''} onChange={e => set('description', e.target.value)} />
        </VF>
      )}
      {isDynamic && (
        <div style={{ padding: 10, background: '#F0F4FF', borderRadius: 8, border: '1px solid #C7D2FE', marginBottom: 8, fontSize: 11, color: '#4F46E5', fontWeight: 600 }}>
          Content is auto-generated from database. Only headings are editable here.
        </div>
      )}
      {!isDynamic && cards.map((card, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <div style={{ width: 60 }}><label style={LS}>Icon</label><input style={IS} value={card.icon} onChange={e => { const n = [...cards]; n[i] = { ...n[i], icon: e.target.value }; setCards(n); }} /></div>
            <div style={{ flex: 1 }}><label style={LS}>Title</label><input style={IS} value={card.title} onChange={e => { const n = [...cards]; n[i] = { ...n[i], title: e.target.value }; setCards(n); }} /></div>
            <button onClick={() => setCards(cards.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, alignSelf: 'end' }}>X</button>
          </div>
          <label style={LS}>Description</label><textarea style={{ ...TA, minHeight: 40 }} value={card.description} onChange={e => { const n = [...cards]; n[i] = { ...n[i], description: e.target.value }; setCards(n); }} />
        </div>
      ))}
      {!isDynamic && (
        <button onClick={() => setCards([...cards, { icon: '⭐', title: 'New Card', description: 'Description' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Card</button>
      )}
    </>
  );
}

function ColumnsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const columns = (content.columns as { heading: string; html: string; icon: string }[]) ?? [];
  const set = (k: string, v: unknown) => onChange({ ...content, [k]: v });
  const setCols = (next: typeof columns) => onChange({ ...content, columns: next, count: next.length });
  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value as unknown)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value as unknown)} />
      </VF>
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

// ── Platform columns editor (Two Platforms section) ─────────────────────────

interface PlatformCol { id: string; title: string; description: string; borderColor: string; borderSideColor: string; accentColor: string; shadowColor: string; features: string[]; ctaText: string; ctaUrl: string; icon: string }

function TwoPlatformsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...content, [k]: v });
  const cols = (content.columns as PlatformCol[]) ?? [];
  const setCols = (next: PlatformCol[]) => onChange({ ...content, columns: next });
  const updateCol = (i: number, patch: Partial<PlatformCol>) => { const n = [...cols]; n[i] = { ...n[i], ...patch }; setCols(n); };

  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Subheading" fieldKey="subheading" content={content} onChange={onChange}>
        <input style={IS} value={(content.subheading as string) ?? ''} onChange={e => set('subheading', e.target.value)} />
      </VF>

      {cols.map((col, ci) => {
        const features = col.features ?? [];
        const setFeatures = (next: string[]) => updateCol(ci, { features: next });
        const handleFeatureDrag = (result: DropResult) => {
          if (!result.destination) return;
          const arr = Array.from(features);
          const [removed] = arr.splice(result.source.index, 1);
          arr.splice(result.destination.index, 0, removed);
          setFeatures(arr);
        };
        return (
          <div key={col.id || ci} style={{ marginTop: 12, padding: 12, background: '#F9FAFB', borderRadius: 10, border: `2px solid ${col.borderColor || '#E5E7EB'}`, borderTop: `4px solid ${col.borderColor || '#E5E7EB'}` }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: col.accentColor || '#374151', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              {col.title || `Column ${ci + 1}`}
            </div>
            <VF label="Title" fieldKey={`col${ci}_title`} content={content} onChange={onChange}>
              <input style={IS} value={col.title} onChange={e => updateCol(ci, { title: e.target.value })} />
            </VF>
            <div style={{ marginTop: 6 }}>
              <label style={LS}>Border Color</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="color" value={col.borderColor || '#1B4F8A'} onChange={e => updateCol(ci, { borderColor: e.target.value, accentColor: e.target.value })} style={{ width: 28, height: 28, border: '1px solid #D1D5DB', borderRadius: 4, cursor: 'pointer', padding: 1 }} />
                <input style={IS} value={col.borderColor || ''} onChange={e => updateCol(ci, { borderColor: e.target.value, accentColor: e.target.value })} placeholder="#1B4F8A" />
              </div>
            </div>
            <VF label="Description" fieldKey={`col${ci}_desc`} content={content} onChange={onChange}>
              <textarea style={{ ...TA, minHeight: 50 }} value={col.description} onChange={e => updateCol(ci, { description: e.target.value })} />
            </VF>
            <VF label="Features" fieldKey={`col${ci}_features`} content={content} onChange={onChange}>
              <DragDropContext onDragEnd={handleFeatureDrag}>
                <Droppable droppableId={`platform-features-${ci}`}>
                  {(provided) => (
                    <div ref={provided.innerRef} {...provided.droppableProps}>
                      {features.map((feat, fi) => (
                        <Draggable key={`${ci}-${fi}`} draggableId={`pf-${ci}-${fi}`} index={fi}>
                          {(prov) => (
                            <div ref={prov.innerRef} {...prov.draggableProps} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center', ...prov.draggableProps.style }}>
                              <span {...prov.dragHandleProps} style={{ cursor: 'grab', color: '#9CA3AF', fontSize: 14, flexShrink: 0 }}>⠿</span>
                              <span style={{ color: col.accentColor || '#1B4F8A', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>→</span>
                              <input style={{ ...IS, flex: 1 }} value={feat} onChange={e => { const n = [...features]; n[fi] = e.target.value; setFeatures(n); }} />
                              <button onClick={() => setFeatures(features.filter((_, j) => j !== fi))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>X</button>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
              <button onClick={() => setFeatures([...features, 'New feature'])} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, marginTop: 4 }}>+ Add Feature</button>
            </VF>
            <VF label="CTA Button" fieldKey={`col${ci}_cta`} content={content} onChange={onChange}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div><label style={LS}>Text</label><input style={IS} value={col.ctaText} onChange={e => updateCol(ci, { ctaText: e.target.value })} /></div>
                <div><label style={LS}>URL</label><input style={IS} value={col.ctaUrl} onChange={e => updateCol(ci, { ctaUrl: e.target.value })} /></div>
              </div>
            </VF>
          </div>
        );
      })}
    </>
  );
}

function PaceMakersEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...content, [k]: v });
  const svcs = ((content.services as { id: string; text: string }[]) ?? []).map(s => ({ ...s, id: s.id || `svc_${Math.random().toString(36).slice(2,9)}` }));
  const setSvcs = (next: typeof svcs) => onChange({ ...content, services: next });
  const handleSvcDrag = (result: DropResult) => {
    if (!result.destination) return;
    const arr = Array.from(svcs);
    const [removed] = arr.splice(result.source.index, 1);
    arr.splice(result.destination.index, 0, removed);
    setSvcs(arr);
  };
  const logoUrl = (content.logo_url as string) ?? '';
  return (
    <>
      {/* Logo */}
      <div style={{ marginBottom:10, padding:10, background:'#F9FAFB', borderRadius:8, border:'1px solid #E5E7EB' }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>Company Logo</div>
        <div style={{ display:'flex', gap:6 }}>
          <input style={{ ...IS, flex:1 }} value={logoUrl} onChange={e => set('logo_url', e.target.value)} placeholder="https://... or upload →" />
          <MediaPickerButton onSelect={url => set('logo_url', url)} />
        </div>
        {logoUrl && (
          <div style={{ display:'flex', gap:8, alignItems:'center', marginTop:6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="" style={{ maxWidth:140, maxHeight:48, objectFit:'contain' }} />
            <div style={{ flex:1 }}><label style={LS}>Logo Width</label><input style={IS} value={(content.logo_width as string) ?? '180px'} onChange={e => set('logo_width', e.target.value)} placeholder="180px" /></div>
            <button onClick={() => { onChange({ ...content, logo_url: '', logo_width: '' }); }} style={{ padding:'4px 8px', borderRadius:4, border:'1px solid #FECACA', background:'#FEF2F2', color:'#DC2626', cursor:'pointer', fontSize:11 }}>✕</button>
          </div>
        )}
      </div>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
      <VF label="Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Description" fieldKey="description" content={content} onChange={onChange}>
        <textarea style={{ ...TA, minHeight: 80 }} value={(content.description as string) ?? ''} onChange={e => set('description', e.target.value)} />
      </VF>
      <VF label="Description 2 (optional)" fieldKey="description2" content={content} onChange={onChange}>
        <textarea style={{ ...TA, minHeight: 60 }} value={(content.description2 as string) ?? ''} onChange={e => set('description2', e.target.value)} placeholder="Optional second paragraph" />
      </VF>
      <VF label="CTA Button" fieldKey="cta_text" content={content} onChange={onChange}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={LS}>Text</label><input style={IS} value={(content.cta_text as string) ?? ''} onChange={e => set('cta_text', e.target.value)} /></div>
          <div><label style={LS}>URL</label><input style={IS} value={(content.cta_url as string) ?? ''} onChange={e => set('cta_url', e.target.value)} /></div>
        </div>
      </VF>
      <div style={{ marginTop: 10, padding: 10, background: '#F0F4FF', borderRadius: 8, border: '1px solid #C7D2FE' }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#4F46E5', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Services / Expertise</div>
        <DragDropContext onDragEnd={handleSvcDrag}>
          <Droppable droppableId="pacemakers-services">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {svcs.map((svc, i) => (
                  <Draggable key={svc.id} draggableId={svc.id} index={i}>
                    {(prov) => (
                      <div ref={prov.innerRef} {...prov.draggableProps} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center', ...prov.draggableProps.style }}>
                        <span {...prov.dragHandleProps} style={{ cursor: 'grab', color: '#9CA3AF', fontSize: 14, flexShrink: 0 }}>⠿</span>
                        <span style={{ color: '#4A90D9', fontWeight: 700, fontSize: 12, flexShrink: 0 }}>✓</span>
                        <input style={{ ...IS, flex: 1 }} value={svc.text} onChange={e => { const n = [...svcs]; n[i] = { ...n[i], text: e.target.value }; setSvcs(n); }} />
                        <button onClick={() => setSvcs(svcs.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>X</button>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
        <button onClick={() => setSvcs([...svcs, { id: `svc_${Date.now()}`, text: 'New service' }])} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #C7D2FE', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#4F46E5', marginTop: 4 }}>+ Add Service</button>
      </div>
    </>
  );
}

function ContactItemsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.contact_items as { type: string; icon: string; label: string; value: string; visible?: boolean }[]) ?? [];
  const setItems = (next: typeof items) => onChange({ ...content, contact_items: next });
  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#1B4F8A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Contact Information Items</div>
      {items.map((item, i) => (
        <div key={i} style={{ background: '#F9FAFB', borderRadius: 8, padding: 10, marginBottom: 8, border: '1px solid #E5E7EB', opacity: item.visible === false ? 0.5 : 1 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexShrink: 0 }}>
              <input type="checkbox" checked={item.visible !== false} onChange={e => { const n = [...items]; n[i] = { ...n[i], visible: e.target.checked }; setItems(n); }} style={{ width: 14, height: 14 }} />
            </label>
            <div style={{ width: 50 }}><label style={LS}>Icon</label><input style={IS} value={item.icon} onChange={e => { const n = [...items]; n[i] = { ...n[i], icon: e.target.value }; setItems(n); }} /></div>
            <div style={{ width: 80 }}><label style={LS}>Type</label><select style={IS} value={item.type} onChange={e => { const n = [...items]; n[i] = { ...n[i], type: e.target.value }; setItems(n); }}><option value="email">Email</option><option value="phone">Phone</option><option value="location">Location</option><option value="other">Other</option></select></div>
            <div style={{ flex: 1 }}><label style={LS}>Label</label><input style={IS} value={item.label} onChange={e => { const n = [...items]; n[i] = { ...n[i], label: e.target.value }; setItems(n); }} /></div>
            <button onClick={() => setItems(items.filter((_, j) => j !== i))} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 11, alignSelf: 'end' }}>X</button>
          </div>
          <div style={{ marginLeft: 22 }}><label style={LS}>Value</label><input style={IS} value={item.value} onChange={e => { const n = [...items]; n[i] = { ...n[i], value: e.target.value }; setItems(n); }} /></div>
        </div>
      ))}
      <button onClick={() => setItems([...items, { type: 'email', icon: '📧', label: 'New Contact', value: '', visible: true }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #D1D5DB', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>+ Add Contact Item</button>
      <div style={{ marginTop: 12, padding: 10, background: '#F0F4FF', borderRadius: 8, border: '1px solid #C7D2FE', fontSize: 11, color: '#4F46E5' }}>
        Contact form and Response Time box are auto-generated. Book a Meeting card appears when booking URL is set in Founder editor.
      </div>
    </>
  );
}

function SmartColumnsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  if (Array.isArray(content.contact_items) || content._dynamic === 'contact_body') return <ContactItemsEditor content={content} onChange={onChange} />;
  const cols = content.columns as Record<string, unknown>[] | undefined;
  const isPlatform = cols?.[0] && (cols[0].id === 'modeling' || Array.isArray(cols[0].features));
  if (isPlatform) return <TwoPlatformsEditor content={content} onChange={onChange} />;
  const heading = (content.heading as string) ?? '';
  if (content.services !== undefined || heading.includes('PaceMakers') || ((content.cta_url as string) ?? '').toLowerCase().includes('pacemakers')) return <PaceMakersEditor content={content} onChange={onChange} />;
  return <ColumnsEditor content={content} onChange={onChange} />;
}

function FaqEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.items as { question: string; answer: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setItems = (next: typeof items) => onChange({ ...content, items: next });
  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
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
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
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
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
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
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
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
      <VF label="Video URL" fieldKey="url" content={content} onChange={onChange}>
        <input style={IS} value={(content.url as string) ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://youtube.com/watch?v=..." />
      </VF>
      <VF label="Caption" fieldKey="caption" content={content} onChange={onChange}>
        <input style={IS} value={(content.caption as string) ?? ''} onChange={e => set('caption', e.target.value)} />
      </VF>
    </>
  );
}

function BannerEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  return (
    <>
      <VF label="Banner Text" fieldKey="text" content={content} onChange={onChange}>
        <input style={IS} value={(content.text as string) ?? ''} onChange={e => set('text', e.target.value)} />
      </VF>
      <VF label="Link URL" fieldKey="url" content={content} onChange={onChange}>
        <input style={IS} value={(content.url as string) ?? ''} onChange={e => set('url', e.target.value)} placeholder="https://..." />
      </VF>
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
      <VF label="Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="HTML / Iframe Code" fieldKey="html" content={content} onChange={onChange}>
        <textarea style={{ ...TA, minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} value={(content.html as string) ?? ''} onChange={e => set('html', e.target.value)} placeholder='<iframe src="..."></iframe>' />
        <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>Paste embed code for Google Maps, forms, calendars, etc.</div>
      </VF>
    </>
  );
}

function TeamEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const members = (content.members as { photo: string; name: string; role: string; bio: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setMembers = (next: typeof members) => onChange({ ...content, members: next });
  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
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

// ── Founder profile editor (for team sections with content.name) ────────────

function FounderEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const set = (k: string, v: unknown) => onChange({ ...content, [k]: v });
  const creds = (content.credentials as string[]) ?? [];
  const setCreds = (next: string[]) => onChange({ ...content, credentials: next });


  const photoUrl = (content.photo_url as string) ?? '';

  return (
    <>
      {/* ── SECTION 1: HOME CARD ── */}
      <div style={{ fontSize:10, fontWeight:800, color:'#1B4F8A', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6, borderBottom:'2px solid #1B4F8A', paddingBottom:4 }}>1. Home Card</div>
      <VF label="Name" fieldKey="name" content={content} onChange={onChange}>
        <input style={IS} value={(content.name as string) ?? ''} onChange={e => set('name', e.target.value)} />
      </VF>
      <VF label="Title / Role" fieldKey="title" content={content} onChange={onChange}>
        <input style={IS} value={(content.title as string) ?? ''} onChange={e => set('title', e.target.value)} />
        <div style={{ fontSize:10, color:'#9CA3AF', marginTop:3 }}>Use | to split into two lines</div>
      </VF>
      <VF label="Qualifications" fieldKey="qualifications" content={content} onChange={onChange}>
        <input style={IS} value={(content.qualifications as string) ?? ''} onChange={e => set('qualifications', e.target.value)} placeholder="ACCA | FMVA | 12+ Years Experience" />
        <div style={{ fontSize:10, color:'#9CA3AF', marginTop:3 }}>Separate with |</div>
      </VF>
      <VF label="Short Bio" fieldKey="bio" content={content} onChange={onChange}>
        <textarea style={{ ...TA, minHeight: 60 }} value={(content.bio as string) ?? ''} onChange={e => set('bio', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>

      {/* ── SECTION 2: CREDENTIALS ── */}
      <div style={{ marginTop:14, padding:10, background:'#F0F4FF', borderRadius:8, border:'1px solid #C7D2FE' }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#4F46E5', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>2. Credentials & Experience</div>
        <div style={{ fontSize:9, color:'#6B7280', marginBottom:6 }}>Shows as ✓ checklist on home card AND numbered list on full profile page</div>
        {creds.map((c, i) => (
          <div key={i} style={{ display:'flex', gap:6, marginBottom:4, alignItems:'center' }}>
            <span style={{ color:'#4A90D9', fontWeight:700, fontSize:12, flexShrink:0 }}>✓</span>
            <input style={{ ...IS, flex:1 }} value={c} onChange={e => { const n=[...creds]; n[i]=e.target.value; setCreds(n); }} />
            <button onClick={() => setCreds(creds.filter((_,j)=>j!==i))} style={{ padding:'4px 8px', borderRadius:4, border:'1px solid #FECACA', background:'#FEF2F2', color:'#DC2626', cursor:'pointer', fontSize:11, flexShrink:0 }}>X</button>
          </div>
        ))}
        <button onClick={() => setCreds([...creds,'New credential'])} style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #C7D2FE', background:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, color:'#4F46E5' }}>+ Add</button>
      </div>

      {/* ── SECTION 3: PHOTO ── */}
      <div style={{ marginTop:14, padding:10, background:'#F9FAFB', borderRadius:8, border:'1px solid #E5E7EB' }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>3. Photo</div>
        <div style={{ display:'flex', gap:6 }}>
          <input style={{ ...IS, flex:1 }} value={photoUrl} onChange={e => set('photo_url', e.target.value)} placeholder="https://... or upload →" />
          <MediaPickerButton onSelect={url => set('photo_url', url)} />
        </div>
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" style={{ marginTop:6, maxWidth:160, maxHeight:100, borderRadius:8, objectFit:'cover', border:'1px solid #E5E7EB' }} />
        )}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginTop:6 }}>
          <div><label style={LS}>Height</label><select style={IS} value={(content.photo_height as string) ?? 'auto'} onChange={e => set('photo_height', e.target.value)}><option value="auto">Auto</option><option value="280px">280px</option><option value="320px">320px</option><option value="360px">360px</option><option value="400px">400px</option></select></div>
          <div><label style={LS}>Fit</label><select style={IS} value={(content.photo_fit as string) ?? 'contain'} onChange={e => set('photo_fit', e.target.value)}><option value="contain">Contain</option><option value="cover">Cover</option></select></div>
          <div><label style={LS}>Radius</label><input style={IS} value={(content.photo_radius as string) ?? '12px'} onChange={e => set('photo_radius', e.target.value)} placeholder="12px" /></div>
        </div>
      </div>

      {/* ── SECTION 4: BUTTONS & LINKS ── */}
      <div style={{ marginTop:14, padding:10, background:'#F9FAFB', borderRadius:8, border:'1px solid #E5E7EB' }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>4. Buttons & Links</div>
        <VF label="Primary CTA" fieldKey="cta_primary" content={content} onChange={onChange}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
            <div><label style={LS}>Text</label><input style={IS} value={(content.cta_primary_text as string) ?? ''} onChange={e => set('cta_primary_text', e.target.value)} /></div>
            <div><label style={LS}>URL</label><input style={IS} value={(content.cta_primary_url as string) ?? ''} onChange={e => set('cta_primary_url', e.target.value)} /></div>
          </div>
        </VF>
        <VF label="LinkedIn" fieldKey="cta_secondary" content={content} onChange={onChange}>
          <input style={IS} value={(content.cta_secondary_url as string) ?? ''} onChange={e => set('cta_secondary_url', e.target.value)} placeholder="https://linkedin.com/in/..." />
        </VF>
        <VF label="Book a Meeting" fieldKey="booking" content={content} onChange={onChange}>
          <input style={IS} value={(content.booking_url as string) ?? ''} onChange={e => set('booking_url', e.target.value)} placeholder="Paste Microsoft Bookings URL" />
        </VF>
      </div>

      {/* ── SECTION 5: FULL PROFILE ── */}
      <div style={{ marginTop:14, padding:10, background:'#F0FFF4', borderRadius:8, border:'1px solid #BBF7D0' }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#15803D', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>5. Full Profile (about page + expanded view)</div>
        <label style={{ ...LS, display:'flex', alignItems:'center', gap:6, cursor:'pointer' }}>
          <input type="checkbox" style={VCS} checked={content.show_read_more !== false} onChange={e => set('show_read_more', e.target.checked)} />
          Show &quot;Read Full Profile&quot; link on home
        </label>
        <VF label="Long Bio" fieldKey="long_bio" content={content} onChange={onChange}>
          <textarea style={{ ...TA, minHeight: 80 }} value={(content.long_bio as string) ?? ''} onChange={e => set('long_bio', e.target.value)} placeholder="Full background (paragraphs separated by blank lines)" />
        </VF>
        <VF label="Philosophy Quote" fieldKey="philosophy" content={content} onChange={onChange}>
          <textarea style={{ ...TA, minHeight: 50 }} value={(content.philosophy as string) ?? ''} onChange={e => set('philosophy', e.target.value)} />
        </VF>
        {/* Projects */}
        {(() => {
          const projs = (content.projects as { id: string; title: string; description: string; sector: string; value: string }[]) ?? [];
          const setProjs = (next: typeof projs) => onChange({ ...content, projects: next });
          return (
            <div style={{ marginTop:10 }}>
              <label style={LS}>Projects</label>
              {projs.map((p, i) => (
                <div key={p.id||i} style={{ background:'#F9FAFB', borderRadius:8, padding:8, marginBottom:6, border:'1px solid #E5E7EB' }}>
                  <div style={{ display:'flex', gap:6, marginBottom:4 }}>
                    <div style={{ flex:1 }}><label style={{...LS,fontSize:10}}>Title</label><input style={IS} value={p.title} onChange={e=>{const n=[...projs];n[i]={...n[i],title:e.target.value};setProjs(n);}}/></div>
                    <div style={{ flex:1 }}><label style={{...LS,fontSize:10}}>Sector</label><input style={IS} value={p.sector} onChange={e=>{const n=[...projs];n[i]={...n[i],sector:e.target.value};setProjs(n);}}/></div>
                    <button onClick={()=>setProjs(projs.filter((_,j)=>j!==i))} style={{ padding:'4px 8px', borderRadius:4, border:'1px solid #FECACA', background:'#FEF2F2', color:'#DC2626', cursor:'pointer', fontSize:11, alignSelf:'end' }}>X</button>
                  </div>
                  <label style={{...LS,fontSize:10}}>Description</label><textarea style={{...TA,minHeight:30}} value={p.description} onChange={e=>{const n=[...projs];n[i]={...n[i],description:e.target.value};setProjs(n);}}/>
                  <label style={{...LS,fontSize:10,marginTop:4}}>Value</label><input style={IS} value={p.value} onChange={e=>{const n=[...projs];n[i]={...n[i],value:e.target.value};setProjs(n);}} placeholder="e.g. $50M"/>
                </div>
              ))}
              <button onClick={()=>setProjs([...projs,{id:`proj_${Date.now()}`,title:'',description:'',sector:'',value:''}])} style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #BBF7D0', background:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, color:'#15803D' }}>+ Add Project</button>
            </div>
          );
        })()}
      </div>

      {/* ── SECTION 6: BOOKING PAGE ── */}
      <div style={{ marginTop:14, padding:10, background:'#FFF7ED', borderRadius:8, border:'1px solid #FED7AA' }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#C2410C', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>6. Booking Page (/book-a-meeting)</div>
        {(() => {
          const items = (content.booking_expectations as string[]) ?? [];
          const setItems = (next: string[]) => onChange({ ...content, booking_expectations: next });
          return (
            <div style={{ marginTop:10 }}>
              <label style={LS}>What to Expect (booking page)</label>
              {items.map((item, i) => (
                <div key={i} style={{ display:'flex', gap:6, marginBottom:4, alignItems:'center' }}>
                  <span style={{ color:'#1ABC9C', fontSize:12, flexShrink:0 }}>✓</span>
                  <input style={{ ...IS, flex:1 }} value={item} onChange={e => { const n=[...items]; n[i]=e.target.value; setItems(n); }} />
                  <button onClick={() => setItems(items.filter((_,j)=>j!==i))} style={{ padding:'4px 8px', borderRadius:4, border:'1px solid #FECACA', background:'#FEF2F2', color:'#DC2626', cursor:'pointer', fontSize:11, flexShrink:0 }}>X</button>
                </div>
              ))}
              <button onClick={() => setItems([...items,'New item'])} style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #BBF7D0', background:'#fff', cursor:'pointer', fontSize:11, fontWeight:600, color:'#15803D' }}>+ Add</button>
            </div>
          );
        })()}
      </div>
    </>
  );
}

function SmartTeamEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  if (content.name && typeof content.name === 'string') return <FounderEditor content={content} onChange={onChange} />;
  return <TeamEditor content={content} onChange={onChange} />;
}

function ProcessStepsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const steps = (content.steps as { icon: string; label: string; desc: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setSteps = (next: typeof steps) => onChange({ ...content, steps: next });
  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
      <label style={{ ...LS, marginTop: 8 }}>Process Steps</label>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'end', background: '#F9FAFB', borderRadius: 8, padding: 8, border: '1px solid #E5E7EB' }}>
          <div style={{ width: 50 }}><label style={LS}>Icon</label><input style={IS} value={step.icon} onChange={e => { const n = [...steps]; n[i] = { ...n[i], icon: e.target.value }; setSteps(n); }} /></div>
          <div style={{ flex: 1 }}><label style={LS}>Title</label><input style={IS} value={step.label} onChange={e => { const n = [...steps]; n[i] = { ...n[i], label: e.target.value }; setSteps(n); }} /></div>
          <div style={{ flex: 2 }}><label style={LS}>Description</label><input style={IS} value={step.desc} onChange={e => { const n = [...steps]; n[i] = { ...n[i], desc: e.target.value }; setSteps(n); }} /></div>
          <button onClick={() => setSteps(steps.filter((_, j) => j !== i))} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>X</button>
        </div>
      ))}
      <button onClick={() => setSteps([...steps, { icon: '📌', label: 'New Step', desc: 'Step description' }])} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #BBF7D0', background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#15803D' }}>+ Add Step</button>
    </>
  );
}

function TimelineEventsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const items = (content.items as { date: string; title: string; description: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setItems = (next: typeof items) => onChange({ ...content, items: next });
  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
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

function TimelineEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  if (Array.isArray(content.steps)) return <ProcessStepsEditor content={content} onChange={onChange} />;
  return <TimelineEventsEditor content={content} onChange={onChange} />;
}

function LogoGridEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  const logos = (content.logos as { src: string; alt: string; url: string }[]) ?? [];
  const set = (k: string, v: string) => onChange({ ...content, [k]: v });
  const setLogos = (next: typeof logos) => onChange({ ...content, logos: next });
  return (
    <>
      <VF label="Section Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Badge" fieldKey="badge" content={content} onChange={onChange}>
        <input style={IS} value={(content.badge as string) ?? ''} onChange={e => set('badge', e.target.value)} />
      </VF>
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
      <VF label="Heading" fieldKey="heading" content={content} onChange={onChange}>
        <input style={IS} value={(content.heading as string) ?? ''} onChange={e => set('heading', e.target.value)} />
      </VF>
      <VF label="Subtitle" fieldKey="subtitle" content={content} onChange={onChange}>
        <textarea style={TA} value={(content.subtitle as string) ?? ''} onChange={e => set('subtitle', e.target.value)} />
      </VF>
      <label style={{ ...LS, marginTop: 10 }}>Target Date & Time</label><input style={IS} type="datetime-local" value={(content.targetDate as string) ?? ''} onChange={e => set('targetDate', e.target.value)} />
      <VF label="CTA Button" fieldKey="ctaText" content={content} onChange={onChange}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div><label style={LS}>Text</label><input style={IS} value={(content.ctaText as string) ?? ''} onChange={e => set('ctaText', e.target.value)} /></div>
          <div><label style={LS}>URL</label><input style={IS} value={(content.ctaUrl as string) ?? ''} onChange={e => set('ctaUrl', e.target.value)} /></div>
        </div>
      </VF>
      <label style={{ ...LS, marginTop: 10 }}>Expired Text</label><input style={IS} value={(content.expiredText as string) ?? ''} onChange={e => set('expiredText', e.target.value)} placeholder="This event has passed." />
    </>
  );
}

const EDITORS: Record<string, React.ComponentType<{ content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }>> = {
  hero: HeroEditor, text: TextEditor, rich_text: RichTextEditor2, image: ImageEditor,
  text_image: TextImageEditor, cta: CtaEditor, stats: StatsEditor, cards: CardsEditor,
  columns: SmartColumnsEditor, faq: FaqEditor, list: ListEditor,
  testimonials: TestimonialsEditor, pricing_table: PricingTableEditor, video: VideoEditor,
  banner: BannerEditor, spacer: SpacerEditor, embed: EmbedEditor, team: SmartTeamEditor,
  timeline: TimelineEditor, logo_grid: LogoGridEditor, countdown: CountdownEditor,
};

// ── Universal paragraphs + alignment editor (shown for every section type) ──

const ALIGN_BTNS: { value: string; label: string }[] = [
  { value: 'left', label: 'L' },
  { value: 'center', label: 'C' },
  { value: 'right', label: 'R' },
  { value: 'justify', label: 'J' },
];

function AlignPicker({ value, onChange: onPick }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid #D1D5DB', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
      {ALIGN_BTNS.map(a => (
        <button key={a.value} type="button" onClick={() => onPick(a.value)}
          style={{ padding: '2px 6px', fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer', background: value === a.value ? '#1B4F8A' : '#fff', color: value === a.value ? '#fff' : '#9CA3AF' }}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

function ParagraphsEditor({ content, onChange }: { content: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }) {
  // Normalize: support both string[] and {text,align}[] formats
  const raw = (content.paragraphs ?? []) as (string | { text: string; align?: string })[];
  const paragraphs = raw.map(p => typeof p === 'string' ? { text: p, align: 'left' } : { text: p.text ?? '', align: p.align ?? 'left' });
  const setParagraphs = (next: typeof paragraphs) => onChange({ ...content, paragraphs: next });

  if (paragraphs.length === 0) {
    return (
      <div style={{ marginTop: 14 }}>
        <button onClick={() => setParagraphs([{ text: '', align: 'left' }])}
          style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #FDE68A', background: '#FEFCE8', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#92400E' }}>
          + Add Paragraph
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, padding: 10, background: '#FEFCE8', borderRadius: 8, border: '1px solid #FDE68A' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#92400E', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Additional Paragraphs</div>
      {paragraphs.map((para, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'start' }}>
          <span style={{ color: '#9CA3AF', fontSize: 11, flexShrink: 0, marginTop: 8 }}>{i + 1}.</span>
          <textarea style={{ ...TA, flex: 1, minHeight: 50 }} value={para.text} onChange={e => { const n = [...paragraphs]; n[i] = { ...n[i], text: e.target.value }; setParagraphs(n); }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0, marginTop: 4 }}>
            <AlignPicker value={para.align} onChange={v => { const n = [...paragraphs]; n[i] = { ...n[i], align: v }; setParagraphs(n); }} />
            <button onClick={() => setParagraphs(paragraphs.filter((_, j) => j !== i))} style={{ padding: '3px 6px', borderRadius: 4, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', cursor: 'pointer', fontSize: 10 }}>X</button>
          </div>
        </div>
      ))}
      <button onClick={() => setParagraphs([...paragraphs, { text: '', align: 'left' }])}
        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid #FDE68A', background: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#92400E' }}>
        + Add Paragraph
      </button>
    </div>
  );
}

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
                                {(section.content.heading as string) || (section.content.headline as string) || (section.content.body as string)?.slice(0, 40) || '-'}
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
                <ParagraphsEditor
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

import type { TemplateDefinition } from '../types';

export const instagramPostTemplate: TemplateDefinition = {
  id: 'instagram-post',
  name: 'Instagram Post',
  description: 'Square 1080x1080 image for Instagram feed — big title + tagline + hashtag line.',
  category: 'instagram',
  dimensions: { width: 1080, height: 1080 },
  aspectRatio: '1:1',
  fields: [
    { key: 'headline',  label: 'Headline',    type: 'text',     placeholder: 'NPV vs IRR',           maxLength: 40, required: true },
    { key: 'subtitle',  label: 'Subtitle',    type: 'text',     placeholder: 'Which one actually matters?', maxLength: 80 },
    { key: 'body',      label: 'Body',        type: 'textarea', placeholder: 'Swipe to see the full breakdown.', maxLength: 160 },
    { key: 'hashtag',   label: 'Hashtag Line', type: 'text',    placeholder: '#FinancialModeling #Finance', maxLength: 80 },
    { key: 'variant',   label: 'Style',       type: 'select',   options: [{ value: 'gradient', label: 'Gradient' }, { value: 'navy', label: 'Navy Solid' }, { value: 'light', label: 'Light Card' }] },
  ],
  defaults: {
    headline: 'NPV vs IRR',
    subtitle: 'Which one actually matters?',
    body: 'Most analysts default to IRR — here is why NPV wins in almost every serious decision.',
    hashtag: '#FinancialModeling #Valuation #Finance',
    variant: 'gradient',
  },
  render: (data, kit, logoDataUri, photoDataUri) => {
    const variant = data.variant || 'gradient';
    const isLight = variant === 'light';
    const bg =
      variant === 'light'    ? `linear-gradient(135deg, ${kit.text_color_light} 0%, #F3F4F6 100%)`
    : variant === 'navy'     ? `linear-gradient(180deg, #0A1F3D 0%, ${kit.primary_color} 100%)`
                             : `linear-gradient(135deg, ${kit.primary_color} 0%, ${kit.secondary_color} 100%)`;
    const fg = isLight ? kit.text_color_dark : kit.text_color_light;
    const sub = isLight ? 'rgba(31,41,55,0.7)' : 'rgba(255,255,255,0.82)';
    const accent = isLight ? kit.accent_color : kit.accent_color;

    return (
      <div style={{ width: 1080, height: 1080, display: 'flex', flexDirection: 'column', background: bg, fontFamily: kit.font_family, position: 'relative', padding: 72, overflow: 'hidden' }}>
        {/* Decorative */}
        <div style={{ position: 'absolute', top: -120, right: -120, width: 420, height: 420, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -140, left: -140, width: 380, height: 380, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex' }} />

        {/* Top */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
          {logoDataUri ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoDataUri} alt="Logo" style={{ height: 50 }} />
          ) : <div />}
          {photoDataUri ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={photoDataUri} alt="Author" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: `3px solid ${accent}` }} />
          ) : null}
        </div>

        {/* Middle: headline */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28, zIndex: 2 }}>
          <div style={{ display: 'flex', width: 80, height: 8, background: accent, borderRadius: 4 }} />
          <div style={{ fontSize: data.headline.length > 20 ? 110 : 140, fontWeight: 800, color: fg, lineHeight: 1.0, letterSpacing: '-0.03em', display: 'flex', flexWrap: 'wrap', maxWidth: 940 }}>
            {data.headline}
          </div>
          {data.subtitle ? (
            <div style={{ fontSize: 36, fontWeight: 500, color: sub, lineHeight: 1.25, display: 'flex', flexWrap: 'wrap', maxWidth: 880 }}>
              {data.subtitle}
            </div>
          ) : null}
          {data.body ? (
            <div style={{ fontSize: 24, color: sub, lineHeight: 1.45, display: 'flex', flexWrap: 'wrap', maxWidth: 880, marginTop: 8 }}>
              {data.body}
            </div>
          ) : null}
        </div>

        {/* Bottom */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, zIndex: 2 }}>
          {data.hashtag ? (
            <div style={{ fontSize: 22, fontWeight: 600, color: isLight ? kit.primary_color : kit.secondary_color, letterSpacing: '0.02em' }}>
              {data.hashtag}
            </div>
          ) : null}
          <div style={{ fontSize: 20, color: sub }}>financialmodelerpro.com</div>
        </div>
      </div>
    );
  },
};

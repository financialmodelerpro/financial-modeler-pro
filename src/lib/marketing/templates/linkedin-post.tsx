import type { TemplateDefinition } from '../types';

export const linkedinPostTemplate: TemplateDefinition = {
  id: 'linkedin-post',
  name: 'LinkedIn Post',
  description: 'Professional 1200x627 share image for LinkedIn posts — headline, body, branding.',
  category: 'linkedin',
  dimensions: { width: 1200, height: 627 },
  aspectRatio: '1.91:1',
  fields: [
    { key: 'label',    label: 'Eyebrow',     type: 'text',     placeholder: 'FINANCIAL MODELING TIP', maxLength: 40, helpText: 'Small caps label at top.' },
    { key: 'headline', label: 'Headline',    type: 'text',     placeholder: '3 DCF mistakes that kill valuations',     maxLength: 100, required: true },
    { key: 'body',     label: 'Body',        type: 'textarea', placeholder: 'A short sentence that teases the insight.', maxLength: 200, helpText: 'One or two lines that invite the click.' },
    { key: 'author',   label: 'Author',      type: 'text',     placeholder: 'Ahmad Din · FMP',        maxLength: 60 },
    { key: 'variant',  label: 'Style',       type: 'select',   options: [{ value: 'navy', label: 'Navy Professional' }, { value: 'light', label: 'Light Minimal' }, { value: 'split', label: 'Split with Photo' }] },
  ],
  defaults: {
    label: 'FINANCIAL MODELING TIP',
    headline: '3 DCF mistakes that kill valuations',
    body: 'A short insight that makes people stop scrolling — then teaches them something useful.',
    author: 'Ahmad Din · Financial Modeler Pro',
    variant: 'navy',
  },
  render: (data, kit, logoDataUri, photoDataUri) => {
    const variant = data.variant || 'navy';
    const isLight = variant === 'light';
    const isSplit = variant === 'split';
    const bg = isLight
      ? `linear-gradient(135deg, ${kit.text_color_light} 0%, #F3F4F6 100%)`
      : `linear-gradient(135deg, #0A1F3D 0%, ${kit.primary_color} 100%)`;
    const fg = isLight ? kit.text_color_dark : kit.text_color_light;
    const sub = isLight ? 'rgba(31,41,55,0.7)' : 'rgba(255,255,255,0.78)';
    const labelColor = isLight ? kit.primary_color : kit.secondary_color;

    if (isSplit) {
      return (
        <div style={{ width: 1200, height: 627, display: 'flex', background: bg, fontFamily: kit.font_family, position: 'relative' }}>
          {/* Left: content */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 48px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {data.label ? <div style={{ fontSize: 14, fontWeight: 700, color: labelColor, letterSpacing: '0.18em' }}>{data.label}</div> : null}
              <div style={{ fontSize: 54, fontWeight: 800, color: fg, lineHeight: 1.08, letterSpacing: '-0.02em', display: 'flex', flexWrap: 'wrap' }}>
                {data.headline}
              </div>
              {data.body ? <div style={{ fontSize: 22, color: sub, lineHeight: 1.4, marginTop: 12, display: 'flex', flexWrap: 'wrap' }}>{data.body}</div> : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {logoDataUri ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoDataUri} alt="Logo" style={{ height: 36 }} />
              ) : null}
              {data.author ? <div style={{ fontSize: 16, color: sub, fontWeight: 500 }}>{data.author}</div> : null}
            </div>
          </div>
          {/* Right: photo / accent */}
          <div style={{ width: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `linear-gradient(180deg, ${kit.primary_color} 0%, ${kit.secondary_color} 100%)` }}>
            {photoDataUri ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={photoDataUri} alt="Photo" style={{ width: 280, height: 280, borderRadius: '50%', objectFit: 'cover', border: `6px solid ${kit.text_color_light}` }} />
            ) : (
              <div style={{ display: 'flex', width: 280, height: 280, borderRadius: '50%', background: 'rgba(255,255,255,0.12)' }} />
            )}
          </div>
        </div>
      );
    }

    return (
      <div style={{ width: 1200, height: 627, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: bg, fontFamily: kit.font_family, position: 'relative', padding: 64, overflow: 'hidden' }}>
        {/* Decorative shapes */}
        <div style={{ position: 'absolute', top: -80, right: -80, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: 0, right: 40, width: 200, height: 8, background: kit.accent_color, borderRadius: 4, display: 'flex' }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
          {logoDataUri ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoDataUri} alt="Logo" style={{ height: 40 }} />
          ) : <div />}
          {data.label ? (
            <div style={{ fontSize: 14, fontWeight: 700, color: labelColor, letterSpacing: '0.2em', padding: '8px 18px', border: `1px solid ${labelColor}`, borderRadius: 20 }}>{data.label}</div>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, zIndex: 2 }}>
          <div style={{ fontSize: data.headline.length > 70 ? 50 : 60, fontWeight: 800, color: fg, lineHeight: 1.08, letterSpacing: '-0.02em', maxWidth: 980, display: 'flex', flexWrap: 'wrap' }}>
            {data.headline}
          </div>
          {data.body ? (
            <div style={{ fontSize: 24, color: sub, lineHeight: 1.4, maxWidth: 920, display: 'flex', flexWrap: 'wrap' }}>
              {data.body}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {photoDataUri ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={photoDataUri} alt="Author" style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${kit.accent_color}` }} />
            ) : null}
            {data.author ? <div style={{ fontSize: 18, color: sub, fontWeight: 500 }}>{data.author}</div> : null}
          </div>
          <div style={{ fontSize: 16, color: sub }}>financialmodelerpro.com</div>
        </div>
      </div>
    );
  },
};

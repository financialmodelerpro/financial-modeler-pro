import type { TemplateDefinition } from '../types';

export const youtubeThumbnailTemplate: TemplateDefinition = {
  id: 'youtube-thumbnail',
  name: 'YouTube Thumbnail',
  description: 'Bold 1280x720 thumbnail for YouTube videos — large headline + accent bar + logo.',
  category: 'youtube',
  dimensions: { width: 1280, height: 720 },
  aspectRatio: '16:9',
  fields: [
    { key: 'headline',  label: 'Headline',     type: 'text',     placeholder: 'DCF Valuation EXPLAINED',   maxLength: 60, required: true, helpText: 'Big attention-grabbing title (under 60 chars).' },
    { key: 'subtitle',  label: 'Subtitle',     type: 'text',     placeholder: 'Step-by-step walkthrough',   maxLength: 80,                    helpText: 'Optional supporting line.' },
    { key: 'badge',     label: 'Badge',        type: 'text',     placeholder: 'TUTORIAL',                   maxLength: 20,                    helpText: 'Small top-left label.' },
    { key: 'module',    label: 'Course',       type: 'text',     placeholder: 'Financial Modeling · Ep 4', maxLength: 60,                    helpText: 'Shown bottom-right above logo.' },
    { key: 'variant',   label: 'Style',        type: 'select',   options: [{ value: 'dark', label: 'Dark Navy' }, { value: 'accent', label: 'Accent Gradient' }, { value: 'light', label: 'Light' }] },
  ],
  defaults: {
    headline: 'DCF Valuation EXPLAINED',
    subtitle: 'Step-by-step Excel walkthrough',
    badge: 'TUTORIAL',
    module: 'Financial Modeling · Episode 4',
    variant: 'dark',
  },
  render: (data, kit, logoDataUri, photoDataUri) => {
    const variant = data.variant || 'dark';
    const bg =
      variant === 'light'  ? `linear-gradient(135deg, ${kit.text_color_light} 0%, #F3F4F6 100%)`
    : variant === 'accent' ? `linear-gradient(135deg, ${kit.primary_color} 0%, ${kit.secondary_color} 100%)`
                           : `linear-gradient(135deg, #0A1F3D 0%, ${kit.primary_color} 50%, #0F3D6E 100%)`;
    const fg = variant === 'light' ? kit.text_color_dark : kit.text_color_light;
    const sub = variant === 'light' ? 'rgba(31,41,55,0.65)' : 'rgba(255,255,255,0.75)';
    const badgeFg = variant === 'light' ? kit.primary_color : kit.secondary_color;
    const badgeBg = variant === 'light' ? 'rgba(27,79,114,0.12)' : 'rgba(45,212,191,0.18)';

    return (
      <div style={{ width: 1280, height: 720, display: 'flex', flexDirection: 'column', background: bg, fontFamily: kit.font_family, position: 'relative', overflow: 'hidden', padding: 64 }}>
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: -120, right: -120, width: 480, height: 480, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: -100, left: -100, width: 360, height: 360, borderRadius: '50%', background: 'rgba(255,255,255,0.03)', display: 'flex' }} />

        {/* Top: badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
          {data.badge ? (
            <div style={{ display: 'flex', padding: '10px 22px', borderRadius: 26, background: badgeBg, border: `2px solid ${badgeFg}` }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: badgeFg, letterSpacing: '0.1em' }}>{data.badge}</span>
            </div>
          ) : <div />}
          {logoDataUri ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={logoDataUri} alt="Logo" style={{ height: 54 }} />
          ) : null}
        </div>

        {/* Main headline area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', zIndex: 2, gap: 28 }}>
          {/* Accent bar */}
          <div style={{ display: 'flex', width: 120, height: 8, background: kit.accent_color, borderRadius: 4 }} />
          <div style={{ fontSize: data.headline.length > 30 ? 92 : 110, fontWeight: 800, color: fg, lineHeight: 1.02, letterSpacing: '-0.03em', display: 'flex', flexWrap: 'wrap', maxWidth: 1100 }}>
            {data.headline}
          </div>
          {data.subtitle ? (
            <div style={{ fontSize: 36, fontWeight: 500, color: sub, lineHeight: 1.3, display: 'flex', maxWidth: 1000 }}>
              {data.subtitle}
            </div>
          ) : null}
        </div>

        {/* Bottom: module + founder photo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.module ? <div style={{ fontSize: 22, fontWeight: 600, color: sub }}>{data.module}</div> : null}
            <div style={{ fontSize: 18, color: sub }}>financialmodelerpro.com</div>
          </div>
          {photoDataUri ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={photoDataUri} alt="Photo" style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: `4px solid ${kit.accent_color}` }} />
          ) : null}
        </div>
      </div>
    );
  },
};

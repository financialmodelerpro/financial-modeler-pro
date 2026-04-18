import Link from 'next/link';
import { CmsField, cmsVisible } from '../CmsField';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface PricingTier {
  name: string;
  price: string;
  period?: string;
  description?: string;
  features: string[];
  cta_text?: string;
  cta_url?: string;
  highlighted?: boolean;
  visible?: boolean;
}

export function PricingTableSection({ content, styles }: Props) {
  const rawTiers = (content.tiers as PricingTier[]) ?? [];
  const tiers    = rawTiers.filter(t => t.visible !== false);
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#ffffff';
  const textColor = (styles.textColor as string) ?? '';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '1100px';

  if (!tiers.length) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px`, color: textColor || undefined }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {cmsVisible(content, 'badge') && badge && (
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {cmsVisible(content, 'heading') && heading && (
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: textColor || '#0D2E5A', marginBottom: 40 }}>
            {heading}
          </h2>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(260px, 1fr))`, gap: 24, alignItems: 'start' }}>
          {tiers.map((tier, i) => (
            <div key={i} style={{
              background: '#fff', borderRadius: 14,
              border: tier.highlighted ? '2px solid #2EAA4A' : '1px solid #E5E7EB',
              padding: '32px 24px', textAlign: 'center',
              boxShadow: tier.highlighted ? '0 8px 32px rgba(46,170,74,0.15)' : '0 2px 12px rgba(0,0,0,0.04)',
              position: 'relative',
            }}>
              {tier.highlighted && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: '#2EAA4A', color: '#fff', fontSize: 11, fontWeight: 700,
                  padding: '3px 14px', borderRadius: 12, letterSpacing: '0.04em',
                }}>
                  POPULAR
                </div>
              )}
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>{tier.name}</div>
              <div style={{ fontSize: 36, fontWeight: 800, color: '#0D2E5A', lineHeight: 1.1 }}>
                {tier.price}
                {tier.period && <span style={{ fontSize: 14, fontWeight: 500, color: '#9CA3AF' }}>/{tier.period}</span>}
              </div>
              <CmsField
                content={tier as unknown as Record<string, unknown>}
                field="description"
                style={{ fontSize: 13, color: '#6B7280', marginTop: 8, lineHeight: 1.5 }}
              />
              <div style={{ margin: '20px 0', borderTop: '1px solid #F3F4F6' }} />
              <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                {tier.features.map((f, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#374151' }}>
                    <span style={{ color: '#2EAA4A', fontWeight: 700, flexShrink: 0 }}>&#10003;</span>
                    <CmsField content={{ text: f }} field="text" as="span" />
                  </div>
                ))}
              </div>
              {tier.cta_text && tier.cta_url && (
                <Link href={tier.cta_url} style={{
                  display: 'block', padding: '12px 24px', borderRadius: 8, fontSize: 14, fontWeight: 700,
                  textDecoration: 'none', textAlign: 'center',
                  background: tier.highlighted ? '#2EAA4A' : 'transparent',
                  color: tier.highlighted ? '#fff' : '#2EAA4A',
                  border: tier.highlighted ? 'none' : '2px solid #2EAA4A',
                }}>
                  {tier.cta_text}
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

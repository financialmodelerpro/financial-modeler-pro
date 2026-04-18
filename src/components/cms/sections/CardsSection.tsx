import { CmsParagraphs } from './CmsParagraphs';
import { CmsField, cmsVisible } from '../CmsField';

interface Props {
  content: Record<string, unknown>;
  styles: Record<string, unknown>;
}

interface Card {
  icon?: string;
  title: string;
  description: string;
}

export function CardsSection({ content, styles }: Props) {
  const cards   = (content.cards as Card[]) ?? [];
  const heading = content.heading as string ?? '';
  const badge   = content.badge as string ?? '';
  const bgColor = (styles.bgColor as string) ?? '#F5F7FA';
  const py      = (styles.paddingY as string) ?? 'clamp(48px,7vw,80px)';
  const maxW    = (styles.maxWidth as string) ?? '1000px';

  if (!cards.length) return null;

  return (
    <section style={{ background: bgColor, padding: `${py} 40px` }}>
      <div style={{ maxWidth: maxW, margin: '0 auto' }}>
        {cmsVisible(content, 'badge') && badge && (
          <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#2EAA4A', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
            {badge}
          </div>
        )}
        {cmsVisible(content, 'heading') && heading && (
          <h2 style={{ textAlign: 'center', fontSize: 'clamp(22px,3.5vw,34px)', fontWeight: 800, color: '#0D2E5A', marginBottom: 16 }}>
            {heading}
          </h2>
        )}
        <CmsField
          content={content}
          field="description"
          style={{ textAlign: 'center', fontSize: 15, color: '#6B7280', lineHeight: 1.7, marginBottom: 24, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}
        />
        <div style={{ textAlign: 'center', marginBottom: 24 }}><CmsParagraphs content={content} color="#6B7280" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 24 }}>
          {cards.map((card, i) => (
            <div key={i} style={{
              background: '#fff', borderRadius: 12,
              border: '1px solid #E5E7EB',
              padding: '28px 22px', textAlign: 'center',
              boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            }}>
              {card.icon && <div style={{ fontSize: 32, marginBottom: 14 }}>{card.icon}</div>}
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0D2E5A', marginBottom: 8 }}>
                {card.title}
              </div>
              <CmsField
                content={card as unknown as Record<string, unknown>}
                field="description"
                style={{ fontSize: 12.5, color: '#6B7280', lineHeight: 1.6 }}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

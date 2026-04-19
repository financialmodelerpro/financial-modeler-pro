import Link from 'next/link';
import { BreadcrumbJsonLd } from './StructuredData';

export interface BreadcrumbItem { name: string; url: string }

/**
 * Visual breadcrumb trail + matching BreadcrumbList JSON-LD in one component.
 * The last item renders as plain text (the current page) and isn't a link.
 * Keep labels short — Google shows them at smaller font in rich results.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  if (!items || items.length < 2) return null;
  return (
    <>
      <BreadcrumbJsonLd items={items} />
      <nav aria-label="Breadcrumb" style={{
        fontSize: 12, color: '#6B7280',
        fontFamily: "'Inter', sans-serif",
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        gap: 6, padding: '12px 0',
      }}>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <span key={`${item.url}-${idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {idx > 0 && <span style={{ color: '#D1D5DB' }} aria-hidden="true">›</span>}
              {isLast ? (
                <span aria-current="page" style={{ color: '#1B3A6B', fontWeight: 600 }}>{item.name}</span>
              ) : (
                <Link href={item.url} style={{ color: '#1B4F8A', textDecoration: 'none' }}>
                  {item.name}
                </Link>
              )}
            </span>
          );
        })}
      </nav>
    </>
  );
}

import Link from 'next/link';
import { InlineEdit } from './InlineEdit';

interface SharedFooterProps {
  company:   string;
  founder:   string;
  copyright: string;
  isAdmin?:  boolean;
}

export function SharedFooter({ company, founder, copyright, isAdmin = false }: SharedFooterProps) {
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: '#0D2E5A', padding: '48px 40px', color: '#fff' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 40, marginBottom: 40 }}>
          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 22 }}>📐</span>
              <span style={{ fontWeight: 800, fontSize: 14, color: '#fff' }}>Financial Modeler Pro</span>
            </div>
            <InlineEdit tag="p" section="footer" fieldKey="company_line" value={company} isAdmin={isAdmin} darkBg
              style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)', lineHeight: 1.7, margin: '0 0 8px' }} />
            <InlineEdit tag="p" section="footer" fieldKey="founder_line" value={founder} isAdmin={isAdmin} darkBg
              style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', margin: 0 }} />
          </div>

          {/* Platform links */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              Platform
            </div>
            {([
              ['Modeling Hub',    '/modeling'],
              ['Training Hub',    '/training'],
              ['Articles',        '/articles'],
              ['Launch Platform', '/login'],
            ] as [string, string][]).map(([label, href]) => (
              <Link key={href} href={href} style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', marginBottom: 8 }}>
                {label}
              </Link>
            ))}
          </div>

          {/* Company links */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              Company
            </div>
            {([
              ['About FMP',  '/about'],
              ['Founder',    '/about/ahmad-din'],
              ['Pricing',    '/pricing'],
              ['Sign In',    '/login'],
            ] as [string, string][]).map(([label, href]) => (
              <Link key={href} href={href} style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,0.5)', textDecoration: 'none', marginBottom: 8 }}>
                {label}
              </Link>
            ))}
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
            © <InlineEdit tag="span" section="footer" fieldKey="copyright" value={copyright} isAdmin={isAdmin} darkBg />
          </span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
            Structured Modeling. Real-World Finance.
          </span>
        </div>
      </div>
    </footer>
  );
}

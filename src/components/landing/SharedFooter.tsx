import Link from 'next/link';
import { InlineEdit } from './InlineEdit';
import { NewsletterSubscribeForm } from '@/src/components/newsletter/NewsletterSubscribeForm';

interface SharedFooterProps {
  company:   string;
  founder:   string;
  copyright: string;
  isAdmin?:  boolean;
  height?:   'compact' | 'standard' | 'large';
  paddingTop?:    string;
  paddingBottom?: string;
  showDescription?:    boolean;
  showQuickLinks?:     boolean;
  showCompanyLinks?:   boolean;
  showPrivacy?:        boolean;
  showConfidentiality?: boolean;
}

export function SharedFooter({
  company, founder, copyright, isAdmin = false,
  height = 'standard',
  paddingTop, paddingBottom,
  showDescription  = true,
  showQuickLinks   = true,
  showCompanyLinks = true,
  showPrivacy      = true,
  showConfidentiality = true,
}: SharedFooterProps) {
  const heightPadding = { compact: '32px', standard: '40px', large: '64px' }[height];
  const topPad    = paddingTop    ? `${paddingTop}px`    : heightPadding;
  const bottomPad = paddingBottom ? `${paddingBottom}px` : heightPadding;

  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: '#0D2E5A', paddingTop: topPad, paddingBottom: bottomPad, paddingLeft: 40, paddingRight: 40, color: '#fff' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 40, marginBottom: 40 }}>

          {/* Brand */}
          {showDescription && (
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
          )}

          {/* Platform links */}
          {showQuickLinks && (
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
          )}

          {/* Company links */}
          {showCompanyLinks && (
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
          )}

          {/* Stay Updated + Follow Us */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              Stay Updated
            </div>
            <NewsletterSubscribeForm />
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 16, marginBottom: 8 }}>
              Follow Us
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <a href="https://www.linkedin.com/showcase/financialmodelerpro/" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, background: '#0077b5', color: '#fff', textDecoration: 'none' }}>
                LinkedIn
              </a>
              <a href={`https://www.youtube.com/channel/${process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID ?? ''}?sub_confirmation=1`} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 12px', fontSize: 11, fontWeight: 600, borderRadius: 5, background: '#FF0000', color: '#fff', textDecoration: 'none' }}>
                YouTube
              </a>
            </div>
          </div>
        </div>

        {/* Bottom row */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)' }}>
            © <InlineEdit tag="span" section="footer" fieldKey="copyright" value={copyright} isAdmin={isAdmin} darkBg />
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {showPrivacy && (
              <Link href="/privacy-policy" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>
                Privacy Policy
              </Link>
            )}
            {showConfidentiality && (
              <Link href="/confidentiality" style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>
                Confidentiality &amp; Terms
              </Link>
            )}
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
              Structured Modeling. Real-World Finance.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

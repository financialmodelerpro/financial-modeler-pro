import Link from 'next/link';
import { InlineEdit } from './InlineEdit';
import { NewsletterSubscribeForm } from '@/src/hubs/main/components/newsletter/NewsletterSubscribeForm';
import { getFooterLegalLinks } from '@/src/shared/cms';

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
  // Legacy props, retained for call-site compatibility. The legal row is now
  // driven by each page's published/draft status (getFooterLegalLinks), so
  // these no longer gate Privacy / Confidentiality individually.
  showPrivacy?:        boolean;
  showConfidentiality?: boolean;
}

export async function SharedFooter({
  company, founder, copyright, isAdmin = false,
  height = 'standard',
  paddingTop, paddingBottom,
  showDescription  = true,
  showQuickLinks   = true,
  showCompanyLinks = true,
}: SharedFooterProps) {
  // Legal links are the PUBLISHED legal pages, in order. A page set to draft in
  // the Page Builder disappears here; a newly published one (e.g. Refund Policy)
  // appears automatically. No hardcoded list.
  const legalLinks = await getFooterLegalLinks();
  const heightPadding = { compact: '32px', standard: '40px', large: '64px' }[height];
  const topPad    = paddingTop    ? `${paddingTop}px`    : heightPadding;
  const bottomPad = paddingBottom ? `${paddingBottom}px` : heightPadding;

  // Some CMS rows (footer.copyright) and hardcoded callers (training-sessions
  // pages pass \u00A9) already include a leading copyright symbol. The bottom
  // row then prefixes its own literal ©, producing "© © 2026 ...". Stripping
  // any leading © / &copy; / &#169; plus whitespace from the value keeps a
  // single symbol on render regardless of where the string came from. Matches
  // the user-facing display only; admin edits through InlineEdit still save
  // whatever they type, and this strip is re-applied the next time the value
  // is rendered so the footer stays single-© forever.
  const copyrightDisplay = (copyright ?? '').replace(/^\s*(?:©|&copy;|&#169;)\s*/i, '');

  // I17: footer padding + inter-column gap scale with viewport so
  // phones don't have 80px of wasted horizontal gutter. The minmax
  // drops to 160px so two columns fit at 375px instead of stacking.
  return (
    <footer style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: '#0D2E5A', paddingTop: topPad, paddingBottom: bottomPad, paddingLeft: 'clamp(20px, 5vw, 40px)', paddingRight: 'clamp(20px, 5vw, 40px)', color: '#fff' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 'clamp(20px, 4vw, 40px)', marginBottom: 40 }}>

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
                ['About Us',   '/about/ahmad-din'],
                ['Founder',    '/about/ahmad-din'],
                ['Pricing',    '/pricing'],
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
            © <InlineEdit tag="span" section="footer" fieldKey="copyright" value={copyrightDisplay} isAdmin={isAdmin} darkBg />
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }} data-testid="footer-legal-links">
            {legalLinks.map((l) => (
              <Link key={l.slug} href={`/${l.slug}`} data-testid={`footer-legal-${l.slug}`} style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textDecoration: 'none' }}>
                {l.label}
              </Link>
            ))}
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>
              Structured Modeling. Real-World Finance.
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}

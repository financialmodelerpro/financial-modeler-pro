/**
 * NavbarServer — server component wrapper around Navbar.
 * Fetches nav pages from DB (respects admin visibility toggles)
 * and logo URL from CMS. All public pages should use this instead
 * of importing <Navbar /> directly.
 */
import { getSitePages, getCmsContent, cms } from '@/src/lib/shared/cms';
import { Navbar } from './Navbar';

interface Props {
  topOffset?: number;
}

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL   ?? 'https://app.financialmodelerpro.com';

/**
 * DB nav pages store relative hrefs (e.g. "/", "/about") which break on subdomains
 * because the browser resolves them against the current host. Absolutize them here
 * so that e.g. Home → financialmodelerpro.com/, Modeling Hub → app.*, Training Hub → learn.*
 */
function absolutizeHref(href: string): string {
  // Already absolute
  if (href.startsWith('http://') || href.startsWith('https://')) return href;

  // Subdomain-specific paths
  if (href === '/training' || href.startsWith('/training/')) return `${LEARN_URL}${href}`;
  if (href === '/modeling' || href.startsWith('/modeling/') || href === '/refm' || href.startsWith('/refm/')) return `${APP_URL}${href}`;

  // Everything else (including '/', '/about', '/pricing', etc.) belongs on main domain
  return `${MAIN_URL}${href}`;
}

export async function NavbarServer({ topOffset = 0 }: Props) {
  const [sitePages, content] = await Promise.all([
    getSitePages(),
    getCmsContent(),
  ]);
  // branding section = saved via admin/content; platform section = saved via admin/settings
  const logoUrl          = cms(content, 'branding', 'logo_url', '') || cms(content, 'platform', 'logo_url', '');
  const logoWidthInches  = cms(content, 'branding', 'logo_width_inches',  '');
  const logoHeightInches = cms(content, 'branding', 'logo_height_inches', '');
  const logoPosition     = cms(content, 'branding', 'logo_position',      'top-left');

  const absolutePages = sitePages.map(p => ({ ...p, href: absolutizeHref(p.href) }));

  return (
    <Navbar
      navPages={absolutePages.length > 0 ? absolutePages : undefined}
      topOffset={topOffset}
      logoUrl={logoUrl || undefined}
      logoWidthInches={logoWidthInches  || undefined}
      logoHeightInches={logoHeightInches || undefined}
      logoPosition={logoPosition || undefined}
    />
  );
}

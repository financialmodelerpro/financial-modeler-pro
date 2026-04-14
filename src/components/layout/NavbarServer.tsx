/**
 * NavbarServer — server component wrapper around Navbar.
 * Fetches nav pages from DB + header settings from cms_content.
 * All pages should use this instead of importing <Navbar /> directly.
 */
import { getSitePages, getCmsContent, cms } from '@/src/lib/shared/cms';
import { Navbar } from './Navbar';

interface Props {
  topOffset?: number;
}

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL   ?? 'https://app.financialmodelerpro.com';

function absolutizeHref(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href === '/training' || href.startsWith('/training/')) return `${LEARN_URL}${href}`;
  if (href === '/modeling' || href.startsWith('/modeling/') || href === '/refm' || href.startsWith('/refm/')) return `${APP_URL}${href}`;
  return `${MAIN_URL}${href}`;
}

export async function NavbarServer({ topOffset = 0 }: Props) {
  const [sitePages, content] = await Promise.all([
    getSitePages(),
    getCmsContent(),
  ]);

  // Read all header_settings from cms_content
  const hs = (k: string, fallback: string) => cms(content, 'header_settings', k, fallback);

  // Backward compat: if header_settings.logo_url is empty, try old branding/platform keys
  const logoUrlRaw = hs('logo_url', '') || cms(content, 'branding', 'logo_url', '') || cms(content, 'platform', 'logo_url', '');

  const absolutePages = sitePages.map(p => ({ ...p, href: absolutizeHref(p.href) }));

  return (
    <Navbar
      navPages={absolutePages.length > 0 ? absolutePages : undefined}
      topOffset={topOffset}
      logoEnabled={hs('logo_enabled', 'true') === 'true'}
      logoUrl={logoUrlRaw || undefined}
      logoWidthPx={hs('logo_width_px', '') || undefined}
      logoHeightPx={hs('logo_height_px', '36') || '36'}
      logoPosition={hs('logo_position', 'left')}
      showBrandName={hs('show_brand_name', 'true') === 'true'}
      brandName={hs('brand_name', 'Financial Modeler Pro')}
      showTagline={hs('show_tagline', 'true') === 'true'}
      tagline={hs('tagline', 'Structured Modeling. Real-World Finance.')}
      iconUrl={hs('icon_url', '') || undefined}
      iconAsFavicon={hs('icon_as_favicon', 'false') === 'true'}
      iconInHeader={hs('icon_in_header', 'false') === 'true'}
      iconSizePx={hs('icon_size_px', '20')}
      headerHeightPx={hs('header_height_px', '') || undefined}
      headerPaddingTopPx={hs('header_padding_top_px', '') || undefined}
      headerPaddingBottomPx={hs('header_padding_bottom_px', '') || undefined}
    />
  );
}

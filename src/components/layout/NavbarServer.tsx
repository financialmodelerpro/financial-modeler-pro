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
  return (
    <Navbar
      navPages={sitePages.length > 0 ? sitePages : undefined}
      topOffset={topOffset}
      logoUrl={logoUrl || undefined}
      logoWidthInches={logoWidthInches  || undefined}
      logoHeightInches={logoHeightInches || undefined}
      logoPosition={logoPosition || undefined}
    />
  );
}

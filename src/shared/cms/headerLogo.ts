/**
 * headerLogo.ts (2026-10-14)
 *
 * The ONE rule for which logo a header shows. The standard logo has dark blue
 * lettering that does not read on navy at any size, so a DARK header shows the
 * light version (`header_settings.logo_light_url`, set on /admin/header-settings)
 * and falls back to the standard logo while none is set. A light surface (the
 * Training Hub welcome modal, documents) keeps the standard logo.
 *
 * The light version is drawn on the standard logo's own canvas, so the shared
 * height setting gives both the same visual size.
 *
 * No em dashes in this file.
 */

/** The cms_content key (section `header_settings`) holding the light logo. */
export const LOGO_LIGHT_KEY = 'logo_light_url';

/** The logo a dark header shows: the light version, else the standard one, else ''. */
export function logoForDarkHeader(logos: { light?: string | null; standard?: string | null }): string {
  return (logos.light ?? '').trim() || (logos.standard ?? '').trim();
}

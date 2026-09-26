/**
 * InstalledAppFooter.tsx (2026-09-26)
 *
 * The installed Modeling Hub window's footer: the same attribution the
 * exports and emails carry (FMP_FOOTER_BASE, imported, never retyped) and the
 * deployed build, which is what /api/health reports and what support needs to
 * know. Rendered on the server by each installed-app layout; shown ONLY in the
 * installed window by installedAppCss (lib/pwa/appManifest.ts), so a browser
 * tab never sees it. Small and quiet: it must not compete with the page.
 *
 * No em dashes in this file.
 */
import { FMP_FOOTER_BASE } from '@/src/shared/email/templates/_base';
import { INSTALLED_FOOTER_PX } from '@/src/hubs/modeling/lib/pwa/appManifest';

export default function InstalledAppFooter(): React.JSX.Element {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  const build = sha ? sha.slice(0, 7) : '';
  return (
    <footer
      data-installed-only
      data-testid="installed-app-footer"
      style={{
        // display is set by installedAppCss only (none in a tab, flex in the app).
        height: INSTALLED_FOOTER_PX, boxSizing: 'border-box', alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: '0 16px', background: '#F5F7FA', borderTop: '1px solid #E5E7EB',
        fontSize: 11, color: '#9CA3AF', fontFamily: "'Inter', sans-serif", whiteSpace: 'nowrap', overflow: 'hidden',
      }}
    >
      <span>{FMP_FOOTER_BASE}</span>
      {build && <span aria-label={`Build ${build}`} style={{ color: '#C4C9D2' }}>Build {build}</span>}
    </footer>
  );
}

/**
 * TrainingShellServer — server component wrapper around TrainingShell.
 * Fetches logo from CMS and passes to the client component.
 */
import { getCmsContent, cms } from '@/src/lib/shared/cms';
import { TrainingShell } from './TrainingShell';

interface Props {
  children: React.ReactNode;
  activeNav?: 'dashboard' | 'live-sessions' | 'certificates';
  headerOnly?: boolean;
}

export async function TrainingShellServer({ children, activeNav, headerOnly }: Props) {
  const content = await getCmsContent();

  const hs = (k: string, fallback: string) => cms(content, 'header_settings', k, fallback);
  const logoUrl = hs('logo_url', '') || cms(content, 'branding', 'logo_url', '') || cms(content, 'platform', 'logo_url', '');
  const logoHeightPx = hs('logo_height_px', '36') || '36';

  return (
    <TrainingShell
      activeNav={activeNav}
      headerOnly={headerOnly}
      logoUrl={logoUrl || undefined}
      logoHeightPx={logoHeightPx}
    >
      {children}
    </TrainingShell>
  );
}

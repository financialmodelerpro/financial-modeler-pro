import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import SessionProviderWrapper from '@/src/components/shared/SessionProviderWrapper';
import BrandingThemeApplier from '@/src/components/shared/BrandingThemeApplier';
import { ToastProvider } from '@/src/components/ui/Toaster';
import { getServerClient } from '@/src/lib/shared/supabase';

const inter = Inter({ subsets: ['latin'] });

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const OG_TITLE  = 'Financial Modeler Pro — Professional Financial Modeling Platform';
const OG_DESC   = 'Professional financial modeling platform with free certification, interactive modeling tools, and expert-led training. 3-Statement Financial Modeling, Business Valuation, and more.';

export async function generateMetadata(): Promise<Metadata> {
  let iconUrl = '';

  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_content')
      .select('key, value')
      .eq('section', 'header_settings')
      .in('key', ['icon_url', 'icon_as_favicon']);
    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;
    if (map.icon_as_favicon === 'true' && map.icon_url) iconUrl = map.icon_url;
  } catch { /* use defaults */ }

  const ogImage = `${MAIN_URL}/api/og/main`;

  const base: Metadata = {
    metadataBase: new URL(MAIN_URL),
    title: OG_TITLE,
    description: OG_DESC,
    openGraph: {
      type: 'website',
      title: OG_TITLE,
      description: OG_DESC,
      siteName: 'Financial Modeler Pro',
      url: MAIN_URL,
      images: [{ url: ogImage, width: 1200, height: 627, alt: 'Financial Modeler Pro — Free Financial Modeling Certification' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: OG_TITLE,
      description: OG_DESC,
      images: [ogImage],
    },
  };

  if (iconUrl) base.icons = { icon: iconUrl };

  return base;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
        <SessionProviderWrapper>
          <ToastProvider>
            <BrandingThemeApplier />
            {children}
          </ToastProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}

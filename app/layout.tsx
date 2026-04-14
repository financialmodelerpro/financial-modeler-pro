import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import SessionProviderWrapper from '@/src/components/shared/SessionProviderWrapper';
import BrandingThemeApplier from '@/src/components/shared/BrandingThemeApplier';
import { ToastProvider } from '@/src/components/ui/Toaster';
import { getServerClient } from '@/src/lib/shared/supabase';

const inter = Inter({ subsets: ['latin'] });

export async function generateMetadata(): Promise<Metadata> {
  try {
    const sb = getServerClient();
    const { data } = await sb
      .from('cms_content')
      .select('key, value')
      .eq('section', 'header_settings')
      .in('key', ['icon_url', 'icon_as_favicon']);
    const map: Record<string, string> = {};
    for (const row of (data ?? []) as { key: string; value: string }[]) map[row.key] = row.value;

    const base: Metadata = {
      title: 'Financial Modeler Pro — Platform Hub',
      description: 'Professional financial modeling and planning platform suite.',
    };

    if (map.icon_as_favicon === 'true' && map.icon_url) {
      base.icons = { icon: map.icon_url };
    }

    return base;
  } catch {
    return {
      title: 'Financial Modeler Pro — Platform Hub',
      description: 'Professional financial modeling and planning platform suite.',
    };
  }
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

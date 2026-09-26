import PwaClient from '@/src/hubs/modeling/components/pwa/PwaClient';
import InstalledAppFooter from '@/src/hubs/modeling/components/pwa/InstalledAppFooter';

// INSTALLED APP (2026-09-26): account settings open inside the Modeling Hub's
// installed window, so the same client keeps its links that leave the app in a
// browser tab. It links no manifest; the app is installed from the hub itself.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PwaClient />
      {children}
      <InstalledAppFooter />
    </>
  );
}

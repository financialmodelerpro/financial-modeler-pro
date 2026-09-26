/**
 * GET /app-icon/<file> (2026-09-26), the Modeling Hub's installed-app icons.
 *
 * Drawn from the SITE FAVICON (header settings, "Use as Favicon") through the
 * one favicon rule, so the installed app shows the same mark as the browser
 * tab and follows it when an admin changes it. When no favicon is set or it
 * cannot be fetched, it falls back to the static copy under /pwa/, which
 * scripts/generate-pwa-icons.ts draws from the same favicon.
 *
 * No em dashes in this file.
 */
import { getServerClient } from '@/src/core/db/supabase';
import { readSiteFaviconUrl } from '@/src/shared/cms/siteFavicon';
import { isAppIconFile } from '@/src/hubs/modeling/lib/pwa/appManifest';
import { renderAppIcon } from '@/src/hubs/modeling/lib/pwa/appIcon';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await ctx.params;
  if (!isAppIconFile(file)) return new Response('Not found', { status: 404 });
  const fallback = (): Response => Response.redirect(new URL(`/pwa/${file}`, req.url), 307);
  try {
    const favicon = await readSiteFaviconUrl(getServerClient());
    if (!favicon) return fallback();
    const res = await fetch(favicon, { cache: 'no-store' });
    if (!res.ok) return fallback();
    const png = await renderAppIcon(Buffer.from(await res.arrayBuffer()), file);
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        // The manifest versions every icon URL by its favicon, so a long edge
        // cache is safe: a new favicon is a new URL.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch {
    return fallback();
  }
}

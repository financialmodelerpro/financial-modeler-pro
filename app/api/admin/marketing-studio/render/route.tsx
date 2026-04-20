import { NextRequest, NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { loadOgFonts } from '@/src/lib/shared/ogFonts';
import { imageToDataUri } from '@/src/lib/marketing/imageToDataUri';
import { backgroundToCss } from '@/src/lib/marketing/canvasDefaults';
import type { CanvasElement, CanvasBackground, CanvasDimensions } from '@/src/lib/marketing/types';

export const runtime = 'nodejs';
// Vercel Hobby caps at 10s; Pro allows up to 60s per the tier. Setting
// 60 is harmless on Hobby and gives headroom on Pro for designs with
// many remote images. The real "Failed to fetch" culprit was a single
// slow image URL holding imageToDataUri open indefinitely — that now
// has a per-image 5s timeout, so total render time is bounded.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

interface RenderPayload {
  dimensions: CanvasDimensions;
  background: CanvasBackground;
  elements: CanvasElement[];
}

/** POST /api/admin/marketing-studio/render — element-based canvas → PNG */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: RenderPayload;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { dimensions, background, elements } = body;
  if (!dimensions?.width || !dimensions?.height) {
    return NextResponse.json({ error: 'dimensions required' }, { status: 400 });
  }
  if (!Array.isArray(elements)) return NextResponse.json({ error: 'elements must be array' }, { status: 400 });

  // Fonts are required for satori to render any text reliably. If the
  // Inter files fail to load, ImageResponse without fonts silently dies
  // mid-stream on text-heavy designs — another "Failed to fetch" trigger.
  // We log the failure so the cause is visible in Vercel logs.
  const fonts = await loadOgFonts().catch((e) => {
    console.error('[marketing-studio/render] font load failed:', e);
    return [];
  });

  // Pre-resolve all remote images (background + image elements) as base64
  // — satori cannot fetch cross-origin URLs at render time. Per-image
  // timeout lives inside imageToDataUri; Promise.all total is bounded
  // by that × concurrency, never unbounded.
  const urls = new Set<string>();
  if (background?.type === 'image' && background.image) urls.add(background.image);
  for (const el of elements) if (el.type === 'image' && el.image?.src) urls.add(el.image.src);
  const resolved: Record<string, string> = {};
  await Promise.all(Array.from(urls).map(async (u) => { resolved[u] = await imageToDataUri(u).catch(() => ''); }));
  const unresolvedCount = Array.from(urls).filter(u => !resolved[u]).length;
  if (unresolvedCount > 0) {
    console.warn('[marketing-studio/render] unresolved image URLs:', unresolvedCount, 'of', urls.size);
  }

  const bgWithResolved: CanvasBackground = background.type === 'image' && background.image
    ? { ...background, image: resolved[background.image] || background.image }
    : background;
  const bgCss = backgroundToCss(bgWithResolved);

  const sorted = [...elements].sort((a, b) => a.zIndex - b.zIndex);

  try {
    return new ImageResponse(
      (
        <div style={{
          width: dimensions.width, height: dimensions.height,
          position: 'relative', display: 'flex', overflow: 'hidden',
          fontFamily: 'Inter, Arial, sans-serif',
          ...bgCss,
        }}>
          {/* Background image overlay */}
          {bgWithResolved.type === 'image' && bgWithResolved.overlay && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: bgWithResolved.overlay.color,
              opacity: bgWithResolved.overlay.opacity / 100,
              display: 'flex',
            }} />
          )}

          {sorted.map((el) => renderElement(el, resolved, dimensions))}
        </div>
      ),
      {
        width: dimensions.width,
        height: dimensions.height,
        // Pass `undefined` instead of an empty array when fonts failed —
        // ImageResponse falls back to its bundled defaults rather than
        // trying to use the missing Inter reference.
        fonts: fonts.length > 0 ? fonts : undefined,
      },
    );
  } catch (err) {
    // Only catches errors thrown synchronously during ImageResponse
    // construction. Satori errors inside the streamed body can still
    // surface as "Failed to fetch" on the client — logging payload
    // details here so Vercel logs capture what was attempted.
    console.error('[marketing-studio/render] error:', {
      message:       err instanceof Error ? err.message : String(err),
      dimensions,
      elementCount:  elements.length,
      unresolvedCount,
    });
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Render failed',
      hint:  unresolvedCount > 0 ? `${unresolvedCount} image(s) couldn't be loaded` : undefined,
    }, { status: 500 });
  }
}

// ── Server-side element rendering (satori-compatible JSX) ───────────────────
function renderElement(el: CanvasElement, resolved: Record<string, string>, dims: CanvasDimensions) {
  const pos: React.CSSProperties = {
    position: 'absolute',
    left: el.x, top: el.y,
    width: el.width, height: el.height,
    zIndex: el.zIndex,
    display: 'flex',
    overflow: 'hidden',
  };

  if (el.type === 'text' && el.text) {
    const t = el.text;
    return (
      <div key={el.id} style={{
        ...pos,
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: t.textAlign === 'center' ? 'center' : t.textAlign === 'right' ? 'flex-end' : 'flex-start',
      }}>
        <div style={{
          width: '100%',
          color: t.color,
          fontSize: t.fontSize,
          fontWeight: t.fontWeight,
          fontFamily: `${t.fontFamily}, Inter, Arial, sans-serif`,
          fontStyle: t.fontStyle ?? 'normal',
          textAlign: t.textAlign,
          lineHeight: t.lineHeight,
          letterSpacing: t.letterSpacing,
          whiteSpace: 'pre-wrap',
          display: 'flex',
          flexWrap: 'wrap',
          ...(t.textAlign === 'center' ? { justifyContent: 'center' } : t.textAlign === 'right' ? { justifyContent: 'flex-end' } : {}),
        }}>
          {t.content}
        </div>
      </div>
    );
  }

  if (el.type === 'image' && el.image) {
    const i = el.image;
    const src = resolved[i.src] || '';
    const radius = i.borderRadius <= 50 ? `${i.borderRadius}%` : `${i.borderRadius}px`;
    const hasBorder = (i.borderWidth ?? 0) > 0 && i.borderColor && i.borderColor !== 'transparent';
    if (!src) return <div key={el.id} style={{ ...pos, background: 'rgba(0,0,0,0.1)', borderRadius: radius, border: hasBorder ? `${i.borderWidth}px solid ${i.borderColor}` : undefined }} />;
    const filters: string[] = [];
    if (i.filter === 'grayscale') filters.push('grayscale(100%)');
    if (i.filter === 'blur')      filters.push('blur(6px)');
    if (i.brightness !== 100)     filters.push(`brightness(${i.brightness}%)`);
    return (
      <div key={el.id} style={{
        ...pos,
        borderRadius: radius,
        overflow: 'hidden',
        border: hasBorder ? `${i.borderWidth}px solid ${i.borderColor}` : undefined,
        boxSizing: 'border-box',
        opacity: i.opacity / 100,
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          width={el.width}
          height={el.height}
          style={{
            width: '100%', height: '100%',
            objectFit: i.objectFit,
            filter: filters.length ? filters.join(' ') : undefined,
            display: 'flex',
          }}
        />
      </div>
    );
  }

  if (el.type === 'shape' && el.shape) {
    const s = el.shape;
    return (
      <div key={el.id} style={{
        ...pos,
        background: s.backgroundColor,
        borderRadius: s.borderRadius <= 50 ? `${s.borderRadius}%` : `${s.borderRadius}px`,
        border: s.borderWidth > 0 ? `${s.borderWidth}px solid ${s.borderColor}` : 'none',
        opacity: s.opacity / 100,
      }} />
    );
  }

  // Silence unused-var for dims; satori doesn't need it but keep the param for future guards
  void dims;
  return null;
}

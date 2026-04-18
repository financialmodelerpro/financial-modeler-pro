import { NextRequest, NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/lib/shared/auth';
import { loadOgFonts } from '@/src/lib/shared/ogFonts';
import { imageToDataUri } from '@/src/lib/marketing/imageToDataUri';
import { backgroundToCss } from '@/src/lib/marketing/canvasDefaults';
import type { CanvasElement, CanvasBackground, CanvasDimensions } from '@/src/lib/marketing/types';

export const runtime = 'nodejs';

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

  const fonts = await loadOgFonts().catch(() => []);

  // Pre-resolve all remote images (background + image elements) as base64
  // — satori cannot fetch cross-origin URLs at render time.
  const urls = new Set<string>();
  if (background?.type === 'image' && background.image) urls.add(background.image);
  for (const el of elements) if (el.type === 'image' && el.image?.src) urls.add(el.image.src);
  const resolved: Record<string, string> = {};
  await Promise.all(Array.from(urls).map(async (u) => { resolved[u] = await imageToDataUri(u).catch(() => ''); }));

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
      { width: dimensions.width, height: dimensions.height, fonts },
    );
  } catch (err) {
    console.error('[marketing-studio/render] error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Render failed' }, { status: 500 });
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

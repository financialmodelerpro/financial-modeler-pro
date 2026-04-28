import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/src/shared/auth/nextauth';
import { getServerClient } from '@/src/core/db/supabase';
import satori from 'satori';
import sharp from 'sharp';
import { loadOgFonts } from '@/src/shared/ogFonts';

export const runtime = 'nodejs';

const W = 800;
const H = 500;

// ── Mission Image JSX ──────────────────────────────────────────────────────
function MissionJsx() {
  return (
    <div style={{ width: W, height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(145deg, #0f1729 0%, #1a2744 100%)', position: 'relative', overflow: 'hidden', fontFamily: 'Inter' }}>
      {/* Grid pattern */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px', display: 'flex' }} />

      {/* Globe - outer ring */}
      <div style={{ width: 220, height: 220, borderRadius: '50%', border: '3px solid rgba(45, 212, 191, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', boxShadow: '0 0 60px rgba(45, 212, 191, 0.15)' }}>
        {/* Globe - inner ring */}
        <div style={{ width: 160, height: 160, borderRadius: '50%', border: '2px solid rgba(45, 212, 191, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Globe - core */}
          <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'radial-gradient(circle at 40% 40%, rgba(45, 212, 191, 0.25), rgba(45, 212, 191, 0.05))', border: '2px solid rgba(45, 212, 191, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(45, 212, 191, 0.2)', display: 'flex' }} />
          </div>
        </div>
      </div>

      {/* Connection dots */}
      {[
        { x: 120, y: 90 }, { x: 620, y: 120 }, { x: 160, y: 370 },
        { x: 580, y: 350 }, { x: 350, y: 80 }, { x: 480, y: 400 },
        { x: 100, y: 220 }, { x: 680, y: 240 },
      ].map((dot, i) => (
        <div key={i} style={{ position: 'absolute', left: dot.x, top: dot.y, width: 6 + (i % 3) * 2, height: 6 + (i % 3) * 2, borderRadius: '50%', background: `rgba(45, 212, 191, ${0.3 + (i % 4) * 0.15})`, boxShadow: '0 0 12px rgba(45, 212, 191, 0.3)', display: 'flex' }} />
      ))}

      {/* Horizontal latitude lines on globe */}
      <div style={{ position: 'absolute', width: 180, height: 1, background: 'rgba(45, 212, 191, 0.2)', top: 235, display: 'flex' }} />
      <div style={{ position: 'absolute', width: 140, height: 1, background: 'rgba(45, 212, 191, 0.15)', top: 265, display: 'flex' }} />

      {/* Bottom accent line */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent, #2DD4BF, #27AE60, transparent)', display: 'flex' }} />
    </div>
  );
}

// ── Vision Image JSX ───────────────────────────────────────────────────────
function VisionJsx() {
  return (
    <div style={{ width: W, height: H, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', background: 'linear-gradient(145deg, #0f1729 0%, #1a2744 100%)', position: 'relative', overflow: 'hidden', fontFamily: 'Inter', padding: '0 80px 60px' }}>
      {/* Grid pattern */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.04, backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px', display: 'flex' }} />

      {/* Background bars (subtle) */}
      {[140, 180, 230, 200, 260, 300, 280, 340].map((h, i) => (
        <div key={i} style={{ position: 'absolute', bottom: 60, left: 60 + i * 85, width: 50, height: h, borderRadius: '6px 6px 0 0', background: `rgba(45, 212, 191, ${0.04 + i * 0.01})`, display: 'flex' }} />
      ))}

      {/* Main growth bars */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, position: 'relative', zIndex: 1 }}>
        {[
          { h: 100, c: 'rgba(45, 212, 191, 0.3)' },
          { h: 150, c: 'rgba(45, 212, 191, 0.4)' },
          { h: 130, c: 'rgba(45, 212, 191, 0.35)' },
          { h: 200, c: 'rgba(45, 212, 191, 0.5)' },
          { h: 180, c: 'rgba(45, 212, 191, 0.45)' },
          { h: 250, c: 'rgba(45, 212, 191, 0.6)' },
          { h: 230, c: 'rgba(45, 212, 191, 0.55)' },
          { h: 310, c: 'rgba(45, 212, 191, 0.7)' },
        ].map((bar, i) => (
          <div key={i} style={{ width: 48, height: bar.h, borderRadius: '8px 8px 0 0', background: bar.c, display: 'flex', position: 'relative' }}>
            {i === 7 && (
              <div style={{ position: 'absolute', top: -30, left: '50%', transform: 'translateX(-50%)', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 20, height: 20, background: '#F59E0B', borderRadius: '50%', boxShadow: '0 0 20px rgba(245, 158, 11, 0.4)', display: 'flex' }} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Upward trend line */}
      <svg width="640" height="350" viewBox="0 0 640 350" style={{ position: 'absolute', bottom: 60, left: 80, zIndex: 2 }}>
        <path d="M 0 300 Q 80 280 160 250 Q 240 200 320 220 Q 400 180 480 130 Q 560 60 640 20" fill="none" stroke="#2DD4BF" strokeWidth="3" opacity="0.7" />
        <path d="M 0 300 Q 80 280 160 250 Q 240 200 320 220 Q 400 180 480 130 Q 560 60 640 20" fill="none" stroke="#2DD4BF" strokeWidth="8" opacity="0.1" />
      </svg>

      {/* Bottom accent line */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent, #2DD4BF, #F59E0B, transparent)', display: 'flex' }} />
    </div>
  );
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if ((session?.user as { role?: string } | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const fonts = await loadOgFonts();
    const sb = getServerClient();
    const results: Record<string, string> = {};

    for (const { name, jsx } of [
      { name: 'mission-image.png', jsx: MissionJsx() },
      { name: 'vision-image.png', jsx: VisionJsx() },
    ]) {
      // Render JSX to SVG via satori
      const svg = await satori(jsx, { width: W, height: H, fonts });

      // Convert SVG to PNG via sharp
      const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();

      // Upload to Supabase storage
      await sb.storage.from('cms-assets').upload(name, pngBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

      const { data: urlData } = sb.storage.from('cms-assets').getPublicUrl(name);
      results[name] = urlData.publicUrl;
    }

    // Update CMS page_sections with image URLs
    const missionUrl = results['mission-image.png'];
    const visionUrl = results['vision-image.png'];

    if (missionUrl) {
      // Update Mission section imageSrc
      const { data: missionSections } = await sb
        .from('page_sections')
        .select('id, content')
        .eq('page_slug', 'home')
        .eq('section_type', 'text_image')
        .ilike('content::text', '%Our Mission%');

      for (const s of (missionSections ?? [])) {
        const content = s.content as Record<string, unknown>;
        await sb.from('page_sections').update({
          content: { ...content, imageSrc: missionUrl, imageAlt: 'Our Mission - Global Access' },
          updated_at: new Date().toISOString(),
        }).eq('id', s.id);
      }
    }

    if (visionUrl) {
      const { data: visionSections } = await sb
        .from('page_sections')
        .select('id, content')
        .eq('page_slug', 'home')
        .eq('section_type', 'text_image')
        .ilike('content::text', '%Our Vision%');

      for (const s of (visionSections ?? [])) {
        const content = s.content as Record<string, unknown>;
        await sb.from('page_sections').update({
          content: { ...content, imageSrc: visionUrl, imageAlt: 'Our Vision - Growth and Leadership' },
          updated_at: new Date().toISOString(),
        }).eq('id', s.id);
      }
    }

    return NextResponse.json({ ok: true, urls: results });
  } catch (err) {
    console.error('[generate-images] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

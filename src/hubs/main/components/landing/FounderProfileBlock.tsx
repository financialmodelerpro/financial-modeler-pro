/**
 * THE founder profile block: the home page section, and the instructor section
 * of a live course page. ONE profile record (the home page's `team` CMS section,
 * edited at /admin/page-builder/home) rendered the same way everywhere.
 *
 * Moved verbatim from app/(portal)/page.tsx (2026-11-08). The one change: every
 * HTML field (bio, long bio, philosophy) is SANITISED before it reaches
 * CmsField, which renders HTML as-is. A course page showed the instructor bio's
 * raw <p> tags because it read a different record as text; it now renders this.
 */
import type React from 'react';
import Link from 'next/link';
import { CmsField, cmsVisible } from '@/src/hubs/main/components/cms/CmsField';
import { sanitizeArticleHtml } from '@/src/shared/cms/sanitizeArticle';
import { FounderExpand } from './FounderExpand';

const FOUNDER_NAME = 'Ahmad Din';
const FOUNDER_SHORT_BIO = 'Corporate Finance and Transaction Advisory specialist with deep expertise in financial modeling across real estate, business valuation, and corporate finance.';

/** HTML is sanitised; plain text passes through for CmsField's paragraph handling. */
export function safeProfileHtml(v: string): string {
  return /<[a-z][\s\S]*?>/i.test(v) ? sanitizeArticleHtml(v) : v;
}

export function FounderProfileBlock({
  content, bgColor, badgeFallback = 'The Founder', badgeOverride, isAdmin = false, id,
}: {
  /** The `team` CMS section's content (null = fallbacks). */
  content: Record<string, unknown> | null | undefined;
  bgColor?: string;
  badgeFallback?: string;
  /** e.g. "Your instructor" on a course page. */
  badgeOverride?: string;
  isAdmin?: boolean;
  id?: string;
}) {
  const fc = content ?? undefined;
  const fBadge   = badgeOverride || (fc?.badge as string) || badgeFallback;
  const fName    = (fc?.name as string)             || FOUNDER_NAME;
  const fTitle   = (fc?.title as string)            || 'Corporate Finance & Transaction Advisory Specialist | Financial Modeling Expert';
  const fBio     = safeProfileHtml((fc?.bio as string) || FOUNDER_SHORT_BIO);
  const fQuals   = (fc?.qualifications as string)   || '';
  const fCreds   = (fc?.credentials as string[])    || ['12+ years in Corporate Finance & Advisory','Experience across KSA & Pakistan','Lender-grade models: IRR, DSCR, Feasibility','Real estate, energy, infrastructure & industrial sectors','Transaction advisory & investment support'];
  const fPhoto   = (fc?.photo_url as string)        || '';
  const fRadius  = (fc?.photo_radius as string)     || '12px';
  const fFit     = (fc?.photo_fit as string)        || 'contain';
  const fLinkedIn = (fc?.cta_secondary_url as string) || (fc?.linkedin_url as string) || '';
  const fCtaPri  = (fc?.cta_primary_text as string) || 'Read Full Profile →';
  const fCtaUrl  = (fc?.cta_primary_url as string)  || '/about/ahmad-din';
  const fCtaSec  = (fc?.cta_secondary_text as string) || 'Connect on LinkedIn →';
  const fBookTxt = (fc?.booking_text as string)     || 'Book a Meeting';
  const fBookUrl = (fc?.booking_url as string)      || '';
  const fLongBio = safeProfileHtml((fc?.long_bio as string) || '');
  const fPhilo   = safeProfileHtml((fc?.philosophy as string) || '');
  const fShowMore = fc?.show_read_more !== false;
  const fMoreLabel = (fc?.read_more_label as string) || 'Read Full Profile →';
  const fBg      = bgColor ?? '#1B3A6B';
  return (
    <section id={id} data-testid="founder-profile-block" style={{ padding:'64px 40px 80px', background:fBg, color:'#fff' }}>
      <style>{`
        @media (max-width: 640px) {
          .fmp-founder-img-col { order: -1 !important; }
        }
      `}</style>
      <div style={{ maxWidth:1100, margin:'0 auto' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap:56, alignItems:'center' }}>
          <div className="fmp-founder-img-col" style={{ display:'flex', justifyContent:'center', order:1 }}>
            {fPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fPhoto} alt={fName} style={{ width:'100%', maxWidth:400, height:'auto', objectFit:fFit as React.CSSProperties['objectFit'], borderRadius:fRadius, display:'block' }} />
            ) : (
              <div style={{ width:'100%', maxWidth:400, height:320, borderRadius:fRadius, background:'linear-gradient(135deg,#0D2E5A,#1B4F8A)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <span style={{ fontSize:72, fontWeight:800, color:'rgba(255,255,255,0.9)', letterSpacing:'-2px', fontFamily:"'Inter',sans-serif" }}>AD</span>
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:'#4A90D9', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:14 }}>{fBadge}</div>
            <h2 style={{ fontSize:'clamp(22px,3vw,32px)', fontWeight:800, color:'#fff', marginBottom:6 }}>{fName}</h2>
            {/* Title split on | */}
            <div style={{ marginBottom:4 }}>
              {fTitle.split('|').map((line, i) => (
                <div key={i} style={{ fontSize: i===0 ? '1rem' : '0.95rem', color: i===0 ? '#93C5FD' : '#1ABC9C', fontWeight: i===0 ? 500 : 600, marginBottom:2 }}>{line.trim()}</div>
              ))}
            </div>
            {/* Qualifications */}
            {fQuals && (
              <div style={{ fontSize:'0.85rem', color:'rgba(255,255,255,0.6)', letterSpacing:'0.05em', marginBottom:16, marginTop:4 }}>{fQuals}</div>
            )}
            <CmsField
              // As before: with a CMS record, its own bio (sanitised); without one, the fallback.
              content={fc ? { ...fc, bio: safeProfileHtml((fc.bio as string) || '') } : { bio: fBio }}
              field="bio"
              style={{ fontSize:14.5, color:'rgba(255,255,255,0.65)', lineHeight:1.75, marginBottom:16 }}
            />
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:24 }}>
              {fCreds.slice(0, 5).map(text=>(
                <div key={text} style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ color:'#4A90D9', fontWeight:700, fontSize:12, flexShrink:0 }}>✓</span>
                  <span style={{ fontSize:13.5, color:'rgba(255,255,255,0.6)' }}>{text}</span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <Link href="/admin/page-builder/home" target="_blank" style={{ fontSize:11, color:'#93C5FD', textDecoration:'none', display:'block', marginBottom:20 }}>✏️ Edit founder profile in Admin →</Link>
            )}
            <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
              {cmsVisible(fc ?? {}, 'cta_primary') && (
                <Link href={fCtaUrl} style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1B4F8A', border:'1px solid #1B4F8A', color:'#fff', fontSize:13, fontWeight:700, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>{fCtaPri}</Link>
              )}
              {cmsVisible(fc ?? {}, 'cta_secondary') && fLinkedIn && (
                <a href={fLinkedIn} target="_blank" rel="noopener noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'transparent', border:'1px solid rgba(255,255,255,0.25)', color:'rgba(255,255,255,0.8)', fontSize:13, fontWeight:600, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>{fCtaSec}</a>
              )}
              {cmsVisible(fc ?? {}, 'booking') && fBookUrl && (
                <Link href="/book-a-meeting" style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#1ABC9C', color:'#fff', fontSize:13, fontWeight:700, padding:'9px 20px', borderRadius:7, textDecoration:'none' }}>📅 {fBookTxt}</Link>
              )}
            </div>
            {fShowMore && (fLongBio || fCreds.length > 0) && (
              <FounderExpand label={fMoreLabel} longBio={fLongBio} experience={fCreds} philosophy={fPhilo} name={fName} photoUrl={fPhoto} photoRadius={fRadius} qualifications={fQuals} bookingUrl={fBookUrl} bookingText={fBookTxt} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

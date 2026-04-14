import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedComment {
  id: string;
  author: string;
  authorPhoto: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

/**
 * GET /api/training/youtube-comments?videoId=xxx
 * Returns cached YouTube comments, refreshing from API if cache is stale.
 */
export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get('videoId');
  if (!videoId) {
    return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  }

  const sb = getServerClient();

  // Check cache
  const { data: cached } = await sb
    .from('youtube_comments_cache')
    .select('comments, fetched_at')
    .eq('video_id', videoId)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS) {
    return NextResponse.json({ comments: cached.comments as CachedComment[], cached: true });
  }

  // Fetch fresh from YouTube API
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    // No API key — return cache if available, else empty
    return NextResponse.json({
      comments: (cached?.comments as CachedComment[]) ?? [],
      cached: true,
    });
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=10&order=relevance&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok || !data.items) {
      // API error (quota exceeded, etc.) — return stale cache if available
      return NextResponse.json({
        comments: (cached?.comments as CachedComment[]) ?? [],
        cached: true,
        error: 'unavailable',
      });
    }

    const comments: CachedComment[] = data.items.map((item: Record<string, unknown>) => {
      const snippet = (item.snippet as Record<string, unknown>);
      const tlc = (snippet.topLevelComment as Record<string, unknown>);
      const s = (tlc.snippet as Record<string, unknown>);
      return {
        id: item.id as string,
        author: s.authorDisplayName as string,
        authorPhoto: s.authorProfileImageUrl as string,
        text: s.textDisplay as string,
        likeCount: s.likeCount as number,
        publishedAt: s.publishedAt as string,
      };
    });

    // Upsert cache
    await sb.from('youtube_comments_cache').upsert({
      video_id: videoId,
      comments,
      fetched_at: new Date().toISOString(),
      comment_count: comments.length,
    }, { onConflict: 'video_id' });

    return NextResponse.json({ comments, cached: false });
  } catch {
    // Network error — return stale cache if available
    return NextResponse.json({
      comments: (cached?.comments as CachedComment[]) ?? [],
      cached: true,
      error: 'unavailable',
    });
  }
}

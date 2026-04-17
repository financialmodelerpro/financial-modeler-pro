import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/src/lib/shared/supabase';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS          = 24 * 60 * 60 * 1000; // 24 hours — successful fetches
const NEGATIVE_CACHE_TTL_MS =  1 * 60 * 60 * 1000; //  1 hour  — failed fetches

interface CachedComment {
  id: string;
  author: string;
  authorPhoto: string;
  text: string;
  likeCount: number;
  publishedAt: string;
}

type Status    = 'ok' | 'empty' | 'error' | 'cached_error';
type ErrorType = 'no_api_key' | 'quota_exceeded' | 'comments_disabled' | 'api_error' | 'network_error';

function json(body: {
  comments: CachedComment[];
  cached: boolean;
  status: Status;
  errorType?: ErrorType;
}) {
  return NextResponse.json(body);
}

/** Write a negative-cache row so we don't retry for NEGATIVE_CACHE_TTL_MS. */
async function writeNegativeCache(videoId: string) {
  try {
    const sb = getServerClient();
    await sb.from('youtube_comments_cache').upsert({
      video_id: videoId,
      comments: [],
      fetched_at: new Date().toISOString(),
      comment_count: -1, // sentinel — distinguishes error from genuinely 0 comments
    }, { onConflict: 'video_id' });
  } catch (e) {
    console.error('[youtube-comments] failed to write negative cache:', e);
  }
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

  // ── Check cache ───────────────────────────────────────────────────────────
  const { data: cached } = await sb
    .from('youtube_comments_cache')
    .select('comments, comment_count, fetched_at')
    .eq('video_id', videoId)
    .maybeSingle();

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    const isNegative = cached.comment_count === -1;

    // Negative cache hit — still within 1h TTL
    if (isNegative && age < NEGATIVE_CACHE_TTL_MS) {
      return json({ comments: [], cached: true, status: 'cached_error', errorType: 'api_error' });
    }

    // Positive cache hit — still within 24h TTL
    if (!isNegative && age < CACHE_TTL_MS) {
      const comments = (cached.comments as CachedComment[]) ?? [];
      return json({
        comments,
        cached: true,
        status: comments.length > 0 ? 'ok' : 'empty',
      });
    }
  }

  // ── No API key ────────────────────────────────────────────────────────────
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error(`[youtube-comments] YOUTUBE_API_KEY not set (videoId=${videoId})`);
    await writeNegativeCache(videoId);
    return json({ comments: [], cached: false, status: 'error', errorType: 'no_api_key' });
  }

  // ── Fetch from YouTube API ────────────────────────────────────────────────
  try {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&maxResults=10&order=relevance&key=${apiKey}`;
    const res = await fetch(url);

    if (!res.ok) {
      // Try to parse the error body for specific reason codes
      let errorType: ErrorType = 'api_error';
      try {
        const errBody = await res.json();
        const reason = errBody?.error?.errors?.[0]?.reason as string | undefined;
        if (res.status === 403 && reason === 'commentsDisabled') {
          errorType = 'comments_disabled';
        } else if (res.status === 403) {
          errorType = 'quota_exceeded';
        }
      } catch { /* body wasn't JSON — use generic api_error */ }

      console.error(`[youtube-comments] YouTube API ${res.status} for videoId=${videoId} (${errorType})`);
      await writeNegativeCache(videoId);
      return json({ comments: [], cached: false, status: 'error', errorType });
    }

    const data = await res.json();

    if (!data.items) {
      // 200 but no items — genuinely zero comments
      await sb.from('youtube_comments_cache').upsert({
        video_id: videoId,
        comments: [],
        fetched_at: new Date().toISOString(),
        comment_count: 0,
      }, { onConflict: 'video_id' });

      return json({ comments: [], cached: false, status: 'empty' });
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

    return json({
      comments,
      cached: false,
      status: comments.length > 0 ? 'ok' : 'empty',
    });
  } catch (err) {
    console.error(`[youtube-comments] Network error for videoId=${videoId}:`, err);
    await writeNegativeCache(videoId);
    return json({ comments: [], cached: false, status: 'error', errorType: 'network_error' });
  }
}

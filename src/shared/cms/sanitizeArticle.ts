import sanitizeHtml from 'sanitize-html';

/**
 * sanitizeArticle.ts
 *
 * Strict allow-list sanitizer for public article body HTML. Runs at render, after
 * the {{MID_IMAGE}} marker resolves, immediately before dangerouslySetInnerHTML on
 * app/articles/[slug]. The .article-body CSS is element-based (the class lives on
 * the wrapper div, not in the body), so no class hooks are allowed here.
 *
 * Uses sanitize-html (pure Node, no jsdom) so it runs reliably in the serverless
 * runtime. The previous isomorphic-dompurify implementation depended on jsdom,
 * which failed at render on Vercel (500) while working locally.
 *
 * Allowed tags:  p h2 h3 blockquote figure figcaption img ul ol li a strong em br
 *                plus structural: hr code pre table thead tbody tr th td
 * Allowed attrs: href (links), src / alt (images). No colspan/rowspan: neither the
 *                .article-body CSS nor the live content uses them.
 * Stripped:      script, style, iframe, event handlers (on*), inline style, and any
 *                tag not on the list (dropped; script/style content removed).
 *
 * No em dashes in this file.
 */

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'h2', 'h3', 'blockquote', 'figure', 'figcaption', 'img', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'br',
    'hr', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href'],
    img: ['src', 'alt'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Discard disallowed tags (script/style content is removed via nonTextTags default).
  disallowedTagsMode: 'discard',
};

export function sanitizeArticleHtml(html: string): string {
  try {
    return sanitizeHtml(html ?? '', OPTIONS);
  } catch {
    // Defense in depth: a sanitizer failure must never 500 the page. Fall back to a
    // plain-text strip (safe, no markup) so the article still renders.
    return (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }
}

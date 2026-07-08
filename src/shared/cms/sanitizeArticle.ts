import DOMPurify from 'isomorphic-dompurify';

/**
 * sanitizeArticle.ts
 *
 * Strict allow-list sanitizer for public article body HTML. Runs at render, after
 * the {{MID_IMAGE}} marker resolves, immediately before dangerouslySetInnerHTML on
 * app/articles/[slug]. The .article-body CSS is element-based (the class lives on
 * the wrapper div, not in the body), so no class hooks are allowed here.
 *
 * Allowed tags:  p h2 h3 blockquote figure figcaption img ul ol li a strong em br
 *                plus structural: hr code pre table thead tbody tr th td
 * Allowed attrs: href (links), src / alt (images). No colspan/rowspan: neither the
 *                .article-body CSS nor the live content uses them, so they stay out.
 * Stripped:      script, style, iframe, event handlers (on*), inline style, and any
 *                tag not on the list (DOMPurify drops the tag; safe text is kept,
 *                script/style content is removed).
 *
 * No em dashes in this file.
 */

const ALLOWED_TAGS = [
  'p', 'h2', 'h3', 'blockquote', 'figure', 'figcaption', 'img', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'br',
  // Structural/formatting elements, all non-scripting, all with existing .article-body CSS.
  'hr', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const ALLOWED_ATTR = ['href', 'src', 'alt'];

export function sanitizeArticleHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'input'],
    FORBID_ATTR: ['style'],            // explicit: strip inline styles
    ALLOW_DATA_ATTR: false,            // no data-* hooks
    // DOMPurify blocks javascript:/other unsafe URI schemes by default and never
    // permits event-handler (on*) attributes, so href/src stay safe.
  });
}

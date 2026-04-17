/** Detect if a string contains HTML tags */
const HTML_RE = /<[a-z][\s\S]*?>/i;
export function isHtml(text: string): boolean {
  return HTML_RE.test(text);
}

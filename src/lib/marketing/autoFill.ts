import type { CanvasElement } from './types';

export interface AutoFillSource {
  title: string;
  subtitle?: string;
  session?: string;
  date?: string;
}

/**
 * Element id → purpose. Match element ids by substring so preset-generated ids
 * (e.g. "title-abc123") still resolve to the correct slot.
 *
 * Order matters: we check more specific keys first.
 */
function bucketFor(id: string): 'title' | 'subtitle' | 'session' | 'tag' | 'series' | null {
  const lower = id.toLowerCase();
  if (lower.startsWith('session-') || lower.includes('session_number')) return 'session';
  if (lower.startsWith('title2-')) return 'subtitle'; // FMP YouTube title line 2 gets subtitle text
  if (lower.startsWith('title-')   || lower.startsWith('headline-')) return 'title';
  if (lower.startsWith('subtitle-') || lower.startsWith('insight-') || lower.startsWith('description-')) return 'subtitle';
  if (lower.startsWith('tag-'))    return 'tag';
  if (lower.startsWith('series-')) return 'series';
  return null;
}

/**
 * Return a new elements array with text content replaced based on a data source.
 * Non-text elements and text elements that don't match any bucket are untouched.
 */
export function autoFillElements(elements: CanvasElement[], source: AutoFillSource): CanvasElement[] {
  return elements.map((el) => {
    if (el.type !== 'text' || !el.text) return el;
    const bucket = bucketFor(el.id);
    if (!bucket) return el;

    let next: string | null = null;
    if (bucket === 'title')    next = source.title;
    if (bucket === 'subtitle') next = source.subtitle || '';
    if (bucket === 'session')  next = source.session || '';
    // 'tag' + 'series' intentionally preserved — they're brand labels, not content

    if (next === null) return el;
    if (!next) return el; // skip empty overwrites so preset defaults don't get wiped
    return { ...el, text: { ...el.text, content: next } };
  });
}

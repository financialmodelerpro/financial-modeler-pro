/**
 * shared/utils/testimonialByline.ts
 *
 * One formatter for the line under a testimonial author's name.
 *
 * Both testimonial systems already capture a title and a company (Training Hub
 * stores job_title + company on student_testimonials; Modeling Hub stores role +
 * company on testimonials), and both are optional. This renders them as
 * "{title} at {company}" without ever producing a dangling "at" when one side is
 * missing, which is why every card must go through here rather than joining the
 * two values inline.
 *
 *   title + company -> "Financial Analyst at KPMG"
 *   title only      -> "Financial Analyst"
 *   company only    -> "KPMG"          (no leading "at")
 *   neither         -> ""              (callers render nothing)
 *
 * No em dashes in this file.
 */

/**
 * Format the author byline. Returns '' when there is nothing to show, so a
 * caller can guard with a simple truthiness check.
 */
export function testimonialByline(
  title: string | null | undefined,
  company: string | null | undefined,
): string {
  const t = (title ?? '').trim();
  const c = (company ?? '').trim();
  if (t && c) return `${t} at ${c}`;
  return t || c;
}

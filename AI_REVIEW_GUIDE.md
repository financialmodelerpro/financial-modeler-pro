# AI Review Guide

This guide records the repository audit completed on 2026-07-31. It is a
prioritized remediation reference, not an implementation plan.

## Immediate priorities

1. Require authentication for `POST /api/email/send` in every environment.
   The current conditional secret check permits an unauthenticated email relay
   when `RESEND_WEBHOOK_SECRET` is missing.
2. Protect transcript generation and cached transcript access with verified
   student ownership or a scoped, expiring share token.
3. Remove unauthenticated student-record lookups by email, registration ID, or
   certificate ID. Keep public verification responses minimal and free of PII
   and private document URLs.
4. Require ownership checks before retrieving or issuing transcript share links.

## Security findings

| Severity | Location | Risk | Review direction |
| --- | --- | --- | --- |
| Critical | `app/api/email/send/route.ts:30` | Open email relay if the secret is unset. | Make auth mandatory; validate input and rate-limit requests. |
| Critical | `app/api/training/transcript/route.tsx:624` | Arbitrary student transcript generation from supplied email and registration ID. | Authenticate and verify ownership; use scoped share tokens only where intended. |
| Critical | `app/api/training/certificate/route.ts:48` | Student PII and private document URLs exposed through public lookup parameters. | Split public verification from authenticated dashboard data. |
| High | `app/api/training/transcript-link/route.ts:38` | Unauthenticated callers can obtain or create transcript share links. | Require the owner session on GET, POST, and DELETE. |
| High | `app/api/training/certificate-image/route.ts:10` | Certificate and transcript URLs can be retrieved by email/certificate ID. | Require ownership for private data. |
| High | `app/(portal)/page.tsx:463` | Unsanitized CMS icon HTML can create stored XSS. | Use an allow-listed icon model or strict server-side sanitization. |
| Medium | `app/admin/communications-hub/NewsletterTab.tsx:541` | Unsanitized newsletter HTML can execute in an admin browser. | Sanitize strictly or preview in a sandboxed iframe. |

## Correctness and React findings

| Severity | Location | Risk | Review direction |
| --- | --- | --- | --- |
| Medium | `src/hubs/training/components/dashboard/CourseContent.tsx:77` | Conditional early return changes hook order. | Run hooks unconditionally; handle invalid courses outside the hook sequence. |
| Medium | `app/admin/page-builder/[slug]/page.tsx:227` | Render-time random IDs are unstable between renders. | Generate and persist IDs only on creation or migration. |
| Medium | `src/hubs/training/components/dashboard/CourseContent.tsx:90` | Attachment fetch failures are silently ignored. | Check non-OK responses and show a retryable error state. |
| Low | Multiple files | Synchronous effect state updates cause extra rendering. | Prefer derived initial state or asynchronous callbacks. |

## Quality gate status

- `npm run type-check` passed.
- `npm run lint` failed with 401 errors and 268 warnings.
- Restore a passing lint baseline before relying on it as a CI gate. Prioritize
  rules-of-hooks, React purity/ref errors, and unsafe `any` usage before
  cosmetic lint items.

## Review checklist for future changes

- Every service-role Supabase query must have an explicit authentication and
  ownership/role check in the route before the query.
- Public endpoints must return only intentionally public fields and should not
  accept email or predictable identifiers as authorization.
- Treat all CMS, newsletter, and rich-text HTML as untrusted until sanitized.
- Validate JSON request bodies with a schema and return safe error messages.
- Add a limit/pagination strategy to list queries and avoid fetching records
  solely to filter or count them in JavaScript.
- Do not suppress TypeScript or React hook errors without a documented reason.
- Keep `npm run type-check` and `npm run lint` green in CI.

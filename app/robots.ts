import type { MetadataRoute } from 'next';

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_URL ?? 'https://financialmodelerpro.com';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // `/api/og/` is explicitly allowed so LinkedInBot / Twitterbot /
        // WhatsApp etc. can fetch the dynamic OG images embedded in share
        // previews. More specific allows override the broader `/api/` block
        // below (robots.txt precedence = longest matching rule wins).
        allow: ['/', '/api/og/'],
        disallow: [
          '/admin/',
          '/admin',
          '/api/',
          '/_next/',
          // Authenticated / behind-auth areas — not indexable
          '/training/dashboard',
          '/training/signin',
          '/training/register',
          '/training/forgot',
          '/training/confirm-email',
          '/training/set-password',
          '/training/certificate',
          '/training/certificates',
          '/training/transcript',
          '/training/material',
          '/training/watch/',
          '/training/assessment/',
          '/training/live-sessions/',
          '/training/submit-testimonial',
          '/training/coming-soon',
          '/modeling/dashboard',
          '/portal',
          '/modeling/signin',
          '/modeling/register',
          '/modeling/confirm-email',
          '/modeling/submit-testimonial',
          '/refm',
          // One-off auth pages on the main domain
          '/login',
          '/forgot-password',
          '/reset-password',
          '/signin',
          '/register',
          '/forgot',
          // Tokenized URLs (verification / share links)
          '/t/',
        ],
      },
      // Block scraping bots used for LLM training by default — public-facing
      // content is still fully indexable by Google, Bing, etc.
      { userAgent: 'GPTBot',          disallow: '/' },
      { userAgent: 'ChatGPT-User',    disallow: '/' },
      { userAgent: 'CCBot',           disallow: '/' },
      { userAgent: 'anthropic-ai',    disallow: '/' },
      { userAgent: 'Claude-Web',      disallow: '/' },
      { userAgent: 'Google-Extended', disallow: '/' },
    ],
    sitemap: `${MAIN_URL}/sitemap.xml`,
    host: MAIN_URL,
  };
}

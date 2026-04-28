/**
 * JSON-LD helpers. Each component emits a single `<script type="application/ld+json">`
 * tag. Safe to drop into any server component. Pass fully-qualified URLs so the
 * structured data is portable across our three subdomains.
 *
 * Reference: https://schema.org + https://developers.google.com/search/docs/appearance/structured-data
 */

const MAIN_URL  = process.env.NEXT_PUBLIC_MAIN_URL  ?? 'https://financialmodelerpro.com';
const LEARN_URL = process.env.NEXT_PUBLIC_LEARN_URL ?? 'https://learn.financialmodelerpro.com';

function Ld({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      // Escaping `</script>` in JSON is sufficient; next/script would strip it.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/** Rendered once in the root layout — organization-level facts. */
export function OrganizationJsonLd() {
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Financial Modeler Pro',
      alternateName: 'FMP',
      url: MAIN_URL,
      logo: `${MAIN_URL}/api/og/main`,
      description: 'Practitioner-built financial modeling platform and training hub. Professional training in 3-Statement Modeling, Business Valuation, Real Estate, Project Finance, and Corporate Finance.',
      founder: {
        '@type': 'Person',
        name: 'Ahmad Din',
        jobTitle: 'Corporate Finance & Transaction Advisory Specialist',
        url: `${MAIN_URL}/about/ahmad-din`,
        sameAs: ['https://www.linkedin.com/in/meetahmaddin/'],
      },
      foundingDate: '2024',
      sameAs: [
        'https://www.linkedin.com/showcase/financialmodelerpro/',
        'https://www.youtube.com/@FinancialModelerPro',
      ],
      areaServed: [
        { '@type': 'Country', name: 'Saudi Arabia' },
        { '@type': 'Country', name: 'United Arab Emirates' },
        { '@type': 'Country', name: 'Qatar' },
        { '@type': 'Country', name: 'Kuwait' },
        { '@type': 'Country', name: 'Bahrain' },
        { '@type': 'Country', name: 'Oman' },
        { '@type': 'Country', name: 'Pakistan' },
      ],
      knowsAbout: [
        'Financial Modeling',
        '3-Statement Financial Modeling',
        'Business Valuation',
        'Real Estate Financial Modeling',
        'Corporate Finance',
        'Transaction Advisory',
        'LBO Modeling',
        'Project Finance',
        'FP&A Modeling',
        'Equity Research',
      ],
    }} />
  );
}

export function WebSiteJsonLd() {
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Financial Modeler Pro',
      url: MAIN_URL,
      publisher: { '@type': 'Organization', name: 'Financial Modeler Pro' },
      inLanguage: 'en',
    }} />
  );
}

interface PersonLdProps {
  name: string;
  jobTitle?: string;
  image?: string;
  bio?: string;
  url: string;
  sameAs?: string[];
  worksFor?: string;
}
export function PersonJsonLd({ name, jobTitle, image, bio, url, sameAs = [], worksFor = 'Financial Modeler Pro' }: PersonLdProps) {
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'Person',
      name,
      jobTitle,
      image,
      description: bio,
      url,
      sameAs: sameAs.filter(Boolean),
      worksFor: worksFor ? { '@type': 'Organization', name: worksFor } : undefined,
    }} />
  );
}

interface CourseLdProps {
  name: string;
  description: string;
  url: string;
  image?: string;
  provider?: string;
}
export function CourseJsonLd({ name, description, url, image, provider = 'Financial Modeler Pro' }: CourseLdProps) {
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'Course',
      name,
      description,
      url,
      image,
      provider: {
        '@type': 'Organization',
        name: provider,
        sameAs: MAIN_URL,
      },
      educationalCredentialAwarded: 'Certificate of Completion',
      inLanguage: 'en',
      offers: {
        '@type': 'Offer',
        category: 'Education',
        price: '0',
        priceCurrency: 'USD',
      },
    }} />
  );
}

interface ArticleLdProps {
  title: string;
  description: string;
  image?: string;
  publishedTime?: string | null;
  modifiedTime?: string | null;
  author?: string;
  url: string;
}
export function ArticleJsonLd({ title, description, image, publishedTime, modifiedTime, author = 'Ahmad Din', url }: ArticleLdProps) {
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description,
      image: image ?? `${MAIN_URL}/api/og/main`,
      datePublished: publishedTime ?? undefined,
      dateModified: modifiedTime ?? publishedTime ?? undefined,
      author: {
        '@type': 'Person',
        name: author,
        url: `${MAIN_URL}/about/ahmad-din`,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Financial Modeler Pro',
        logo: { '@type': 'ImageObject', url: `${MAIN_URL}/api/og/main` },
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    }} />
  );
}

interface BreadcrumbItem { name: string; url: string }
export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((item, idx) => ({
        '@type': 'ListItem',
        position: idx + 1,
        name: item.name,
        item: item.url,
      })),
    }} />
  );
}

interface FAQItem { question: string; answer: string }
export function FAQJsonLd({ items }: { items: FAQItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: items.map(i => ({
        '@type': 'Question',
        name: i.question,
        acceptedAnswer: { '@type': 'Answer', text: i.answer },
      })),
    }} />
  );
}

interface EventLdProps {
  name: string;
  description: string;
  startDate: string;
  endDate?: string;
  image?: string;
  url: string;
  isVirtual?: boolean;
  instructor?: string;
  status?: 'scheduled' | 'recorded' | 'cancelled';
}
export function EventJsonLd({ name, description, startDate, endDate, image, url, isVirtual = true, instructor, status = 'scheduled' }: EventLdProps) {
  const schemaStatus = status === 'cancelled' ? 'EventCancelled' : 'EventScheduled';
  const eventMode = isVirtual ? 'OnlineEventAttendanceMode' : 'OfflineEventAttendanceMode';
  return (
    <Ld data={{
      '@context': 'https://schema.org',
      '@type': 'Event',
      name,
      description,
      startDate,
      endDate,
      image,
      url,
      eventStatus: `https://schema.org/${schemaStatus}`,
      eventAttendanceMode: `https://schema.org/${eventMode}`,
      location: isVirtual ? {
        '@type': 'VirtualLocation',
        url: LEARN_URL,
      } : undefined,
      organizer: {
        '@type': 'Organization',
        name: 'Financial Modeler Pro',
        url: MAIN_URL,
      },
      performer: instructor ? { '@type': 'Person', name: instructor } : undefined,
    }} />
  );
}

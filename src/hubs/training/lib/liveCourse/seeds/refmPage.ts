/**
 * The REFM live course landing page content (founder brief, 2026-11-08).
 * Data only: written to training_course_settings.page_sections by
 * scripts/seed-refm-sessions.ts when the course has none yet, then edited in
 * Admin > Live Training > REFM > Page sections. No "What you will build" section.
 */
import type { PageConfig } from '../pageSections';
import { BODY_SECTIONS } from '../pageSections';

export const REFM_PAGE: PageConfig = {
  order: [...BODY_SECTIONS],
  sections: {
    hero: { enabled: true, facts: ['8 instructor-led sessions · 20 hours of structured learning', 'Tuesdays 7:00 PM KSA', 'Starts 1 Dec 2026', 'Free', 'Certificate'], countdown: true },
    sideCard: { enabled: true, enrolledThreshold: 25 },
    about: { enabled: true },
    curriculum: { enabled: true, heading: 'Sessions' },
    skills: {
      enabled: true, heading: 'Skills you will gain',
      items: [
        { icon: 'layers', title: 'Area chain', text: 'From land and FAR to GFA, sellable area and built-up area' },
        { icon: 'grid', title: 'Vintage matrix', text: 'Residential collections by year of sale in one formula' },
        { icon: 'banknote', title: 'Non-circular finance cost', text: 'Debt, capitalised interest and the cash waterfall' },
        { icon: 'hotel', title: 'USALI hotel P&L', text: 'From keys and ADR to EBITDA' },
        { icon: 'trending-up', title: 'Returns and fund fees', text: 'IRR, MOIC, preferred return and performance fee' },
        { icon: 'bot', title: 'Modeling with Claude', text: 'Building and reviewing complex schedules with AI, checked in Excel' },
      ],
    },
    whoFor: {
      enabled: true, heading: 'Who it is for',
      items: [
        { icon: 'building', title: 'Real estate developers', text: 'Build and test your own project models before committing capital.' },
        { icon: 'briefcase', title: 'Family offices and investors', text: 'Understand how returns, fees and funding really work in a development.' },
        { icon: 'users', title: 'Advisory firms', text: 'Deliver investor-grade development models faster, to a consistent standard.' },
        { icon: 'graduation-cap', title: 'Career starters', text: 'Learn the real estate modeling skills GCC employers look for.' },
      ],
    },
    certification: {
      enabled: true, heading: 'How certification works', showSamples: true,
      steps: [
        { title: 'Attend or watch', text: 'Attend at least 75% of each session live, or watch its recording in full. Earn a session certificate for each one.' },
        { title: 'Submit your model', text: 'Submit your completed Marina Gate model. Our team reviews it, with up to 3 attempts.' },
        { title: 'Get certified', text: 'Receive your course certificate and badge, verifiable with a QR code.' },
      ],
    },
    tools: {
      enabled: true, heading: 'Tools you will use',
      items: [
        { icon: 'file-spreadsheet', title: 'Microsoft Excel', text: 'Every schedule built by hand, formula by formula' },
        { icon: 'bot', title: 'Claude', text: 'AI segments in every session, with every output checked' },
        { icon: 'video', title: 'Microsoft Teams', text: 'Live sessions, joined from your dashboard' },
        { icon: 'monitor', title: 'Financial Modeler Pro', text: 'The same case on the platform in the final session' },
      ],
    },
    instructor: { enabled: true, heading: 'Your instructor', shortBio: '' },
    testimonials: { enabled: true, heading: 'What participants say', ids: [] },
    faq: {
      enabled: true, heading: 'Frequently asked questions',
      items: [
        { q: 'Is the course really free?', a: 'Yes. All 8 live sessions, recordings, materials and the certificate are free.' },
        { q: 'What level is this course?', a: 'It is for people comfortable with three-statement and DCF modeling in Excel. It is not a beginner course.' },
        { q: 'When are the sessions?', a: 'Every Tuesday, 7:00 to 9:30 PM KSA, from 1 December 2026 to 26 January 2027, with no session on 29 December. Use "See times in your region" to see your local time.' },
        { q: 'How do I join a live session?', a: 'Register, then join from your dashboard. The Join live button opens 15 minutes before each session and takes you to Microsoft Teams.' },
        { q: 'What if I miss a session?', a: 'The recording is added to your dashboard after the session. Watch it in full and that session still counts toward your certificate.' },
        { q: 'What software do I need?', a: 'Microsoft Excel (Microsoft 365 or Excel 2019 or later recommended) and Microsoft Teams. A Claude account is useful for the Build with Claude segments, but you can also follow along by watching.' },
        { q: 'What materials do I get?', a: 'After each session you get the slides, the Claude prompts and the case files on your dashboard.' },
        { q: 'How do I earn the certificate?', a: 'For every session, attend at least 75% live or watch the recording in full. Then submit your completed model. Our team reviews it, with up to 3 attempts, and approved models receive the course certificate and badge with QR verification.' },
        { q: 'Do I get anything for each session?', a: 'Yes. You earn a session certificate for each session you complete, which you can download and share.' },
        { q: 'What if a session is rescheduled?', a: 'You will get an email with the new time and an updated calendar invite, and your dashboard will show the new date.' },
        { q: 'What language is the course in?', a: 'English.' },
      ],
    },
    cta: { enabled: true, text: 'Build a full real estate development and fund model in 8 weeks. Free, live, with a certificate.' },
  },
};

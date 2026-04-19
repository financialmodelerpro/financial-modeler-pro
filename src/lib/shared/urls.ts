// Central place for all cross-domain URLs.
// Import URLS instead of hardcoding domain strings anywhere.

export const URLS = {
  main:  process.env.NEXT_PUBLIC_MAIN_URL  || 'https://financialmodelerpro.com',
  learn: process.env.NEXT_PUBLIC_LEARN_URL || 'https://learn.financialmodelerpro.com',
  app:   process.env.NEXT_PUBLIC_APP_URL   || 'https://app.financialmodelerpro.com',

  // Training (learn subdomain)
  training:      () => `${URLS.learn}/training`,
  trainingLogin: () => `${URLS.learn}/signin`,
  dashboard:     () => `${URLS.learn}/training/dashboard`,

  // Modeling (app subdomain)
  modeling:      () => `${URLS.app}/modeling`,
  refm:          () => `${URLS.app}/refm`,

  // Verification (canonical host is learn.* — QR codes, share previews,
  // and OG metadata all resolve here. Migration 113 moved all stored
  // verification URLs to learn; main→learn redirect still honours any
  // legacy shares that predate the migration.)
  verify:        (id: string) => `${URLS.learn}/verify/${id}`,
};

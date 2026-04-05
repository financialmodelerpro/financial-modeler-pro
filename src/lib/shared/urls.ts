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

  // Verification (always on main domain)
  verify:        (id: string) => `${URLS.main}/verify/${id}`,
};

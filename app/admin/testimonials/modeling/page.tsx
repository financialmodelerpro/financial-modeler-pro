'use client';

// Modeling Hub testimonials - pre-filtered to hub='modeling'
// Shares the same component as /admin/testimonials but with hub locked to 'modeling'

import TestimonialsAdminPage from '../TestimonialsAdminShared';

export default function ModelingTestimonialsPage() {
  return <TestimonialsAdminPage defaultHub="modeling" />;
}

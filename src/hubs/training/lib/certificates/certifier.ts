/**
 * certifier.ts - DEPRECATED
 * Certifier.io integration has been replaced with the internal certificate system.
 * This file is kept as a stub to avoid import errors during the transition.
 * All certificate generation now happens via certificateEngine.ts + Supabase storage.
 */

export interface CertifierCredential {
  id: string;
  recipientName: string;
  recipientEmail: string;
  issuedOn: string;
  courseTitle: string;
  imageUrl: string;
  certUrl: string;
  attributes: Record<string, string>;
}

/** @deprecated Use internal certificate system via student_certificates table */
export async function getCertifierCredential(_uuid: string): Promise<CertifierCredential | null> {
  return null;
}

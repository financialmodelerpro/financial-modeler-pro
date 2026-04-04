const CERTIFIER_API_BASE = 'https://api.certifier.io/v1';

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

export async function getCertifierCredential(uuid: string): Promise<CertifierCredential | null> {
  try {
    const res = await fetch(`${CERTIFIER_API_BASE}/credentials/${uuid}`, {
      headers: {
        Authorization: `Bearer ${process.env.CERTIFIER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id:             data.id ?? uuid,
      recipientName:  data.recipient?.name ?? '',
      recipientEmail: data.recipient?.email ?? '',
      issuedOn:       data.issuedOn ?? '',
      courseTitle:    data.group?.title ?? '',
      imageUrl:       data.imageUrl ?? '',
      certUrl:        data.certUrl ?? '',
      attributes:     data.attributes ?? {},
    };
  } catch {
    return null;
  }
}

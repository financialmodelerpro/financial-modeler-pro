/** Verifies an hCaptcha token server-side. */
export async function verifyCaptcha(token: string): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret:   process.env.HCAPTCHA_SECRET_KEY ?? '',
        response: token,
      }),
    });
    const data = await res.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

import { readFile } from 'fs/promises';
import path from 'path';

type Weight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
type OgFont = { name: string; data: Buffer; weight: Weight; style: 'normal' };

let cached: OgFont[] | null = null;

/** Load Inter font files for satori / ImageResponse. Cached after first call. */
export async function loadOgFonts(): Promise<OgFont[]> {
  if (cached) return cached;
  const dir = path.join(process.cwd(), 'src/assets/fonts');
  const [regular, bold, extraBold] = await Promise.all([
    readFile(path.join(dir, 'Inter-Regular.ttf')),
    readFile(path.join(dir, 'Inter-Bold.ttf')),
    readFile(path.join(dir, 'Inter-ExtraBold.ttf')),
  ]);
  cached = [
    { name: 'Inter', data: regular, weight: 400, style: 'normal' },
    { name: 'Inter', data: bold, weight: 700, style: 'normal' },
    { name: 'Inter', data: extraBold, weight: 800, style: 'normal' },
  ];
  return cached;
}

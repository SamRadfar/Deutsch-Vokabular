// Generates the PWA icons from public/brand-icon.jpg (run once when the brand image changes):
//   node scripts/generate-icons.mjs
// The source has a white rounded frame; the icons use the inner square (flag background):
//  - icon-{192,512}.png     purpose "any": rounded corners, transparent outside
//  - maskable-512.png       purpose "maskable": full-bleed square (content inside the 80% safe zone)
//  - apple-touch-icon.png   180×180 full-bleed (iOS applies its own mask)
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = `data:image/jpeg;base64,${readFileSync(resolve(root, 'public/brand-icon.jpg')).toString('base64')}`;
const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });

const ICONS = [
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'maskable-512.png', size: 512, rounded: false },
  { file: 'apple-touch-icon.png', size: 180, rounded: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');
for (const icon of ICONS) {
  const dataUrl = await page.evaluate(async ({ src, size, rounded }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.getElementById('c');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, size, size);
    if (rounded) {
      const r = size * 0.22;
      g.beginPath();
      g.roundRect(0, 0, size, size, r);
      g.clip();
    }
    // Inner square of the 300×300 source (inside the white rounded frame).
    g.drawImage(img, 18, 18, 264, 264, 0, 0, size, size);
    return c.toDataURL('image/png');
  }, { src, size: icon.size, rounded: icon.rounded });
  writeFileSync(resolve(out, icon.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`  public/icons/${icon.file}`);
}
await browser.close();

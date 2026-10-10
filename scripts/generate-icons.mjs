// Renders the raster icons and social preview image in public/ from the Common mark and src/site.ts.
// Usage: CHROME_PATH=/path/to/chrome node scripts/generate-icons.mjs   (needs Chrome or Chromium)
import { chromium } from 'playwright-core';

const { SITE } = await import('../src/site.ts').catch(() => ({ SITE: null }));
const tagline = SITE?.tagline ?? 'A common space for you, your people and your agents.';
const INK = '#1c1c1a';
const mark = (size, stroke = 1.5) => `<svg width="${size}" height="${size}" viewBox="2.6 2.7 18.8 18.8" fill="none"><defs><clipPath id="a"><circle cx="12" cy="8.9" r="5.4"/></clipPath><clipPath id="b" clip-path="url(#a)"><circle cx="8.4" cy="15.1" r="5.4"/></clipPath></defs><circle cx="15.6" cy="15.1" r="5.4" fill="${INK}" clip-path="url(#b)"/><g stroke="${INK}" stroke-width="${stroke}"><circle cx="12" cy="8.9" r="5.4"/><circle cx="8.4" cy="15.1" r="5.4"/><circle cx="15.6" cy="15.1" r="5.4"/></g></svg>`;

// Square app icons: full-bleed so platforms can apply their own mask; the mark stays inside the safe zone.
const icon = (size, scale = 0.56, stroke = 1.5) =>
  `<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:#fdfdfc">${mark(Math.round(size * scale), stroke)}</body>`;
const og = `<body style="margin:0;width:1200px;height:630px;overflow:hidden;position:relative;background:#f5f5f2;font-family:-apple-system,'SF Pro Display','Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK}">
  <div style="position:absolute;width:640px;height:640px;left:-120px;top:-220px;border-radius:50%;background:#d1e5d7;filter:blur(110px);opacity:.9"></div>
  <div style="position:absolute;width:640px;height:640px;right:-160px;bottom:-300px;border-radius:50%;background:#ddd6f5;filter:blur(110px);opacity:.9"></div>
  <div style="position:absolute;width:520px;height:520px;right:120px;top:-300px;border-radius:50%;background:#d5e4f5;filter:blur(110px);opacity:.7"></div>
  <div style="position:relative;height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 96px">
    <div style="display:flex;align-items:center;gap:22px">
      <div style="width:104px;height:104px;border-radius:30px;background:#fff;display:grid;place-items:center;box-shadow:0 0 0 1px rgba(28,28,26,.06),0 24px 48px -20px rgba(28,28,26,.3)">${mark(66, 1.4)}</div>
      <div style="font-size:52px;font-weight:700;letter-spacing:-0.03em">${SITE?.name ?? 'Common'}</div>
    </div>
    <div style="margin-top:44px;max-width:900px;font-size:68px;line-height:1.08;font-weight:700;letter-spacing:-0.035em">${tagline.replace(/\.$/, '')}</div>
  </div>
</body>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
async function render(html, width, height, file) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head>${html}</html>`);
  await page.screenshot({ path: `public/${file}`, clip: { x: 0, y: 0, width, height } });
  await page.close();
}
await render(icon(180), 180, 180, 'apple-touch-icon.png');
await render(icon(192), 192, 192, 'icon-192.png');
await render(icon(512), 512, 512, 'icon-512.png');
await render(icon(48, 0.72, 1.9), 48, 48, 'favicon-48.png'); // converted to favicon.ico (16/32/48), then removed
await render(og, 1200, 630, 'og.png');
await browser.close();

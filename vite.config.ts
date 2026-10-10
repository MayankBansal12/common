import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SITE } from './src/site';
import { LEGAL, PRIVACY, TERMS, type LegalDoc } from './src/legal';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MARK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs><clipPath id="a"><circle cx="12" cy="8.9" r="5.4"/></clipPath><clipPath id="b" clip-path="url(#a)"><circle cx="8.4" cy="15.1" r="5.4"/></clipPath></defs><circle cx="15.6" cy="15.1" r="5.4" fill="currentColor" clip-path="url(#b)"/><g stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8.9" r="5.4"/><circle cx="8.4" cy="15.1" r="5.4"/><circle cx="15.6" cy="15.1" r="5.4"/></g></svg>`;

/** A legal document as a standalone, readable page: no JavaScript, same look and metadata as the app. */
function legalPage(doc: LegalDoc, origin: string) {
  const title = `${doc.title} · ${SITE.name}`;
  const url = origin ? `${origin}/${doc.slug}` : `/${doc.slug}`;
  const image = (origin || '') + SITE.ogImage.path;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(doc.description)}" />
<meta name="theme-color" content="${SITE.themeColor}" />
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
${origin ? `<link rel="canonical" href="${url}" />\n` : ''}<meta property="og:type" content="article" />
<meta property="og:site_name" content="${SITE.name}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(doc.description)}" />
${origin ? `<meta property="og:url" content="${url}" />\n` : ''}<meta property="og:image" content="${image}" />
<meta name="twitter:card" content="summary_large_image" />
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: ${SITE.backgroundColor}; color: #1c1c1a; font: 16px/1.65 ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  a { color: inherit; text-decoration-color: rgba(28, 28, 26, 0.3); text-underline-offset: 3px; }
  a:hover { text-decoration-color: currentColor; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 32px 22px 64px; }
  header { display: flex; align-items: center; justify-content: space-between; }
  .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 650; letter-spacing: -0.015em; text-decoration: none; }
  .open { font-size: 14px; color: #57554f; }
  article { margin-top: 36px; padding: 36px 32px; background: #fff; border-radius: 22px; box-shadow: 0 0 0 1px rgba(28, 28, 26, 0.06), 0 18px 48px -24px rgba(40, 38, 28, 0.18); }
  h1 { margin: 0; font-size: 32px; line-height: 1.15; letter-spacing: -0.03em; }
  .date { margin: 8px 0 0; font-size: 14px; color: #8f8d86; }
  .intro { margin: 22px 0 0; font-size: 17px; color: #3a3935; }
  h2 { margin: 34px 0 8px; font-size: 18px; letter-spacing: -0.015em; }
  p { margin: 0 0 12px; color: #3a3935; }
  ul { margin: 0 0 12px; padding-left: 20px; color: #3a3935; }
  li { margin: 6px 0; }
  footer { margin-top: 28px; display: flex; gap: 18px; justify-content: center; font-size: 14px; color: #8f8d86; }
  @media (max-width: 560px) { article { padding: 26px 20px; border-radius: 18px; } h1 { font-size: 27px; } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="brand" href="/">${MARK}<span>${SITE.name}</span></a>
    <a class="open" href="/">Open ${SITE.name} →</a>
  </header>
  <article>
    <h1>${esc(doc.title)}</h1>
    <p class="date">Effective ${LEGAL.effective}</p>
    <p class="intro">${doc.intro}</p>
${doc.sections.map((s) => `    <h2>${esc(s.heading)}</h2>\n    ${s.html}`).join('\n')}
  </article>
  <footer>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
    <a href="mailto:${LEGAL.contact}">Contact</a>
  </footer>
</div>
</body>
</html>
`;
}

/**
 * Builds every metadata surface from src/site.ts so they can't drift: <head> tags (title,
 * description, Open Graph, Twitter), site.webmanifest, robots.txt, the /privacy and /terms pages
 * (from src/legal.ts) and, once the public origin is known (VITE_SITE_URL), canonical/og:url links
 * and sitemap.xml.
 */
function site(): Plugin {
  let origin = '';
  const abs = (path: string) => (origin ? origin + path : path);
  const manifest = () =>
    JSON.stringify(
      {
        name: SITE.name,
        short_name: SITE.name,
        description: SITE.tagline,
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: SITE.backgroundColor,
        theme_color: SITE.themeColor,
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      null,
      2,
    );
  const robots = () => `User-agent: *\nAllow: /\n${origin ? `\nSitemap: ${origin}/sitemap.xml\n` : ''}`;
  const sitemap = () =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', '/privacy', '/terms'].map((p) => `  <url><loc>${origin}${p}</loc></url>`).join('\n')}\n</urlset>\n`;
  const files: Record<string, { type: string; body: () => string }> = {
    '/site.webmanifest': { type: 'application/manifest+json', body: manifest },
    '/robots.txt': { type: 'text/plain', body: robots },
    // Served at /privacy and /terms; built as privacy.html / terms.html (vercel.json's cleanUrls maps them).
    '/privacy': { type: 'text/html; charset=utf-8', body: () => legalPage(PRIVACY, origin) },
    '/terms': { type: 'text/html; charset=utf-8', body: () => legalPage(TERMS, origin) },
  };

  return {
    name: 'common-site',
    configResolved(config) {
      origin = (config.env.VITE_SITE_URL ?? '').replace(/\/+$/, '');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = req.url && files[req.url.split('?')[0].replace(/\.html$/, '')];
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(file.body());
      });
    },
    transformIndexHtml() {
      const meta = (attrs: Record<string, string>): HtmlTagDescriptor => ({ tag: 'meta', attrs, injectTo: 'head' });
      const link = (attrs: Record<string, string>): HtmlTagDescriptor => ({ tag: 'link', attrs, injectTo: 'head' });
      const image = abs(SITE.ogImage.path);
      return [
        { tag: 'title', children: SITE.title, injectTo: 'head' },
        meta({ name: 'description', content: SITE.tagline }),
        meta({ name: 'application-name', content: SITE.name }),
        meta({ name: 'apple-mobile-web-app-title', content: SITE.name }),
        meta({ name: 'theme-color', content: SITE.themeColor }),
        meta({ name: 'color-scheme', content: 'light' }),
        link({ rel: 'icon', href: '/favicon.ico', sizes: '32x32' }),
        link({ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }),
        link({ rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }),
        link({ rel: 'manifest', href: '/site.webmanifest' }),
        ...(origin ? [link({ rel: 'canonical', href: `${origin}/` })] : []),
        meta({ property: 'og:type', content: 'website' }),
        meta({ property: 'og:site_name', content: SITE.name }),
        meta({ property: 'og:title', content: SITE.title }),
        meta({ property: 'og:description', content: SITE.tagline }),
        ...(origin ? [meta({ property: 'og:url', content: `${origin}/` })] : []),
        meta({ property: 'og:image', content: image }),
        meta({ property: 'og:image:width', content: String(SITE.ogImage.width) }),
        meta({ property: 'og:image:height', content: String(SITE.ogImage.height) }),
        meta({ property: 'og:image:alt', content: SITE.ogImage.alt }),
        meta({ name: 'twitter:card', content: 'summary_large_image' }),
        meta({ name: 'twitter:title', content: SITE.title }),
        meta({ name: 'twitter:description', content: SITE.tagline }),
        meta({ name: 'twitter:image', content: image }),
        meta({ name: 'twitter:image:alt', content: SITE.ogImage.alt }),
      ];
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'site.webmanifest', source: manifest() });
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots() });
      this.emitFile({ type: 'asset', fileName: 'privacy.html', source: legalPage(PRIVACY, origin) });
      this.emitFile({ type: 'asset', fileName: 'terms.html', source: legalPage(TERMS, origin) });
      if (origin) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() });
    },
  };
}

export default defineConfig({ plugins: [react(), site()], server: { allowedHosts: ['.getbb.app'] } });

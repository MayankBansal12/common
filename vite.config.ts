import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SITE } from './src/site';

/**
 * Builds every metadata surface from src/site.ts so they can't drift: <head> tags (title,
 * description, Open Graph, Twitter), site.webmanifest, robots.txt and, once the public origin
 * is known (VITE_SITE_URL), canonical/og:url links and sitemap.xml.
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
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`;
  const files: Record<string, { type: string; body: () => string }> = {
    '/site.webmanifest': { type: 'application/manifest+json', body: manifest },
    '/robots.txt': { type: 'text/plain', body: robots },
  };

  return {
    name: 'common-site',
    configResolved(config) {
      origin = (config.env.VITE_SITE_URL ?? '').replace(/\/+$/, '');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const file = req.url && files[req.url.split('?')[0]];
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
      if (origin) this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap() });
    },
  };
}

export default defineConfig({ plugins: [react(), site()], server: { allowedHosts: ['.getbb.app'] } });

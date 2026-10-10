// The one source for how Common describes itself. Page metadata, social previews, the web
// manifest, robots.txt/sitemap (see vite.config.ts), in-app copy and emails all read from here.
export const SITE = {
  name: 'Common',
  tagline: 'A common space for you, your people and your agents.',
  // The short form, for tight spots like the loading screen.
  short: 'A shared space',
  title: 'Common · A common space for you, your people and your agents',
  // Matches the app's surfaces: --panel for browser chrome, --page behind it.
  themeColor: '#fdfdfc',
  backgroundColor: '#f5f5f2',
  ogImage: { path: '/og.png', width: 1200, height: 630, alt: 'Common: a common space for you, your people and your agents.' },
} as const;

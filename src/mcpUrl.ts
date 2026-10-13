/**
 * The MCP server URL people paste into their agent, or `null` when it can't be known.
 * Prefers the explicit `.convex.site` origin; otherwise derives it from the standard `.convex.cloud`
 * client URL (or a local `convex dev` backend, whose HTTP actions sit one port up). Never returns a
 * relative path: an agent can't resolve one.
 */
export function mcpUrlFrom({ siteUrl, convexUrl }: { siteUrl?: string; convexUrl?: string }): string | null {
  const site = parse(siteUrl);
  // Convex site URLs are bare origins; anything with a path, query or fragment is a misconfiguration.
  if (site && site.pathname === '/' && !site.search && !site.hash) return `${site.origin}/mcp`;
  const cloud = parse(convexUrl);
  if (!cloud) return null;
  if (cloud.hostname.endsWith('.convex.cloud')) {
    cloud.hostname = `${cloud.hostname.slice(0, -'.convex.cloud'.length)}.convex.site`;
    return `${cloud.origin}/mcp`;
  }
  if ((cloud.hostname === '127.0.0.1' || cloud.hostname === 'localhost') && cloud.port === '3210') {
    cloud.port = '3211';
    return `${cloud.origin}/mcp`;
  }
  return null;
}

function parse(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** Single-quotes a value for POSIX shells, for commands people paste into a terminal. */
export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

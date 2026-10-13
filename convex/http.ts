import { httpRouter } from 'convex/server';
import { auth } from './auth';
import * as mcp from './mcpHttp';
const http = httpRouter();
auth.addHttpRoutes(http);

// Hosted MCP endpoint for agents, and the OAuth endpoints that connect them (see convex/mcpHttp.ts).
http.route({ path: '/mcp', method: 'POST', handler: mcp.mcpPost });
http.route({ path: '/mcp', method: 'GET', handler: mcp.mcpOther });
http.route({ path: '/mcp', method: 'DELETE', handler: mcp.mcpOther });
http.route({ path: '/mcp', method: 'OPTIONS', handler: mcp.mcpPreflight });
for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
  http.route({ path, method: 'GET', handler: mcp.protectedResource });
  http.route({ path, method: 'OPTIONS', handler: mcp.openPreflight });
}
http.route({ path: '/.well-known/oauth-authorization-server', method: 'GET', handler: mcp.authorizationServer });
http.route({ path: '/.well-known/oauth-authorization-server', method: 'OPTIONS', handler: mcp.openPreflight });
http.route({ path: '/oauth/register', method: 'POST', handler: mcp.register });
http.route({ path: '/oauth/authorize', method: 'GET', handler: mcp.authorize });
http.route({ path: '/oauth/token', method: 'POST', handler: mcp.token });
http.route({ path: '/oauth/revoke', method: 'POST', handler: mcp.revoke });
for (const path of ['/oauth/register', '/oauth/token', '/oauth/revoke']) http.route({ path, method: 'OPTIONS', handler: mcp.openPreflight });
export default http;

import { describe, expect, test } from 'vitest';
import { mcpUrlFrom, shellQuote } from '../src/mcpUrl';

describe('MCP server URL shown to people', () => {
  test('uses the explicit .convex.site origin', () => {
    expect(mcpUrlFrom({ siteUrl: 'https://happy-otter-123.convex.site/', convexUrl: 'https://other.convex.cloud' })).toBe('https://happy-otter-123.convex.site/mcp');
  });
  test('derives .convex.site from the standard .convex.cloud URL when the site URL is missing', () => {
    expect(mcpUrlFrom({ convexUrl: 'https://happy-otter-123.convex.cloud' })).toBe('https://happy-otter-123.convex.site/mcp');
    expect(mcpUrlFrom({ siteUrl: '', convexUrl: 'https://happy-otter-123.eu-west-1.convex.cloud/' })).toBe('https://happy-otter-123.eu-west-1.convex.site/mcp');
  });
  test('maps a local convex dev backend to its HTTP actions port', () => {
    expect(mcpUrlFrom({ convexUrl: 'http://127.0.0.1:3210' })).toBe('http://127.0.0.1:3211/mcp');
  });
  test('is unavailable rather than relative when neither is usable', () => {
    expect(mcpUrlFrom({})).toBeNull();
    expect(mcpUrlFrom({ siteUrl: '   ', convexUrl: '' })).toBeNull();
    expect(mcpUrlFrom({ siteUrl: '/convex', convexUrl: 'https://api.example.com' })).toBeNull();
    expect(mcpUrlFrom({ convexUrl: 'https://evil.example/x.convex.cloud' })).toBeNull();
    expect(mcpUrlFrom({ siteUrl: 'javascript:alert(1)' })).toBeNull();
    // Site URLs are bare origins; paths that could smuggle shell syntax into copied commands are refused.
    expect(mcpUrlFrom({ siteUrl: "https://x.convex.site/$(id)';rm" })).toBeNull();
    expect(mcpUrlFrom({ siteUrl: 'https://user:pw@x.convex.site' })).toBeNull();
  });
  test('quotes values for pasted shell commands', () => {
    expect(shellQuote('https://x.convex.site/mcp')).toBe("'https://x.convex.site/mcp'");
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});

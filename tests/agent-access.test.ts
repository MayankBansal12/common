import { describe, expect, it } from 'vitest';
import type { AgentConnection } from '../src/types';
import { agentHasSpaceAccess } from '../src/ui/agentAccess';

const connection: AgentConnection = {
  id: 'agent', name: 'opencode', kind: 'oauth', scopes: ['messages:read'],
  requestedScopes: ['messages:read'], spaceMode: 'selected',
  spaces: [{ id: 'hello', name: 'hello-test' }], createdAt: 1, expired: false,
};

describe('space agent access', () => {
  it('includes agents explicitly granted the current space', () => {
    expect(agentHasSpaceAccess(connection, 'hello')).toBe(true);
  });
  it('excludes agents granted only a different space', () => {
    expect(agentHasSpaceAccess(connection, 'other')).toBe(false);
  });
  it('includes all-spaces grants in new spaces too', () => {
    expect(agentHasSpaceAccess({ ...connection, spaceMode: 'all', spaces: [] }, 'new')).toBe(true);
  });
  it('excludes empty selected-space grants', () => {
    expect(agentHasSpaceAccess({ ...connection, spaces: [] }, 'hello')).toBe(false);
  });
  it('excludes expired selected-space grants', () => {
    expect(agentHasSpaceAccess({ ...connection, expired: true }, 'hello')).toBe(false);
  });
  it('excludes expired all-spaces grants', () => {
    expect(agentHasSpaceAccess({ ...connection, expired: true, spaceMode: 'all' }, 'hello')).toBe(false);
  });
  it('does not confuse awaiting connection with missing permission', () => {
    expect(agentHasSpaceAccess({ ...connection, lastUsedAt: undefined }, 'hello')).toBe(true);
  });
});

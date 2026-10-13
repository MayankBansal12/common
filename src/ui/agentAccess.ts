import type { AgentConnection } from '../types';

/** Expired connections cannot use a space, even if it is still in their grant. */
export function agentHasSpaceAccess(connection: AgentConnection, spaceId: string) {
  return !connection.expired && (connection.spaceMode === 'all' || connection.spaces.some((space) => space.id === spaceId));
}

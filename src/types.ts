export type Person = { id: string; name: string; email: string; avatarSeed: string; color: number; role?: 'owner' | 'member'; imageUrl?: string };
export type Space = { id: string; name: string; symbol: string; color: number; imageUrl?: string; memberCount: number; unread: number; lastMessage?: string; updatedAt: number };
/** `agent`: sent by an agent acting for `sender`. Agent messages are never shown as the sender's own. */
export type Message = { id: string; clientId: string; body: string; sender: Person; agent?: { id: string; name: string }; createdAt: number; status?: 'sending' | 'sent' | 'failed' };
/** Someone composing a message right now; `expiresAt` (ms) is when the signal lapses without a refresh. */
export type TypingPerson = Person & { expiresAt: number };
export type Invitation = { id: string; email: string; createdAt: number; canRevoke?: boolean };
export type PendingInvitation = { id: string; spaceName: string; inviterName: string };
export type Activity = { id: string; kind: 'space_created' | 'member_invited' | 'member_joined' | 'member_removed' | 'invite_revoked' | 'space_updated'; actorName: string; agentName?: string; subject?: string; createdAt: number };
/** `image`: a new photo to upload, `null` to remove the current one, or omitted to keep it. */
export type SpaceInput = { name: string; symbol: string; color: number; image?: Blob | null };
export type ProfileInput = { name: string; image?: Blob | null; avatarSeed?: string };
export type AgentScope = 'messages:read' | 'messages:send' | 'spaces:manage' | 'profile:write';
/** One agent's access, as its person sees it. `requestedScopes` (OAuth only) caps what can be turned on. */
export type AgentConnection = {
  id: string;
  name: string;
  kind: 'oauth' | 'token';
  clientName?: string;
  redirectHost?: string;
  scopes: AgentScope[];
  requestedScopes: AgentScope[] | null;
  spaceMode: 'all' | 'selected';
  spaces: { id: string; name: string }[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  expired: boolean;
};
export type AgentGrant = { name: string; scopes: AgentScope[]; spaceMode: 'all' | 'selected'; spaceIds: string[] };
/** A browser sign-in request from an agent, waiting for the person's decision. */
export type ConsentRequest = { status: 'loading' } | { status: 'expired' } | { status: 'ready'; clientName: string; redirectHost: string; requestedScopes: AgentScope[] };
export type AgentProps = {
  /** `undefined` while loading. */
  connections: AgentConnection[] | undefined;
  /** The MCP server URL people paste into their agent; `null` when this build doesn't know it. */
  mcpUrl: string | null;
  /** Preview only: says the connections shown are made up. */
  sampleNote?: string;
  onUpdate: (id: string, grant: AgentGrant) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  /** Resolves with the new token, shown once. */
  onCreateToken: (grant: AgentGrant & { expiresInDays?: 30 | 90 }) => Promise<string>;
};
export type ConsentProps = {
  request: ConsentRequest;
  /** Resolves once the browser is on its way back to the agent. */
  onApprove: (grant: AgentGrant) => Promise<void>;
  onDeny: () => Promise<void>;
  onDismiss: () => void;
};
export interface CommonUIProps {
  screen: 'loading' | 'login' | 'spaces' | 'chat';
  user: Person | null;
  spaces: Space[];
  activeSpace: Space | null;
  messages: Message[];
  members: Person[];
  invitations: Invitation[];
  pendingInvitations: PendingInvitation[];
  activities: Activity[];
  typing: TypingPerson[];
  isOnline: boolean;
  isLoadingMessages: boolean;
  /** The spaces list hasn't arrived yet (show placeholders, not the first-space welcome). */
  isLoadingSpaces?: boolean;
  hasMoreMessages: boolean;
  error: string | null;
  emailStep: 'email' | 'code';
  emailAddress: string;
  authBusy: boolean;
  authAvailable: { google: boolean; email: boolean };
  onGoogleSignIn: () => Promise<void>;
  onEmailSignIn: (email: string) => Promise<void>;
  onVerifyCode: (code: string) => Promise<void>;
  onBackToEmail: () => void;
  onSignOut: () => Promise<void>;
  /** Resolves with the new space's id; the UI opens it once the sheet has closed. */
  onCreateSpace: (input: SpaceInput) => Promise<string>;
  onUpdateSpace: (input: SpaceInput) => Promise<void>;
  onSelectSpace: (id: string | null) => void;
  onSendMessage: (body: string) => Promise<void>;
  /** Called while composing (`true`, repeatedly) and when the composer empties or closes (`false`). */
  onTyping: (spaceId: string, typing: boolean) => void;
  onRetryMessage: (clientId: string) => void;
  onLoadMoreMessages: () => void;
  onInviteMember: (email: string) => Promise<void>;
  onRemoveMember: (userId: string) => Promise<void>;
  onRevokeInvite: (id: string) => Promise<void>;
  onAcceptInvitation: (id: string) => Promise<void>;
  onUpdateProfile: (input: ProfileInput) => Promise<void>;
  onDismissError: () => void;
  agents?: AgentProps;
  /** A pending agent connection request: shown instead of the spaces once signed in. */
  consent?: ConsentProps;
  /** A short line on the sign-in screen, e.g. why signing in is needed right now. */
  authNotice?: string;
  /** Preview only: open the Connected agents sheet on load. */
  openAgents?: boolean;
}

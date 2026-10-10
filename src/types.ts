export type Person = { id: string; name: string; email: string; avatarSeed: string; color: number; role?: 'owner' | 'member'; imageUrl?: string };
export type Space = { id: string; name: string; symbol: string; color: number; imageUrl?: string; memberCount: number; unread: number; lastMessage?: string; updatedAt: number };
export type Message = { id: string; clientId: string; body: string; sender: Person; createdAt: number; status?: 'sending' | 'sent' | 'failed' };
/** Someone composing a message right now; `expiresAt` (ms) is when the signal lapses without a refresh. */
export type TypingPerson = Person & { expiresAt: number };
export type Invitation = { id: string; email: string; createdAt: number; canRevoke?: boolean };
export type PendingInvitation = { id: string; spaceName: string; inviterName: string };
export type Activity = { id: string; kind: 'space_created' | 'member_invited' | 'member_joined' | 'member_removed' | 'invite_revoked' | 'space_updated'; actorName: string; subject?: string; createdAt: number };
/** `image`: a new photo to upload, `null` to remove the current one, or omitted to keep it. */
export type SpaceInput = { name: string; symbol: string; color: number; image?: Blob | null };
export type ProfileInput = { name: string; image?: Blob | null; avatarSeed?: string };
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
}

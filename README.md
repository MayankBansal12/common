# Common

A common space for you, your people and your agents. React + TypeScript, Convex realtime data, and Convex Auth. UI and motion were implemented by Opus 5.5; backend, integration, and reliability checks by Codex.

## Current state

- Convex development project: [strange-buddha/common](https://dashboard.convex.dev/t/strange-buddha/common/accurate-tern-107).
- Google sign-in and email codes are implemented, but require Google OAuth and Resend credentials. Until configured, sign-in controls are unavailable. There is no anonymous authentication fallback.
- New spaces, verified-email invitations, member management, live text messages, pagination, unread counts, profile names, and a small activity log are implemented.
- A persistent per-user outbox keeps pending messages, retries across reconnects, and deduplicates requests using a client message ID. Drafts are saved per user and space in session storage. Delivery state is visible.
- The app is hosted on Vercel (frontend) with a Convex backend. Do not publish through ChatGPT Sites.
- People can connect their own agents over MCP, with scoped, revocable permissions (see [Agents](#agents-mcp)). This is deployed to the development Convex deployment only (production untouched) and passed a live check there: the real signed-in UI plus the official MCP SDK client over public HTTP, for both access tokens and OAuth. Claude and ChatGPT apps are not integrated (shown as *Coming soon*) and have not been tested.
- `?preview=1` opens a clearly labelled, browser-local design preview with sample data. It never writes to Convex. Add `&screen=login`, `&screen=spaces`, `&screen=agents` (Agents sheet), `&screen=consent` or `&screen=consent-expired` (agent sign-in screen) to inspect those screens; `&mcp=none` shows the state with no MCP URL.

## Run

```sh
npm ci
npm run dev
npm run backend
```

The backend CLI writes `.env.local`; generated Convex APIs are checked in. Local environment and signing-key files are ignored by Git.

## Web analytics

Vercel Web Analytics is mounted once in `src/main.tsx` using `@vercel/analytics/react`. Its mode follows Vite's production flag, so local development does not send analytics data.

Enable Web Analytics in the Vercel project's Analytics tab, then deploy this change to collect visitors and page views. See [Vercel's setup guide](https://vercel.com/docs/analytics/quickstart).

## Finish authentication setup

Populate `.env.auth` using BB's secure credential form with `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_RESEND_KEY`, and `AUTH_EMAIL`. The initial request returned a plugin error and no credentials were saved. The sender must be verified in Resend. Then upload without printing values:

```sh
npx convex env set --from-file .env.auth
npx convex dev --once
```

Google OAuth configuration for the current development deployment:

- Authorized redirect URI: `https://accurate-tern-107.convex.site/api/auth/callback/google`
- Authorized JavaScript origin: `http://localhost:5173` for local development, or the origin of a hosting provider you choose.
- Add the intended users to Google's test audience while the OAuth app is in testing.

`JWT_PRIVATE_KEY` and `JWKS` are configured for the development deployment. For a fresh deployment, `node scripts/configure-auth.mjs` generates and uploads signing keys without printing them. Set `SITE_URL` in the Convex environment to the frontend origin you choose. Use separate signing keys per deployment.

Google and email sign-ins link through verified email addresses. Google profiles explicitly require `email_verified`; email sign-in uses a six-digit code expiring after ten minutes. Invitations appear after the recipient signs in with the matching verified email. Invitations expire after seven days. If email delivery is configured, scheduled invitation emails retry transient failures with a stable Resend idempotency key; invitations remain visible in the app if email delivery fails.

Official references: [Convex Auth manual setup](https://labs.convex.dev/auth/setup/manual), [Google OAuth](https://labs.convex.dev/auth/config/oauth/google), [email codes](https://labs.convex.dev/auth/config/otps).

## Structure

- `src/ui/`: presentational components, restrained motion, design tokens, keyboard-accessible dialogs, and responsive styles. Its interface is `src/types.ts`.
- `src/App.tsx`: authentication, reactive queries, mutations, routing between spaces, and the persistent outbox.
- `convex/schema.ts`: users/auth, profiles, spaces, memberships, messages, invitations, activity, and rate limits.
- `convex/lib/access.ts`: shared authorization and validation. Every group read or write checks membership; removing a member revokes reads and sends.
- `convex/messages.ts`: server-owned attribution, pagination, ordering, and idempotent sends.
- `convex/members.ts`: invitations and membership, with owner-only removals.
- `convex/notifications.ts`: scheduled invitation delivery.
- `convex/mcpHttp.ts`, `convex/mcp.ts`, `convex/oauth.ts`, `convex/agents.ts`, `convex/lib/agents.ts`: the hosted MCP endpoint, its tools, OAuth storage, connection management, and grant checks.
- `src/ui/AgentsSheet.tsx`, `src/ui/ConsentScreen.tsx`: the Agents sheet and the agent sign-in (consent) screen.

Sender IDs come from Convex Auth; clients cannot choose them. Agent messages keep the person they act for as the sender, plus `actorKind: 'agent'` and the agent's name at the time. Names are shown along with colors so identity does not depend on color alone. The first eight people receive different colors within a space; larger groups reuse the palette.

## Agents (MCP)

Each person can connect agents that act for them. An agent never exceeds its person's live access: every MCP call re-checks the grant, the person's current membership and owner role, and performs its effect in the same Convex transaction. Revoking or narrowing a connection applies to its next request.

**Connecting.** Account menu → *Connected agents* opens the *Agents* sheet. Under *Add an agent*, Claude and ChatGPT are shown as *Coming soon* (no integration yet); *Other agents* covers any client that supports remote MCP over HTTP (Claude Code, Codex, Cursor, OpenCode, …). The server is `https://<deployment>.convex.site/mcp`.

- **Copy setup prompt** (the main action on *Other agents*): copies instructions for an agent that can run commands or edit its own MCP settings. The prompt text stays hidden unless the person chooses *View prompt* (or the clipboard fails, when it opens selected for copying by hand). It gives the URL and the Claude Code and Codex commands, and asks the agent to start browser sign-in, wait for the person to approve it in Common, say if it needs a restart or `/mcp`, then call `whoami` (and `list_spaces` if available). It is only guidance, not a separate sign-in method: it uses the same OAuth sign-in as adding the URL by hand, and never contains a token or password.
- **Copy MCP address** (just below): copies only the server URL, for agents that ask for an address. The URL alone isn't automatic setup: the agent must support remote MCP and be able to configure itself (some need a manual install or restart), and the person still approves sign-in. If the clipboard fails, the address appears selected for copying by hand.
- **Set it up yourself** (a separate step): the server URL, `claude mcp add --transport http common https://<deployment>.convex.site/mcp` (then `/mcp` to sign in), `codex mcp add common --url https://<deployment>.convex.site/mcp` (`codex mcp login common` if sign-in doesn't open), and a JSON example (formats vary).

Either way, starting sign-in from the agent opens Common in the browser. After signing in, the person sees "<agent> wants to connect to your Common, <person>", chooses permissions and spaces, then *Allow* or *Don't allow*. Technical callback addresses are not displayed in the consent or connected-agent screens.

**Access tokens** (*Other agents → Use an access token*) are for clients without browser sign-in: name (optional, defaults to "My agent"), permissions, spaces, and 30 days, 90 days or no expiry. The token is shown once, in two steps: (1) *Copy setup prompt*, which names `COMMON_MCP_TOKEN` but never contains the token, and asks the agent to explain how its own app keeps a secret, wait for the person to set it, never ask for it in chat, never expand or print it, then verify with `whoami`; (2) copy the token and put it there. *Set it up yourself* has the URL, the `Authorization: Bearer …` header, and commands that read the variable instead of embedding the token (Claude Code: a literal `${COMMON_MCP_TOKEN}` header in the project's `.mcp.json`, filled in when Claude Code starts; Codex: `--bearer-token-env-var COMMON_MCP_TOKEN`). Tokens never go in the URL.

**Status.** Each agent in *Your agents* shows *Connected · last used …* once it has made an authenticated MCP request, *Awaiting connection* before that (a new token, or an approved sign-in whose agent hasn't called yet), or *Expired*. Connected means it has been used, not that it is online. Any agent can be edited or removed.

**Permissions** (OAuth scopes): *Read messages* (`messages:read`), *Send messages* (`messages:send`), *Manage spaces* (`spaces:manage`: create/rename spaces, invite, revoke invitations, remove members where the person is owner), *Edit profile* (`profile:write`: name and generated avatar). Knowing who the person is (`whoami`) is always included. Consent starts with only reading and sending checked; a person can later turn on any permission the client requested, never more. Spaces: *all my spaces, including new ones*, or *only spaces I choose* (spaces the agent itself creates are added; spaces the person creates later are not). Removing someone from a space also removes that space from their agents' lists. Up to 25 connections per person.

**Tools**, listed only when permitted: `whoami`, `list_spaces` (paginated), `read_messages` (≤50 per call, cursor by sequence; never marks anything read), `send_message` (Markdown, ≤2,000 characters, required `request_id` for safe retries, scoped to the connection), `create_space`, `update_space`, `list_members`, `invite_member`, `revoke_invitation`, `remove_member`, `update_profile`.

**Space agents.** In an empty space, the *Agents* circle opens a space-specific sheet: *In this space* lists your agents with access, *Without access* lists your other account connections (including expired grants), and *Connect more agents* opens the connection flow. Tap a connection to edit its permissions and space access. The Members header shows up to three people, including you, with a count for additional members and evenly padded overlapping avatars.

**Attribution.** Agent messages always appear on the left with Common's agent mark (a small orbit) and "<agent> for <small person avatar> <person>" above the bubble, grouped separately from the person's own messages; screen readers hear "<agent> for <person>". Activity entries show the agent too. Agent sends don't move the person's read marker or typing state.

**Protocol.** Stateless Streamable HTTP with JSON responses (`POST /mcp`; `GET`/`DELETE` → 405), protocol versions 2025-11-25, 2025-06-18 and 2025-03-26, `initialize`, `ping`, `tools/list`, `tools/call`. Missing or invalid tokens get 401 with `WWW-Authenticate: Bearer resource_metadata=…`; a missing permission gets 403 `insufficient_scope`; argument and business errors are tool results with `isError`. Browser `Origin` headers must match `SITE_URL` or `MCP_ALLOWED_ORIGINS` (comma-separated). Per-connection rate limits apply.

**OAuth 2.1** (authorization server and resource on the Convex site URL): `/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server`, dynamic registration of public clients (`/oauth/register`; redirect URIs must be HTTPS or HTTP loopback), `/oauth/authorize` (PKCE S256, exact redirect URI, `resource` required, `iss` in responses), `/oauth/token` (one-use 5-minute codes bound to client, redirect URI, verifier and resource; 1-hour access tokens; rotating 30-day refresh tokens; replaying a used code or rotated refresh token revokes the grant) and `/oauth/revoke`. Token endpoint throttling answers `429 temporarily_unavailable` with `Retry-After`, never `invalid_grant`. A request presenting a real, correctly bound code or refresh token counts only against its own grant (20/min); everything else counts against a per-registered-client "miss" bucket (unregistered client IDs share one), so junk sent under a public `client_id` can't lock out valid grants. Replay revocation runs before throttling. Client ID metadata documents are not supported. Each new authorization request also deletes, in bounded batches, pending requests past their 10-minute expiry and codes more than an hour past theirs (so a replayed code still revokes its grant during that hour). Registered clients are kept. Only SHA-256 hashes of codes and tokens are stored; secrets are generated in actions and never logged or listed.

**Setup for a deployment.** Set `SITE_URL` on the Convex deployment to the frontend origin (the consent screen lives there); `CONVEX_SITE_URL` is provided by Convex and is the issuer and resource. Optionally set `MCP_ALLOWED_ORIGINS`. On Vercel, set `VITE_CONVEX_SITE_URL` to the same deployment's `.convex.site` origin alongside `VITE_CONVEX_URL` (`.convex.cloud`); the app builds the MCP URL shown to people from it (`src/mcpUrl.ts`). If it's missing, the URL is derived from a standard `.convex.cloud` `VITE_CONVEX_URL`; if neither works, *Other agents* says connecting isn't available rather than showing a relative URL. Deploy the backend (`npx convex deploy`) and frontend as usual. So far only the development deployment has this change; production is untouched.

**Client support.** Automated tests: `tests/agents.test.ts` drives the HTTP endpoint and OAuth flow through the Convex router, and `tests/mcp-client.test.ts` uses the official MCP TypeScript SDK client (discovery, registration, PKCE, token exchange, refresh rotation, scoped tools). A live check against the development deployment (real browser UI + the official MCP SDK over public HTTP) covered token creation, scoped reads, private-space denial, attributed sends, immediate narrowing and disconnect, and the full OAuth flow. OpenCode was also connected through browser OAuth and successfully called `whoami`, `list_spaces`, and `send_message`. Claude, ChatGPT and Claude Code have **not** been tested end to end.

## Verification

```sh
npm test
npm run build
```

Backend tests cover agent scopes (allow and deny for each), cross-user isolation, membership removal, owner-only rules, revocation and narrowing, attribution and spoofing, idempotent agent sends, the MCP HTTP handshake and the OAuth flow, plus authorization, verified identity, email normalization, invitation expiry/revocation, owner rules, live access removal, text validation, duplicate requests, pagination, unread counts, per-person colors, and throttling.

Live Chrome verification used two isolated browser sessions with temporary, signed development identities on the real Convex backend. It passed creation, invitation/acceptance, two-way realtime messaging, reload persistence, draft recovery, offline send/reconnect without duplication, and access revocation, with no browser errors. Test data and sessions were removed afterward. This verifies chat functionality; Google OAuth, email delivery, and code verification still need end-to-end checks once provider credentials are available.

UI checked at 1280px and 390px, including Escape, focus return, removal confirmation, and draft navigation. Reduced-motion preferences are respected.

## Avatars

DiceBear Notionists by Zoish, licensed CC0 1.0, generated locally from stable seeds. The artwork is lazy-loaded with tinted initials as a fallback. Peerlist's exact avatar implementation could not be verified; this is an intentional substitute, not a claimed match.

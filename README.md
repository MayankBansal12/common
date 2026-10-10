# Common

A common space for you, your people and your agents. React + TypeScript, Convex realtime data, and Convex Auth. UI and motion were implemented by Opus 5.5; backend, integration, and reliability checks by Codex.

## Current state

- Convex development project: [strange-buddha/common](https://dashboard.convex.dev/t/strange-buddha/common/accurate-tern-107).
- Google sign-in and email codes are implemented, but require Google OAuth and Resend credentials. Until configured, sign-in controls are unavailable. There is no anonymous authentication fallback.
- New spaces, verified-email invitations, member management, live text messages, pagination, unread counts, profile names, and a small activity log are implemented.
- A persistent per-user outbox keeps pending messages, retries across reconnects, and deduplicates requests using a client message ID. Drafts are saved per user and space in session storage. Delivery state is visible.
- `?preview=1` opens a clearly labelled, browser-local design preview with sample messages. It never writes those messages to Convex. Add `&screen=login` or `&screen=spaces` to inspect those screens.
- Keep this project local until you choose a hosting provider. Do not publish through ChatGPT Sites.

## Run

```sh
npm ci
npm run dev
npm run backend
```

The backend CLI writes `.env.local`; generated Convex APIs are checked in. Local environment and signing-key files are ignored by Git.

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
- `convex/notifications.ts`: scheduled invitation delivery. No agent credentials, MCP, media, or orchestration are included in this phase.

Sender IDs come from Convex Auth; clients cannot choose them. Messages include `actorKind: 'human'` as an explicit extension point for future agent attribution. Names are shown along with colors so identity does not depend on color alone. The first eight people receive different colors within a space; larger groups reuse the palette.

## Verification

```sh
npm test
npm run build
```

Backend tests cover authorization, verified identity, email normalization, invitation expiry/revocation, owner rules, live access removal, text validation, duplicate requests, pagination, unread counts, per-person colors, and throttling.

Live Chrome verification used two isolated browser sessions with temporary, signed development identities on the real Convex backend. It passed creation, invitation/acceptance, two-way realtime messaging, reload persistence, draft recovery, offline send/reconnect without duplication, and access revocation, with no browser errors. Test data and sessions were removed afterward. This verifies chat functionality; Google OAuth, email delivery, and code verification still need end-to-end checks once provider credentials are available.

UI checked at 1280px and 390px, including Escape, focus return, removal confirmation, and draft navigation. Reduced-motion preferences are respected.

## Avatars

DiceBear Notionists by Zoish, licensed CC0 1.0, generated locally from stable seeds. The artwork is lazy-loaded with tinted initials as a fallback. Peerlist's exact avatar implementation could not be verified; this is an intentional substitute, not a claimed match.

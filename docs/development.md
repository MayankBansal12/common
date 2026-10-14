# Development

Common uses React, TypeScript, Vite, Convex, and Convex Auth.

## Run locally

Install dependencies and start the Convex development backend:

```sh
npm ci
npm run backend
```

The Convex CLI walks through project setup and writes `.env.local`. In another terminal, start the frontend:

```sh
npm run dev
```

Open `http://localhost:5173`. Add `?preview=1` to explore the UI with browser-local sample data before configuring authentication.

See [`.env.example`](../.env.example) for environment variables. Local environment and signing-key files are ignored by Git.

## Authentication

Configure at least one sign-in provider on the Convex deployment:

- Google: `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.
- Email codes: `AUTH_RESEND_KEY` and `AUTH_EMAIL`, using a sender verified in Resend.

Set `SITE_URL` to the frontend origin, such as `http://localhost:5173`. For a fresh deployment, generate and upload signing keys:

```sh
node scripts/configure-auth.mjs
```

Google's authorized redirect URI is `https://<deployment>.convex.site/api/auth/callback/google`. Add the frontend origin as an authorized JavaScript origin, and add test users while the OAuth app is in testing.

Keep provider credentials and signing keys on the backend; never use `VITE_` variables for secrets. See the [Convex Auth setup guide](https://labs.convex.dev/auth/setup/manual).

## Connect agents

Open the account menu → **Connected agents** → **Other agents**. Copy the setup prompt into an agent that supports remote MCP, or add `https://<deployment>.convex.site/mcp` as its server address. Approve browser sign-in in Common and choose the agent's permissions and spaces.

Clients without browser sign-in can use **Use an access token**. Tokens are shown once and belong in the client's secret configuration.

Agents can read and send messages, manage spaces and members, or edit your profile when permitted. Agent messages identify the agent and the person it acts for. Edit or remove connections from **Your agents**; changes apply to their next request. The dedicated Claude and ChatGPT integrations are marked **Coming soon**.

## Deploy

The frontend runs on Vercel and the backend on Convex:

1. Deploy the production backend with `npx convex deploy` and configure its authentication providers and signing keys.
2. Set `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` on Vercel to the matching `.convex.cloud` and `.convex.site` origins.
3. Set `SITE_URL` on Convex to the frontend origin; agent consent returns to this address. Set `VITE_SITE_URL` on Vercel to enable canonical links and the sitemap.
4. Optionally enable Web Analytics in the Vercel project's Analytics tab.

Use separate signing keys for development and production.

## Checks

```sh
npm test
npm run build
```

## Source

- `src/ui/`: components, motion, and styles.
- `src/App.tsx`: authentication, queries, routing, and message delivery.
- `convex/`: schema, chat and membership APIs, MCP, and OAuth.
- `tests/`: backend authorization, chat, and agent protocol tests.

Avatars use [DiceBear Notionists by Zoish](https://www.dicebear.com/styles/notionists/), licensed CC0 1.0.

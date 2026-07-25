# Self-hosting on Railway (Recupera fork)

This fork exists so Recupera can run FasterFixes on its own Railway infrastructure.
Upstream targets Vercel + Neon + Cloudflare R2; the patches below make it run on
Railway's Postgres without changing behaviour for the cloud instance.

Upstream: `manucoffin/faster-fixes` (AGPL-3.0). Keep `upstream` as a remote and
rebase these patches when syncing.

## Why this fork exists (the patches)

| # | File | Problem | Fix |
|---|------|---------|-----|
| 1 | `packages/database/index.ts` | Hardcoded `PrismaNeon` whenever `NODE_ENV=production`. Neon's driver speaks HTTP/WebSocket to a Neon endpoint and cannot talk to Railway's plain TCP Postgres. | Driver is now explicit via `DB_DRIVER`; defaults to `PrismaPg`, which works everywhere. |
| 2 | `apps/web/next.config.mjs` | `images.remotePatterns` hardcodes the upstream author's R2 hostname, so `next/image` rejects screenshots from any other bucket. | Allowed host is derived from `NEXT_PUBLIC_STORAGE_BASE_URL`. |
| 3 | `packages/database/package.json` | The docs reference a `migrate:deploy` script that does not exist; `migrate:prod` uses `dotenv -e .env.local`, which is absent on a PaaS. | Added `migrate:deploy`, which reads host-injected env vars. |
| 4 | `apps/web/src/server/auth/plugins/stripe.ts` + `server/auth/index.ts` | The docs say Stripe is not needed when self-hosting, but a module-scope throw broke *any* production build, and `createCustomerOnSignUp` would call Stripe with a placeholder key and break sign-up. | Both the throw and the plugin registration are gated on `isCloud()`. |
| 5 | `apps/web/src/server/github/github-app.ts` | Resolved `GITHUB_PRIVATE_KEY` at module scope, so builds crashed with `Cannot read properties of undefined (reading 'replace')` when the "optional" GitHub App was not configured. | Credentials resolve lazily, with a clear error only if the integration is actually used. |
| 6 | `apps/web/src/server/storage/index.ts` | Hardcoded the Cloudflare R2 client, so self-hosting could only ever use R2 despite the docs saying "AWS S3 works identically". | Client is chosen from the environment: `AWS_S3_ENDPOINT` → generic S3 (AWS with a custom endpoint, R2's S3 API, MinIO, LocalStack); `R2_ACCOUNT_ID` → native R2; otherwise AWS by region. Recupera reuses `api-recupera`'s existing credentials. |
| 7 | `turbo.json` | Turbo's strict env mode filtered `AWS_*` out of the build task, so `turbo run build` failed with "storage is not configured" while a direct `next build` succeeded with the identical shell env. A genuinely confusing one to debug. | Added `globalPassThroughEnv` declaring every variable the app reads, which also makes cache keys correct. |

## Build configuration

Committed in `railway.json`. Note that `pnpm --filter web build` is **not**
enough: it skips the workspace dependencies, so Prisma's client and the widget
`dist/` are never generated. Turbo's `dependsOn: ["^build"]` is what builds them.

```
build:      pnpm install --frozen-lockfile && pnpm turbo run build --filter=web
preDeploy:  pnpm --filter @workspace/db migrate:deploy
start:      pnpm --filter web start
```

## Environment variables

Next.js collects page data at build time, so most of these are needed at
**build** time, not just runtime. Railway exposes service variables to both.

### Required

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Railway Postgres. Use the **internal** URL for the service, the public one for local migrations. |
| `DOMAIN_NAME` | Bare domain, no scheme. Feeds Better Auth `trustedOrigins`. |
| `BASE_URL` | Full origin, with scheme. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | Same as `BASE_URL`. |
| `RESEND_API_KEY` | Constructed at module scope, so the build fails without it. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | The R2 client validates at module scope; the build fails without all three. |
| `STORAGE_BUCKET_NAME`, `STORAGE_REGION` | `STORAGE_REGION` is `auto` for R2. |
| `NEXT_PUBLIC_STORAGE_BASE_URL` | Public bucket URL. Also drives the `next/image` allow-list (patch 2). |
| `NEXT_PUBLIC_FF_API_ORIGIN` | Where widgets send feedback. Same as `BASE_URL`. |
| `NEXT_PUBLIC_IS_CLOUD` | `false`. Skips marketing pages and disables billing (patch 4). |
| `LINEAR_TOKEN_ENCRYPTION_KEY`, `JIRA_TOKEN_ENCRYPTION_KEY`, `SLACK_TOKEN_ENCRYPTION_KEY` | Each `openssl rand -hex 32`. Loaded at module scope, so **all three are required even if the integrations are unused**. Rotating one means re-encrypting stored tokens. |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Required in production. Drives integration sync and welcome emails. |

### Optional

`GITHUB_APP_ID` / `GITHUB_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET`,
`LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` / `LINEAR_WEBHOOK_SIGNING_SECRET`,
`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`, `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET`,
and every `STRIPE_*` / `PLUNK_*` variable.

`DB_DRIVER` is optional and defaults to the `pg` adapter. Set it to `neon` only
on a Neon serverless endpoint.

## After the first deploy

1. Point Inngest at `<BASE_URL>/api/inngest`.
2. Create the first account at `<BASE_URL>/login`; it becomes the admin.
3. Create a project and copy its `proj_...` ID into the client widget.
4. Create an agent token in Organization Settings for the MCP server.

## Known upstream mismatches

The `.npmrc` references `${NPM_TOKEN}`, which is only needed for publishing.
pnpm warns and continues when it is unset; the warning is harmless.

pnpm 10 blocks postinstall scripts by default, so `pnpm install` reports ignored
build scripts for `prisma`, `@tailwindcss/oxide`, `sharp` and others. The build
succeeds anyway because those packages ship prebuilt platform binaries as
optional dependencies.

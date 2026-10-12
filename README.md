# llm-gateway

Your own subscription logins (Claude, Codex, Gemini and the rest that [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) supports) served as an API from Cloudflare, so any app can use them from anywhere with a base URL and a key. No machine of yours has to stay on.

```
app ──► Worker (llm-gateway.<subdomain>.workers.dev) ──► Container: CPA v8.0.24 ──► Claude / Codex / Gemini
              │                                              │
              └─ dashboard login (password cookie)           └─ config and logins in R2
```

- **Worker** (`src/`): the only public entry. It forwards `/v1/*`, `/v1beta/*` and `/healthz` to CPA, which checks the API key. It serves the CPA dashboard only after a password sign-in at `/login`. Everything else, including CPA's unauthenticated OAuth callback pages, returns 404.
- **Container** (`container/`): CPA built from a pinned commit, with the matching dashboard (`management.html` v1.26.1, checksum-pinned). One instance; it sleeps after 30 minutes without requests and wakes on the next one.
- **R2**: CPA's object store (`OBJECTSTORE_*`) keeps `config/config.yaml` and the login files in the `llm-gateway` bucket, so a restart or a new deploy keeps every login and key.

## Use it from an app

The Anthropic Messages API, with streaming and tools:

```
ANTHROPIC_BASE_URL=https://llm-gateway.<subdomain>.workers.dev
ANTHROPIC_API_KEY=<a client API key>
```

That is also what the Claude Agent SDK and Claude Code read. CPA accepts the key as `x-api-key` or `Authorization: Bearer`. OpenAI-compatible clients use `https://llm-gateway.<subdomain>.workers.dev/v1` as their base URL with the same key.

```
curl https://llm-gateway.<subdomain>.workers.dev/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-5-5","max_tokens":64,"messages":[{"role":"user","content":"Say hi"}]}'
```

`GET /v1/models` lists the models the logged-in subscriptions offer.

## Set up once

Needs a Cloudflare account on the Workers Paid plan (Containers require it).

1. In the Cloudflare dashboard, create:
   - an API token with Account: Workers Scripts Edit, Containers Edit, Workers R2 Storage Edit, and Account Settings Read;
   - an R2 API token (R2, Manage API tokens) with Object Read & Write on the `llm-gateway` bucket. It gives an Access Key ID and a Secret Access Key.
2. In this repository's settings, add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The `deploy` workflow then runs after every green `ci` run on `main`, creates the bucket if it is missing, builds the image and deploys.
3. Store the Worker secrets once, from any machine with Node:

   ```
   npm ci
   export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... sh scripts/set-secrets.sh
   ```

   It generates the dashboard password, the CPA management key and a first client API key, stores them as Worker secrets and prints them once.

The management key and the first client key are written into CPA's config on its first start only. After that the config in R2 is the source of truth: change keys in the dashboard, not in the Worker secrets. The dashboard password is the Worker's and can be changed any time with `wrangler secret put DASHBOARD_PASSWORD`.

## Log in to a subscription

1. Open `https://llm-gateway.<subdomain>.workers.dev`, sign in with the dashboard password, then enter the management key in the CPA dashboard.
2. Under OAuth login, pick the provider (for Claude: Anthropic) and open the link it shows.
3. Sign in. The browser then lands on a `localhost` address that does not load; that is expected. Copy the whole address from the address bar and paste it into the dashboard's callback field.

The login is saved to R2 and CPA refreshes its tokens itself.

## Keys for each app

Give every app its own key: add it under the dashboard's API keys (it is saved to the config in R2). Removing a key there cuts off only that app.

## Develop

```
npm ci
npm run verify                 # typecheck, lint, unit tests
sh test/container-smoke.sh     # needs Docker: builds the image and runs it against a local S3
```

`npm run types` regenerates `worker-configuration.d.ts` after a `wrangler.jsonc` change.

## Cost and limits

Workers Paid is $5 a month and includes 25 GiB-hours of memory, 375 vCPU-minutes and 200 GB-hours of disk for Containers each month; the `basic` instance (1/4 vCPU, 1 GiB) sleeping when idle stays well inside that for personal use. See [Containers pricing](https://developers.cloudflare.com/containers/pricing/).

Requests come from Cloudflare's network, not your home connection. The first request after the container sleeps waits a few seconds for it to start.

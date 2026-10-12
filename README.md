# llm-gateway

Your own subscription logins (Claude, Codex, Gemini and the others [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) supports) served as an API from your Cloudflare account. One click deploys it; then any app uses your subscriptions with a base URL and a key, from anywhere. No machine of yours has to stay on.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PlaygrndLabs/llm-gateway)

```
app ──► Worker  llm-gateway.<subdomain>.workers.dev ──► Container: CPA v8.0.24 ──► Claude / Codex / Gemini
          │  /v1/*  → key from the dashboard, then CPA      │
          │  /login → dashboard behind a password           └─ http://r2.internal ─► Worker S3 shim ─► R2 bucket
          └  everything else → 404
```

- **The real CPA**, built from a pinned upstream commit, with its matching dashboard (`management.html` v1.26.1, checksum-pinned). Not a port: every provider and API CPA supports works the same way.
- **State in R2 with no keys to create.** CPA saves its config and logins through its S3 object store. Inside the container that store points at `http://r2.internal`, which the Worker intercepts and serves from an R2 binding (`src/s3.ts`). Restarts, sleeps and redeploys keep every login.
- **Locked down by default.** API keys exist only once you make them in the dashboard; until then every API call is refused. CPA checks every `/v1/*` and `/v1beta/*` call against its key list, but on its own it lets every call through when that list is empty. So before forwarding, the Worker asks CPA with a random key: if CPA accepts it, no keys are set up and the Worker refuses the call; if CPA can't be reached, the Worker refuses too (`src/key-guard.ts`). The dashboard opens only after a password sign-in (an HMAC-signed, HttpOnly, SameSite=Strict cookie) and still asks for CPA's management key. CPA's own unauthenticated pages, such as its OAuth callbacks, return 404.
- **Cheap when idle.** One `basic` instance (1/4 vCPU, 1 GiB) that sleeps after 30 minutes without requests and wakes on the next one.

## Deploy

You need a Cloudflare account on the Workers Paid plan ($5 a month; Containers require it).

1. Press **Deploy to Cloudflare** above. Cloudflare copies this repository to your GitHub account, creates the R2 bucket and builds the container.
2. It asks for two secrets. Generate each with `openssl rand -hex 32` (any value of at least 32 characters of `A-Z a-z 0-9 _ -` works):
   - `DASHBOARD_PASSWORD`: your password for the dashboard sign-in.
   - `MANAGEMENT_KEY`: CPA's management key, which the dashboard asks for after sign-in.
3. When the deploy finishes, open `https://llm-gateway.<your-subdomain>.workers.dev`, sign in, and make an API key for each app under API Keys.

`MANAGEMENT_KEY` seeds CPA's config on its first start only. From then on the config in R2 is the source of truth: rotate it, and add or remove app keys, in the dashboard. `DASHBOARD_PASSWORD` stays a Worker secret and can be changed any time in the Cloudflare dashboard or with `wrangler secret put DASHBOARD_PASSWORD`.

## Log in to a subscription

1. Open your gateway, sign in with the dashboard password, then enter the management key.
2. Under OAuth login, choose the provider (for Claude: Anthropic) and open the link it gives you.
3. Sign in with that provider. The browser then lands on a `localhost` address that does not load; that is expected, since each provider only returns to the address registered for its login. Copy the whole address from the address bar (it carries `code` and `state`) and paste it into the dashboard's Callback URL field. Or, in the same browser where you are signed in to the gateway, replace `http://localhost:<port>` with your gateway address and open it: the gateway hands the callback to CPA.

CPA saves the login to R2 and refreshes its tokens itself.

## Use it from an app

The Anthropic Messages API, with streaming and tools, is what the Anthropic SDKs, the Claude Agent SDK and Claude Code read:

```
ANTHROPIC_BASE_URL=https://llm-gateway.<subdomain>.workers.dev
ANTHROPIC_API_KEY=<an API key made in the dashboard>
```

Send the key as `x-api-key` or `Authorization: Bearer` (Gemini clients may use `x-goog-api-key` or `?key=`). OpenAI-compatible clients use `https://llm-gateway.<subdomain>.workers.dev/v1` with the same key; Gemini clients use `/v1beta`.

```
curl https://llm-gateway.<subdomain>.workers.dev/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-5-5","max_tokens":64,"messages":[{"role":"user","content":"Say hi"}]}'
```

`GET /v1/models` lists the models your logged-in subscriptions offer. Give every app its own key in the dashboard, so removing one cuts off only that app. A key works as soon as you save it.

## Deploy with wrangler instead

```
npm ci
npx wrangler deploy               # needs Docker running to build the image
sh scripts/set-secrets.sh         # generates the two secrets, stores them, prints them once
```

To deploy from GitHub Actions, add the repository secrets `CLOUDFLARE_API_TOKEN` (Workers Scripts, Containers and Workers R2 Storage: Edit) and `CLOUDFLARE_ACCOUNT_ID`; the `deploy` workflow then runs after every green `ci` run on `main`. Without them it skips.

## Develop

```
npm ci
npm run verify                    # typecheck, lint, unit tests
sh test/container-smoke.sh        # needs Docker: builds the image and runs CPA against the S3 shim
```

`npm run types` regenerates `worker-configuration.d.ts` after a `wrangler.jsonc` change. To move to a newer CPA, change `CPA_COMMIT` in `container/Dockerfile` together with a dashboard release that speaks the same management API (`PANEL_VERSION` and `PANEL_SHA256`).

## Limits

- Requests to providers leave from Cloudflare's network, not your home connection. Check that your provider's terms allow how you use your subscription.
- The first request after the container sleeps waits a few seconds while it starts.
- One instance serves everything; CPA handles concurrent requests itself.

Containers pricing: [developers.cloudflare.com/containers/pricing](https://developers.cloudflare.com/containers/pricing/).

## License

MIT

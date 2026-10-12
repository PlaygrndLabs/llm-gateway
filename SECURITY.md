# Security

## Reporting a vulnerability

Please report privately through [GitHub's private vulnerability reporting](https://github.com/PlaygrndLabs/llm-gateway/security/advisories/new). Don't open a public issue. We aim to reply within a week.

Bugs in CPA itself belong upstream at [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI).

## Security model

Everything a deploy holds belongs to its owner: your Cloudflare account, your R2 bucket and your secrets. This repository has no keys, telemetry or shared backend.

- **API calls need a key.** On its own, CPA lets every `/v1/*` and `/v1beta/*` call through while its key list is empty. The gateway closes that gap: before forwarding, it asks CPA with a random key (`src/key-guard.ts`). If CPA accepts it, no keys are set up, so the gateway refuses the call. If CPA can't be reached, the gateway refuses too. The check runs in the single Durable Object in front of the container, so every request sees the same answer, and a dashboard change takes effect at once.
- **The dashboard needs two secrets.** First the `DASHBOARD_PASSWORD` sign-in, which sets an HMAC-signed `__Host-` cookie (HttpOnly, Secure, SameSite=Strict) that lasts 12 hours. Then CPA's own management key. Sign-in attempts are limited to 5 a minute per IP. Changing the password signs out every session.
- **Only known paths reach CPA.** The API, the dashboard, `/healthz` and the OAuth callback (for a signed-in user only) are forwarded. Everything else, and any path with encoded separators, returns 404. Browser cookies are stripped before forwarding.
- **State stays in your R2 bucket.** CPA's S3 client talks to `http://r2.internal`, which only the container can reach and which the Worker serves from an R2 binding. No R2 API tokens exist.
- **A pinned supply chain.** CPA is built from a pinned commit, and the dashboard HTML is checksum-verified (`container/Dockerfile`).

## Your part

- Use long random secrets: `openssl rand -hex 32`.
- Give each app its own API key, and delete a key the moment it may have leaked.
- Never commit `.dev.vars`. It is in `.gitignore`.

#!/bin/sh
# Stores the Worker secrets for a deploy made with wrangler: a new dashboard password,
# management key and client API key unless you pass your own. Prints them once.
set -eu

MANAGEMENT_KEY=${MANAGEMENT_KEY:-$(openssl rand -hex 32)}
CLIENT_API_KEY=${CLIENT_API_KEY:-$(openssl rand -hex 32)}
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD:-$(openssl rand -base64 30 | tr '+/' '-_' | tr -d '=')}

for value in "$MANAGEMENT_KEY" "$CLIENT_API_KEY" "$DASHBOARD_PASSWORD"; do
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_-]{32,}$'; then
    echo "set-secrets: each value needs at least 32 characters of A-Z a-z 0-9 _ -" >&2
    exit 64
  fi
done

umask 077
file=$(mktemp)
trap 'rm -f "$file"' EXIT
cat > "$file" <<JSON
{
  "MANAGEMENT_KEY": "$MANAGEMENT_KEY",
  "CLIENT_API_KEY": "$CLIENT_API_KEY",
  "DASHBOARD_PASSWORD": "$DASHBOARD_PASSWORD"
}
JSON
npx wrangler secret bulk "$file"

cat <<OUT

Keep these somewhere safe; they are not shown again.
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
MANAGEMENT_KEY=$MANAGEMENT_KEY
CLIENT_API_KEY=$CLIENT_API_KEY
OUT

#!/bin/sh
# Stores the Worker secrets: the R2 keys you pass in, plus a new management key, client API key
# and dashboard password unless you pass your own. Prints the generated values once.
set -eu

: "${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID to the R2 API token's Access Key ID}"
: "${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY to the R2 API token's Secret Access Key}"

MANAGEMENT_KEY=${MANAGEMENT_KEY:-$(openssl rand -hex 32)}
CLIENT_API_KEY=${CLIENT_API_KEY:-$(openssl rand -hex 32)}
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD:-$(openssl rand -base64 30 | tr '+/' '-_' | tr -d '=')}

for value in "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" "$MANAGEMENT_KEY" "$CLIENT_API_KEY" "$DASHBOARD_PASSWORD"; do
  if ! printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_-]+$'; then
    echo "set-secrets: values may only use A-Z a-z 0-9 _ -" >&2
    exit 64
  fi
done

umask 077
file=$(mktemp)
trap 'rm -f "$file"' EXIT
cat > "$file" <<EOF
{
  "R2_ACCESS_KEY_ID": "$R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY": "$R2_SECRET_ACCESS_KEY",
  "MANAGEMENT_KEY": "$MANAGEMENT_KEY",
  "CLIENT_API_KEY": "$CLIENT_API_KEY",
  "DASHBOARD_PASSWORD": "$DASHBOARD_PASSWORD"
}
EOF
npx wrangler secret bulk "$file"

cat <<EOF

Keep these somewhere safe; they are not shown again.
DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD
MANAGEMENT_KEY=$MANAGEMENT_KEY
CLIENT_API_KEY=$CLIENT_API_KEY
EOF

#!/bin/sh
# Builds the CPA image and runs it against the Worker's S3 shim (src/s3.ts) served by Node:
# keys, management, panel, and that the config survives a restart because it lives in the bucket.
set -eu

IMAGE=${IMAGE:-llm-gateway-cpa:test}
NODE_IMAGE=node:24-alpine
NET=llm-gateway-smoke
PORT=18317
CLIENT_KEY=client-key-0123456789abcdef0123456789abcdef
OTHER_KEY=other-key-0123456789abcdef0123456789abcdef00
MANAGEMENT_KEY=management-key-0123456789abcdef0123456789ab

cleanup() {
  docker rm -f smoke-cpa smoke-s3 >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

fail() {
  echo "FAIL: $*" >&2
  docker logs smoke-cpa >&2 || true
  docker logs smoke-s3 >&2 || true
  exit 1
}

status() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}

expect() {
  want=$1
  shift
  got=$(status "$@")
  [ "$got" = "$want" ] || fail "expected $want, got $got for: $*"
  echo "ok $want $*"
}

start_cpa() {
  docker rm -f smoke-cpa >/dev/null 2>&1 || true
  docker run -d --name smoke-cpa --network "$NET" -p "127.0.0.1:$PORT:8317" \
    -e OBJECTSTORE_ENDPOINT=http://smoke-s3:9000 \
    -e OBJECTSTORE_BUCKET=state \
    -e OBJECTSTORE_ACCESS_KEY=smoke-access \
    -e OBJECTSTORE_SECRET_KEY=smoke-secret-0123456789 \
    -e CPA_MANAGEMENT_KEY="$MANAGEMENT_KEY" \
    -e CPA_CLIENT_KEY="$1" \
    "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    [ "$(status "http://127.0.0.1:$PORT/healthz")" = 200 ] && return 0
    sleep 1
  done
  fail "CPA did not become healthy"
}

docker build -q -t "$IMAGE" container >/dev/null
docker network create "$NET" >/dev/null
docker run -d --name smoke-s3 --network "$NET" -p "127.0.0.1:19000:9000" \
  -v "$(pwd):/app:ro" -w /app "$NODE_IMAGE" node test/s3-server.ts >/dev/null
for _ in $(seq 1 30); do
  [ "$(status http://127.0.0.1:19000/__keys)" = 200 ] && break
  sleep 1
done

base="http://127.0.0.1:$PORT"
start_cpa "$CLIENT_KEY"
expect 200 "$base/healthz"
expect 401 "$base/v1/models"
expect 401 -H "x-api-key: wrong-key" "$base/v1/models"
expect 200 -H "x-api-key: $CLIENT_KEY" "$base/v1/models"
expect 200 -H "authorization: Bearer $CLIENT_KEY" "$base/v1/models"
expect 401 "$base/v8/management/config"
expect 200 -H "authorization: Bearer $MANAGEMENT_KEY" "$base/v8/management/config"
expect 200 "$base/management.html"

if docker run --rm --network "$NET" -e OBJECTSTORE_BUCKET=x "$IMAGE" >/dev/null 2>&1; then
  fail "entrypoint started without its required settings"
fi
echo "ok entrypoint refuses missing settings"

keys=$(curl -s http://127.0.0.1:19000/__keys)
echo "bucket keys: $keys"
case "$keys" in
  *'"config/config.yaml"'*) echo "ok config stored in the bucket" ;;
  *) fail "config/config.yaml was not stored in the bucket" ;;
esac

start_cpa "$OTHER_KEY"
expect 200 -H "x-api-key: $CLIENT_KEY" "$base/v1/models"
expect 401 -H "x-api-key: $OTHER_KEY" "$base/v1/models"
echo "ok config survived a restart from the bucket"

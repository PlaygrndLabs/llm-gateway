FROM golang:1.26-bookworm AS builder
ARG CPA_VERSION=v8.0.24
ARG CPA_COMMIT=091ff27f31285ec4fd1dd5823b44f7f51fb8f48b
WORKDIR /src
RUN git init -q . && git remote add origin https://github.com/router-for-me/CLIProxyAPI.git \
  && git fetch -q --depth 1 origin "${CPA_COMMIT}" && git checkout -q FETCH_HEAD
RUN CGO_ENABLED=1 GOOS=linux go build -buildvcs=false \
  -ldflags="-s -w -X 'main.Version=${CPA_VERSION}' -X 'main.Commit=${CPA_COMMIT}'" \
  -o /out/CLIProxyAPI ./cmd/server/

FROM debian:bookworm-slim
ARG PANEL_VERSION=v1.26.1
ARG PANEL_SHA256=32d835ee74ac9241e3b975567a1d6c24a64627931679dc616721fe5271dfca33
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tzdata \
  && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /panel \
  && curl -fsSL --retry 5 --retry-all-errors -o /panel/management.html \
    "https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases/download/${PANEL_VERSION}/management.html" \
  && echo "${PANEL_SHA256}  /panel/management.html" | sha256sum -c -
WORKDIR /CLIProxyAPI
COPY --from=builder /out/CLIProxyAPI ./CLIProxyAPI
COPY entrypoint.sh /entrypoint.sh
ENV MANAGEMENT_STATIC_PATH=/panel/management.html
EXPOSE 8317
ENTRYPOINT ["/entrypoint.sh"]

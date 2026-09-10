#!/bin/sh
set -eu

WARP_DIR="${WARP_DIR:-/tmp/warp}"
SOCKS_HOST="127.0.0.1"
SOCKS_PORT="1080"
mkdir -p "$WARP_DIR"
cd "$WARP_DIR"

start_warp() {
  if [ "${WARP_DISABLED:-0}" = "1" ]; then
    echo "WARP disabled"
    return 1
  fi
  if ! command -v wgcf >/dev/null 2>&1 || ! command -v wireproxy >/dev/null 2>&1; then
    echo "wgcf/wireproxy missing"
    return 1
  fi

  if [ ! -f wgcf-account.toml ]; then
    echo "Registering Cloudflare WARP..."
    wgcf register --accept-tos || true
  fi
  if [ ! -f wgcf-profile.conf ]; then
    echo "Generating WARP profile..."
    wgcf generate || true
  fi
  if [ ! -f wgcf-profile.conf ]; then
    echo "WARP profile missing"
    return 1
  fi

  cat > wireproxy.conf <<EOF
WGConfig = "${WARP_DIR}/wgcf-profile.conf"
[Socks5]
BindAddress = "${SOCKS_HOST}:${SOCKS_PORT}"
EOF

  echo "Starting wireproxy on ${SOCKS_HOST}:${SOCKS_PORT}..."
  wireproxy -c "${WARP_DIR}/wireproxy.conf" >/tmp/wireproxy.log 2>&1 &
  echo $! > /tmp/wireproxy.pid
  sleep 4

  if [ -f /tmp/wireproxy.pid ] && kill -0 "$(cat /tmp/wireproxy.pid)" 2>/dev/null; then
    echo "WARP SOCKS ready"
    export YTDLP_PROXY="socks5://${SOCKS_HOST}:${SOCKS_PORT}"
    return 0
  fi

  echo "WARP failed; log:"
  tail -n 40 /tmp/wireproxy.log 2>/dev/null || true
  return 1
}

start_warp || echo "Continuing without WARP"

cd /app
exec node server.js

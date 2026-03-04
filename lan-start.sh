#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$ROOT_DIR/server"
CLIENT_DIR="$ROOT_DIR/client"

PORT_SERVER="${PORT_SERVER:-8080}"
PORT_CLIENT="${PORT_CLIENT:-5173}"
HOST_BIND="${HOST_BIND:-0.0.0.0}"
SKIP_INSTALL="${SKIP_INSTALL:-0}"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but not found in PATH"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found in PATH"
  exit 1
fi

if [ ! -d "$SERVER_DIR" ] || [ ! -d "$CLIENT_DIR" ]; then
  echo "Expected server/ and client/ directories under $ROOT_DIR"
  exit 1
fi

find_lan_ip() {
  local ip=""
  if command -v ipconfig >/dev/null 2>&1; then
    ip=$(ipconfig getifaddr en0 2>/dev/null || true)
    if [ -z "$ip" ]; then
      ip=$(ipconfig getifaddr en1 2>/dev/null || true)
    fi
  fi
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}' || true)
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
  fi
  echo "$ip"
}

if [ "$SKIP_INSTALL" != "1" ]; then
  if [ ! -d "$SERVER_DIR/node_modules" ]; then
    echo "Installing server dependencies..."
    (cd "$SERVER_DIR" && npm install)
  fi
  if [ ! -d "$CLIENT_DIR/node_modules" ]; then
    echo "Installing client dependencies..."
    (cd "$CLIENT_DIR" && npm install)
  fi
fi

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID"
  fi
  if [ -n "${CLIENT_PID:-}" ] && kill -0 "$CLIENT_PID" 2>/dev/null; then
    kill "$CLIENT_PID"
  fi
}
trap cleanup EXIT INT TERM

ip_addr=$(find_lan_ip)

echo "Starting server on 0.0.0.0:${PORT_SERVER}"
(cd "$SERVER_DIR" && PORT="$PORT_SERVER" npm run dev) &
SERVER_PID=$!

sleep 1

echo "Starting client on 0.0.0.0:${PORT_CLIENT}"
(cd "$CLIENT_DIR" && npm run dev -- --host "$HOST_BIND" --port "$PORT_CLIENT") &
CLIENT_PID=$!

sleep 1

echo ""
if [ -n "$ip_addr" ]; then
  echo "LAN URL:  http://$ip_addr:$PORT_CLIENT"
  echo "WS URL:   ws://$ip_addr:$PORT_SERVER"
  echo "In the page, set server URL to the WS URL above."
else
  echo "LAN IP not detected. Find your LAN IP and use:"
  echo "Client: http://<LAN-IP>:$PORT_CLIENT"
  echo "Server: ws://<LAN-IP>:$PORT_SERVER"
fi

echo "Press Ctrl+C to stop."
wait

#!/usr/bin/env bash
set -euo pipefail

RECALLANT_HOME="${RECALLANT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${RECALLANT_ENV_FILE:-/opt/secure-configs/recallant.env}"
DATA_DIR="${RECALLANT_DATA_DIR:-/ai/recallant-data}"
RUN_USER="${RECALLANT_RUN_USER:-${SUDO_USER:-$(id -un)}}"
INSTALL_CLI_PREFIX="${INSTALL_CLI_PREFIX:-/usr/local/bin}"

random_hex() {
  node -e "process.stdout.write(require('crypto').randomBytes(Number(process.argv[1])).toString('hex'))" "$1"
}

random_uuid() {
  node -e "process.stdout.write(require('crypto').randomUUID())"
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_command node
need_command npm
need_command docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Missing Docker Compose plugin: docker compose" >&2
  exit 1
fi

cd "$RECALLANT_HOME"

mkdir -p "$DATA_DIR/postgres" "$DATA_DIR/backups" "$(dirname "$ENV_FILE")"

if [[ ! -f "$ENV_FILE" ]]; then
  db_password="$(random_hex 24)"
  auth_token="$(random_hex 32)"
  session_secret="$(random_hex 32)"
  developer_id="$(random_uuid)"
  project_id="$(random_uuid)"
  cat >"$ENV_FILE" <<EOF
POSTGRES_DB=recallant_agent_work
POSTGRES_USER=recallant
POSTGRES_PASSWORD=$db_password
RECALLANT_DATABASE_URL=postgres://recallant:$db_password@127.0.0.1:15432/recallant_agent_work
RECALLANT_DEVELOPER_ID=$developer_id
RECALLANT_PROJECT_ID=$project_id
RECALLANT_PROJECT_PATH=$RECALLANT_HOME
RECALLANT_SERVER_URL=http://127.0.0.1:3005
RECALLANT_HOST=127.0.0.1
RECALLANT_PORT=3005
RECALLANT_AUTH_TOKEN=$auth_token
RECALLANT_SESSION_SECRET=$session_secret
RECALLANT_CLOUDFLARE_ACCESS=disabled
RECALLANT_ADMIN_EMAILS=
RECALLANT_OLLAMA_URL=http://127.0.0.1:11434
RECALLANT_EXPECTED_OLLAMA_MODELS=nomic-embed-text,qwen2.5-coder:14b,mistral-small:24b
RECALLANT_MANAGEMENT_CHAT_AI=on
RECALLANT_MANAGEMENT_CHAT_MODEL=mistral-small:24b
RECALLANT_MANAGEMENT_CHAT_KEEP_ALIVE=10m
EOF
  chmod 600 "$ENV_FILE"
  echo "Created $ENV_FILE"
else
  echo "Using existing $ENV_FILE"
fi

if [[ ! -d node_modules ]]; then
  npm install
fi
npm run build

PREFIX="$INSTALL_CLI_PREFIX" "$RECALLANT_HOME/scripts/install-recallant-cli.sh"

./scripts/recallant-prod-compose.sh up -d postgres
./scripts/recallant-prod-compose.sh exec -T postgres sh -c 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
schema_ready="$(./scripts/recallant-prod-compose.sh exec -T postgres psql -tAc "SELECT to_regclass('public.projects') IS NOT NULL" -U recallant -d recallant_agent_work | tr -d '[:space:]')"
if [[ "$schema_ready" != "t" ]]; then
  ./scripts/recallant-prod-compose.sh exec -T postgres psql -v ON_ERROR_STOP=1 -U recallant -d recallant_agent_work -f /migrations/0001_initial.sql
else
  echo "Recallant database schema already present"
fi

unit_file="/etc/systemd/system/recallant.service"
if [[ -d /etc/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
  cat >"$unit_file" <<EOF
[Unit]
Description=Recallant private memory server
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$RECALLANT_HOME
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/env npm run server:start
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now recallant.service
  echo "Installed and started recallant.service"
else
  echo "systemd not available; start manually with: cd $RECALLANT_HOME && npm run server:start"
fi

echo
echo "Recallant installed."
echo "Human UI: http://127.0.0.1:3005/review"
echo "CLI: $INSTALL_CLI_PREFIX/recallant"
echo "Attach a project: cd /path/to/project && recallant attach . --target codex"

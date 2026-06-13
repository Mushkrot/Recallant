#!/usr/bin/env bash
set -euo pipefail

RECALLANT_HOME="${RECALLANT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
INSTALL_PROFILE="${RECALLANT_INSTALL_PROFILE:-owner-server}"
ENV_FILE="${RECALLANT_ENV_FILE:-}"
DATA_DIR="${RECALLANT_DATA_DIR:-}"
RUN_USER="${RECALLANT_RUN_USER:-${SUDO_USER:-$(id -un)}}"
INSTALL_CLI_PREFIX="${INSTALL_CLI_PREFIX:-}"
SYSTEMD_MODE="${RECALLANT_SYSTEMD_MODE:-auto}"
POSTGRES_HOST="${RECALLANT_POSTGRES_HOST:-127.0.0.1}"
POSTGRES_PORT="${RECALLANT_POSTGRES_PORT:-15432}"
POSTGRES_CONTAINER_NAME="${RECALLANT_POSTGRES_CONTAINER_NAME:-recallant-postgres}"
COMPOSE_PROJECT_NAME="${RECALLANT_COMPOSE_PROJECT_NAME:-recallant}"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/install-recallant.sh [options]

Options:
  --dry-run                  Print the install plan without changing files, Docker, or systemd.
  --profile <name>           single-user, managed-server, or owner-server.
  --recallant-home <path>    Repository/runtime path to install from.
  --env-file <path>          Environment file path.
  --data-dir <path>          Recallant data directory.
  --install-cli-prefix <dir> Directory where the recallant CLI wrapper is installed.
  --postgres-host <host>     Host bind address for Postgres, default 127.0.0.1.
  --postgres-port <port>     Host bind port for Postgres, default 15432.
  --postgres-container-name <name>
                             Docker container name, default recallant-postgres.
  --compose-project-name <name>
                             Docker Compose project name, default recallant.
  --run-user <user>          systemd service user.
  --no-systemd               Do not write or start a systemd service.
  -h, --help                 Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --profile)
      INSTALL_PROFILE="${2:-}"
      shift 2
      ;;
    --recallant-home)
      RECALLANT_HOME="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --data-dir)
      DATA_DIR="${2:-}"
      shift 2
      ;;
    --install-cli-prefix)
      INSTALL_CLI_PREFIX="${2:-}"
      shift 2
      ;;
    --postgres-host)
      POSTGRES_HOST="${2:-}"
      shift 2
      ;;
    --postgres-port)
      POSTGRES_PORT="${2:-}"
      shift 2
      ;;
    --postgres-container-name)
      POSTGRES_CONTAINER_NAME="${2:-}"
      shift 2
      ;;
    --compose-project-name)
      COMPOSE_PROJECT_NAME="${2:-}"
      shift 2
      ;;
    --run-user)
      RUN_USER="${2:-}"
      shift 2
      ;;
    --no-systemd)
      SYSTEMD_MODE="manual"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$INSTALL_PROFILE" in
  managed-server)
    ENV_FILE="${ENV_FILE:-/etc/recallant/recallant.env}"
    DATA_DIR="${DATA_DIR:-/var/lib/recallant}"
    INSTALL_CLI_PREFIX="${INSTALL_CLI_PREFIX:-/usr/local/bin}"
    ;;
  owner-server)
    ENV_FILE="${ENV_FILE:-/etc/recallant/recallant.env}"
    DATA_DIR="${DATA_DIR:-/var/lib/recallant}"
    INSTALL_CLI_PREFIX="${INSTALL_CLI_PREFIX:-/usr/local/bin}"
    ;;
  single-user)
    ENV_FILE="${ENV_FILE:-$HOME/.config/recallant/recallant.env}"
    DATA_DIR="${DATA_DIR:-$HOME/.local/share/recallant}"
    INSTALL_CLI_PREFIX="${INSTALL_CLI_PREFIX:-$HOME/.local/bin}"
    if [[ "$SYSTEMD_MODE" == "auto" ]]; then
      SYSTEMD_MODE="manual"
    fi
    ;;
  *)
    echo "Unknown install profile: $INSTALL_PROFILE" >&2
    usage >&2
    exit 2
    ;;
esac

print_plan() {
  cat <<EOF
Recallant install plan
profile: $INSTALL_PROFILE
dry_run: $DRY_RUN
recallant_home: $RECALLANT_HOME
env_file: $ENV_FILE
data_dir: $DATA_DIR
run_user: $RUN_USER
install_cli_prefix: $INSTALL_CLI_PREFIX
systemd_mode: $SYSTEMD_MODE
postgres_host: $POSTGRES_HOST
postgres_port: $POSTGRES_PORT
postgres_container_name: $POSTGRES_CONTAINER_NAME
compose_project_name: $COMPOSE_PROJECT_NAME
will_create_data_dirs: $DATA_DIR/postgres, $DATA_DIR/backups
will_create_env_file: $([[ -f "$ENV_FILE" ]] && echo no || echo yes)
will_install_dependencies: $([[ -d "$RECALLANT_HOME/node_modules" ]] && echo no || echo yes)
will_build: yes
will_install_cli: yes
will_start_postgres: yes
will_apply_migrations: if schema is absent
will_install_systemd: $([[ "$SYSTEMD_MODE" != "manual" ]] && echo auto || echo no)
EOF
}

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

if [[ "$DRY_RUN" == "true" ]]; then
  print_plan
  echo "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."
  exit 0
fi

need_command node
need_command npm
need_command docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Missing Docker Compose plugin: docker compose" >&2
  exit 1
fi

cd "$RECALLANT_HOME"

mkdir -p "$DATA_DIR/postgres" "$DATA_DIR/backups" "$(dirname "$ENV_FILE")"
install_marker="$DATA_DIR/.recallant-install-marker"
if [[ ! -f "$install_marker" ]]; then
  cat >"$install_marker" <<EOF
profile=$INSTALL_PROFILE
env_file=$ENV_FILE
data_dir=$DATA_DIR
postgres_container_name=$POSTGRES_CONTAINER_NAME
compose_project_name=$COMPOSE_PROJECT_NAME
created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
  chmod 600 "$install_marker"
fi

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
RECALLANT_DATABASE_URL=postgres://recallant:$db_password@$POSTGRES_HOST:$POSTGRES_PORT/recallant_agent_work
RECALLANT_POSTGRES_HOST=$POSTGRES_HOST
RECALLANT_POSTGRES_PORT=$POSTGRES_PORT
RECALLANT_POSTGRES_CONTAINER_NAME=$POSTGRES_CONTAINER_NAME
RECALLANT_COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
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

prod_compose() {
  RECALLANT_ENV_FILE="$ENV_FILE" \
    RECALLANT_DATA_DIR="$DATA_DIR" \
    RECALLANT_POSTGRES_HOST="$POSTGRES_HOST" \
    RECALLANT_POSTGRES_PORT="$POSTGRES_PORT" \
    RECALLANT_POSTGRES_CONTAINER_NAME="$POSTGRES_CONTAINER_NAME" \
    RECALLANT_COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
    ./scripts/recallant-prod-compose.sh "$@"
}

prod_compose up -d postgres
prod_compose exec -T postgres sh -c 'until pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'
schema_ready="$(prod_compose exec -T postgres psql -tAc "SELECT to_regclass('public.projects') IS NOT NULL" -U recallant -d recallant_agent_work | tr -d '[:space:]')"
if [[ "$schema_ready" != "t" ]]; then
  prod_compose exec -T postgres psql -v ON_ERROR_STOP=1 -U recallant -d recallant_agent_work -f /migrations/0001_initial.sql
else
  echo "Recallant database schema already present"
fi

unit_file="/etc/systemd/system/recallant.service"
if [[ "$SYSTEMD_MODE" != "manual" && -d /etc/systemd/system ]] && command -v systemctl >/dev/null 2>&1; then
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

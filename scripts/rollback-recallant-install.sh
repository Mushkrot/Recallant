#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=""
DATA_DIR=""
CLI_PATH=""
POSTGRES_CONTAINER_NAME=""
COMPOSE_PROJECT_NAME="recallant"
SYSTEMD_UNIT="/etc/systemd/system/recallant.service"
DRY_RUN=false
REMOVE_ENV_FILE=false
REMOVE_DATA_DIR=false
REMOVE_CLI=false
REMOVE_CONTAINER=false
REMOVE_SYSTEMD=false
CONFIRM_TOKEN=""
ALLOW_UNMARKED_DATA_DIR=false

usage() {
  cat <<'EOF'
Usage: scripts/rollback-recallant-install.sh [options]

Rollback is conservative. Dry-run prints a plan and changes nothing. Confirmed rollback requires
--confirm-token rollback-recallant-install and removes only explicitly selected artifacts.

Options:
  --dry-run                         Print the rollback plan without changing files, Docker, or systemd.
  --env-file <path>                 Env file to remove when --remove-env-file is set.
  --data-dir <path>                 Data directory to remove when --remove-data-dir is set.
  --cli-path <path>                 CLI wrapper to remove when --remove-cli is set.
  --install-cli-prefix <dir>        Shorthand for --cli-path <dir>/recallant.
  --postgres-container-name <name>  Docker container to stop/remove when --remove-container is set.
  --compose-project-name <name>     Docker Compose project name, used for reporting.
  --systemd-unit <path>             systemd unit path to remove when --remove-systemd is set.
  --remove-env-file                 Remove the selected env file.
  --remove-data-dir                 Remove the selected data dir; requires .recallant-install-marker.
  --remove-cli                      Remove the selected CLI wrapper.
  --remove-container                Remove the selected Postgres container.
  --remove-systemd                  Disable and remove the selected systemd unit.
  --allow-unmarked-data-dir         Permit data-dir removal without marker; intended only for manual recovery.
  --confirm-token <token>           Required for non-dry-run. Must be rollback-recallant-install.
  -h, --help                        Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --data-dir)
      DATA_DIR="${2:-}"
      shift 2
      ;;
    --cli-path)
      CLI_PATH="${2:-}"
      shift 2
      ;;
    --install-cli-prefix)
      CLI_PATH="${2:-}/recallant"
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
    --systemd-unit)
      SYSTEMD_UNIT="${2:-}"
      shift 2
      ;;
    --remove-env-file)
      REMOVE_ENV_FILE=true
      shift
      ;;
    --remove-data-dir)
      REMOVE_DATA_DIR=true
      shift
      ;;
    --remove-cli)
      REMOVE_CLI=true
      shift
      ;;
    --remove-container)
      REMOVE_CONTAINER=true
      shift
      ;;
    --remove-systemd)
      REMOVE_SYSTEMD=true
      shift
      ;;
    --allow-unmarked-data-dir)
      ALLOW_UNMARKED_DATA_DIR=true
      shift
      ;;
    --confirm-token)
      CONFIRM_TOKEN="${2:-}"
      shift 2
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

dangerous_path() {
  case "$1" in
    ""|"/"|"/home"|"/root"|"/tmp"|"/var"|"/var/lib"|"/etc"|"/usr"|"/usr/local"|"/usr/local/bin")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

require_safe_path() {
  local label="$1"
  local path="$2"
  if dangerous_path "$path"; then
    echo "Refusing dangerous $label path: $path" >&2
    exit 2
  fi
}

marker_path() {
  printf "%s/.recallant-install-marker" "$DATA_DIR"
}

data_dir_marked() {
  [[ -n "$DATA_DIR" && -f "$(marker_path)" ]]
}

cli_wrapper_looks_owned() {
  [[ -n "$CLI_PATH" && -f "$CLI_PATH" ]] &&
    grep -q "apps/cli/dist/index.js" "$CLI_PATH" &&
    grep -q "RECALLANT_HOME" "$CLI_PATH"
}

print_plan() {
  cat <<EOF
Recallant rollback plan
dry_run: $DRY_RUN
env_file: ${ENV_FILE:-not selected}
data_dir: ${DATA_DIR:-not selected}
cli_path: ${CLI_PATH:-not selected}
postgres_container_name: ${POSTGRES_CONTAINER_NAME:-not selected}
compose_project_name: $COMPOSE_PROJECT_NAME
systemd_unit: ${SYSTEMD_UNIT:-not selected}
will_remove_env_file: $REMOVE_ENV_FILE
will_remove_data_dir: $REMOVE_DATA_DIR
data_dir_marker_present: $(data_dir_marked && echo yes || echo no)
will_remove_cli: $REMOVE_CLI
cli_wrapper_owned: $(cli_wrapper_looks_owned && echo yes || echo no)
will_remove_container: $REMOVE_CONTAINER
will_remove_systemd: $REMOVE_SYSTEMD
EOF
}

print_plan

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY_RUN: no files, Docker containers, database rows, or systemd services were changed."
  exit 0
fi

if [[ "$CONFIRM_TOKEN" != "rollback-recallant-install" ]]; then
  echo "Confirmed rollback requires --confirm-token rollback-recallant-install" >&2
  exit 2
fi

if [[ "$REMOVE_ENV_FILE" == "true" ]]; then
  require_safe_path "env-file" "$ENV_FILE"
fi
if [[ "$REMOVE_DATA_DIR" == "true" ]]; then
  require_safe_path "data-dir" "$DATA_DIR"
  if [[ "$ALLOW_UNMARKED_DATA_DIR" != "true" ]] && ! data_dir_marked; then
    echo "Refusing to remove unmarked data dir: $DATA_DIR" >&2
    exit 2
  fi
fi
if [[ "$REMOVE_CLI" == "true" ]]; then
  require_safe_path "cli" "$CLI_PATH"
  if [[ -f "$CLI_PATH" ]] && ! cli_wrapper_looks_owned; then
    echo "Refusing to remove CLI path that does not look like a Recallant wrapper: $CLI_PATH" >&2
    exit 2
  fi
fi

if [[ "$REMOVE_SYSTEMD" == "true" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl disable --now "$(basename "$SYSTEMD_UNIT")" >/dev/null 2>&1 || true
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f "$SYSTEMD_UNIT"
fi

if [[ "$REMOVE_CONTAINER" == "true" && -n "$POSTGRES_CONTAINER_NAME" ]]; then
  if command -v docker >/dev/null 2>&1; then
    docker rm -f "$POSTGRES_CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
fi

if [[ "$REMOVE_CLI" == "true" && -n "$CLI_PATH" ]]; then
  rm -f "$CLI_PATH"
fi
if [[ "$REMOVE_ENV_FILE" == "true" && -n "$ENV_FILE" ]]; then
  rm -f "$ENV_FILE"
fi
if [[ "$REMOVE_DATA_DIR" == "true" && -n "$DATA_DIR" ]]; then
  rm -rf "$DATA_DIR"
fi

echo "Recallant rollback complete."

#!/usr/bin/env bash
set -euo pipefail

SOURCE_REF="${RECALLANT_INSTALL_REF:-main}"
REPO_URL="${RECALLANT_INSTALL_REPO_URL:-https://github.com/Mushkrot/Recallant.git}"
INSTALL_DIR="${RECALLANT_CLIENT_BOOTSTRAP_INSTALL_DIR:-$HOME/.local/share/recallant-client-cli}"
INVOKE_DIR="$(pwd -P)"
PROJECT_DIR="."
CLIENT="codex"
SERVER_URL=""
CREDENTIAL=""
PROJECT_ID=""
DEVELOPER_ID=""
CLIENT_ID=""
SESSION_ID=""
TRACE_ID=""
CAPTURE_PROOF=false
SKIP_DOCTOR=false
DRY_RUN=false

fail() {
  echo "Recallant remote client bootstrap cannot continue." >&2
  echo "$1" >&2
  exit "${2:-2}"
}

redacted_args() {
  local redact_next=false
  for value in "$@"; do
    if [[ "$redact_next" == "true" ]]; then
      printf ' %q' "<redacted-remote-mcp-credential>"
      redact_next=false
      continue
    fi
    printf ' %q' "$value"
    if [[ "$value" == "--credential" ]]; then
      redact_next=true
    fi
  done
}

usage() {
  cat <<'USAGE'
Usage: scripts/install-recallant-client-bootstrap.sh [options]

Installs only the Recallant remote client/bridge CLI and connects this project to an existing
central Recallant server. It does not install local Recallant storage and does not require Docker,
Postgres, RECALLANT_DATABASE_URL, or server-internal paths.

Example:
  curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-client-bootstrap.sh | bash -s -- \
    --server-url https://recallant.example.com \
    --credential <scoped-remote-mcp-credential> \
    --project-id <project-id> \
    --developer-id <developer-id> \
    --client-id <client-id> \
    --project-dir .

Options:
  --server-url <https-url>     Existing Recallant server URL.
  --credential <token>         Scoped remote MCP credential for this project/developer/client.
  --project-id <id>            Recallant project id.
  --developer-id <id>          Recallant developer id.
  --client-id <id>             Remote client id.
  --project-dir <path>         Project folder to write client config into. Default: current folder.
  --client <name>              codex, cursor, claude-code, or generic. Default: codex.
  --target <name>              Alias for --client, matching server-generated packages.
  --session-id <id>            Optional remote MCP session id.
  --trace-id <id>              Optional remote MCP trace id.
  --capture-proof              Ask remote-doctor to prove capture/recall through remote MCP.
  --skip-doctor                Write config without running remote-doctor.
  --dry-run                    Install CLI and preview config/doctor command without writing files.
  --ref <git-branch-or-tag>    Git ref to fetch. Default: main.
  --repo-url <git-https-url>   Repository URL. Default: https://github.com/Mushkrot/Recallant.git
  --install-dir <path>         Persistent client CLI source directory. Default: ~/.local/share/recallant-client-cli
  --help                       Show this help.
USAGE
}

hint_missing() {
  case "$1" in
    node)
      echo "  - Install Node.js 20+ (npm included). https://nodejs.org/en/download"
      ;;
    npm)
      echo "  - Install Node.js 20+ package, then ensure npm is available."
      ;;
    curl)
      echo "  - Install curl."
      ;;
    git)
      echo "  - Install git."
      ;;
    *)
      echo "  - Install: $1"
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server-url)
      SERVER_URL="${2:-}"
      shift 2
      ;;
    --credential)
      CREDENTIAL="${2:-}"
      shift 2
      ;;
    --project-id)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --developer-id)
      DEVELOPER_ID="${2:-}"
      shift 2
      ;;
    --client-id)
      CLIENT_ID="${2:-}"
      shift 2
      ;;
    --project-dir)
      PROJECT_DIR="${2:-}"
      shift 2
      ;;
    --client)
      CLIENT="${2:-}"
      shift 2
      ;;
    --target)
      CLIENT="${2:-}"
      shift 2
      ;;
    --session-id)
      SESSION_ID="${2:-}"
      shift 2
      ;;
    --trace-id)
      TRACE_ID="${2:-}"
      shift 2
      ;;
    --capture-proof)
      CAPTURE_PROOF=true
      shift
      ;;
    --skip-doctor)
      SKIP_DOCTOR=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --ref)
      SOURCE_REF="${2:-}"
      shift 2
      ;;
    --repo-url)
      REPO_URL="${2:-}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:-}"
      shift 2
      ;;
    --help|-h)
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

required=()
[[ -n "$SERVER_URL" ]] || required+=("--server-url")
[[ -n "$CREDENTIAL" ]] || required+=("--credential")
[[ -n "$PROJECT_ID" ]] || required+=("--project-id")
[[ -n "$DEVELOPER_ID" ]] || required+=("--developer-id")
[[ -n "$CLIENT_ID" ]] || required+=("--client-id")
if [[ ${#required[@]} -gt 0 ]]; then
  {
    echo "Missing required remote setup inputs:"
    echo
    echo "The central Recallant server onboarding package must provide:"
    echo
    for option in "${required[@]}"; do
      echo "- $option"
    done
  } >&2
  exit 2
fi

if [[ ! "$SERVER_URL" =~ ^https://[^[:space:]/?#]+([^[:space:]]*)?$ ]]; then
  fail "Remote onboarding requires an HTTPS Recallant server URL from the central server package." 2
fi

missing=()
for dependency in node npm curl git; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    missing+=("$dependency")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required dependencies for Recallant remote client bootstrap:"
  for dependency in "${missing[@]}"; do
    echo "- $dependency"
  done
  echo
  echo "Install missing tools before retrying:"
  for dependency in "${missing[@]}"; do
    hint_missing "$dependency"
  done
  exit 1
fi

case "$PROJECT_DIR" in
  /*)
    target_project="$PROJECT_DIR"
    ;;
  *)
    target_project="$INVOKE_DIR/$PROJECT_DIR"
    ;;
esac

if [[ -n "${RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD:-}" ]]; then
  recallant_cmd="$RECALLANT_CLIENT_BOOTSTRAP_RECALLANT_CMD"
else
  case "$INSTALL_DIR" in
    /*)
      client_install_dir="$INSTALL_DIR"
      ;;
    *)
      client_install_dir="$INVOKE_DIR/$INSTALL_DIR"
      ;;
  esac

  if [[ -e "$client_install_dir" && ! -d "$client_install_dir/.git" ]]; then
    fail "Recallant client CLI install directory exists but is not a git checkout: $client_install_dir" 1
  fi

  mkdir -p "$(dirname "$client_install_dir")"
  if [[ -d "$client_install_dir/.git" ]]; then
    git -C "$client_install_dir" fetch --depth 1 origin "$SOURCE_REF"
  else
    git clone --depth 1 "$REPO_URL" "$client_install_dir"
    git -C "$client_install_dir" fetch --depth 1 origin "$SOURCE_REF"
  fi
  git -C "$client_install_dir" checkout -q --detach FETCH_HEAD

  RECALLANT_HOME="$client_install_dir" "$client_install_dir/scripts/install-recallant-cli.sh" --user

  recallant_cmd="recallant"
  if ! command -v recallant >/dev/null 2>&1 && [[ -x "$HOME/.local/bin/recallant" ]]; then
    recallant_cmd="$HOME/.local/bin/recallant"
  fi
fi

connect_args=(
  "connect-remote"
  "$CLIENT"
  "--server-url"
  "$SERVER_URL"
  "--credential"
  "$CREDENTIAL"
  "--project-id"
  "$PROJECT_ID"
  "--developer-id"
  "$DEVELOPER_ID"
  "--client-id"
  "$CLIENT_ID"
  "--project-dir"
  "$target_project"
)
doctor_args=(
  "remote-doctor"
  "--server-url"
  "$SERVER_URL"
  "--credential"
  "$CREDENTIAL"
  "--project-id"
  "$PROJECT_ID"
  "--developer-id"
  "$DEVELOPER_ID"
  "--client-id"
  "$CLIENT_ID"
)

if [[ -n "$SESSION_ID" ]]; then
  connect_args+=("--session-id" "$SESSION_ID")
  doctor_args+=("--session-id" "$SESSION_ID")
fi
if [[ -n "$TRACE_ID" ]]; then
  connect_args+=("--trace-id" "$TRACE_ID")
  doctor_args+=("--trace-id" "$TRACE_ID")
fi
if [[ "$CAPTURE_PROOF" == "true" ]]; then
  doctor_args+=("--capture-proof")
fi

echo "Recallant remote client bootstrap"
echo "- Project: $target_project"
echo "- Client: $CLIENT"
echo "- Server: $SERVER_URL"
echo "- Local storage: not installed"
echo "- Docker/Postgres: not required"
echo

if [[ "$DRY_RUN" == "true" ]]; then
  echo "DRY_RUN: remote client config preview"
  echo "- Target config will be written by connect-remote when --dry-run is removed."
  echo "- Raw credential is hidden in human output."
  echo "DRY_RUN: no project files were changed."
  if [[ "$SKIP_DOCTOR" != "true" ]]; then
    echo "Doctor command after write:"
    printf '  %q' "$recallant_cmd"
    redacted_args "${doctor_args[@]}" --format text
    echo
  fi
  exit 0
fi

"$recallant_cmd" "${connect_args[@]}" --write --format text
echo "Config written: Recallant remote MCP config is installed for this project."

if [[ "$SKIP_DOCTOR" != "true" ]]; then
  if "$recallant_cmd" "${doctor_args[@]}" --format text; then
    echo "Remote doctor passed: central Recallant server accepted this project/client scope."
  else
    status=$?
    echo "Remote doctor failed: config was written, but the central server check did not pass." >&2
    echo "Check the server URL, credential status, project/developer/client scope, and edge/access policy." >&2
    exit "$status"
  fi
else
  echo "Remote doctor skipped: run recallant remote-doctor later to verify central server access."
fi

echo "Next step: open Codex in this project."

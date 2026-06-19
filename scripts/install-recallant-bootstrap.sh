#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_PROFILE="${RECALLANT_INSTALL_PROFILE:-single-user}"
SOURCE_REF="${RECALLANT_INSTALL_REF:-main}"
REPO_URL="${RECALLANT_INSTALL_REPO_URL:-https://github.com/Mushkrot/Recallant.git}"
SCRIPT_SHA256="${RECALLANT_INSTALL_SCRIPT_SHA256:-}"
INVOKE_DIR="$(pwd -P)"
ONBOARD_PROJECT=""
CONFIRM_LOCAL_SELF_HOST=false
FORWARDED_ARGS=()

usage() {
  cat <<'USAGE'
Usage: scripts/install-recallant-bootstrap.sh [options]

Installs Recallant from a trusted repository source with one command.

Examples:
  curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash
  curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash -s -- --confirm-local-self-host --onboard .
  curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash -s -- --profile managed-server

Options:
  --profile <single-user|managed-server|owner-server>
      Install profile for this machine. Default: single-user.
  --ref <git-branch-or-tag>
      Git ref to fetch before bootstrap. Default: main.
  --repo-url <git-https-url>
      Repository URL for bootstrap. Default: https://github.com/Mushkrot/Recallant.git
  --script-sha256 <sha256>
      Optional SHA-256 checksum for scripts/install-recallant.sh.
  --onboard <project-dir>
      After installing the local Recallant self-host stack, run `recallant onboard <project-dir>`.
      Relative paths are resolved from the directory where this bootstrap command was started.
      This is not the remote existing-server client path.
  --confirm-local-self-host
      Confirm that this machine should run its own local Recallant storage stack. Local self-host
      installs may require Docker/Postgres. Do not use this for a workstation that should connect
      to an existing central Recallant server.
  --help
      Show this help.

Contract:
  - Install URL uses raw.githubusercontent.com for script discovery.
  - For stronger stability, replace `main` with a fixed tag name.
  - When your environment has an expected checksum policy, set RECALLANT_INSTALL_SCRIPT_SHA256.
USAGE
}

add_hint() {
  case "$1" in
    node)
      echo "  - Install Node.js 20+ (npm included). https://nodejs.org/en/download"
      ;;
    npm)
      echo "  - Install Node.js 20+ package, then ensure npm is available."
      ;;
    curl)
      echo "  - Install curl (Debian/Ubuntu: apt-get install curl; macOS: brew install curl)."
      ;;
    git)
      echo "  - Install git (Debian/Ubuntu: apt-get install git; macOS: xcode-select --install or brew install git)."
      ;;
    docker)
      echo "  - Install Docker Engine or Docker Desktop and verify `docker` works."
      ;;
    docker-compose)
      echo "  - Install Docker with Compose plugin."
      ;;
    docker-running)
      echo "  - Start Docker Desktop or Docker Engine, wait until it says it is running, then rerun the same command."
      ;;
    *)
      echo "  - Install: $1"
      ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      BOOTSTRAP_PROFILE="${2:-}";
      shift 2
      ;;
    --ref)
      SOURCE_REF="${2:-}";
      shift 2
      ;;
    --repo-url)
      REPO_URL="${2:-}";
      shift 2
      ;;
    --script-sha256)
      SCRIPT_SHA256="${2:-}";
      shift 2
      ;;
    --onboard)
      ONBOARD_PROJECT="${2:-}";
      shift 2
      ;;
    --confirm-local-self-host)
      CONFIRM_LOCAL_SELF_HOST=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      FORWARDED_ARGS+=("$1")
      shift
      ;;
  esac
 done

if [[ "$BOOTSTRAP_PROFILE" != "single-user" && "$EUID" -ne 0 ]]; then
  echo "Install profile '$BOOTSTRAP_PROFILE' requires root privileges (for default service path permissions)."
  echo "Use --profile single-user for non-root installs, or run with sudo for managed/owner profiles."
  echo "Suggested safe default command:"
  echo "  curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash"
  exit 1
fi

if [[ -n "$ONBOARD_PROJECT" && "$CONFIRM_LOCAL_SELF_HOST" != "true" ]]; then
  echo "Refusing to run bootstrap --onboard without local self-host confirmation."
  echo
  echo "This bootstrap installer creates a local Recallant storage stack on this machine."
  echo "It may require Docker/Postgres and is not the path for connecting a project to an existing"
  echo "central Recallant server."
  echo
  echo "If you intentionally want a local self-host evaluation, rerun with:"
  echo "  --confirm-local-self-host --onboard <project-dir>"
  echo
  echo "If you want an external workstation/project to use an existing Recallant server, use the"
  echo "remote client setup in docs/CLIENT_SETUP.md. A beginner one-command remote bootstrap is not"
  echo "release-ready yet."
  exit 2
fi

missing=()
for dependency in node npm curl git docker; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    missing+=("$dependency")
  fi
done
if ! docker compose version >/dev/null 2>&1; then
  missing+=("docker-compose")
fi

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing required dependencies for bootstrap:"
  for dependency in "${missing[@]}"; do
    echo "- $dependency"
  done
  echo
  echo "Install missing tools before retrying:"
  for dependency in "${missing[@]}"; do
    add_hint "$dependency"
  done
  echo
  echo "After fixing dependencies, rerun the same command."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed, but the Docker daemon is not running."
  echo
  echo "Start Docker before retrying:"
  add_hint docker-running
  echo
  echo "After Docker is running, rerun the same command."
  exit 1
fi

case "$BOOTSTRAP_PROFILE" in
  managed-server)
    expected_cli_prefix="/usr/local/bin"
    ;;
  owner-server)
    expected_cli_prefix="/usr/local/bin"
    ;;
  single-user|*)
    expected_cli_prefix="$HOME/.local/bin"
    ;;
esac

clone_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$clone_dir"
}
trap cleanup EXIT

if ! command -v git >/dev/null 2>&1; then
  echo "bootstrap sanity check lost git before clone; please rerun."
  exit 1
fi

git clone --depth 1 --branch "$SOURCE_REF" "$REPO_URL" "$clone_dir"

install_script="$clone_dir/scripts/install-recallant.sh"
if [[ ! -f "$install_script" ]]; then
  echo "Failed to locate install script in source checkout: $install_script"
  exit 1
fi

if [[ -n "$SCRIPT_SHA256" ]]; then
  if ! command -v sha256sum >/dev/null 2>&1; then
    echo "sha256sum is required for checksum verification and is not available."
    exit 1
  fi
  actual_sha256="$(sha256sum "$install_script" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$SCRIPT_SHA256" ]]; then
    echo "install-recallant.sh SHA mismatch: expected $SCRIPT_SHA256, got $actual_sha256."
    echo "Download the script again from the exact trusted source or disable this check."
    exit 1
  fi
  echo "install-recallant.sh checksum verified."
fi

"$install_script" --profile "$BOOTSTRAP_PROFILE" "${FORWARDED_ARGS[@]}"

install_was_dry_run=false
for forwarded_arg in "${FORWARDED_ARGS[@]}"; do
  if [[ "$forwarded_arg" == "--dry-run" ]]; then
    install_was_dry_run=true
  fi
done

if command -v recallant >/dev/null 2>&1; then
  actual_version="$(recallant --version 2>/dev/null || true)"
  if [[ -n "$actual_version" ]]; then
    echo "Installed: $actual_version"
  else
    echo "Recallant CLI installed and available in PATH."
  fi
else
  echo "Install completed, but the recallant command is not on this shell PATH yet."
  if [[ -x "$expected_cli_prefix/recallant" ]]; then
    echo "Add it with:"
    echo "  export PATH=\"$expected_cli_prefix:\$PATH\""
    echo
    echo "To make it permanent:"
    if [[ "$expected_cli_prefix" == "$HOME/.local/bin" ]]; then
      echo "  echo 'export PATH=\"$HOME/.local/bin:\$PATH\"' >> \"$HOME/.bashrc\""
    else
      echo "  echo 'export PATH=\"$expected_cli_prefix:\$PATH\"' >> /etc/environment"
    fi
  fi
  echo "Then rerun: recallant --version"
fi

echo
echo "Install contract summary:"
echo "- Profile: $BOOTSTRAP_PROFILE"
echo "- Repository: $REPO_URL"
echo "- Source ref: $SOURCE_REF"
echo "- Installer entry: scripts/install-recallant.sh"
echo "- CLI prefix: $expected_cli_prefix"
echo
if [[ -n "$ONBOARD_PROJECT" ]]; then
  case "$ONBOARD_PROJECT" in
    /*)
      onboard_target="$ONBOARD_PROJECT"
      ;;
    *)
      onboard_target="$INVOKE_DIR/$ONBOARD_PROJECT"
      ;;
  esac

  if [[ "$install_was_dry_run" == "true" ]]; then
    echo "Next command after preview:"
    echo "  recallant onboard \"$onboard_target\""
  else
    recallant_cmd="recallant"
    if ! command -v recallant >/dev/null 2>&1 && [[ -x "$expected_cli_prefix/recallant" ]]; then
      recallant_cmd="$expected_cli_prefix/recallant"
    fi
    echo "Onboarding project:"
    echo "  $onboard_target"
    "$recallant_cmd" onboard "$onboard_target"
  fi
else
  echo "Next command:"
  echo "  recallant --version"
fi

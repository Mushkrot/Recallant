#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_PROFILE="${RECALLANT_INSTALL_PROFILE:-single-user}"
SOURCE_REF="${RECALLANT_INSTALL_REF:-main}"
REPO_URL="${RECALLANT_INSTALL_REPO_URL:-https://github.com/Mushkrot/Recallant.git}"
SCRIPT_SHA256="${RECALLANT_INSTALL_SCRIPT_SHA256:-}"
FORWARDED_ARGS=()

usage() {
  cat <<'USAGE'
Usage: scripts/install-recallant-bootstrap.sh [options]

Installs Recallant from a trusted repository source with one command.

Examples:
  curl -fsSL https://raw.githubusercontent.com/Mushkrot/Recallant/main/scripts/install-recallant-bootstrap.sh | bash
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
echo "Next command:"
echo "  recallant --version"

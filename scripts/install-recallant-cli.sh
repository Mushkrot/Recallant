#!/usr/bin/env bash
set -euo pipefail

RECALLANT_HOME="${RECALLANT_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
PREFIX="${PREFIX:-/usr/local/bin}"
CLI_ENV_FILE="${RECALLANT_CLI_ENV_FILE:-${RECALLANT_ENV_FILE:-}}"

if [[ "${1:-}" == "--user" ]]; then
  PREFIX="${HOME}/.local/bin"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Missing node. Install Node.js 20+ first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Missing npm. Install npm 10+ first." >&2
  exit 1
fi

cd "$RECALLANT_HOME"

if [[ ! -d node_modules ]]; then
  npm install
fi

npm run build

mkdir -p "$PREFIX"
tmp_wrapper="$(mktemp)"
cat >"$tmp_wrapper" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export RECALLANT_HOME="\${RECALLANT_HOME:-$RECALLANT_HOME}"
if [[ -z "\${RECALLANT_ENV_FILE:-}" && -n "$CLI_ENV_FILE" ]]; then
  export RECALLANT_ENV_FILE="$CLI_ENV_FILE"
fi
exec node "\$RECALLANT_HOME/apps/cli/dist/index.js" "\$@"
EOF

install -m 0755 "$tmp_wrapper" "$PREFIX/recallant"
rm -f "$tmp_wrapper"

echo "Recallant CLI installed: $PREFIX/recallant"
if [[ -n "$CLI_ENV_FILE" ]]; then
  echo "Recallant CLI env file: $CLI_ENV_FILE"
fi
echo "Try: recallant doctor"
echo "Onboard a project: recallant onboard /path/to/project"

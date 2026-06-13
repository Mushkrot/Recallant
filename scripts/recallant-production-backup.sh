#!/bin/sh
set -eu

RECALLANT_HOME=${RECALLANT_HOME:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}
ENV_FILE=${RECALLANT_ENV_FILE:-/etc/recallant/recallant.env}
DATA_DIR=${RECALLANT_DATA_DIR:-/var/lib/recallant}
BACKUP_TARGET=${RECALLANT_BACKUP_TARGET:-$DATA_DIR/backups}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

cd "$RECALLANT_HOME"
mkdir -p "$BACKUP_TARGET"

backup_output=$(node apps/cli/dist/index.js backup --target "$BACKUP_TARGET")
manifest_path=$(printf "%s" "$backup_output" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => process.stdout.write(JSON.parse(data).manifest_path));')

verification_output=$(node apps/cli/dist/index.js backup-verify --manifest "$manifest_path")
printf "%s" "$verification_output" | node -e '
const { writeFileSync } = require("node:fs");
const [manifestPath, verificationPath] = process.argv.slice(1);
let data = "";
process.stdin.on("data", chunk => data += chunk);
process.stdin.on("end", () => {
  const parsed = JSON.parse(data);
  parsed.manifest_path = manifestPath;
  parsed.verified_at = new Date().toISOString();
  writeFileSync(verificationPath, `${JSON.stringify(parsed, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
});
' "$manifest_path" "$BACKUP_TARGET/latest-verification.json"
ln -sfn "$manifest_path" "$BACKUP_TARGET/latest-manifest.json"

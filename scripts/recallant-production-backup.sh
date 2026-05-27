#!/bin/sh
set -eu

ENV_FILE=/opt/secure-configs/recallant.env
BACKUP_TARGET=/ai/recallant-data/backups

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

cd /ai/recallant
mkdir -p "$BACKUP_TARGET"

backup_output=$(node apps/cli/dist/index.js backup --target "$BACKUP_TARGET")
manifest_path=$(printf "%s" "$backup_output" | node -e 'let data=""; process.stdin.on("data", c => data += c); process.stdin.on("end", () => process.stdout.write(JSON.parse(data).manifest_path));')

node apps/cli/dist/index.js backup-verify --manifest "$manifest_path"
ln -sfn "$manifest_path" "$BACKUP_TARGET/latest-manifest.json"

#!/bin/sh
set -eu

RECALLANT_HOME=${RECALLANT_HOME:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}

# systemd EnvironmentFile already exports the service profile. Source a file only
# when the caller explicitly identifies the same authoritative profile.
if [ -n "${RECALLANT_ENV_FILE:-}" ]; then
  if [ ! -f "$RECALLANT_ENV_FILE" ]; then
    echo "Configured Recallant env file is missing" >&2
    exit 1
  fi
  set -a
  . "$RECALLANT_ENV_FILE"
  set +a
fi

if [ -z "${RECALLANT_DATABASE_URL:-}" ]; then
  echo "RECALLANT_DATABASE_URL is required" >&2
  exit 1
fi

cd "$RECALLANT_HOME"
exec node scripts/recallant-production-backup.mjs "$@"

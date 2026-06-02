#!/bin/sh
set -eu

ENV_FILE=${RECALLANT_ENV_FILE:-/opt/secure-configs/recallant.env}
DATA_DIR=${RECALLANT_DATA_DIR:-/ai/recallant-data}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

export RECALLANT_DATA_DIR="$DATA_DIR"

exec docker compose -f docker-compose.production.yml "$@"

#!/bin/sh
set -eu

ENV_FILE=/opt/secure-configs/recallant.env

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

exec docker compose -f docker-compose.production.yml "$@"

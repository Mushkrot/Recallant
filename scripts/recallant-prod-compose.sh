#!/bin/sh
set -eu

RECALLANT_PROFILE_LIBRARY_ONLY=1 . "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/recallant-profile.sh"
recallant_profile_load
recallant_profile_assert_storage

COMPOSE_PROJECT_NAME="$RECALLANT_COMPOSE_PROJECT_NAME"

exec docker compose -p "$COMPOSE_PROJECT_NAME" -f docker-compose.production.yml "$@"

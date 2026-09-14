#!/bin/sh
set -eu

RECALLANT_HOME=${RECALLANT_HOME:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}

RECALLANT_PROFILE_LIBRARY_ONLY=1 . "$RECALLANT_HOME/scripts/recallant-profile.sh"
recallant_profile_load
recallant_profile_assert_storage

cd "$RECALLANT_HOME"
exec node scripts/recallant-production-backup.mjs "$@"

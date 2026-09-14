#!/bin/sh
set -eu

# Shared production-profile resolver. The selected environment file is the authority for
# runtime, Compose, and backup values. Ambient values are accepted only when they match it.

recallant_profile_error() {
  printf 'Recallant profile error: %s\n' "$1" >&2
  return 2
}

recallant_profile_capture_override() {
  if [ -n "${RECALLANT_DATA_DIR:-}" ]; then
    recallant_profile_requested_data_dir=$RECALLANT_DATA_DIR
    recallant_profile_requested_data_dir_set=1
  else
    recallant_profile_requested_data_dir_set=0
  fi
  if [ -n "${RECALLANT_BACKUP_TARGET:-}" ]; then
    recallant_profile_requested_backup_target=$RECALLANT_BACKUP_TARGET
    recallant_profile_requested_backup_target_set=1
  else
    recallant_profile_requested_backup_target_set=0
  fi
  if [ -n "${RECALLANT_POSTGRES_HOST:-}" ]; then
    recallant_profile_requested_postgres_host=$RECALLANT_POSTGRES_HOST
    recallant_profile_requested_postgres_host_set=1
  else
    recallant_profile_requested_postgres_host_set=0
  fi
  if [ -n "${RECALLANT_POSTGRES_PORT:-}" ]; then
    recallant_profile_requested_postgres_port=$RECALLANT_POSTGRES_PORT
    recallant_profile_requested_postgres_port_set=1
  else
    recallant_profile_requested_postgres_port_set=0
  fi
  if [ -n "${RECALLANT_POSTGRES_CONTAINER_NAME:-}" ]; then
    recallant_profile_requested_container=$RECALLANT_POSTGRES_CONTAINER_NAME
    recallant_profile_requested_container_set=1
  else
    recallant_profile_requested_container_set=0
  fi
  if [ -n "${RECALLANT_COMPOSE_PROJECT_NAME:-}" ]; then
    recallant_profile_requested_project=$RECALLANT_COMPOSE_PROJECT_NAME
    recallant_profile_requested_project_set=1
  else
    recallant_profile_requested_project_set=0
  fi
  if [ -n "${RECALLANT_BACKUP_METRICS_FILE:-}" ]; then
    recallant_profile_requested_metrics_file=$RECALLANT_BACKUP_METRICS_FILE
    recallant_profile_requested_metrics_file_set=1
  else
    recallant_profile_requested_metrics_file_set=0
  fi
}

recallant_profile_compare_override() {
  requested_set=$1
  requested_value=$2
  profile_value=$3
  field_name=$4
  if [ "$requested_set" = 1 ] && [ "$requested_value" != "$profile_value" ]; then
    recallant_profile_error "$field_name conflicts with the authoritative env file"
  fi
}

recallant_profile_require_authoritative_keys() {
  for profile_key in \
    POSTGRES_DB \
    POSTGRES_USER \
    POSTGRES_PASSWORD \
    RECALLANT_DATABASE_URL \
    RECALLANT_DATA_DIR \
    RECALLANT_BACKUP_TARGET \
    RECALLANT_POSTGRES_HOST \
    RECALLANT_POSTGRES_PORT \
    RECALLANT_POSTGRES_CONTAINER_NAME \
    RECALLANT_COMPOSE_PROJECT_NAME; do
    grep -q "^${profile_key}=" "$recallant_profile_env_file" ||
      recallant_profile_error "authoritative env file is missing $profile_key"
  done
}

recallant_profile_validate_url() {
  if ! command -v node >/dev/null 2>&1; then
    recallant_profile_error "node is required to validate RECALLANT_DATABASE_URL"
    return 2
  fi
  if ! RECALLANT_PROFILE_URL="$RECALLANT_DATABASE_URL" \
    RECALLANT_PROFILE_DB_USER="$POSTGRES_USER" \
    RECALLANT_PROFILE_DB_PASSWORD="$POSTGRES_PASSWORD" \
    RECALLANT_PROFILE_DB_NAME="$POSTGRES_DB" \
    RECALLANT_PROFILE_DB_HOST="$RECALLANT_POSTGRES_HOST" \
    RECALLANT_PROFILE_DB_PORT="$RECALLANT_POSTGRES_PORT" \
    node -e '
      const url = new URL(process.env.RECALLANT_PROFILE_URL);
      const expected = {
        username: process.env.RECALLANT_PROFILE_DB_USER,
        password: process.env.RECALLANT_PROFILE_DB_PASSWORD,
        database: process.env.RECALLANT_PROFILE_DB_NAME,
        hostname: process.env.RECALLANT_PROFILE_DB_HOST,
        port: process.env.RECALLANT_PROFILE_DB_PORT
      };
      const actual = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.replace(/^\/+/, "")),
        hostname: url.hostname,
        port: url.port || (url.protocol === "postgres:" || url.protocol === "postgresql:" ? "5432" : "")
      };
      for (const field of Object.keys(expected)) {
        if (actual[field] !== expected[field]) process.exitCode = 2;
      }
      if (!/^postgres(?:ql)?:$/.test(url.protocol)) process.exitCode = 2;
      if (process.exitCode) process.stderr.write("RECALLANT_DATABASE_URL does not match the production profile\n");
    ';
  then
    recallant_profile_error "RECALLANT_DATABASE_URL does not match the production profile"
  fi
}

recallant_profile_url_component() {
  component=$1
  RECALLANT_PROFILE_URL="$RECALLANT_DATABASE_URL" RECALLANT_PROFILE_COMPONENT="$component" node -e '
    const url = new URL(process.env.RECALLANT_PROFILE_URL);
    const component = process.env.RECALLANT_PROFILE_COMPONENT;
    if (component === "hostname") process.stdout.write(url.hostname);
    if (component === "port") process.stdout.write(url.port || "5432");
  '
}

recallant_profile_load() {
  recallant_profile_capture_override

  if [ -n "${RECALLANT_ENV_FILE:-}" ]; then
    recallant_profile_env_file=$RECALLANT_ENV_FILE
  elif [ -n "${RECALLANT_DATABASE_URL:-}" ]; then
    # Fully explicit test/one-shot invocations may provide a complete profile without a file.
    recallant_profile_env_file=
  else
    recallant_profile_env_file=/etc/recallant/recallant.env
  fi

  if [ -n "$recallant_profile_env_file" ]; then
    [ -f "$recallant_profile_env_file" ] ||
      recallant_profile_error "authoritative env file is missing"
    recallant_profile_require_authoritative_keys
    set -a
    # shellcheck disable=SC1090
    . "$recallant_profile_env_file"
    set +a
  fi

  RECALLANT_ENV_FILE=${recallant_profile_env_file:-}
  if [ -n "${RECALLANT_DATABASE_URL:-}" ]; then
    if [ -z "${RECALLANT_POSTGRES_HOST:-}" ] && command -v node >/dev/null 2>&1; then
      RECALLANT_POSTGRES_HOST=$(recallant_profile_url_component hostname)
    fi
    if [ -z "${RECALLANT_POSTGRES_PORT:-}" ] && command -v node >/dev/null 2>&1; then
      RECALLANT_POSTGRES_PORT=$(recallant_profile_url_component port)
    fi
  fi
  RECALLANT_DATA_DIR=${RECALLANT_DATA_DIR:-/var/lib/recallant}
  RECALLANT_BACKUP_TARGET=${RECALLANT_BACKUP_TARGET:-$RECALLANT_DATA_DIR/backups}
  RECALLANT_LATEST_BACKUP_VERIFICATION_FILE=$RECALLANT_BACKUP_TARGET/latest-verification.json
  RECALLANT_LATEST_BACKUP_MANIFEST=$RECALLANT_BACKUP_TARGET/latest-manifest.json
  RECALLANT_POSTGRES_HOST=${RECALLANT_POSTGRES_HOST:-127.0.0.1}
  RECALLANT_POSTGRES_PORT=${RECALLANT_POSTGRES_PORT:-15432}
  RECALLANT_POSTGRES_CONTAINER_NAME=${RECALLANT_POSTGRES_CONTAINER_NAME:-recallant-postgres}
  RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER=${RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER:-}
  RECALLANT_EXPECTED_POSTGRES_MOUNT_SOURCE=${RECALLANT_EXPECTED_POSTGRES_MOUNT_SOURCE:-$RECALLANT_DATA_DIR/postgres}
  RECALLANT_EXPECTED_POSTGRES_MOUNT_DESTINATION=${RECALLANT_EXPECTED_POSTGRES_MOUNT_DESTINATION:-/var/lib/postgresql/data}
  RECALLANT_COMPOSE_PROJECT_NAME=${RECALLANT_COMPOSE_PROJECT_NAME:-recallant}
  RECALLANT_BACKUP_METRICS_FILE=${RECALLANT_BACKUP_METRICS_FILE:-}

  recallant_profile_compare_override "$recallant_profile_requested_data_dir_set" \
    "${recallant_profile_requested_data_dir:-}" "$RECALLANT_DATA_DIR" RECALLANT_DATA_DIR
  recallant_profile_compare_override "$recallant_profile_requested_backup_target_set" \
    "${recallant_profile_requested_backup_target:-}" "$RECALLANT_BACKUP_TARGET" RECALLANT_BACKUP_TARGET
  recallant_profile_compare_override "$recallant_profile_requested_postgres_host_set" \
    "${recallant_profile_requested_postgres_host:-}" "$RECALLANT_POSTGRES_HOST" RECALLANT_POSTGRES_HOST
  recallant_profile_compare_override "$recallant_profile_requested_postgres_port_set" \
    "${recallant_profile_requested_postgres_port:-}" "$RECALLANT_POSTGRES_PORT" RECALLANT_POSTGRES_PORT
  recallant_profile_compare_override "$recallant_profile_requested_container_set" \
    "${recallant_profile_requested_container:-}" "$RECALLANT_POSTGRES_CONTAINER_NAME" RECALLANT_POSTGRES_CONTAINER_NAME
  recallant_profile_compare_override "$recallant_profile_requested_project_set" \
    "${recallant_profile_requested_project:-}" "$RECALLANT_COMPOSE_PROJECT_NAME" RECALLANT_COMPOSE_PROJECT_NAME
  recallant_profile_compare_override "$recallant_profile_requested_metrics_file_set" \
    "${recallant_profile_requested_metrics_file:-}" "$RECALLANT_BACKUP_METRICS_FILE" RECALLANT_BACKUP_METRICS_FILE

  export RECALLANT_ENV_FILE RECALLANT_DATA_DIR RECALLANT_BACKUP_TARGET
  export RECALLANT_LATEST_BACKUP_VERIFICATION_FILE RECALLANT_LATEST_BACKUP_MANIFEST
  export RECALLANT_POSTGRES_HOST RECALLANT_POSTGRES_PORT
  export RECALLANT_POSTGRES_CONTAINER_NAME RECALLANT_COMPOSE_PROJECT_NAME
  export RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER
  export RECALLANT_EXPECTED_POSTGRES_MOUNT_SOURCE RECALLANT_EXPECTED_POSTGRES_MOUNT_DESTINATION
  export RECALLANT_BACKUP_METRICS_FILE
}

recallant_profile_assert_values() {
  for profile_path in "$RECALLANT_DATA_DIR" "$RECALLANT_BACKUP_TARGET"; do
    case "$profile_path" in
      /*) ;;
      *) recallant_profile_error "profile paths must be absolute" ;;
    esac
  done
  case "$RECALLANT_POSTGRES_PORT" in
    ''|*[!0-9]*) recallant_profile_error "RECALLANT_POSTGRES_PORT must be numeric" ;;
  esac
  case "$RECALLANT_POSTGRES_CONTAINER_NAME" in
    ''|*[!A-Za-z0-9_.-]*) recallant_profile_error "Postgres container name is invalid" ;;
  esac
  if [ -n "${RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER:-}" ]; then
    case "$RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER" in
      ''|*[!0-9]*) recallant_profile_error "RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER must be numeric" ;;
    esac
  fi
  case "$RECALLANT_EXPECTED_POSTGRES_MOUNT_SOURCE" in
    /*) ;;
    *) recallant_profile_error "RECALLANT_EXPECTED_POSTGRES_MOUNT_SOURCE must be absolute" ;;
  esac
  case "$RECALLANT_EXPECTED_POSTGRES_MOUNT_DESTINATION" in
    /*) ;;
    *) recallant_profile_error "RECALLANT_EXPECTED_POSTGRES_MOUNT_DESTINATION must be absolute" ;;
  esac
  if [ -n "${RECALLANT_BACKUP_METRICS_FILE:-}" ]; then
    case "$RECALLANT_BACKUP_METRICS_FILE" in
      /*) ;;
      *) recallant_profile_error "RECALLANT_BACKUP_METRICS_FILE must be absolute" ;;
    esac
  fi
  case "$RECALLANT_COMPOSE_PROJECT_NAME" in
    ''|*[!A-Za-z0-9_.-]*) recallant_profile_error "Compose project name is invalid" ;;
  esac
  : "${POSTGRES_DB:?POSTGRES_DB is required by the production profile}"
  : "${POSTGRES_USER:?POSTGRES_USER is required by the production profile}"
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required by the production profile}"
  : "${RECALLANT_DATABASE_URL:?RECALLANT_DATABASE_URL is required by the production profile}"
  recallant_profile_validate_url
}

recallant_profile_assert_storage() {
  recallant_profile_assert_values
  [ -d "$RECALLANT_DATA_DIR" ] ||
    recallant_profile_error "data root is unavailable"
  [ -d "$(dirname "$RECALLANT_BACKUP_TARGET")" ] ||
    recallant_profile_error "backup target parent is unavailable"
  [ -w "$RECALLANT_DATA_DIR" ] ||
    recallant_profile_error "data root is not writable"
  [ -w "$(dirname "$RECALLANT_BACKUP_TARGET")" ] ||
    recallant_profile_error "backup target parent is not writable"
}

if [ "${RECALLANT_PROFILE_LIBRARY_ONLY:-0}" != 1 ]; then
  mode=${1:-assert}
  recallant_profile_load
  case "$mode" in
    assert|assert-compose|assert-backup)
      recallant_profile_assert_storage
      ;;
    assert-service)
      recallant_profile_assert_values
      ;;
    print)
      recallant_profile_assert_values
      printf 'env_file=%s\ndata_dir=%s\nbackup_target=%s\npostgres_host=%s\npostgres_port=%s\npostgres_container=%s\ncompose_project=%s\n' \
        "$RECALLANT_ENV_FILE" "$RECALLANT_DATA_DIR" "$RECALLANT_BACKUP_TARGET" \
        "$RECALLANT_POSTGRES_HOST" "$RECALLANT_POSTGRES_PORT" \
        "$RECALLANT_POSTGRES_CONTAINER_NAME" "$RECALLANT_COMPOSE_PROJECT_NAME"
      printf 'expected_postgres_system_identifier=%s\nexpected_postgres_mount_source=%s\nexpected_postgres_mount_destination=%s\n' \
        "${RECALLANT_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER:-}" "$RECALLANT_EXPECTED_POSTGRES_MOUNT_SOURCE" \
        "$RECALLANT_EXPECTED_POSTGRES_MOUNT_DESTINATION"
      printf 'backup_metrics_file=%s\n' "${RECALLANT_BACKUP_METRICS_FILE:-}"
      ;;
    *)
      recallant_profile_error "unknown mode: $mode"
      ;;
  esac
fi

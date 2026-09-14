#!/usr/bin/env bash
# Linux-only, offline fixtures. Never fall back to an unsandboxed child.
set -euo pipefail
fixture_repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fixture_entry=${1:-scripts/smoke-fixture-isolation.mjs}
case "$fixture_entry" in
  scripts/*.mjs) ;;
  *) echo 'Expected a tracked scripts/*.mjs fixture' >&2; exit 2 ;;
esac
case "$fixture_entry" in
  *..*|*//* ) echo 'Fixture path traversal is forbidden' >&2; exit 2 ;;
esac
if [[ $# -gt 0 ]]; then shift; fi
command -v bwrap >/dev/null
git -C "$fixture_repo" ls-files --error-unmatch -- "$fixture_entry" >/dev/null
test -d "$fixture_repo/node_modules"
fixture_export=$(mktemp -d /tmp/recallant-isolated-fixture.XXXXXXXX)
trap 'rm -rf -- "$fixture_export"' EXIT
# Only tracked source is exported; project state and operator configuration stay outside.
git -C "$fixture_repo" archive HEAD | tar -x -C "$fixture_export"
for fixture_group in apps packages; do
  for fixture_package in "$fixture_repo/$fixture_group"/*; do
    [[ -d "$fixture_package/dist" ]] || continue
    fixture_relative="$fixture_group/$(basename -- "$fixture_package")"
    mkdir -p "$fixture_export/$fixture_relative"
    cp -a -- "$fixture_package/dist" "$fixture_export/$fixture_relative/dist"
  done
done
test -f "$fixture_export/$fixture_entry"
mkdir -p "$fixture_export/node_modules"
# Dependencies are read-only. Workspace links resolve into the exported packages.
# No host /etc, home, /run, /tmp, project roots, DB sockets or network are mounted.
bwrap --unshare-all --die-with-parent --new-session --cap-drop ALL \
  --clearenv --setenv PATH /usr/bin:/bin --setenv HOME /home/fixture \
  --setenv TMPDIR /tmp --setenv RECALLANT_ENV_FILE /dev/null \
  --setenv RECALLANT_SERVICE_ENV_FILE /dev/null \
  --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib \
  --symlink usr/lib64 /lib64 --proc /proc --dev /dev --tmpfs /tmp \
  --dir /home/fixture --tmpfs /workspace --dir /workspace/project \
  --ro-bind "$fixture_export" /candidate \
  --ro-bind "$fixture_repo/node_modules" /candidate/node_modules \
  --chdir /workspace/project \
  /usr/bin/node "/candidate/$fixture_entry" "$@"

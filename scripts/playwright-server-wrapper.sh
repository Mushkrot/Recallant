#!/usr/bin/env bash
set -euo pipefail

# Run the repository's installed Playwright; its standard cache or an explicit
# PLAYWRIGHT_BROWSERS_PATH determines the browser location.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$script_dir/../node_modules/@playwright/test/cli.js" "$@"

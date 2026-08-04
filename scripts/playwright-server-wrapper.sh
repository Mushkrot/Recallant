#!/usr/bin/env bash
set -euo pipefail

# Server-wide Playwright entrypoint for shared headless QA browser binaries.
# This wrapper keeps Playwright as an on-demand CLI tool and does not run a service.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ai/playwright/browsers}"

exec /usr/bin/playwright "$@"

# Workbench Portfolio Screenshots

The three PNG files in this directory come from the real Recallant Workbench and the synthetic,
public-safe fixture in `scripts/smoke-review-ui-playwright.mjs`. They do not use a private Recallant
service, private project data, or manual image editing.

From a clean checkout:

```bash
npm ci
npx playwright install chromium
npm run db:up
npm run db:reset:integration
npm run build
npm run portfolio-screenshots:generate
```

The generator writes exactly these primary portfolio assets:

- `home-readiness.png`
- `review-provenance.png`
- `activity-recovery.png`

The fixture uses a 1440 x 900 desktop viewport, masks volatile timestamps, checks visible text for
private identifiers and secret-shaped data, and fails on browser errors, failed requests, clipped
controls, or horizontal overflow.

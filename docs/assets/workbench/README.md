# Workbench Portfolio Screenshots

The three PNG files in this directory come from the real Recallant Workbench and the synthetic,
public-safe fixture in `scripts/smoke-review-ui-playwright.mjs`. They do not use a private Recallant
service, private project data, or manual image editing.

For these documentation previews, the generator temporarily applies
`scripts/portfolio-screenshot-theme.css`: cool neutral surfaces, graphite text, and a restrained
blue action accent. Status colors retain their meaning. This is a presentation study, not a claim
that the installed application uses this theme.

The stylesheet is loaded only while each portfolio image is captured and removed immediately
afterward. It is not imported by the application. The capture checks that visible content stays
unchanged; the existing browser fixture continues to check the real controls and workflows.

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

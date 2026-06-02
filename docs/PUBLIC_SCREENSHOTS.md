# Public Screenshot Policy

Public screenshots are part of Stage 7, but only sanitized screenshots can be used in README,
release notes, or public issue/PR material.

## Allowed Screenshot Sources

Use Recallant's browser smoke fixture for public-ready screenshots whenever possible:

```bash
npm run review-ui:playwright
```

The fixture uses generated ids and synthetic project data. Screenshots are written under the
configured Playwright report directory, normally:

```text
/ai/playwright/reports
```

Before publishing, copy only sanitized images into a release artifact location outside private
runtime paths.

## Required Screenshots Before Public Release

- Workbench overview showing Memory Spaces, Ask Recallant, Activity / Replay, and capture state.
- Focused Ask Recallant view with a safe read-only answer.
- Memory Space / Sources view with synthetic sources only.
- Review view with synthetic review items only.
- Mobile width Workbench view with no horizontal overflow.

## Redaction Rules

Public screenshots must not contain:

- owner-server paths such as `/ai/recallant`, `/ai/recallant-data`, or `/opt/secure-configs`;
- private hostnames such as `recallant.unicloud.ca`;
- owner email addresses;
- real project names, customer names, private repository names, or production service names;
- raw ids that can identify private memory records when they are not synthetic;
- secrets, tokens, database URLs, provider API key references, or connector credentials;
- raw memory excerpts from real owner projects.

## Verification

Before attaching screenshots to public documentation:

1. Generate them from synthetic fixture data.
2. Inspect the image manually.
3. Confirm no private path, hostname, email, token, or real project name appears.
4. Keep technical details collapsed unless the screenshot is specifically for developer docs.

The automated `npm run public-readiness:smoke` checks this policy document exists and contains the
redaction contract. The actual visual image review remains a release-candidate task.

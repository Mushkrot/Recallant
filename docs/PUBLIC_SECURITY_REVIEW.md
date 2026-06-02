# Public Security Review

This is the Stage 7 security review checklist for public-facing installation, packaging, and
documentation.

## Reviewed Public Path

The public path is:

```text
README
  -> QUICKSTART
  -> SELF_HOSTING
  -> CLIENT_SETUP
  -> RELEASE
  -> PUBLIC_READINESS
  -> PUBLIC_SCREENSHOTS
```

Owner-server operational facts live in [OWNER_SERVER.md](OWNER_SERVER.md) and are not the generic
install path.

## Public Defaults

Public-facing defaults must remain:

- private/self-hosted;
- local stdio MCP by default;
- localhost/private Workbench by default;
- local database by default;
- dry-run before destructive cleanup;
- confirmation-gated for paid API, public exposure, connector/account binding, production service
  operations, and broad global rules.

## What The Public Path Must Not Expose

Normal public onboarding docs must not expose:

- owner production hostname;
- owner email addresses;
- owner `/ai` runtime paths;
- secure env-file paths;
- database URLs or database passwords;
- auth tokens, session secrets, API keys, connector secrets, or provider key references;
- real project names or private memory excerpts.

Owner-specific values may appear only in `OWNER_SERVER.md` or as explicit "must not publish"
examples in release/screenshot/security policy documents.

## Current Review Result

Current repository guardrails:

- `npm run public-readiness:smoke` checks the public onboarding path.
- `npm run public-clean-host:smoke` checks isolated clean-host-style install planning.
- `npm run public-security:smoke` checks that normal onboarding docs do not contain owner hostnames,
  owner emails, owner `/ai` runtime paths, secure env paths, or raw secret-like assignments.
- Server code rejects public bind by default unless explicit public-bind opt-in is set.
- Management Chat policy gates destructive, public exposure, paid API, connector/account, and broad
  global-rule actions.

This is a repository-level public-doc/security guardrail. A final public release still needs a
manual security review after the real clean-host install and screenshot approval.

# Why Recallant

AI coding agents are becoming part of everyday software maintenance, but their memory is still
fragile. A maintainer may spend real time explaining architecture, constraints, release state,
security posture, and past decisions, only to repeat the same context in the next session.

Recallant exists to make that work durable.

## The Maintainer Pain

Modern OSS maintenance has many context surfaces:

- repository files and docs;
- issues, PRs, reviews, and CI logs;
- local terminal output;
- private deployment notes;
- agent chat history;
- human decisions that never become code.

Generic context retrieval can find text, but maintainers need more than text. They need to know
whether something is still true, where it came from, which project it applies to, whether it is safe
to reuse, and whether it should guide future agent behavior.

## The Gap

Plain logs preserve evidence but do not create governed memory.

Basic RAG can retrieve old chunks but usually lacks authority, review state, lifecycle, and
project-scope policy.

Manual handoff files help, but they grow stale and push context-budget work back onto humans.

Recallant is designed around the missing layer: governed external memory for agents.

## Why Codex And OSS Maintainers Benefit

Codex can already write code quickly. The hard part is making it continue responsibly across
sessions, branches, reviews, and releases. Recallant gives Codex a way to:

- start from a server-built context pack instead of a long manual prompt;
- remember decisions and checkpoints with source references;
- avoid silently mixing unrelated project memory;
- surface conflicts and candidate rules for maintainer review;
- preserve release/security evidence without exposing secrets.

This helps solo maintainers and small OSS projects get more reliable agent assistance without
needing a large process around every session.

## What Recallant Optimizes For

- private self-hosting first;
- evidence-backed memory instead of ungrounded summaries;
- explicit review for durable rules;
- local-first model routing and cost gates;
- MCP-compatible agents beyond a single client;
- honest pre-release hardening before broad adoption.

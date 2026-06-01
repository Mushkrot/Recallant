# Product Acceptance Test

Last updated: 2026-06-01.

This file defines the non-negotiable product gate for Recallant. Component-level success is not
enough. Ordinary-use readiness requires the main agent-memory loop to be proven end-to-end without
the owner acting as QA.

Current status: the first production-ready coding-agent memory slice passed this gate through
`npm run product-acceptance:smoke`. This does not make every future Recallant domain complete.
New domains such as virtual memory spaces, personal external-memory workflows, new connectors, or
additional client adapters must pass their own acceptance gates before being called ready.

## Main Acceptance Scenario

A fresh project is considered truly attached only when this scenario passes:

1. Create or use a clean project directory.
2. Run the normal one-command onboarding path:

   ```bash
   recallant attach .
   ```

3. Start a Recallant-backed agent session from that project.
4. The session reads a server-built context pack before non-trivial work.
5. The agent records meaningful workflow evidence, including at least one owner decision, one agent
   action, one verification result, and one checkpoint.
6. The session closes cleanly.
7. A new session in the same project receives the previous decision through Recallant context,
   without reading old project logs by hand.
8. The Review Command Center shows the project as capture-ready, with last context read, last memory
   write, and last checkpoint visible.
9. Cleanup/detach can remove the test project from active Recallant views without touching unrelated
   projects or original files.

If any step fails, the project is only registered or partially integrated; it is not product-ready.

## Agent Continuation Rule

Agents working on Recallant must continue through the next documented implementation gate whenever
they can do so safely. A commit, progress report, or passing component smoke test is a checkpoint,
not a stopping point.

Stop only for a real owner-dependent blocker:

- secrets or raw credential handling;
- paid API use;
- public exposure, firewall, service, or security changes;
- destructive/permanent erasure;
- attaching a production-sensitive live project outside the documented safety path;
- a genuine contradiction in the specification.

## Required Proof Before "Ready"

The final readiness claim must include:

- local build/lint/format checks;
- component smoke tests for the touched subsystem;
- `npm run product-acceptance:smoke` on an isolated project;
- `npm run pilot-report:smoke` for the clean/copy/production-preflight pilot report;
- dogfood proof that `/ai/recallant` itself can write and recall Recallant work through the same
  capture loop;
- production health checks after deploy when deployment changed.

Until those pass, use language such as "first slice complete" or "registered only", not "ready" or
"done".

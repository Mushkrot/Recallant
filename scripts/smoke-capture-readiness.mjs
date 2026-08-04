import assert from "node:assert/strict";

import { buildRecallantReadinessContract } from "../packages/contracts/dist/index.js";

const now = "2026-07-18T12:00:00.000Z";
const governedLoop = buildRecallantReadinessContract({
  configured: true,
  context_ready: true,
  semantic_memory_ready: true,
  capture_active: true,
  last_context_read_at: "2026-07-18T09:00:00.000Z",
  last_memory_write_at: "2026-07-18T10:00:00.000Z",
  last_checkpoint_at: "2026-07-18T11:00:00.000Z",
  now
});
assert.equal(governedLoop.version, 2);
assert.equal(governedLoop.memory_loop_ready, true);
assert.equal(governedLoop.capture_active, false);
assert.equal(governedLoop.primary_state, "memory_loop_ready");

const freshAutomaticCapture = buildRecallantReadinessContract({
  configured: true,
  last_automatic_capture_at: "2026-07-18T11:30:00.000Z",
  automatic_capture_source: "codex_native_hook",
  capture_freshness_hours: 2,
  now
});
assert.equal(freshAutomaticCapture.capture_fresh, true);
assert.equal(freshAutomaticCapture.capture_active, true);
assert.equal(freshAutomaticCapture.primary_state, "capture_active");

const staleAutomaticCapture = buildRecallantReadinessContract({
  configured: true,
  last_automatic_capture_at: "2026-07-18T09:00:00.000Z",
  automatic_capture_source: "codex_native_hook",
  capture_freshness_hours: 2,
  now
});
assert.equal(staleAutomaticCapture.capture_fresh, false);
assert.equal(staleAutomaticCapture.capture_active, false);
assert.equal(staleAutomaticCapture.evidence.last_automatic_capture_at !== null, true);

const unconfiguredCapture = buildRecallantReadinessContract({
  configured: false,
  last_automatic_capture_at: "2026-07-18T11:30:00.000Z",
  now
});
assert.equal(unconfiguredCapture.capture_fresh, true);
assert.equal(unconfiguredCapture.capture_active, false);

process.stdout.write("capture readiness smoke passed\n");

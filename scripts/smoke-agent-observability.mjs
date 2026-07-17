import { randomUUID } from "node:crypto";
import pg from "pg";
import { analyzeAgentObservationCompleteness } from "../packages/core/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-observability-${projectId}`;
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
const client = new pg.Client({ connectionString: databaseUrl });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fakeSecret = `sk-observability-${randomUUID().replaceAll("-", "")}`;
const fakePassword = `fixture-password-${randomUUID().slice(0, 8)}`;
const forbidden = [fakeSecret, fakePassword];

await client.connect();
try {
  const project = await db.ensureProject();
  const started = await db.startSession({
    project_id: project.projectId,
    client_kind: "codex",
    client_version: "observability-smoke"
  });
  const sessionId = started.session_id;
  assert(sessionId, "session was not created");

  const expired = await db.appendAgentObservation({
    session_id: sessionId,
    kind: "system",
    title: "Retention fixture"
  });
  await client.query(
    "UPDATE agent_observations SET occurred_at = now() - interval '31 days' WHERE id = $1",
    [expired.id]
  );

  const turnId = randomUUID();
  const prompt = await db.appendAgentObservation({
    session_id: sessionId,
    turn_id: turnId,
    kind: "user_prompt",
    body: `Investigate the failure using api_key=${fakeSecret}`,
    metadata: { password: fakePassword, safe: "visible" },
    client_kind: "codex"
  });
  const duplicate = await db.appendAgentObservation({
    session_id: sessionId,
    turn_id: turnId,
    kind: "assistant_response",
    dedup_key: "turn-response-1",
    body: "I will inspect the failing operation."
  });
  const duplicateAgain = await db.appendAgentObservation({
    session_id: sessionId,
    turn_id: turnId,
    kind: "assistant_response",
    dedup_key: "turn-response-1",
    body: "This duplicate must not be stored."
  });
  assert(duplicate.id === duplicateAgain.id, "deduplication did not return the existing row");

  const toolTrace = randomUUID();
  const toolCall = await db.appendAgentObservation({
    session_id: sessionId,
    trace_id: toolTrace,
    kind: "tool_call",
    tool_name: "exec_command",
    title: "Inspect service status",
    rationale: "Confirm whether the service is currently healthy."
  });
  await db.appendAgentObservation({
    session_id: sessionId,
    trace_id: toolTrace,
    parent_observation_id: toolCall.id,
    kind: "tool_result",
    status: "success",
    body: "Service is active."
  });

  const errorTrace = randomUUID();
  const error = await db.appendAgentObservation({
    session_id: sessionId,
    trace_id: errorTrace,
    kind: "error",
    error_code: "DEPENDENCY_UNAVAILABLE",
    body: "The dependency did not answer.",
    attempt_number: 1
  });
  const retry = await db.appendAgentObservation({
    session_id: sessionId,
    trace_id: errorTrace,
    parent_observation_id: error.id,
    kind: "retry",
    attempt_number: 2,
    body: "Retry with the bounded fallback."
  });
  const remediation = await db.appendAgentObservation({
    session_id: sessionId,
    trace_id: errorTrace,
    parent_observation_id: retry.id,
    kind: "remediation",
    body: "Restored the dependency connection."
  });
  await db.appendAgentObservation({
    session_id: sessionId,
    trace_id: errorTrace,
    parent_observation_id: error.id,
    kind: "verification",
    resolution_status: "resolved",
    status: "success",
    body: "The same operation now succeeds.",
    metadata: { remediation_observation_id: remediation.id }
  });

  const observations = await db.listAgentObservations({ session_id: sessionId, limit: 100 });
  const serialized = JSON.stringify(observations);
  assert(!forbidden.some((value) => serialized.includes(value)), "stored data leaked a secret");
  assert(prompt.redacted === true, "redaction was not reported on the prompt");
  assert(
    observations.every((item, index, rows) =>
      index === 0 ? true : item.sequence_number < rows[index - 1].sequence_number
    ),
    "observations are not ordered by descending sequence"
  );
  assert(!observations.some((item) => item.id === expired.id), "retention did not prune old data");

  const completeness = analyzeAgentObservationCompleteness(observations);
  assert(
    completeness.state === "complete",
    `unexpected completeness: ${JSON.stringify(completeness)}`
  );
  assert(completeness.unresolved_errors === 0, "resolved error remained open");
  const artificialGap = observations.map((item, index) =>
    index === 0 ? { ...item, sequence_number: item.sequence_number + 2 } : item
  );
  const gapCompleteness = analyzeAgentObservationCompleteness(artificialGap);
  assert(gapCompleteness.sequence_gaps.length > 0, "sequence gap was not detected");

  const storedRows = await client.query(
    "SELECT count(*)::int AS count FROM agent_observations WHERE project_id = $1",
    [project.projectId]
  );
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "pass",
        project_scoped: true,
        observations: storedRows.rows[0]?.count,
        deduplication: "pass",
        redaction: "pass",
        retention: "pass",
        error_chain: "resolved",
        completeness
      },
      null,
      2
    )}\n`
  );
} finally {
  await client.query("DELETE FROM projects WHERE id = $1", [projectId]).catch(() => undefined);
  await db.close();
  await client.end();
}

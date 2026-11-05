import { continuityDatabaseUrl } from "./fixtures/continuity-database.mjs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import pg from "pg";

const url = continuityDatabaseUrl();
const target = new URL(url);
const admin = new pg.Client({ connectionString: url });
await admin.connect();
const name = `recallant_closeout_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE DATABASE "${name}"`);
target.pathname = `/${name}`;
const fixture = new pg.Client({ connectionString: target.toString() });
const projectPath = await mkdtemp(join(tmpdir(), "recallant-closeout-facts-"));
const client = new Client({ name: "closeout-factual-memory-smoke", version: "1" });
const developerId = randomUUID();
const projectId = randomUUID();
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(process.cwd(), "apps/cli/dist/index.js"), "mcp-server"],
  cwd: projectPath,
  env: {
    PATH: process.env.PATH,
    RECALLANT_ENV_FILE: join(projectPath, "missing.env"),
    RECALLANT_DATABASE_URL: target.toString(),
    RECALLANT_DEVELOPER_ID: developerId,
    RECALLANT_PROJECT_ID: projectId,
    RECALLANT_PROJECT_PATH: projectPath,
    RECALLANT_EMBEDDING_PROVIDER: "deterministic",
    RECALLANT_EMBEDDING_DIMS: "768"
  },
  stderr: "pipe"
});
const results = [];
async function call(name, args, expectedError = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 30000
  });
  assert.equal(result.isError === true, expectedError, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

try {
  await fixture.connect();
  await fixture.query(await readFile("packages/db/migrations/0001_initial.sql", "utf8"));
  await client.connect(transport);
  const start = () =>
    call("memory_start_session", {
      client_kind: "codex",
      project_path: projectPath,
      external_session_id: randomUUID()
    });
  const first = await start();
  await fixture.query(
    `INSERT INTO developer_settings (developer_id, key, value, updated_by)
     VALUES ($1, 'embedding_route', $2, 'smoke')`,
    [
      developerId,
      JSON.stringify({
        route_class: "local_model",
        provider: "deterministic",
        model: "deterministic-closeout-facts",
        dims: 768
      })
    ]
  );
  const safe = [
    "Two public DNS controls failed.",
    "The provider health probe succeeded; the model output parsed correctly.",
    "Public DNS controls were checked; default recall and next-session context passed.",
    "The public DNS, provider health and model output checks passed; the event artifact default is empty. Default recall and next-session context passed.",
    "The default recall policy passed the instruction and rule audit.",
    "Проверка правил выполнена; память находится по умолчанию.",
    "Проверка публичного DNS завершена. Ответ провайдера и модель данных проверены."
  ];
  const risky = [
    "Production deploy provider decision remains under review.",
    "Make the bucket public.",
    "Allow public access to the service.",
    "Push the changes to the public repository.",
    "Always use the new provider for every project.",
    "Switch the model to the paid endpoint.",
    "Selected the replacement model.",
    "The default model is the new provider.",
    "Сделать хранилище публичным.",
    "Отправить данные в публичный репозиторий.",
    "Сменить провайдера и выбрать модель для всех проектов."
  ];
  for (const [index, summary] of [...safe, ...risky].entries()) {
    const expectedAccepted = index < safe.length;
    const session = index === 0 ? first : await start();
    const event = await call("memory_append_event", {
      session_id: session.session_id,
      client_kind: "codex",
      event_kind: "system",
      text: "Synthetic closeout regression evidence."
    });
    const closeout = await call("memory_closeout", {
      session_id: session.session_id,
      closeout_intent: "task_complete",
      summary,
      checkpoint_payload: {
        current_focus: "Synthetic closeout verification",
        current_status: "scenario complete",
        next_step: "Read the recorded result",
        last_event_id: event.event_id,
        open_questions: []
      }
    });
    const lifecycle = closeout.lifecycle;
    assert.equal(lifecycle.proof.event.event_written, true);
    assert.equal(lifecycle.proof.checkpoint.checkpoint_updated, true);
    assert.equal(
      lifecycle.proof.memory.memory_status,
      expectedAccepted ? "accepted" : "needs_review",
      summary
    );
    assert.equal(lifecycle.next_agent_ready, expectedAccepted, summary);
    assert.equal(lifecycle.proof.recall.marker_found, expectedAccepted, summary);
    assert.equal(lifecycle.proof.next_session_context.marker_found, expectedAccepted, summary);
    const memoryId = lifecycle.proof.memory.memory_id;
    const recall = await call("memory_recall_agent_memories", {
      query: summary,
      memory_types: ["work_log"],
      top_k: 20
    });
    assert.equal(
      recall.memories.some((m) => m.memory_id === memoryId),
      expectedAccepted
    );
    const next = await start();
    const pack = await call("memory_get_context_pack", {
      session_id: next.session_id,
      task_hint: lifecycle.proof.recall.query,
      max_chars_total: 16000,
      include_raw_evidence: "never"
    });
    assert.equal(
      JSON.stringify(pack.sections.working_memories).includes(memoryId),
      expectedAccepted,
      summary
    );
    assert.ok(!pack.sections.checkpoint.payload?.current_focus?.includes("Synthetic closeout"));
    results.push({
      scenario: summary,
      status: "PASS",
      next_agent_ready: lifecycle.next_agent_ready
    });
  }
  const low = await call("memory_create_agent_memory", {
    memory_type: "work_log",
    scope: "project",
    title: "Low confidence diagnostic",
    body: safe[0],
    confidence: 0.2,
    created_by: "agent"
  });
  assert.equal(low.status, "needs_review");
  assert.equal(low.use_policy, "evidence_only");
  for (const body of [
    "Rule: run the focused checks.",
    "Use compact formatting by default.",
    "По умолчанию используй компактный формат."
  ]) {
    const rule = await call("memory_create_agent_memory", {
      memory_type: "decision",
      scope: "project",
      title: "Synthetic instruction control",
      body,
      created_by: "agent",
      confidence: 0.95
    });
    assert.equal(rule.status, "candidate", body);
    assert.equal(rule.use_policy, "recall_allowed");
  }
  await call(
    "memory_create_agent_memory",
    {
      memory_type: "work_log",
      scope: "project",
      title: "Synthetic forbidden payload",
      body: "password=synthetic-forbidden-value",
      created_by: "agent"
    },
    true
  );
  results.push({ scenario: "low confidence and forbidden payload gates", status: "PASS" });
  process.stdout.write(`${JSON.stringify({ status: "PASS", results }, null, 2)}\n`);
} finally {
  await client.close();
  await transport.close();
  await fixture.end();
  await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.end();
  await rm(projectPath, { recursive: true, force: true });
}

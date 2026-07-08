import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { URL, fileURLToPath } from "node:url";
import { RecallantDb } from "../packages/db/dist/index.js";
import { createRecallantTools } from "../packages/mcp/dist/index.js";

const defaultDatabaseUrl = [
  "postgres",
  "://",
  "recallant",
  ":",
  "recallant_dev_password",
  "@127.0.0.1:15433/recallant_agent_work"
].join("");
const databaseUrl = process.env.RECALLANT_DATABASE_URL ?? defaultDatabaseUrl;
const developerId = randomUUID();
const projectId = randomUUID();
const projectPath = `/tmp/recallant-memory-keeper-${projectId}`;
const marker = `memory_keeper_smoke_${randomUUID().replaceAll("-", "_")}`;
const forbiddenToken = ["sk", "memorykeeperleakfixture123"].join("-");
const forbiddenNeedles = [
  forbiddenToken,
  ["postgres", "://"].join(""),
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  ["provider", "token"].join(" "),
  ["raw", "credentials"].join(" "),
  ["customer", "@example.invalid"].join("")
];
const cliPath = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoForbidden(text, label) {
  for (const needle of forbiddenNeedles) {
    assert(!text.includes(needle), `${label} leaked forbidden marker: ${needle}`);
  }
}

function keeperText(topic, decision) {
  return ["Project: Recallant", `Topic: ${topic}`, "Entity: Codex", `Decision: ${decision}`].join(
    "\n"
  );
}

function runCli(args, options = {}) {
  const env = {
    ...process.env,
    RECALLANT_DATABASE_URL: databaseUrl,
    RECALLANT_DEVELOPER_ID: developerId,
    ...options.env
  };
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assertNoForbidden(output, `CLI ${args.slice(0, 2).join(" ")}`);
  if (options.expectFailure) {
    assert(result.status !== 0, `${args.join(" ")} should have failed`);
  } else {
    assert(result.status === 0, `${args.join(" ")} failed: ${result.stderr}`);
  }
  return result;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} did not return valid JSON: ${error}`);
  }
}

function toolMap(database, context) {
  return new Map(
    createRecallantTools({
      projectId: context.project_id,
      projectPath,
      developerId: context.developer_id,
      clientId: "memory-keeper-smoke",
      traceId: marker,
      getDatabase: () => database
    }).map((tool) => [tool.name, tool])
  );
}

async function callTool(tools, name, args) {
  const tool = tools.get(name);
  assert(tool, `Missing tool ${name}`);
  return tool.handler(args);
}

const noDbEnv = {
  RECALLANT_DATABASE_URL: "",
  RECALLANT_ENV_FILE: `/tmp/recallant-memory-keeper-missing-env-${projectId}`
};

const controlledText = keeperText(
  `${marker} dry run`,
  `${marker} dry-run keeper proposals stay staged`
);
const dryRun = parseJsonOutput(
  runCli(
    [
      "keeper",
      "candidates",
      "--text",
      controlledText,
      "--source-kind",
      "event",
      "--source-id",
      `${marker}:dry-run`,
      "--source-path",
      "fixtures/memory-keeper-smoke.md",
      "--project-dir",
      projectPath,
      "--format",
      "json"
    ],
    { env: noDbEnv }
  ),
  "keeper dry-run"
);
assert(dryRun.dry_run === true, "dry-run should report dry_run=true");
assert(dryRun.writes_database === false, "dry-run should report writes_database=false");
assert(dryRun.summary.node_candidates > 0, "dry-run should produce node candidates");
assert(dryRun.summary.edge_candidates > 0, "dry-run should produce edge candidates");
assert(dryRun.proposals.every((proposal) => proposal.candidate.extraction_method === "keeper"));
assert(dryRun.proposals.every((proposal) => proposal.candidate.source_refs.length > 0));

const confirmGate = runCli(
  [
    "keeper",
    "candidates",
    "--text",
    controlledText,
    "--project-dir",
    projectPath,
    "--write-candidates"
  ],
  { expectFailure: true }
);
assert(
  `${confirmGate.stdout}${confirmGate.stderr}`.includes("--write-candidates --confirm"),
  "confirm-gate rejection should name --confirm"
);

const missingDb = runCli(
  [
    "keeper",
    "candidates",
    "--text",
    controlledText,
    "--project-dir",
    projectPath,
    "--write-candidates",
    "--confirm"
  ],
  { expectFailure: true, env: noDbEnv }
);
assert(
  `${missingDb.stdout}${missingDb.stderr}`.includes("RECALLANT_DATABASE_URL"),
  "missing DB rejection should name RECALLANT_DATABASE_URL"
);

const safeWrite = parseJsonOutput(
  runCli([
    "keeper",
    "candidates",
    "--text",
    keeperText(`${marker} persisted`, `${marker} confirmed write persists source links`),
    "--source-kind",
    "event",
    "--source-id",
    `${marker}:safe-write`,
    "--source-path",
    "fixtures/memory-keeper-smoke.md",
    "--project-dir",
    projectPath,
    "--write-candidates",
    "--confirm",
    "--format",
    "json"
  ]),
  "keeper confirmed write"
);
assert(safeWrite.dry_run === false, "confirmed write should report dry_run=false");
assert(safeWrite.writes_database === true, "confirmed write should report writes_database=true");
assert(safeWrite.persisted.count === safeWrite.summary.proposals);
assert(safeWrite.proposals.every((proposal) => proposal.persisted));

const unsafeText = keeperText(
  `${marker} unsafe ${forbiddenToken}`,
  `${marker} token=${forbiddenToken} must remain redacted`
);
const unsafeWrite = parseJsonOutput(
  runCli([
    "keeper",
    "candidates",
    "--text",
    unsafeText,
    "--source-kind",
    "event",
    "--source-id",
    `${marker}:unsafe-write`,
    "--source-path",
    "fixtures/memory-keeper-unsafe.md",
    "--project-dir",
    projectPath,
    "--write-candidates",
    "--confirm",
    "--format",
    "json"
  ]),
  "keeper unsafe confirmed write"
);
const unsafeOutput = JSON.stringify(unsafeWrite);
assert(!unsafeOutput.includes(forbiddenToken), "unsafe CLI output should not include raw token");
assert(unsafeOutput.includes("[redacted_token]"), "unsafe CLI output should include redaction");
assert(
  unsafeWrite.summary.lifecycle_states.includes("needs_review"),
  "unsafe fixture should be needs_review"
);

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectPath
});

try {
  const allPersistedIds = [
    ...safeWrite.persisted.graph_candidate_ids,
    ...unsafeWrite.persisted.graph_candidate_ids
  ];
  const first = await db.getGraphCandidate({
    project_path: projectPath,
    graph_candidate_id: safeWrite.persisted.graph_candidate_ids[0]
  });
  const list = await db.listGraphCandidates({
    project_path: projectPath,
    extraction_method: "keeper",
    limit: 50
  });
  const storedPayload = JSON.stringify(list);
  assertNoForbidden(storedPayload, "stored keeper candidates");
  const sourceLinked = list.candidates.every(
    (candidate) =>
      candidate.extraction_method === "keeper" &&
      candidate.source_refs.length > 0 &&
      candidate.source_refs.every((ref) => ref.source_id?.startsWith(marker))
  );
  assert(sourceLinked, "stored keeper candidates should stay source-linked");

  const tools = toolMap(db, first);
  const defaultSearch = await callTool(tools, "memory_search", {
    project_id: first.project_id,
    query: marker,
    mode: "lexical_only",
    top_k: 10,
    graph_expand: false,
    max_chars_total: 4000
  });
  const searchText = JSON.stringify(defaultSearch);
  const persistedCandidateIdsVisible = allPersistedIds.some((id) => searchText.includes(id));
  assert(!persistedCandidateIdsVisible, "keeper candidates should not appear in default retrieval");

  process.stdout.write(
    `${JSON.stringify(
      {
        memory_keeper_smoke: "passed",
        policy_matrix: {
          dry_run_no_db_no_write: dryRun.dry_run === true && dryRun.writes_database === false,
          dry_run_node_and_edge_candidates:
            dryRun.summary.node_candidates > 0 && dryRun.summary.edge_candidates > 0,
          confirm_gate_rejected: confirmGate.status !== 0,
          missing_db_write_rejected: missingDb.status !== 0,
          confirmed_write_persisted: safeWrite.persisted.count > 0,
          source_linked_keeper_candidates: sourceLinked,
          unsafe_cli_leak_scan_passed: !unsafeOutput.includes(forbiddenToken),
          unsafe_stored_leak_scan_passed: !storedPayload.includes(forbiddenToken),
          unsafe_lifecycle_needs_review:
            unsafeWrite.summary.lifecycle_states.includes("needs_review"),
          retrieval_isolation: !persistedCandidateIdsVisible
        },
        dry_run: {
          proposals: dryRun.summary.proposals,
          writes_database: dryRun.writes_database
        },
        persisted: {
          safe_count: safeWrite.persisted.count,
          unsafe_count: unsafeWrite.persisted.count,
          listed_keeper_candidates: list.candidates.length
        },
        retrieval_isolation: {
          graph_expand: false,
          default_hit_count: defaultSearch.hits?.length ?? 0,
          persisted_candidate_ids_visible: persistedCandidateIdsVisible
        },
        lifecycle_states: Array.from(
          new Set(list.candidates.map((candidate) => candidate.lifecycle_state))
        )
      },
      null,
      2
    )}\n`
  );
} finally {
  await db.close();
}

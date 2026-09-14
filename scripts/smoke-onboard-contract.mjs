import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { URL } from "node:url";
import { Script, createContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = await readFile(new URL("../apps/cli/src/index.ts", import.meta.url), "utf8");
const sourceFile = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
const functionNames = [
  "parseOnboardOptions",
  "parseFlag",
  "parseProjectArg",
  "runOnboard",
  "runLocalOnboard",
  "checkMemoryLoopReadiness",
  "resolveOnboardWorkbenchOutcome"
];
const selected = sourceFile.statements.filter(
  (statement) => ts.isFunctionDeclaration(statement) && functionNames.includes(statement.name?.text)
);
const functions = selected.map((statement) => statement.getText(sourceFile)).join("\n");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runScenario({ matchingProject, matchingOwner = true, matchingRecall }) {
  const projectId = "project-A";
  const marker = "onboard-fresh-marker-A";
  const dashboard = {
    projects: matchingProject ? [{ project_id: projectId }] : [{ project_id: "project-B" }],
    current_project: matchingProject ? { project_id: projectId } : { project_id: "project-B" },
    critical: { pending_review: 292 },
    import_candidates: []
  };
  let output = "";
  const calls = [];
  const context = {
    resolve: (...parts) => resolve("/synthetic/project-A", ...parts),
    process: {
      cwd: () => "/synthetic/project-A",
      env: {},
      stdout: { write: (value) => (output += value) },
      exitCode: 0
    },
    objectValue: (value) => (value && typeof value === "object" ? value : {}),
    readProjectConfig: async () => ({ project_id: projectId }),
    readAgentSessionState: async () => null,
    memoryLoopStatusFromState: () => "not_observed",
    createRecallantDbFromEnv: () => ({
      getReviewDashboard: async () => dashboard,
      getProjectReadiness: async () => ({
        project_registered: matchingProject,
        last_context_read_at: matchingProject ? "2026-09-09" : null,
        last_memory_write_at: matchingProject ? "2026-09-09" : null,
        checkpoint_updated_at: matchingProject ? "2026-09-09" : null
      }),
      close: async () => {}
    }),
    buildWorkbenchUrl: () => "http://example.invalid/review?project_id=project-A",
    unavailableWorkbenchOutcome: (message) => ({ available: false, message }),
    maybeUpdateRecallantBeforeOnboard: async () => false,
    readyStorageStep: async () => ({ reachable: true }),
    inferTargetClient: () => "codex",
    formatOnboardRerunCommand: () => "recallant onboard /synthetic/project-A",
    analyzeProjectDocumentationPosture: async () => null,
    formatCommandHint: (parts) => parts.join(" "),
    resolveOnboardStorage: async () => ({ reachable: true }),
    resolveOnboardVersionControl: async () => ({ status: "ready" }),
    validateExistingProjectBinding: async ({ existingConfig, projectDir }) => {
      if (!matchingProject) throw new Error("PROJECT_ID_PATH_MISMATCH: project binding mismatch");
      if (!matchingOwner) throw new Error("PROJECT_OWNER_MISMATCH: project owner mismatch");
      return {
        status: "verified",
        projectId: existingConfig.project_id,
        developerId: "developer-A",
        primaryPath: projectDir
      };
    },
    emptyOnboardVerifyEvidence: () => ({
      context_read: false,
      memory_write: false,
      checkpoint: false,
      recall: false
    }),
    clientConnectionReadiness: async () => ({
      mcp_configs: [{ client: "codex", present: true }],
      hook_kit: { ready: true },
      automatic_agent_audit: { configured: true }
    }),
    randomUUID: () => "fresh-marker-A",
    onboardVerifyEvidenceFromDoctor: () => ({
      context_read: true,
      memory_write: true,
      checkpoint: true,
      recall: false
    }),
    recoverOnboardPendingEmbeddings: async () => null,
    runLocalCliSubcommand: (args) => {
      calls.push(args[0]);
      if (args[0] === "demo-capture") {
        return { status: 0, json: { project_id: projectId, marker, recalled: true } };
      }
      if (args[0] === "doctor") {
        return {
          status: 0,
          json: {
            memory_loop_readiness: { ready: true },
            readiness_contract: { capture_active: false },
            capture_readiness: { database_readiness: {} }
          }
        };
      }
      if (args[0] === "ask") {
        const memories =
          matchingRecall === "behind"
            ? [
                { body: "Unrelated old memory", project_id: projectId },
                { body: `Remembered ${marker}`, project_id: projectId }
              ]
            : matchingRecall === "wrong_project"
              ? [{ body: `Remembered ${marker}`, project_id: "project-B" }]
              : [{ body: matchingRecall ? `Remembered ${marker}` : "Unrelated old memory" }];
        return {
          status: 0,
          json: {
            memories
          }
        };
      }
      throw new Error(`unexpected subcommand ${args[0]}`);
    }
  };
  createContext(context);
  new Script(
    ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
      .outputText
  ).runInContext(context);

  const parsed = context.parseOnboardOptions(["node", "cli", "onboard", "."]);
  const workbench = await context.resolveOnboardWorkbenchOutcome("/synthetic/project-A");
  const readiness = await context.checkMemoryLoopReadiness({
    projectDir: "/synthetic/project-A",
    database: context.createRecallantDbFromEnv()
  });
  await context.runOnboard([
    "node",
    "cli",
    "onboard",
    ".",
    "--client",
    "codex",
    "--format",
    "json"
  ]);
  const onboard = JSON.parse(output);
  return { parsed, workbench, readiness, onboard, calls };
}

const mismatched = await runScenario({ matchingProject: false, matchingRecall: false });
assert(
  mismatched.parsed.projectDir === "/synthetic/project-A",
  `onboard positional project parsing changed: ${JSON.stringify(mismatched.parsed)}`
);
assert(
  mismatched.workbench.project_visible === false &&
    mismatched.workbench.migration_review_queue.pending_review === null,
  `Workbench used another project's queue: ${JSON.stringify(mismatched.workbench)}`
);
assert(
  mismatched.readiness.ready === false &&
    mismatched.readiness.database_readiness.project_registered === false,
  `Readiness accepted another project's state: ${JSON.stringify(mismatched.readiness)}`
);
assert(
  mismatched.onboard.status === "incomplete" && mismatched.onboard.verify.status === "failed",
  `Onboard accepted a stale memory without the fresh marker: ${JSON.stringify(mismatched.onboard)}`
);

const positive = await runScenario({ matchingProject: true, matchingRecall: true });
assert(
  positive.workbench.project_visible === true &&
    positive.readiness.ready === true &&
    positive.onboard.status === "completed" &&
    positive.onboard.verify.status === "passed",
  `Matching project and marker control failed: ${JSON.stringify(positive)}`
);

const behindFirst = await runScenario({ matchingProject: true, matchingRecall: "behind" });
assert(
  behindFirst.onboard.status === "completed" && behindFirst.onboard.verify.status === "passed",
  `Recall proof remained dependent on first result: ${JSON.stringify(behindFirst.onboard)}`
);

const wrongOwner = await runScenario({
  matchingProject: true,
  matchingOwner: false,
  matchingRecall: true
});
assert(
  wrongOwner.onboard.status === "incomplete" &&
    wrongOwner.onboard.verify.status === "failed" &&
    wrongOwner.calls.length === 0,
  `Foreign project owner was not rejected before capture: ${JSON.stringify(wrongOwner.onboard)}`
);

const wrongProjectMarker = await runScenario({
  matchingProject: true,
  matchingRecall: "wrong_project"
});
assert(
  wrongProjectMarker.onboard.status === "incomplete" &&
    wrongProjectMarker.onboard.verify.status === "failed",
  `Recall proof accepted a marker from another project: ${JSON.stringify(wrongProjectMarker.onboard)}`
);

process.stdout.write(
  `${JSON.stringify(
    {
      status: "pass",
      checks: {
        project_argument_preserved: true,
        workbench_queue_is_project_scoped: true,
        readiness_is_project_scoped: true,
        recall_requires_fresh_marker: true,
        recall_can_find_marker_after_unrelated_result: true,
        owner_binding_checked_before_capture: true,
        recall_project_binding_checked: true
      },
      source_hash: createHash("sha256").update(source).digest("hex").slice(0, 12),
      mismatched_subcommands: mismatched.calls,
      positive_subcommands: positive.calls,
      behind_first_subcommands: behindFirst.calls
    },
    null,
    2
  )}\n`
);

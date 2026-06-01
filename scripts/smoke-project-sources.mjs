import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { RecallantDb } from "../packages/db/dist/index.js";

const databaseUrl =
  process.env.RECALLANT_DATABASE_URL ??
  "postgres://recallant:recallant_dev_password@127.0.0.1:15433/recallant_agent_work";

const developerId = randomUUID();
const projectId = randomUUID();
const cli = fileURLToPath(new URL("../apps/cli/dist/index.js", import.meta.url));
const env = {
  ...process.env,
  RECALLANT_DATABASE_URL: databaseUrl,
  RECALLANT_DEVELOPER_ID: developerId,
  RECALLANT_PROJECT_ID: projectId,
  RECALLANT_PROJECT_PATH: `/tmp/recallant-source-smoke-${projectId}`
};

function runCli(args) {
  const output = execFileSync("node", [cli, ...args], {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(output);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const virtualSpace = runCli([
  "memory-space",
  "create",
  "--name",
  "Personal Operations Smoke",
  "--project-kind",
  "personal_domain",
  "--memory-domain",
  "personal_life"
]);
assert(virtualSpace.ok === true, `Virtual memory space create failed: ${JSON.stringify(virtualSpace)}`);
assert(
  virtualSpace.memory_space.primary_path === null,
  `Virtual memory space should have no folder: ${JSON.stringify(virtualSpace)}`
);
const virtualProjectId = virtualSpace.memory_space.project_id;

const emptySources = runCli(["source", "list", "--project-id", virtualProjectId]);
assert(emptySources.count === 0, `Virtual memory space should start with zero sources: ${JSON.stringify(emptySources)}`);

const workspaceSource = runCli([
  "source",
  "attach",
  "--project-id",
  virtualProjectId,
  "--source-kind",
  "workspace_path",
  "--uri",
  `/tmp/recallant-workspace-source-${randomUUID()}`,
  "--label",
  "Smoke Workspace",
  "--primary"
]);
assert(
  workspaceSource.source?.source_kind === "workspace_path" &&
    workspaceSource.source?.is_primary === true,
  `Workspace source attach failed: ${JSON.stringify(workspaceSource)}`
);

const manualSource = runCli([
  "source",
  "attach",
  "--project-id",
  virtualProjectId,
  "--source-kind",
  "manual",
  "--label",
  "Manual Smoke Notes"
]);
assert(manualSource.source?.source_kind === "manual", `Manual source attach failed: ${JSON.stringify(manualSource)}`);

const listedSources = runCli(["source", "list", "--project-id", virtualProjectId]);
assert(listedSources.count === 2, `Expected two attached sources: ${JSON.stringify(listedSources)}`);

const detached = runCli([
  "source",
  "detach",
  "--source-id",
  workspaceSource.source.id,
  "--reason",
  "project source smoke"
]);
assert(detached.source?.status === "detached", `Source detach failed: ${JSON.stringify(detached)}`);

const afterDetach = runCli(["source", "list", "--project-id", virtualProjectId]);
assert(
  afterDetach.sources.some((source) => source.status === "detached") &&
    afterDetach.sources.some((source) => source.status === "active"),
  `Detach should not delete memory space or other source: ${JSON.stringify(afterDetach)}`
);

const listedSpaces = runCli(["memory-space", "list"]);
const listedVirtual = listedSpaces.memory_spaces.find((space) => space.project_id === virtualProjectId);
assert(listedVirtual, `Virtual memory space missing from list: ${JSON.stringify(listedSpaces)}`);
assert(
  listedVirtual.sources.length === 2,
  `Memory space list should include source bindings: ${JSON.stringify(listedVirtual)}`
);

const db = new RecallantDb({
  databaseUrl,
  developerId,
  projectId: randomUUID(),
  projectPath: `/tmp/recallant-ensure-source-${randomUUID()}`
});
try {
  const ensured = await db.ensureProject();
  const ensuredSources = await db.listProjectSources(ensured.projectId);
  assert(
    ensuredSources.some((source) => source.source_kind === "workspace_path" && source.is_primary),
    `ensureProject did not create a primary workspace source: ${JSON.stringify(ensuredSources)}`
  );
  const dashboard = await db.getReviewDashboard({ project_id: ensured.projectId });
  const dashboardProject = dashboard.projects.find((project) => project.project_id === ensured.projectId);
  assert(
    dashboardProject?.sources?.some((source) => source.source_kind === "workspace_path"),
    `Dashboard did not expose project sources: ${JSON.stringify(dashboardProject)}`
  );
} finally {
  await db.close();
}

process.stdout.write("Project sources smoke passed\n");

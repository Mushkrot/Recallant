import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { RecallantDb } from "../packages/db/dist/index.js";
import { createRecallantTools } from "../packages/mcp/dist/index.js";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";

const url = process.env.RECALLANT_SMOKE_DATABASE_URL;
assert.ok(url, "An explicitly disposable database is required");
assert.match(new URL(url).pathname, /^\/recallant_remote_binding_[a-z0-9_]+$/);
const owner = randomUUID();
const database = new RecallantDb({ databaseUrl: url, developerId: owner });
const server = createRecallantHttpServer({ remoteMcpDatabase: database });
let listening = false;
const local = await mkdtemp(join(tmpdir(), "recallant-remote-local-path-"));
async function workspace(kind = "workspace") {
  return database.createMemorySpace({
    name: "synthetic remote binding",
    developerId: owner,
    projectKind: kind
  });
}
function start(project, path, context = {}) {
  const tools = createRecallantTools({
    getDatabase: () => database,
    projectId: project.project_id,
    developerId: owner,
    enforceProjectScope: true,
    allowEnvironmentProjectPath: false,
    ...context
  });
  const tool = tools.find((t) => t.name === "memory_start_session");
  return tool.handler(
    tool.inputSchema.parse({
      client_kind: "codex",
      project_path: path,
      resume_policy: "force_new"
    })
  );
}
try {
  for (const file of ["0001_initial.sql", "0002_session_scoped_checkpoints.sql"]) {
    await database.pool.query(
      await readFile(new URL(`../packages/db/migrations/${file}`, import.meta.url), "utf8")
    );
  }
  const first = await workspace();
  const path = `/remote-workspace-fixture/${randomUUID()}`;
  assert.equal((await database.getProjectBinding(first.project_id)).primary_path, null);
  const result = await start(first, path);
  assert.equal(result.project_id, first.project_id);
  assert.equal((await database.getProjectBinding(first.project_id)).primary_path, path);
  await assert.rejects(start(first, `${path}-different`), /PROJECT_ID_PATH_MISMATCH/);
  assert.equal((await database.getProjectBinding(first.project_id)).primary_path, path);

  const unscoped = await workspace();
  await assert.rejects(
    start(unscoped, `${path}-unscoped`, { enforceProjectScope: false }),
    /PROJECT_ID_PATH_MISMATCH/
  );
  assert.equal((await database.getProjectBinding(unscoped.project_id)).primary_path, null);
  const foreign = await workspace();
  await assert.rejects(
    start(foreign, `${path}-foreign`, { developerId: randomUUID() }),
    /REMOTE_WORKSPACE_OWNER_MISMATCH/
  );
  assert.equal((await database.getProjectBinding(foreign.project_id)).primary_path, null);
  const relative = await workspace();
  await assert.rejects(
    start(relative, "relative-workspace"),
    /REMOTE_WORKSPACE_ABSOLUTE_PATH_REQUIRED/
  );
  assert.equal((await database.getProjectBinding(relative.project_id)).primary_path, null);
  const serverLocal = await workspace();
  await assert.rejects(start(serverLocal, local), /REMOTE_WORKSPACE_PATH_IS_LOCAL/);
  assert.equal((await database.getProjectBinding(serverLocal.project_id)).primary_path, null);
  const virtual = await workspace("personal_domain");
  await assert.rejects(start(virtual, `${path}-virtual`), /REMOTE_WORKSPACE_KIND_REQUIRED/);
  assert.equal((await database.getProjectBinding(virtual.project_id)).primary_path, null);

  const concurrent = await workspace();
  const paths = [`${path}-one`, `${path}-two`];
  const outcomes = await Promise.allSettled(paths.map((p) => start(concurrent, p)));
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  const bound = (await database.getProjectBinding(concurrent.project_id)).primary_path;
  const winner = outcomes.findIndex((r) => r.status === "fulfilled");
  assert.equal(bound, paths[winner]);
  const repeated = await start(concurrent, bound);
  assert.equal(repeated.project_id, concurrent.project_id);
  assert.equal((await database.getProjectBinding(concurrent.project_id)).primary_path, bound);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  listening = true;
  const endpoint = `http://127.0.0.1:${server.address().port}/api/mcp`;
  const credentials = new Map();
  async function remote(project, name, args) {
    if (!credentials.has(project.project_id)) {
      credentials.set(
        project.project_id,
        await database.createRemoteMcpCredential({
          projectId: project.project_id,
          developerId: owner,
          clientId: "synthetic-binding-client"
        })
      );
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.get(project.project_id).secret}`,
        "x-recallant-project-id": project.project_id,
        "x-recallant-developer-id": owner,
        "x-recallant-client-id": "synthetic-binding-client"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args }
      })
    });
    const body = await response.json();
    return {
      status: response.status,
      payload: body.result?.structuredContent,
      code: body.error?.data?.code
    };
  }
  const httpProject = await workspace();
  const httpPath = `${path}-http`;
  const httpStart = (project, fields) =>
    remote(project, "memory_start_session", {
      client_kind: "codex",
      resume_policy: "force_new",
      ...fields
    });
  const started = await httpStart(httpProject, { project_path: httpPath });
  assert.equal(started.status, 200, "full authenticated HTTP first start");
  assert.equal(started.payload.project_id, httpProject.project_id);
  assert.equal((await database.getProjectBinding(httpProject.project_id)).primary_path, httpPath);
  assert.equal((await httpStart(httpProject, { project_path: `${httpPath}-wrong` })).status, 400);
  assert.equal((await httpStart(httpProject, { project_path: httpPath })).status, 200);
  const alias = await workspace();
  assert.equal((await httpStart(alias, { project_dir: `${path}-alias` })).status, 200);
  assert.equal((await database.getProjectBinding(alias.project_id)).primary_path, `${path}-alias`);
  const otherTool = await workspace();
  assert.equal(
    (
      await remote(otherTool, "memory_recall_agent_memories", {
        query: "synthetic",
        project_path: `${path}-other-tool`
      })
    ).status,
    400
  );
  assert.equal((await database.getProjectBinding(otherTool.project_id)).primary_path, null);
  const wrongId = await workspace();
  assert.equal(
    (
      await httpStart(wrongId, {
        project_id: httpProject.project_id,
        project_path: `${path}-wrong-id`
      })
    ).status,
    400
  );
  assert.equal((await database.getProjectBinding(wrongId.project_id)).primary_path, null);
  const httpLocal = await workspace();
  assert.equal((await httpStart(httpLocal, { project_path: local })).status, 400);
  assert.equal((await database.getProjectBinding(httpLocal.project_id)).primary_path, null);
  const httpRelative = await workspace();
  assert.equal((await httpStart(httpRelative, { project_path: "relative-workspace" })).status, 400);
  assert.equal((await database.getProjectBinding(httpRelative.project_id)).primary_path, null);
  process.stdout.write(
    "PASS: authenticated first binding, immutable existing scope, owner/local-path/kind guards, concurrent claims and full HTTP scope dispatch\n"
  );
} finally {
  if (listening) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await database.close();
  await rm(local, { recursive: true, force: true });
}

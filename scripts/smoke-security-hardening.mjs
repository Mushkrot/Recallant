import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { normalizeRemoteMcpBridgeServerUrl } from "../packages/contracts/dist/index.js";
import { RecallantDb } from "../packages/db/dist/index.js";
import {
  buildVaultMarkdownExportPlan,
  inventoryVault,
  writeVaultMarkdownExport
} from "../apps/cli/dist/vault-bridge.js";
import { discoveryCandidateForImport } from "../apps/cli/dist/discovery.js";
import { createRecallantHttpServer } from "../apps/server/dist/index.js";
import { smokeDatabaseUrl } from "./smoke-database-env.mjs";

const databaseUrl = smokeDatabaseUrl();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let blockedExternalHttp = false;
try {
  normalizeRemoteMcpBridgeServerUrl("http://recallant.example.com");
} catch {
  blockedExternalHttp = true;
}
assert(blockedExternalHttp, "non-loopback cleartext remote MCP URL was accepted");
normalizeRemoteMcpBridgeServerUrl("http://127.0.0.1:3005");

const discoveryRoot = await mkdtemp(join(tmpdir(), "recallant-security-discovery-"));
const vaultRoot = await mkdtemp(join(tmpdir(), "recallant-security-vault-"));
const vaultOutside = await mkdtemp(join(tmpdir(), "recallant-security-outside-"));
const projectSymlinkRoot = await mkdtemp(join(tmpdir(), "recallant-security-project-links-"));
const projectSymlinkOutside = await mkdtemp(join(tmpdir(), "recallant-security-project-outside-"));
const projectId = randomUUID();
const developerId = randomUUID();
const projectPath = `/tmp/recallant-security-hardening-${projectId}`;
const db = new RecallantDb({ databaseUrl, developerId, projectId, projectPath });
const client = new pg.Client({ connectionString: databaseUrl });
const secret = `sk-hardening-${randomUUID().replaceAll("-", "")}`;
const privateKey = [
  "-----BEGIN PRIVATE KEY-----",
  "hardening-private-key-material",
  "-----END PRIVATE KEY-----"
].join("\n");
const opaqueCredential = `opaque-hardening-${randomUUID().replaceAll("-", "")}`;
let httpServer;
let editableMemoryId;

function runAttachExpectingSymlinkBlock(projectDir, label, mode = "--sandbox") {
  const result = spawnSync(
    process.execPath,
    ["apps/cli/dist/index.js", "attach", projectDir, "--target", "codex", mode, "--format", "json"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        RECALLANT_DATABASE_URL: databaseUrl,
        RECALLANT_DEVELOPER_ID: developerId,
        RECALLANT_EMBEDDING_PROVIDER: "deterministic",
        RECALLANT_EMBEDDING_DIMS: "8"
      },
      encoding: "utf8"
    }
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, `${label} unexpectedly succeeded`);
  assert(output.includes("VALIDATION_ERROR:"), `${label} did not fail closed: ${output}`);
}

try {
  const unsafeName = "unsafe';echo should-not-run;'.md";
  await writeFile(join(discoveryRoot, unsafeName), "# safe\n");
  const candidate = await discoveryCandidateForImport(discoveryRoot, unsafeName);
  assert(
    candidate.suggested_command.includes("'unsafe'\"'\"';echo should-not-run;'\"'\"'.md'"),
    "discovery command is not shell quoted"
  );
  await writeFile(join(discoveryRoot, "README.md"), `${privateKey}\n# public preview\n`);
  const readmeCandidate = await discoveryCandidateForImport(discoveryRoot, "README.md");
  assert(readmeCandidate, "discovery did not return README candidate");
  assert(
    !readmeCandidate.bounded_excerpt.includes("hardening-private-key-material"),
    "discovery preview leaked a private-key body"
  );
  await writeFile(join(vaultOutside, "discovery-outside.md"), "unique-discovery-outside-marker\n");
  await symlink(join(vaultOutside, "discovery-outside.md"), join(discoveryRoot, "AGENTS.md"));
  const symlinkCandidate = await discoveryCandidateForImport(discoveryRoot, "AGENTS.md");
  assert(!symlinkCandidate, "discovery followed a project symlink");

  await writeFile(join(vaultOutside, "outside.md"), "# outside\n");
  await symlink(join(vaultOutside, "outside.md"), join(vaultRoot, "linked.md"));
  await writeFile(
    join(vaultRoot, "unsafe.md"),
    `api_key = ${secret}\n# password: ${opaqueCredential}\n[credential](https://example.com/#token=${opaqueCredential})\n`
  );
  const inventory = await inventoryVault({ vaultDir: vaultRoot });
  assert(
    inventory.skipped.some(
      (item) => item.path === "linked.md" && item.reason === "symbolic_link_not_followed"
    ),
    "vault inventory followed a symlink"
  );
  assert(!JSON.stringify(inventory).includes(secret), "vault inventory leaked a secret");
  assert(
    !JSON.stringify(inventory).includes("user:pass@example.com"),
    "vault inventory leaked URL credentials"
  );
  assert(
    !JSON.stringify(inventory).includes(opaqueCredential),
    "vault inventory leaked a generic credential or anchor"
  );
  const exportPlan = buildVaultMarkdownExportPlan(inventory, join(vaultRoot, "export"));
  assert(
    !JSON.stringify(exportPlan).includes(opaqueCredential),
    "vault export leaked a credential"
  );
  const exportRoot = join(vaultRoot, "export-link");
  await symlink(vaultOutside, exportRoot);
  let exportBlocked = false;
  try {
    await writeVaultMarkdownExport(buildVaultMarkdownExportPlan(inventory, exportRoot), {
      overwrite: true
    });
  } catch (error) {
    exportBlocked = String(error).startsWith("Error: VALIDATION_ERROR:");
  }
  assert(exportBlocked, "vault export followed a symlink");
  const exportTargetRoot = join(vaultRoot, "export-target-link");
  await mkdir(exportTargetRoot, { recursive: true });
  const outsideTarget = join(vaultOutside, "outside-target.md");
  await writeFile(outsideTarget, "outside target must remain unchanged\n");
  await symlink(outsideTarget, join(exportTargetRoot, "Decisions.md"));
  let exportTargetBlocked = false;
  try {
    await writeVaultMarkdownExport(buildVaultMarkdownExportPlan(inventory, exportTargetRoot), {
      overwrite: true
    });
  } catch (error) {
    exportTargetBlocked = String(error).startsWith("Error: VALIDATION_ERROR:");
  }
  assert(exportTargetBlocked, "vault export overwrote a symlink target");
  assert(
    (await readFile(outsideTarget, "utf8")) === "outside target must remain unchanged\n",
    "vault export changed a file outside the output root"
  );

  const readLinkProject = join(projectSymlinkRoot, "read-link");
  await mkdir(join(readLinkProject, ".recallant"), { recursive: true });
  const outsideConfig = join(projectSymlinkOutside, "config");
  await writeFile(outsideConfig, '{"project_id":"outside"}\n');
  await symlink(outsideConfig, join(readLinkProject, ".recallant", "config"));
  runAttachExpectingSymlinkBlock(readLinkProject, "project config read symlink", "--guided");

  const targetLinkProject = join(projectSymlinkRoot, "target-link");
  await mkdir(targetLinkProject, { recursive: true });
  const outsideCodexDir = join(projectSymlinkOutside, "codex-dir");
  await mkdir(outsideCodexDir, { recursive: true });
  await symlink(outsideCodexDir, join(targetLinkProject, ".codex"));
  runAttachExpectingSymlinkBlock(targetLinkProject, "client target directory symlink");
  assert(
    (await readFile(outsideConfig, "utf8")) === '{"project_id":"outside"}\n',
    "project attach changed an outside read target"
  );

  const gitignoreLinkProject = join(projectSymlinkRoot, "gitignore-link");
  await mkdir(gitignoreLinkProject, { recursive: true });
  const outsideGitignore = join(projectSymlinkOutside, "gitignore");
  await writeFile(outsideGitignore, "outside gitignore must remain unchanged\n");
  await symlink(outsideGitignore, join(gitignoreLinkProject, ".gitignore"));
  runAttachExpectingSymlinkBlock(gitignoreLinkProject, "project write target symlink");
  assert(
    (await readFile(outsideGitignore, "utf8")) === "outside gitignore must remain unchanged\n",
    "project attach overwrote an outside write target"
  );

  const backupLinkProject = join(projectSymlinkRoot, "backup-link");
  await mkdir(join(backupLinkProject, ".recallant"), { recursive: true });
  await writeFile(join(backupLinkProject, "AGENTS.md"), "# Existing agent guide\n");
  const outsideBackups = join(projectSymlinkOutside, "backups");
  await mkdir(outsideBackups, { recursive: true });
  await symlink(outsideBackups, join(backupLinkProject, ".recallant", "backups"));
  runAttachExpectingSymlinkBlock(backupLinkProject, "project backup directory symlink");
  assert(
    (await readFile(join(backupLinkProject, "AGENTS.md"), "utf8")) === "# Existing agent guide\n",
    "project attach changed agent instructions before rejecting a backup symlink"
  );

  await client.connect();
  const project = await db.ensureProject();
  const session = await db.startSession({
    project_id: project.projectId,
    client_kind: "codex",
    client_version: "security-hardening-smoke"
  });
  const turn = await db.appendTurn({
    project_id: project.projectId,
    session_id: session.session_id,
    client_kind: "codex",
    role: "user",
    text: `api_key=${secret}\nAuthorization: Bearer ${opaqueCredential}\npassword: ${opaqueCredential}\n${privateKey}`
  });
  const event = await client.query("SELECT payload::text AS payload FROM events WHERE id = $1", [
    turn.event_id
  ]);
  const chunks = await client.query("SELECT text FROM chunks WHERE source_event_id = $1", [
    turn.event_id
  ]);
  const eventText = [
    ...event.rows.map((row) => row.payload),
    ...chunks.rows.map((row) => row.text)
  ].join("\n");
  assert(!eventText.includes(secret), "legacy turn stored a raw token");
  assert(
    !eventText.includes("hardening-private-key-material"),
    "legacy turn stored a raw PEM body"
  );

  const workflow = await db.appendEvent({
    project_id: project.projectId,
    session_id: session.session_id,
    client_kind: "codex",
    event_kind: "tool_result",
    text: privateKey,
    metadata: {
      password: opaqueCredential,
      authorization: `Bearer ${opaqueCredential}`,
      safe: "retained"
    },
    raw_artifacts: [
      {
        artifact_kind: "terminal_output",
        storage_backend: "external",
        uri: "https://user:pass@example.com/artifact",
        excerpt: `${privateKey}\nBearer ${opaqueCredential}`,
        metadata: { token: opaqueCredential }
      }
    ]
  });
  const artifact = await client.query(
    "SELECT excerpt, uri, metadata::text AS metadata FROM raw_artifacts WHERE source_event_id = $1",
    [workflow.event_id]
  );
  const workflowText = JSON.stringify(artifact.rows);
  assert(!workflowText.includes(secret), "legacy event stored a raw token");
  assert(
    !workflowText.includes("hardening-private-key-material"),
    "legacy event stored a raw PEM body"
  );
  assert(!workflowText.includes(opaqueCredential), "legacy event stored a generic credential");

  const localCleanupSentinel = "r5_db_command_injected";
  const maliciousProjectPath = join(
    projectSymlinkRoot,
    `project-$(touch\${IFS}${localCleanupSentinel})`
  );
  await client.query("UPDATE projects SET primary_path = $2 WHERE id = $1", [
    project.projectId,
    maliciousProjectPath
  ]);
  const commandDashboard = await db.getReviewDashboard({ project_id: project.projectId });
  const localCleanupCommand = commandDashboard.project_cleanup?.local_cleanup_command;
  assert(localCleanupCommand, "dashboard local cleanup command was not generated");
  const commandRun = spawnSync("/bin/sh", ["-c", `recallant() { :; }\n${localCleanupCommand}`], {
    cwd: projectSymlinkRoot,
    encoding: "utf8"
  });
  assert(commandRun.status === 0, `dashboard cleanup command did not parse: ${commandRun.stderr}`);
  let commandInjected = true;
  try {
    await readFile(join(projectSymlinkRoot, localCleanupSentinel));
  } catch (error) {
    commandInjected = error.code !== "ENOENT";
  }
  assert(!commandInjected, "dashboard cleanup command executed injected shell syntax");

  const editableMemory = await db.createAgentMemory({
    project_id: project.projectId,
    memory_type: "work_log",
    scope: "project",
    title: "Owner edit boundary",
    body: "Original safe owner-edit body.",
    created_by: "user"
  });
  editableMemoryId = editableMemory.memory_id;
  let scopeEditBlocked = false;
  try {
    await db.reviewAgentMemory({
      memory_id: editableMemoryId,
      action: "edit",
      actor_kind: "user",
      patch: { scope: "developer" }
    });
  } catch (error) {
    scopeEditBlocked = String(error).includes("may change only title and body");
  }
  assert(scopeEditBlocked, "direct owner edit changed memory authority fields");

  const authToken = `r5-owner-edit-${randomUUID()}`;
  process.env.RECALLANT_AUTH_TOKEN = authToken;
  httpServer = createRecallantHttpServer({ workbenchDatabase: db });
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  const httpPort = typeof address === "object" && address ? address.port : 0;
  const malformedHeaders = { "x-forwarded-host": "[" };
  const connectResponse = await fetch(`http://127.0.0.1:${httpPort}/connect`, {
    headers: malformedHeaders
  });
  const inviteResponse = await fetch(`http://127.0.0.1:${httpPort}/j/valid`, {
    headers: malformedHeaders
  });
  assert(connectResponse.status === 400, "malformed forwarded host escaped connect handler");
  assert(inviteResponse.status === 400, "malformed forwarded host escaped invite handler");
  const healthResponse = await fetch(`http://127.0.0.1:${httpPort}/health`);
  assert(healthResponse.status === 200, "HTTP server did not remain healthy after malformed input");

  const ownerEdit = await fetch(`http://127.0.0.1:${httpPort}/api/review-action`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      memory_id: editableMemoryId,
      action: "edit",
      actor_kind: "agent",
      patch: {
        title: "Owner edit applied",
        body: "Safe owner edit applied through Workbench.",
        scope: "developer",
        scope_kind: "developer",
        memory_type: "procedure"
      }
    })
  });
  assert(ownerEdit.status === 200, `safe owner edit returned ${ownerEdit.status}`);
  const ownerEdited = await db.getAgentMemory(editableMemoryId);
  assert(ownerEdited.memory?.scope === "project", "Workbench owner edit changed memory scope");
  assert(
    ownerEdited.memory?.memory_type === "work_log",
    "Workbench owner edit changed memory type"
  );
  assert(
    ownerEdited.memory?.body === "Safe owner edit applied through Workbench.",
    "Workbench owner edit did not update safe content"
  );
  assert(
    ownerEdited.review_actions.some(
      (action) => action.action === "edit" && action.actor_kind === "user"
    ),
    "Workbench owner edit did not enforce user authority"
  );

  const secretOwnerEdit = await fetch(`http://127.0.0.1:${httpPort}/api/review-action`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      memory_id: editableMemoryId,
      action: "edit",
      patch: { body: privateKey }
    })
  });
  assert(
    secretOwnerEdit.status === 400,
    `secret-bearing owner edit returned ${secretOwnerEdit.status}`
  );
  const afterSecretEdit = await db.getAgentMemory(editableMemoryId);
  assert(
    afterSecretEdit.memory?.body === "Safe owner edit applied through Workbench.",
    "rejected owner edit changed stored memory"
  );
  process.stdout.write(
    `${JSON.stringify({
      status: "pass",
      external_http_blocked: blockedExternalHttp,
      shell_quoted_filename: true,
      vault_symlink_blocked: true,
      vault_target_symlink_blocked: true,
      project_read_write_symlinks_blocked: true,
      vault_metadata_redacted: true,
      legacy_capture_redacted: true,
      legacy_artifact_redacted: true,
      owner_edit_authority_and_validation: true,
      dashboard_cleanup_command_quoted: true
    })}\n`
  );
} finally {
  await db.close();
  await client.end().catch(() => undefined);
  if (httpServer) {
    httpServer.closeAllConnections?.();
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await Promise.all([
    rm(discoveryRoot, { recursive: true, force: true }),
    rm(vaultRoot, { recursive: true, force: true }),
    rm(vaultOutside, { recursive: true, force: true }),
    rm(projectSymlinkRoot, { recursive: true, force: true }),
    rm(projectSymlinkOutside, { recursive: true, force: true })
  ]);
}

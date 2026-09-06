import { randomUUID } from "node:crypto";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

const databaseUrl = process.env.RECALLANT_DATABASE_URL;
if (!databaseUrl)
  throw new Error("RECALLANT_DATABASE_URL is required for security hardening smoke");

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
  assert(!JSON.stringify(exportPlan).includes(opaqueCredential), "vault export leaked a credential");
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

  httpServer = createRecallantHttpServer();
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
  process.stdout.write(
    `${JSON.stringify({
      status: "pass",
      external_http_blocked: blockedExternalHttp,
      shell_quoted_filename: true,
      vault_symlink_blocked: true,
      vault_metadata_redacted: true,
      legacy_capture_redacted: true,
      legacy_artifact_redacted: true
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
    rm(vaultOutside, { recursive: true, force: true })
  ]);
}

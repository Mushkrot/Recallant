import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Pool, type PoolClient } from "pg";
import { deriveCanonCapabilityContext } from "./canon-capability-context.js";
import {
  ensureSystemActivitySchema,
  normalizeSystemActivityFinish,
  normalizeSystemActivityStart,
  type FinishSystemActivityInput,
  type SystemActivityInput,
  type SystemActivityRecord
} from "./system-activity.js";

export {
  buildCanonCapabilityContext,
  canonCapabilityContextContainsRawSecret,
  deriveCanonCapabilityContext,
  emptyCanonCapabilityContext,
  type CanonCapabilityAuthority,
  type CanonCapabilityContext,
  type CanonCapabilityContextInput,
  type CanonCapabilityDerivationInput,
  type CanonCapabilityEnvironmentFact,
  type CanonCapabilityProvenance,
  type CanonCapabilityReference,
  type CanonCapabilityReferenceState,
  type CanonCapabilitySecretReference,
  type CanonCapabilityServerCanonLink,
  type DocumentationAuthorityMapItem
} from "./canon-capability-context.js";
export {
  ensureSystemActivitySchema,
  redactSystemActivityValue,
  redactedSystemActivityObject,
  systemActivitySchemaStatements,
  type FinishSystemActivityInput,
  type SystemActivityInput,
  type SystemActivityRecord,
  type SystemActivityStatus
} from "./system-activity.js";

export const recallantDatabasePackage = "recallant-db";

export type RecallantDbConfig = {
  databaseUrl: string;
  developerId?: string;
  projectId?: string;
  projectPath?: string;
};

export type JsonObject = Record<string, unknown>;

export type RemoteMcpCredentialStatus = "active" | "expired" | "revoked";
export type RemoteMcpCredentialHashVersion = "sha256-v1";
export type RemoteMcpCredentialVerifyFailureCode =
  | "missing_token"
  | "invalid_token"
  | "expired"
  | "revoked"
  | "rotated"
  | "wrong_project"
  | "wrong_developer"
  | "wrong_client";

export type RemoteMcpCredentialRow = {
  id: string;
  project_id: string;
  developer_id: string;
  client_id: string | null;
  label: string | null;
  credential_prefix: string;
  credential_hash: string;
  hash_version: string;
  created_by: string;
  rotated_from_credential_id: string | null;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
};

export type RemoteMcpCredentialSummary = Omit<RemoteMcpCredentialRow, "credential_hash"> & {
  status: RemoteMcpCredentialStatus;
};

export type RemoteOnboardingInviteStatus = "active" | "expired" | "redeemed" | "revoked";

export type RemoteOnboardingInviteRow = {
  id: string;
  project_id: string;
  developer_id: string;
  token_prefix: string;
  token_hash: string;
  hash_version: string;
  target: string;
  label: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  redeemed_at: Date | null;
  revoked_at: Date | null;
  redeemed_client_id: string | null;
  redeemed_credential_id: string | null;
};

export type RemoteOnboardingInviteSummary = Omit<RemoteOnboardingInviteRow, "token_hash"> & {
  status: RemoteOnboardingInviteStatus;
};

export type CreateRemoteOnboardingInviteInput = {
  projectId: string;
  developerId: string;
  target?: string | null;
  label?: string | null;
  expiresAt?: string | Date | null;
  createdBy?: string | null;
};

export type CreateRemoteOnboardingInviteResult = {
  token: string;
  invite: RemoteOnboardingInviteSummary;
};

export type RedeemRemoteOnboardingInviteInput = {
  token: string;
  clientId?: string | null;
  redeemedBy?: string | null;
};

export type RedeemRemoteOnboardingInviteResult = {
  invite: RemoteOnboardingInviteSummary;
  secret: string;
  credential: RemoteMcpCredentialSummary;
  client_id: string;
  target: string;
};

export type RemoteConnectRequestStatus = "pending" | "approved" | "denied" | "expired" | "redeemed";

export type RemoteConnectApprovalMode = "human_approval" | "trusted_device" | "bootstrap_token";

export type RemoteConnectRequestRow = {
  id: string;
  device_code_prefix: string;
  device_code_hash: string;
  poll_token_prefix: string;
  poll_token_hash: string;
  hash_version: string;
  status: RemoteConnectRequestStatus;
  target: string;
  project_display_name: string | null;
  project_fingerprint: string | null;
  project_path_hint_redacted: string | null;
  repo_remote_hash: string | null;
  requested_by_ip_hash: string | null;
  trusted_device_key_prefix: string | null;
  trusted_device_public_key_fingerprint: string | null;
  trusted_device_public_key_hash: string | null;
  trusted_device_public_key_algorithm: string | null;
  trusted_device_name: string | null;
  created_by: string;
  approved_by: string | null;
  approved_project_id: string | null;
  developer_id: string | null;
  client_id: string | null;
  credential_id: string | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  approved_at: Date | null;
  denied_at: Date | null;
  redeemed_at: Date | null;
};

export type RemoteConnectRequestSummary = Omit<
  RemoteConnectRequestRow,
  "device_code_hash" | "poll_token_hash" | "trusted_device_public_key_hash"
> & {
  status: RemoteConnectRequestStatus;
};

export type CreateRemoteConnectRequestInput = {
  target?: string | null;
  projectDisplayName?: string | null;
  projectFingerprint?: string | null;
  projectPathHintRedacted?: string | null;
  repoRemoteHash?: string | null;
  requestedByIpHash?: string | null;
  trustedDeviceKeyPrefix?: string | null;
  trustedDevicePublicKeyFingerprint?: string | null;
  trustedDevicePublicKeyMaterial?: string | null;
  trustedDevicePublicKeyHash?: string | null;
  trustedDevicePublicKeyAlgorithm?: string | null;
  trustedDeviceName?: string | null;
  expiresAt?: string | Date | null;
  createdBy?: string | null;
};

export type CreateRemoteConnectRequestResult = {
  device_code: string;
  poll_token: string;
  request: RemoteConnectRequestSummary;
};

export type ApproveRemoteConnectRequestInput = {
  deviceCode: string;
  projectId: string;
  developerId: string;
  clientId?: string | null;
  approvedBy?: string | null;
};

export type DenyRemoteConnectRequestInput = {
  deviceCode: string;
  deniedBy?: string | null;
};

export type GetRemoteConnectRequestForApprovalInput = {
  deviceCode: string;
};

export type RemoteConnectTrustedDeviceRegistrationSummary = {
  device_key_prefix: string;
  public_key_fingerprint: string;
  public_key_hash: string;
  public_key_algorithm: string | null;
  device_name: string | null;
};

export type PollRemoteConnectRequestInput = {
  pollToken: string;
  redeemedBy?: string | null;
};

export type PollRemoteConnectRequestResult =
  | {
      status: "pending" | "denied" | "expired" | "redeemed";
      request: RemoteConnectRequestSummary | null;
    }
  | {
      status: "approved";
      request: RemoteConnectRequestSummary;
      secret: string;
      credential: RemoteMcpCredentialSummary;
      project_id: string;
      developer_id: string;
      client_id: string;
      target: string;
    };

export type RemoteTrustedDeviceStatus = "active" | "expired" | "revoked";

export type RemoteTrustedDeviceRow = {
  id: string;
  developer_id: string;
  device_key_prefix: string;
  device_public_key_fingerprint: string;
  device_public_key_hash: string;
  hash_version: string;
  public_key_algorithm: string;
  device_name: string | null;
  label: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
};

export type RemoteTrustedDeviceSummary = Omit<RemoteTrustedDeviceRow, "device_public_key_hash"> & {
  status: RemoteTrustedDeviceStatus;
};

export type CreateRemoteTrustedDeviceInput = {
  developerId: string;
  deviceKeyPrefix: string;
  publicKeyFingerprint: string;
  publicKeyMaterial?: string | null;
  publicKeyHash?: string | null;
  publicKeyAlgorithm?: string | null;
  deviceName?: string | null;
  label?: string | null;
  expiresAt?: string | Date | null;
  createdBy?: string | null;
};

export type VerifyRemoteTrustedDeviceInput = {
  developerId: string;
  deviceKeyPrefix: string;
  publicKeyFingerprint: string;
  publicKeyMaterial?: string | null;
  challengeNonce?: string | null;
  verifiedBy?: string | null;
};

export type VerifyRemoteTrustedDeviceResult =
  | {
      ok: true;
      device: RemoteTrustedDeviceSummary;
    }
  | {
      ok: false;
      code: "missing_device" | "invalid_device" | "expired" | "revoked" | "replayed";
      message: string;
      device?: RemoteTrustedDeviceSummary;
    };

export type VerifyRemoteTrustedDeviceChallengeInput = {
  deviceKeyPrefix: string;
  publicKeyFingerprint: string;
  publicKeyMaterial: string;
  challengeNonce: string;
  verifiedBy?: string | null;
};

export type RevokeRemoteTrustedDeviceInput = {
  deviceId: string;
  revokedBy?: string | null;
};

export type RemoteConnectBootstrapTokenStatus = "active" | "expired" | "redeemed" | "revoked";

export type RemoteConnectBootstrapTokenRow = {
  id: string;
  project_id: string | null;
  developer_id: string;
  token_prefix: string;
  token_hash: string;
  hash_version: string;
  target: string;
  label: string | null;
  allow_project_create: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  redeemed_at: Date | null;
  revoked_at: Date | null;
  redeemed_client_id: string | null;
  redeemed_project_id: string | null;
};

export type RemoteConnectBootstrapTokenSummary = Omit<
  RemoteConnectBootstrapTokenRow,
  "token_hash"
> & {
  status: RemoteConnectBootstrapTokenStatus;
};

export type CreateRemoteConnectBootstrapTokenInput = {
  projectId?: string | null;
  developerId: string;
  target?: string | null;
  label?: string | null;
  allowProjectCreate?: boolean;
  expiresAt?: string | Date | null;
  createdBy?: string | null;
};

export type CreateRemoteConnectBootstrapTokenResult = {
  token: string;
  bootstrap_token: RemoteConnectBootstrapTokenSummary;
};

export type RedeemRemoteConnectBootstrapTokenInput = {
  token: string;
  clientId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  redeemedBy?: string | null;
};

export type RedeemRemoteConnectBootstrapTokenResult = {
  bootstrap_token: RemoteConnectBootstrapTokenSummary;
  project_id: string | null;
  developer_id: string;
  client_id: string;
  target: string;
};

export type RevokeRemoteConnectBootstrapTokenInput = {
  tokenId: string;
  revokedBy?: string | null;
};

export type CreateRemoteMcpCredentialInput = {
  projectId: string;
  developerId: string;
  clientId?: string | null;
  label?: string | null;
  expiresAt?: string | Date | null;
  createdBy?: string | null;
};

export type VerifyRemoteMcpCredentialInput = {
  bearerToken: string;
  projectId: string;
  developerId: string;
  clientId?: string | null;
};

export type ListRemoteMcpCredentialsInput = {
  projectId: string;
  developerId: string;
  clientId?: string | null;
  includeRevoked?: boolean;
};

export type CreateRemoteMcpCredentialResult = {
  secret: string;
  credential: RemoteMcpCredentialSummary;
};

export type VerifyRemoteMcpCredentialResult =
  | {
      ok: true;
      credential: RemoteMcpCredentialSummary;
    }
  | {
      ok: false;
      code: RemoteMcpCredentialVerifyFailureCode;
      message: string;
      credential?: RemoteMcpCredentialSummary;
    };

export type RotateRemoteMcpCredentialInput = {
  credentialId: string;
  rotatedBy?: string | null;
  expiresAt?: string | Date | null;
};

export type RotateRemoteMcpCredentialResult = {
  secret: string;
  credential: RemoteMcpCredentialSummary;
  previous: RemoteMcpCredentialSummary;
};

export type RevokeRemoteMcpCredentialInput = {
  credentialId: string;
  revokedBy?: string | null;
};

export type SystemAuditReportInput = {
  project_id?: string | null;
  project_path?: string | null;
  since?: string | Date | null;
  until?: string | Date | null;
  surface?: string | null;
  status?: string | null;
  limit?: number | null;
  slow_ms?: number | null;
};

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function auditDateOrNull(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function auditIso(value: Date) {
  return value.toISOString();
}

function boundedAuditLimit(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return 100;
  return Math.max(1, Math.min(500, Math.floor(value)));
}

function auditCountBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function auditRecommendation(severity: string, message: string, evidence: Record<string, unknown>) {
  return { severity, message, evidence };
}

const remoteMcpCredentialHashVersion: RemoteMcpCredentialHashVersion = "sha256-v1";
const remoteMcpCredentialPrefixBytes = 9;
const remoteMcpCredentialSecretBytes = 32;
const remoteOnboardingInviteHashVersion = "sha256-v1";
const remoteOnboardingInvitePrefixBytes = 8;
const remoteOnboardingInviteSecretBytes = 24;

function normalizeRemoteMcpCredentialString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

function normalizeRemoteMcpCredentialDate(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("VALIDATION_ERROR: remote MCP credential date is invalid");
  }
  return date;
}

function generateRemoteMcpCredentialSecret() {
  const prefix = randomBytes(remoteMcpCredentialPrefixBytes).toString("hex");
  const secret = randomBytes(remoteMcpCredentialSecretBytes).toString("base64url");
  return `rcl_mcp_${prefix}_${secret}`;
}

function extractRemoteMcpCredentialPrefix(secret: string) {
  return secret.trim().match(/^rcl_mcp_([A-Fa-f0-9]+)_/)?.[1] ?? null;
}

function hashRemoteMcpCredentialSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function constantTimeRemoteMcpHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function remoteMcpCredentialStatus(row: RemoteMcpCredentialRow): RemoteMcpCredentialStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return "expired";
  return "active";
}

function summarizeRemoteMcpCredential(row: RemoteMcpCredentialRow): RemoteMcpCredentialSummary {
  const summary = { ...row };
  delete (summary as Partial<RemoteMcpCredentialRow>).credential_hash;
  return { ...summary, status: remoteMcpCredentialStatus(row) };
}

function normalizeRemoteOnboardingTarget(value: string | null | undefined) {
  const normalized = normalizeRemoteMcpCredentialString(value)?.replaceAll("-", "_") ?? "codex";
  if (["codex", "cursor", "claude_code", "generic"].includes(normalized)) return normalized;
  throw new Error("VALIDATION_ERROR: remote onboarding invite target is invalid");
}

function defaultRemoteOnboardingInviteExpiry() {
  return new Date(Date.now() + 30 * 60 * 1000);
}

function generateRemoteOnboardingInviteToken() {
  const prefix = randomBytes(remoteOnboardingInvitePrefixBytes).toString("hex");
  const secret = randomBytes(remoteOnboardingInviteSecretBytes).toString("base64url");
  return `rcl_inv_${prefix}_${secret}`;
}

function extractRemoteOnboardingInvitePrefix(token: string) {
  return token.trim().match(/^rcl_inv_([A-Fa-f0-9]+)_/)?.[1] ?? null;
}

function hashRemoteOnboardingInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeRemoteOnboardingHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function remoteOnboardingInviteStatus(
  row: RemoteOnboardingInviteRow
): RemoteOnboardingInviteStatus {
  if (row.revoked_at) return "revoked";
  if (row.redeemed_at) return "redeemed";
  if (row.expires_at.getTime() <= Date.now()) return "expired";
  return "active";
}

function summarizeRemoteOnboardingInvite(
  row: RemoteOnboardingInviteRow
): RemoteOnboardingInviteSummary {
  const summary = { ...row };
  delete (summary as Partial<RemoteOnboardingInviteRow>).token_hash;
  return { ...summary, status: remoteOnboardingInviteStatus(row) };
}

function rawSecretLikeFindings(value: unknown, path = "value"): string[] {
  const findings: string[] = [];
  if (typeof value === "string") {
    const checks = [
      /sk-[A-Za-z0-9_-]{12,}/,
      /gh[pousr]_[A-Za-z0-9_]{20,}/,
      /xox[baprs]-[A-Za-z0-9-]{10,}/,
      /postgres:\/\/[^:\s]+:[^@\s]+@/i,
      /\b(?:password|passwd|api[_-]?key|secret|token)\s*[:=]\s*['"]?[^'",\s]{6,}/i
    ];
    if (checks.some((pattern) => pattern.test(value))) findings.push(path);
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findings.push(...rawSecretLikeFindings(item, `${path}[${index}]`))
    );
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      findings.push(...rawSecretLikeFindings(item, `${path}.${key}`));
    }
  }
  return findings;
}

function memorySpaceProfile(input: {
  project_kind?: string | null;
  memory_domain?: string | null;
  primary_path?: string | null;
}) {
  const projectKind = String(input.project_kind ?? "");
  const memoryDomain = String(input.memory_domain ?? "agent_work");
  if (projectKind === "personal_domain" || memoryDomain === "personal_life") {
    return {
      profile_key: "personal_work_operations",
      label: "Personal / Work Operations",
      purpose:
        "A private virtual memory space for owner-mediated personal or work operations memory.",
      default_isolation:
        "Isolated from coding-agent context. Agents may use it only through explicit governed recall.",
      allowed_sources: [
        "manual notes",
        "virtual owner-supplied records",
        "document references after review",
        "planned connectors only after separate consent and capability binding"
      ],
      allowed_recall:
        "Explicit read-only recall for the selected memory space; no silent injection into code projects.",
      capture_policy:
        "Manual or agent-mediated writes only. Passive personal capture and connector ingestion are not active.",
      connector_policy:
        "Connectors are shown as not connected until consent and capability readiness are recorded.",
      default_sources: input.primary_path ? "primary source from path" : "zero sources by default",
      technical_basis: {
        project_kind: projectKind || "other",
        memory_domain: memoryDomain
      }
    };
  }
  return {
    profile_key: "coding_agent_workspace",
    label: "Coding Agent Workspace",
    purpose: "A project memory space for agent work, decisions, context, checkpoints, and rules.",
    default_isolation:
      "Isolated by default; agents may ask for source-linked examples from other spaces.",
    allowed_sources: [
      "workspace folders",
      "repositories",
      "document references",
      "manual records",
      "planned connectors after governed setup"
    ],
    allowed_recall:
      "Current-project memory is available to project context; cross-space examples require explicit recall.",
    capture_policy:
      "Agent capture is active only when session, context read, memory write, and checkpoint evidence exist.",
    connector_policy:
      "Connectors are planned references until separate consent and capability readiness are recorded.",
    default_sources: input.primary_path ? "primary workspace source" : "zero sources by default",
    technical_basis: {
      project_kind: projectKind || "repo",
      memory_domain: memoryDomain
    }
  };
}

function metadataRecord(row: Record<string, unknown>) {
  return row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? (row.metadata as Record<string, unknown>)
    : {};
}

function resultClassesFor(row: Record<string, unknown>) {
  const metadata = metadataRecord(row);
  const classes = Array.isArray(metadata.result_classes) ? metadata.result_classes : [];
  const resultClass = typeof metadata.result_class === "string" ? [metadata.result_class] : [];
  return [...classes, ...resultClass].map(String);
}

function hasMigrationClass(row: Record<string, unknown>, patterns: RegExp[]) {
  const serialized = JSON.stringify(metadataRecord(row));
  return (
    resultClassesFor(row).some((name) => patterns.some((pattern) => pattern.test(name))) ||
    patterns.some((pattern) => pattern.test(serialized))
  );
}

function summarizeMigrationReview(
  importedRows: Array<Record<string, unknown>>,
  conflictRows: Array<Record<string, unknown>>
) {
  const secretReferenceCount = importedRows.filter((row) =>
    hasMigrationClass(row, [/secret/i, /capability/i, /connector/i])
  ).length;
  const staleHandoffCount = importedRows.filter((row) =>
    hasMigrationClass(row, [/handoff/i, /stale/i, /duplicate/i, /oversized/i])
  ).length;
  const conflictCount = importedRows.filter((row) =>
    hasMigrationClass(row, [/conflict/i, /duplicate/i])
  ).length;
  const lowRiskEvidenceCount = importedRows.filter(
    (row) =>
      String(row.status ?? "") === "candidate" &&
      String(row.use_policy ?? "") === "recall_allowed" &&
      !hasMigrationClass(row, [/secret/i, /capability/i, /connector/i, /conflict/i, /duplicate/i])
  ).length;
  const reviewRequiredCount = importedRows.filter((row) =>
    ["candidate", "needs_review"].includes(String(row.status ?? ""))
  ).length;
  const firstAction =
    conflictCount > 0
      ? "Resolve conflicts and duplicates before promoting migrated guidance."
      : secretReferenceCount > 0
        ? "Review secret and capability references before ordinary imports."
        : staleHandoffCount > 0
          ? "Decide which stale handoffs remain useful evidence."
          : reviewRequiredCount > 0
            ? "Accept useful imported evidence or reject noise."
            : "No migrated imports are waiting for review.";
  return {
    total_imported: importedRows.length,
    review_required: reviewRequiredCount,
    conflicts_or_duplicates: Math.max(conflictCount, conflictRows.length),
    secret_or_capability_references: secretReferenceCount,
    stale_handoffs: staleHandoffCount,
    low_risk_imported_evidence: lowRiskEvidenceCount,
    first_action: firstAction,
    review_filter_hint: "Review imported evidence before active rules.",
    lane_order: [
      {
        key: "conflicts",
        label: "Conflicts and duplicates",
        count: Math.max(conflictCount, conflictRows.length),
        action:
          "Compare overlapping records and choose the source-backed memory agents should trust."
      },
      {
        key: "secret_refs",
        label: "Secret and capability references",
        count: secretReferenceCount,
        action: "Keep names and capability references only; never promote raw secret material."
      },
      {
        key: "stale_handoffs",
        label: "Stale handoffs",
        count: staleHandoffCount,
        action:
          "Keep useful history as evidence, reject noise, and avoid instruction-grade promotion."
      },
      {
        key: "low_risk",
        label: "Low-risk imported evidence",
        count: lowRiskEvidenceCount,
        action: "Accept useful facts as usable memory after review."
      }
    ]
  };
}

function connectorConsentPolicy(metadata: Record<string, unknown>) {
  const state = String(metadata.consent_state ?? "not_requested");
  const capability = String(metadata.capability_binding_status ?? "");
  const consentState = ["not_requested", "proposed", "granted", "revoked"].includes(state)
    ? state
    : "not_requested";
  return {
    consent_state: consentState,
    capture_allowed:
      consentState === "granted" && ["ready", "active", "configured"].includes(capability),
    review_required_before_activation: true,
    allowed_before_active: [
      "connector label",
      "connector reference",
      "consent state",
      "capability binding reference/status",
      "source health metadata"
    ],
    prohibited_before_active: [
      "raw connector content",
      "raw OAuth tokens",
      "API keys",
      "passwords",
      "unreviewed personal data"
    ],
    no_secret_policy: "Raw secrets and credentials stay outside Recallant memory.",
    activation_rule:
      "Connector capture is inactive until owner consent is granted, capability binding is ready, and review policy allows the source."
  };
}

export type StartSessionInput = {
  client_kind: string;
  client_version?: string | null;
  project_id?: string | null;
  project_path?: string | null;
  session_label?: string | null;
  resume_policy?: string;
};

export type AppendTurnInput = {
  session_id?: string | null;
  client_kind: string;
  role: "user" | "assistant";
  text: string;
  occurred_at?: string | null;
  dedup_key?: string | null;
};

export type RawArtifactInput = {
  artifact_kind: string;
  storage_backend: string;
  uri?: string | null;
  sha256?: string | null;
  size_bytes?: number | null;
  content_type?: string | null;
  excerpt?: string | null;
  metadata?: JsonObject;
};

export type AppendEventInput = {
  session_id?: string | null;
  client_kind: string;
  event_kind: string;
  text?: string | null;
  metadata?: JsonObject;
  raw_artifacts?: RawArtifactInput[];
  occurred_at?: string | null;
  dedup_key?: string | null;
};

export type ImportSourceInput = {
  client_kind?: string;
  project_path?: string | null;
  source_path: string;
  source_type: string;
  source_sha256: string;
  source_size_bytes?: number | null;
  content_type?: string | null;
  import_text: string;
  bounded_excerpt?: string | null;
  result_class: string;
  result_classes?: string[];
  scope_kind?: string | null;
  scope_id?: string | null;
  audience?: unknown[];
  risk?: string | null;
  risks?: JsonObject[];
  secret_references?: JsonObject[];
  metadata?: JsonObject;
  dedup_key?: string | null;
};

export type AgentMemorySourceRefInput = {
  source_kind: string;
  source_id: string;
  quote?: string | null;
  metadata?: JsonObject;
};

export type CreateAgentMemoryInput = {
  project_path?: string | null;
  project_id?: string | null;
  memory_type: string;
  scope: "project" | "developer";
  scope_kind?: string | null;
  scope_id?: string | null;
  audience?: unknown[];
  title: string;
  body: string;
  confidence?: number | null;
  source_refs?: AgentMemorySourceRefInput[];
  created_by: "agent" | "user" | "system" | "import";
  metadata?: JsonObject;
};

export type ReviewAgentMemoryInput = {
  memory_id: string;
  action: string;
  superseded_by?: string | null;
  merge_memory_ids?: string[];
  patch?: {
    title?: string | null;
    body?: string | null;
    scope?: "project" | "developer" | null;
    scope_kind?: string | null;
    scope_id?: string | null;
    audience?: unknown[];
    memory_type?: string | null;
  };
  note?: string | null;
  actor_kind: "user" | "agent" | "system";
};

export type ListAgentMemoriesInput = {
  view: string;
  project_id?: string | null;
  source_id?: string | null;
  scope?: string | null;
  scope_kind?: string | null;
  memory_type?: string | null;
  audience_kind?: string | null;
  memory_domain?: string | null;
  status?: string | null;
  use_policy?: string | null;
  limit?: number;
};

export type RecallAgentMemoriesInput = {
  query: string;
  project_id?: string | null;
  source_id?: string | null;
  scope?: string;
  scope_kind?: string | null;
  audience_kind?: string | null;
  memory_types?: string[];
  include_candidates?: boolean;
  include_stale?: boolean;
  include_needs_review?: boolean;
  top_k?: number;
  max_chars_total?: number;
};

export type CrossProjectRecallMode =
  | "same_project"
  | "developer_rules"
  | "environment"
  | "similar_projects"
  | "all_projects_review";

export type CrossProjectRecallInput = {
  query: string;
  mode?: CrossProjectRecallMode;
  session_id?: string | null;
  scope_kind?: string | null;
  memory_types?: string[];
  include_candidates?: boolean;
  include_stale?: boolean;
  include_needs_review?: boolean;
  include_detached?: boolean;
  top_k?: number;
  max_chars_total?: number;
};

export type ReportRecallUsageInput = {
  trace_id: string;
  used_memory_ids?: string[];
  ignored_memory_ids?: string[];
  used_chunk_ids?: string[];
  note?: string | null;
};

export type LinkMemoryInput = {
  src_kind: string;
  src_id: string;
  dst_kind: string;
  dst_id: string;
  relation_type: string;
  weight?: number;
  metadata?: JsonObject;
};

export type ArchiveInput = {
  chunk_id: string;
  action: "archive" | "unarchive";
};

export type ContextPackInput = {
  session_id: string;
  task_hint?: string | null;
  project_id?: string | null;
  max_chars_total?: number;
  include_raw_evidence?: "auto" | "never" | "always";
  include_recovery?: boolean;
  local_spool_status?: JsonObject | null;
};

export type ForgetInput = {
  target: {
    kind: string;
    id?: string | null;
    selector?: JsonObject;
  };
  reason?: string | null;
  dry_run?: boolean;
  confirmation?: {
    confirmed?: boolean;
    confirmation_token?: string | null;
  };
};

export type ProjectSettingInput = {
  project_id?: string | null;
  key: string;
  value: unknown;
  reason?: string | null;
  actor_kind?: "user" | "agent" | "system";
  actor_id?: string | null;
  confirmation?: {
    confirmed?: boolean;
  };
};

export type DetachProjectInput = {
  project_id?: string | null;
  project_path?: string | null;
  mode?: "live" | "sandbox";
  dry_run?: boolean;
  reason?: string | null;
  actor_kind?: "user" | "agent" | "system";
  actor_id?: string | null;
  confirmation?: {
    confirmed?: boolean;
  };
};

export type ProjectSanitizeInput = {
  project_id?: string | null;
  project_path?: string | null;
  mode?: "detach" | "purge";
  detach_mode?: "live" | "sandbox";
  dry_run?: boolean;
  reason?: string | null;
  actor_kind?: "user" | "agent" | "system";
  actor_id?: string | null;
  request_source?: "ui" | "cli" | "chat" | "mcp" | "system";
  confirmation?: {
    confirmed?: boolean;
    confirmation_token?: string | null;
  };
};

type ProjectManagementTarget = {
  project_id?: string | null;
  project_path?: string | null;
};

type ProjectManagementResolutionReason =
  | "project_id"
  | "project_path"
  | "project_path_fallback"
  | "not_found";

type ManagedProjectRow = {
  project_id: string;
  developer_id: string;
  name: string;
  primary_path: string | null;
  project_kind: string;
  memory_domain: string;
  updated_at: string;
};

type ProjectTargetResolution = {
  requested_project_id: string | null;
  requested_project_path: string | null;
  resolved_project_id: string | null;
  resolved_by: ProjectManagementResolutionReason;
  stale_project_id?: string | null;
};

type ProjectContext = {
  developerId: string;
  projectId: string;
};

type SourceFilter = {
  source_id: string;
  label: string | null;
  uri: string | null;
  source_kind: string | null;
  match_values: string[];
};

export type ProjectSourceKind =
  | "workspace_path"
  | "repo"
  | "server_path"
  | "document_collection"
  | "connector"
  | "manual"
  | "virtual"
  | "other";

export type ProjectSourceStatus = "active" | "detached" | "archived" | "needs_review";

export type ProjectSourceInput = {
  project_id: string;
  source_kind: ProjectSourceKind;
  label: string;
  uri?: string | null;
  is_primary?: boolean;
  status?: ProjectSourceStatus;
  metadata?: JsonObject | null;
};

type CaptureProfile = "light" | "standard" | "detailed" | "custom";

type CapturePolicy = {
  profile: CaptureProfile;
  source: string;
  turnTextMaxChars: number;
  workflowTextMaxChars: number;
};

type EmbeddingRoute = {
  routeClass: "local_model" | "paid_api_provider";
  provider: string;
  model: string;
  dims: number;
  source: string;
  routingReason: string;
};

type ProjectLifecycle = {
  status: "active" | "detached" | "sandbox_cleaned";
  visibility: "active" | "hidden";
  searchable: boolean;
  detached_at?: string;
  detach_mode?: "live" | "sandbox";
  reason?: string | null;
};

const capturePolicies: Record<CaptureProfile, Omit<CapturePolicy, "profile" | "source">> = {
  light: {
    turnTextMaxChars: 1_000,
    workflowTextMaxChars: 500
  },
  standard: {
    turnTextMaxChars: 12_000,
    workflowTextMaxChars: 2_000
  },
  detailed: {
    turnTextMaxChars: 50_000,
    workflowTextMaxChars: 8_000
  },
  custom: {
    turnTextMaxChars: 12_000,
    workflowTextMaxChars: 2_000
  }
};

function isCaptureProfile(value: unknown): value is CaptureProfile {
  return value === "light" || value === "standard" || value === "detailed" || value === "custom";
}

function readCaptureProfile(value: unknown) {
  if (isCaptureProfile(value)) return value;
  if (value && typeof value === "object" && "profile" in value) {
    const profile = (value as { profile?: unknown }).profile;
    if (isCaptureProfile(profile)) return profile;
  }
  return null;
}

function buildCapturePolicy(profile: CaptureProfile, source: string): CapturePolicy {
  return { profile, source, ...capturePolicies[profile] };
}

function readNumberSetting(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "minutes" in value) {
    const minutes = (value as { minutes?: unknown }).minutes;
    if (typeof minutes === "number" && Number.isFinite(minutes)) return minutes;
  }
  return null;
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedPositiveIntEnv(name: string, fallback: number, max: number) {
  return Math.min(readPositiveIntEnv(name, fallback), max);
}

function readPositiveFloatEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readFloatEnvInRange(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function assertMaxChars(kind: string, text: string | null | undefined, maxChars: number) {
  const length = text?.length ?? 0;
  if (length > maxChars) {
    throw new Error(
      `VALIDATION_ERROR: ${kind} exceeds configured limit (${length} > ${maxChars} chars)`
    );
  }
}

function readObjectSetting(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readProjectLifecycle(value: unknown): ProjectLifecycle {
  const object = readObjectSetting(value);
  const status =
    object?.status === "detached" || object?.status === "sandbox_cleaned"
      ? object.status
      : "active";
  return {
    status,
    visibility: object?.visibility === "hidden" || status !== "active" ? "hidden" : "active",
    searchable: object?.searchable === false ? false : status === "active",
    detached_at: typeof object?.detached_at === "string" ? object.detached_at : undefined,
    detach_mode:
      object?.detach_mode === "live" || object?.detach_mode === "sandbox"
        ? object.detach_mode
        : undefined,
    reason: typeof object?.reason === "string" ? object.reason : null
  };
}

function projectLifecycleIsDetached(lifecycle: ProjectLifecycle) {
  return (
    lifecycle.status === "detached" ||
    lifecycle.status === "sandbox_cleaned" ||
    lifecycle.visibility === "hidden" ||
    lifecycle.searchable === false
  );
}

function projectSanitizeConfirmationToken(
  mode: "detach" | "purge",
  project: { project_id: string }
) {
  return `recallant-${mode}-project-${project.project_id}`;
}

function countValue(counts: Record<string, unknown>, key: string) {
  const value = counts[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sumCounts(counts: Record<string, unknown>, keys: readonly string[]) {
  return keys.reduce((sum, key) => sum + countValue(counts, key), 0);
}

function redactSecretValues(content: string) {
  return content
    .split("\n")
    .map((line) => {
      if (
        /^\s*[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|DSN|DATABASE_URL)[A-Z0-9_]*\s*=.+/i.test(
          line
        )
      ) {
        return line.replace(/=.*/, "=<redacted>");
      }
      return line
        .replaceAll(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted-token>")
        .replaceAll(/gh[pousr]_[A-Za-z0-9_]{8,}/g, "<redacted-token>")
        .replaceAll(/xox[baprs]-[A-Za-z0-9-]{8,}/g, "<redacted-token>")
        .replaceAll(/:\/\/([^:\s/@]+):([^@\s]+)@/g, "://<redacted>:<redacted>@");
    })
    .join("\n");
}

function vectorLiteral(values: readonly number[]) {
  return `[${values.map((value) => value.toFixed(6)).join(",")}]`;
}

function deterministicEmbedding(text: string, dims: number) {
  const values = Array.from({ length: dims }, () => 0);
  const tokens = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [text.toLowerCase()];
  for (const token of tokens) {
    const normalizedToken =
      {
        connectivity: "network",
        delay: "latency",
        fruit: "banana",
        outage: "network",
        slow: "latency",
        slowness: "latency"
      }[token] ?? token;
    const hash = createHash("sha256").update(normalizedToken).digest();
    const index = hash.readUInt32BE(0) % dims;
    const sign = hash.readUInt32BE(4) % 2 === 0 ? 1 : -1;
    values[index] = (values[index] ?? 0) + sign;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function ollamaUrl(path: string) {
  const base = process.env.RECALLANT_OLLAMA_URL ?? "http://localhost:11434";
  return new URL(path, base.endsWith("/") ? base : `${base}/`);
}

type OllamaEmbeddingAttemptFailure = {
  attempt: number;
  code: string;
  retryable: boolean;
  message: string;
};

type OllamaEmbeddingFetchResult = {
  embedding: number[];
  attempts: number;
  failures: OllamaEmbeddingAttemptFailure[];
  latencyMs: number;
};

class OllamaEmbeddingRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "OllamaEmbeddingRequestError";
    this.code = code;
    this.retryable = retryable;
  }
}

class OllamaEmbeddingUnavailableError extends Error {
  readonly code = "UNAVAILABLE";
  readonly attempts: number;
  readonly failures: OllamaEmbeddingAttemptFailure[];

  constructor(message: string, attempts: number, failures: OllamaEmbeddingAttemptFailure[]) {
    super(message);
    this.name = "OllamaEmbeddingUnavailableError";
    this.attempts = attempts;
    this.failures = failures;
  }
}

function parseEmbedding(payload: unknown, dims: number) {
  const object = readObjectSetting(payload);
  const embedding = object?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Ollama response did not include an embedding array");
  }
  const values = embedding.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Ollama embedding contained non-numeric values");
  }
  if (values.length !== dims) {
    throw new Error(`Ollama embedding dimensions mismatch (${values.length} != ${dims})`);
  }
  return values;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOllamaStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function normalizeOllamaEmbeddingError(error: unknown) {
  if (error instanceof OllamaEmbeddingRequestError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new OllamaEmbeddingRequestError("Ollama embedding request timed out", "TIMEOUT", true);
  }
  return new OllamaEmbeddingRequestError(errorMessage(error), "UNAVAILABLE", true);
}

async function fetchOllamaEmbeddingOnce(route: EmbeddingRoute, text: string) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    readBoundedPositiveIntEnv("RECALLANT_OLLAMA_EMBED_TIMEOUT_MS", 30_000, 120_000)
  );
  try {
    const response = await fetch(ollamaUrl("/api/embeddings"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: route.model, prompt: text }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok) {
      throw new OllamaEmbeddingRequestError(
        `Ollama embedding request failed with HTTP ${response.status}`,
        `HTTP_${response.status}`,
        isRetryableOllamaStatus(response.status)
      );
    }
    try {
      return parseEmbedding(payload, route.dims);
    } catch (error) {
      throw new OllamaEmbeddingRequestError(errorMessage(error), "INVALID_RESPONSE", false);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOllamaEmbedding(route: EmbeddingRoute, text: string) {
  const maxAttempts = readBoundedPositiveIntEnv("RECALLANT_OLLAMA_EMBED_MAX_ATTEMPTS", 3, 5);
  const baseDelayMs = readBoundedPositiveIntEnv(
    "RECALLANT_OLLAMA_EMBED_RETRY_DELAY_MS",
    250,
    5_000
  );
  const maxDelayMs = readBoundedPositiveIntEnv(
    "RECALLANT_OLLAMA_EMBED_MAX_RETRY_DELAY_MS",
    1_000,
    10_000
  );
  const startedAt = Date.now();
  const failures: OllamaEmbeddingAttemptFailure[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        embedding: await fetchOllamaEmbeddingOnce(route, text),
        attempts: attempt,
        failures,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      const failure = normalizeOllamaEmbeddingError(error);
      failures.push({
        attempt,
        code: failure.code,
        retryable: failure.retryable,
        message: capText(failure.message, 300) ?? failure.code
      });
      if (!failure.retryable || attempt >= maxAttempts) {
        throw new OllamaEmbeddingUnavailableError(failure.message, attempt, failures);
      }
      const delayMs = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      await sleep(delayMs);
    }
  }

  throw new OllamaEmbeddingUnavailableError(
    "Ollama embedding retry attempts exhausted",
    maxAttempts,
    failures
  );
}

function summarizeOllamaEmbeddingResults(results: readonly OllamaEmbeddingFetchResult[]) {
  const attemptCount = results.reduce((total, result) => total + result.attempts, 0);
  const transientFailures = results.flatMap((result) => result.failures);
  return {
    attempt_count: attemptCount,
    retry_count: Math.max(0, attemptCount - results.length),
    max_latency_ms: results.reduce((max, result) => Math.max(max, result.latencyMs), 0),
    transient_failures: transientFailures
  };
}

function summarizeOllamaEmbeddingFailure(error: unknown, textCount: number) {
  if (error instanceof OllamaEmbeddingUnavailableError) {
    return {
      message: error.message,
      attempt_count: error.attempts,
      retry_count: Math.max(0, error.attempts - 1),
      retry_exhausted: error.failures.some((failure) => failure.retryable),
      transient_failures: error.failures
    };
  }
  return {
    message: errorMessage(error),
    attempt_count: 1,
    retry_count: 0,
    retry_exhausted: false,
    transient_failures: [
      {
        attempt: 1,
        code: "UNAVAILABLE",
        retryable: false,
        message: capText(errorMessage(error), 300) ?? "UNAVAILABLE"
      }
    ],
    text_count: textCount
  };
}

function capText(text: string | null | undefined, maxChars: number) {
  if (text === null || text === undefined) return null;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function truncationMetadata(text: string | null | undefined, captured: string | null) {
  if (text === null || text === undefined || captured === null) {
    return { original_chars: text?.length ?? 0, captured_chars: 0, truncated: false };
  }
  return {
    original_chars: text.length,
    captured_chars: captured.length,
    truncated: captured.length < text.length
  };
}

function hasInstructionSignal(value: string) {
  return (
    /\b(always|never|default|from now on|every project|all projects|instruction|rule)\b/i.test(
      value
    ) || /(всех проектах|для всех проектов|везде|правило|всегда|никогда|по умолчанию)/i.test(value)
  );
}

function hasHighRiskSignal(value: string) {
  return (
    /\b(secret|security|deploy|public|paid api|cost|delete|destructive|provider|model)\b/i.test(
      value
    ) ||
    /(секрет|безопасност|деплой|публич|платн|стоимост|удал|разруш|провайдер|модель)/i.test(value)
  );
}

function importMemoryType(resultClasses: readonly string[]) {
  if (resultClasses.includes("secret_reference_names_only")) return "secret_reference";
  if (resultClasses.includes("handoff_checkpoint")) return "checkpoint_seed";
  if (resultClasses.includes("repo_contract") || resultClasses.includes("startup_instruction")) {
    return "repo_contract";
  }
  if (
    resultClasses.includes("environment_fact") ||
    resultClasses.includes("capability_binding") ||
    resultClasses.includes("connector_account_binding")
  ) {
    return "environment_fact";
  }
  return "import_candidate";
}

function importMemoryBody(input: ImportSourceInput, resultClasses: readonly string[]) {
  const riskSummary = input.risks?.length
    ? input.risks.map((risk) => `${risk.code}:${risk.severity}`).join(", ")
    : "none";
  const secretSummary = input.secret_references?.length
    ? ` Secret references: ${input.secret_references
        .map((ref) => String(ref.name ?? "unknown"))
        .join(", ")}. Values are redacted.`
    : "";
  return [
    `Imported source ${input.source_path} as ${resultClasses.join(", ")}.`,
    `Risk: ${input.risk ?? "low"} (${riskSummary}).`,
    secretSummary,
    "This imported record is reviewable evidence and must not become instruction_grade without explicit review promotion."
  ]
    .filter(Boolean)
    .join(" ");
}

function isDangerousSetting(key: string, value: unknown) {
  if (
    [
      "paid_api_mode",
      "subscription_worker",
      "model_router_profile",
      "embedding_route",
      "embedding_route_enabled",
      "capture_profile",
      "context_budget_profile"
    ].includes(key)
  ) {
    return true;
  }
  return JSON.stringify(value).includes("auto_with_caps");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function stringArraySetting(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item : null))
        .filter((item): item is string => item !== null)
        .slice(0, maxItems)
    : [];
}

function documentationPostureSection(value: unknown) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const reviewOptions = Array.isArray(record?.review_options)
    ? record.review_options
        .filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null
        )
        .slice(0, 8)
        .map((item) => ({
          option: stringOrNull(item.option) ?? "discuss_first",
          recommended: item.recommended === true,
          reason: stringOrNull(item.reason)
        }))
    : [];
  const canonContext =
    record?.canon_context && typeof record.canon_context === "object"
      ? (record.canon_context as Record<string, unknown>)
      : {};
  const signals = Array.isArray(record?.signals)
    ? record.signals
        .filter(
          (item): item is Record<string, unknown> => typeof item === "object" && item !== null
        )
        .slice(0, 12)
        .map((item) => ({
          code: stringOrNull(item.code) ?? "unknown",
          severity: stringOrNull(item.severity) ?? "info",
          message: stringOrNull(item.message)
        }))
    : [];
  if (!record) {
    return {
      status: "not_recorded",
      profile: "unknown",
      summary: "No documentation posture has been recorded for this project yet.",
      missing_recommended_docs: [],
      review_options: [
        {
          option: "discuss_first",
          recommended: true,
          reason: "Run onboarding or open Workbench review before changing project documentation."
        }
      ],
      authority: {
        source: "project_settings",
        key: "documentation_posture",
        role: "startup_guidance",
        instruction_grade: false,
        notes: [
          "Placeholder only. No project documentation posture setting is stored yet.",
          "This section is guidance, not binding rules."
        ]
      },
      canon_context: {
        needed: false,
        reason: null,
        recommended_reference_kinds: [],
        configured_references: []
      },
      capability_hints: []
    };
  }
  const canonNeeded = canonContext.needed === true;
  return {
    status: stringOrNull(record.status) ?? "unknown",
    profile: stringOrNull(record.profile) ?? "unknown",
    analysis_source: stringOrNull(record.analysis_source) ?? "rules",
    confidence:
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? record.confidence
        : null,
    summary: stringOrNull(record.summary),
    review_needed_reason: stringOrNull(record.review_needed_reason),
    existing_docs: stringArraySetting(record.existing_docs),
    missing_recommended_docs: stringArraySetting(record.missing_recommended_docs),
    review_options: reviewOptions,
    signals,
    authority: {
      source: "project_settings",
      key: "documentation_posture",
      role: "startup_guidance",
      instruction_grade: false,
      notes: [
        "Documentation posture helps agents start with the current docs/canon state.",
        "Imported docs and old handoffs remain evidence unless separately promoted by review.",
        "Raw source text and raw secrets are excluded from this context-pack section."
      ]
    },
    canon_context: {
      needed: canonNeeded,
      reason: stringOrNull(canonContext.reason),
      recommended_reference_kinds: stringArraySetting(canonContext.recommended_reference_kinds),
      configured_references: stringArraySetting(canonContext.configured_references)
    },
    capability_hints: canonNeeded
      ? [
          {
            kind: "owner_server_canon",
            status: "needed",
            guidance:
              "Use configured security, ports, and capability references; do not search for secrets blindly."
          }
        ]
      : []
  };
}

function starterDocsFileList(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === "string") return { path: item };
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const record = item as Record<string, unknown>;
            const path = stringOrNull(record.path);
            if (!path) return null;
            return {
              path,
              kind: stringOrNull(record.kind),
              profile: stringOrNull(record.profile),
              required: record.required === true
            };
          }
          return null;
        })
        .filter((item) => item !== null)
        .slice(0, maxItems)
    : [];
}

function starterDocsSkippedFiles(value: unknown, maxItems = 20) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const record = item as Record<string, unknown>;
            const path = stringOrNull(record.path);
            if (!path) return null;
            return {
              path,
              reason: stringOrNull(record.reason)
            };
          }
          return null;
        })
        .filter((item): item is { path: string; reason: string | null } => item !== null)
        .slice(0, maxItems)
    : [];
}

function starterDocsSection(value: unknown) {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!record) {
    return {
      status: "not_recorded",
      profile: "unknown",
      reason: "No starter-doc plan has been recorded for this project yet.",
      eligible_for_apply: false,
      writes_files: false,
      planned_files: [],
      generated_files: [],
      skipped_files: [],
      outcome: null,
      authority: {
        source: "project_settings",
        key: "starter_docs",
        role: "documentation_bootstrap",
        instruction_grade: false,
        notes: [
          "Placeholder only. No starter-doc plan or outcome is stored yet.",
          "Raw starter document content is excluded from this dashboard section."
        ]
      }
    };
  }
  const outcome =
    record.outcome && typeof record.outcome === "object" && !Array.isArray(record.outcome)
      ? (record.outcome as Record<string, unknown>)
      : null;
  const generatedFiles = stringArraySetting(outcome?.generated_files);
  return {
    status: stringOrNull(record.status) ?? stringOrNull(outcome?.status) ?? "unknown",
    profile: stringOrNull(record.profile) ?? "unknown",
    reason: stringOrNull(record.reason) ?? stringOrNull(outcome?.reason),
    eligible_for_apply: record.eligible_for_apply === true,
    writes_files: false,
    planned_files: starterDocsFileList(record.planned_files),
    generated_files: generatedFiles,
    skipped_files: starterDocsSkippedFiles(record.skipped_files),
    outcome: outcome
      ? {
          status: stringOrNull(outcome.status) ?? "unknown",
          reason: stringOrNull(outcome.reason),
          generated_files: generatedFiles,
          skipped_files: starterDocsSkippedFiles(outcome.skipped_files)
        }
      : null,
    authority: {
      source: "project_settings",
      key: "starter_docs",
      role: "documentation_bootstrap",
      instruction_grade: false,
      notes: [
        "Starter-doc records show the attach bootstrap plan and outcome only.",
        "Raw source text, template content, and secrets are excluded from this section."
      ]
    }
  };
}

function parseIsoOrNow(value: string | null | undefined) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function retrievalDecay(occurredAt: string) {
  if (process.env.RECALLANT_DECAY_ENABLED === "false") return 1;
  const halflifeDays = readPositiveFloatEnv("RECALLANT_DECAY_HALFLIFE_DAYS", 365);
  const minDecay = readFloatEnvInRange("RECALLANT_DECAY_MIN", 0.15, 0, 1);
  const ageMs = Math.max(0, Date.now() - new Date(occurredAt).getTime());
  const ageDays = ageMs / 86_400_000;
  return Math.max(minDecay, 0.5 ** (ageDays / halflifeDays));
}

function broadStartupQueryWarning(query: string) {
  const normalized = query
    .toLowerCase()
    .replace(/[^a-z0-9а-яё\s_-]+/gi, " ")
    .trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const broadTerms = new Set([
    "all",
    "everything",
    "project",
    "context",
    "memory",
    "memories",
    "history",
    "logs",
    "все",
    "проект",
    "контекст",
    "память",
    "история"
  ]);
  if (tokens.length === 0) return null;
  if (tokens.length <= 2 && tokens.every((token) => broadTerms.has(token))) {
    return `Broad startup query "${query}" was rejected. Start with memory_get_context_pack, then use a specific evidence query if more detail is needed.`;
  }
  return null;
}

function chunkText(text: string, maxChars = 4_000) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }
  return chunks.length > 0 ? chunks : [""];
}

const remoteConnectHashVersion = "sha256-v1" as const;
const remoteConnectPrefixBytes = 8;
const remoteConnectSecretBytes = 24;
const remoteTrustedDeviceHashVersion = "sha256-v1" as const;
const remoteTrustedDeviceDefaultExpiresMs = 90 * 24 * 60 * 60 * 1000;
const remoteConnectBootstrapTokenHashVersion = "sha256-v1" as const;
const remoteConnectBootstrapPrefixBytes = 8;
const remoteConnectBootstrapSecretBytes = 24;

function generateRemoteConnectSecret(kind: "conn" | "poll") {
  const prefix = randomBytes(remoteConnectPrefixBytes).toString("hex");
  const secret = randomBytes(remoteConnectSecretBytes).toString("base64url");
  return ["rcl", kind, prefix, secret].join("_");
}

function extractRemoteConnectPrefix(secret: string, kind: "conn" | "poll") {
  const parts = secret.split("_");
  return parts.length >= 4 && parts[0] === "rcl" && parts[1] === kind && parts[3] ? parts[2] : null;
}

function hashRemoteConnectSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function constantTimeRemoteConnectHashEquals(expected: string, actual: string) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function defaultRemoteConnectExpiry() {
  return new Date(Date.now() + 10 * 60_000);
}

function remoteConnectRequestStatus(row: RemoteConnectRequestRow): RemoteConnectRequestStatus {
  if (row.status === "pending" || row.status === "approved") {
    if (row.expires_at.getTime() <= Date.now()) return "expired";
  }
  return row.status;
}

function defaultRemoteTrustedDeviceExpiry() {
  return new Date(Date.now() + remoteTrustedDeviceDefaultExpiresMs);
}

function hashRemoteTrustedDevicePublicKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hashRemoteTrustedDeviceChallengeNonce(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function remoteTrustedDeviceStatus(row: RemoteTrustedDeviceRow): RemoteTrustedDeviceStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && row.expires_at.getTime() <= Date.now()) return "expired";
  return "active";
}

function summarizeRemoteTrustedDevice(row: RemoteTrustedDeviceRow): RemoteTrustedDeviceSummary {
  const summary = { ...row } as RemoteTrustedDeviceSummary & {
    device_public_key_hash?: string;
  };
  delete summary.device_public_key_hash;
  summary.status = remoteTrustedDeviceStatus(row);
  return summary;
}

function generateRemoteConnectBootstrapToken() {
  const prefix = randomBytes(remoteConnectBootstrapPrefixBytes).toString("hex");
  const secret = randomBytes(remoteConnectBootstrapSecretBytes).toString("base64url");
  return `rcl_boot_${prefix}_${secret}`;
}

function extractRemoteConnectBootstrapPrefix(token: string) {
  const parts = token.split("_");
  return parts.length >= 4 && parts[0] === "rcl" && parts[1] === "boot" && parts[3]
    ? parts[2]
    : null;
}

function hashRemoteConnectBootstrapToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function constantTimeRemoteConnectBootstrapHashEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function defaultRemoteConnectBootstrapTokenExpiry() {
  return new Date(Date.now() + 15 * 60_000);
}

function remoteConnectBootstrapTokenStatus(
  row: RemoteConnectBootstrapTokenRow
): RemoteConnectBootstrapTokenStatus {
  if (row.revoked_at) return "revoked";
  if (row.redeemed_at) return "redeemed";
  if (row.expires_at.getTime() <= Date.now()) return "expired";
  return "active";
}

function summarizeRemoteConnectBootstrapToken(
  row: RemoteConnectBootstrapTokenRow
): RemoteConnectBootstrapTokenSummary {
  const summary = { ...row } as RemoteConnectBootstrapTokenSummary & { token_hash?: string };
  delete summary.token_hash;
  summary.status = remoteConnectBootstrapTokenStatus(row);
  return summary;
}

function summarizeRemoteConnectRequest(row: RemoteConnectRequestRow): RemoteConnectRequestSummary {
  const summary = { ...row } as RemoteConnectRequestSummary & {
    device_code_hash?: string;
    poll_token_hash?: string;
    trusted_device_public_key_hash?: string;
  };
  delete summary.device_code_hash;
  delete summary.poll_token_hash;
  delete summary.trusted_device_public_key_hash;
  summary.status = remoteConnectRequestStatus(row);
  return summary;
}

async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export class RecallantDb {
  private readonly pool: Pool;
  private readonly fallbackDeveloperId = randomUUID();
  private projectContext?: ProjectContext;

  constructor(private readonly config: RecallantDbConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async close() {
    await this.pool.end();
  }

  async ensureSystemActivitySchema() {
    await ensureSystemActivitySchema(this.pool);
  }

  async ensureRemoteOnboardingInviteSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS remote_onboarding_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
        token_prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        hash_version TEXT NOT NULL DEFAULT 'sha256-v1',
        target TEXT NOT NULL DEFAULT 'codex',
        label TEXT,
        created_by TEXT NOT NULL DEFAULT 'cli',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        redeemed_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        redeemed_client_id TEXT,
        redeemed_credential_id UUID REFERENCES remote_mcp_credentials(id) ON DELETE SET NULL,
        CHECK (token_prefix <> ''),
        CHECK (token_hash <> ''),
        CHECK (hash_version <> ''),
        CHECK (target IN ('codex', 'cursor', 'claude_code', 'generic'))
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_onboarding_invites_prefix_active
        ON remote_onboarding_invites (token_prefix, token_hash)
        WHERE redeemed_at IS NULL AND revoked_at IS NULL
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_onboarding_invites_scope
        ON remote_onboarding_invites (project_id, developer_id, created_at DESC)
    `);
  }

  async ensureRemoteConnectRequestSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS remote_connect_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_code_prefix TEXT NOT NULL,
        device_code_hash TEXT NOT NULL,
        poll_token_prefix TEXT NOT NULL,
        poll_token_hash TEXT NOT NULL,
        hash_version TEXT NOT NULL DEFAULT 'sha256-v1',
        status TEXT NOT NULL DEFAULT 'pending',
        target TEXT NOT NULL DEFAULT 'codex',
        project_display_name TEXT,
        project_fingerprint TEXT,
        project_path_hint_redacted TEXT,
        repo_remote_hash TEXT,
        requested_by_ip_hash TEXT,
        trusted_device_key_prefix TEXT,
        trusted_device_public_key_fingerprint TEXT,
        trusted_device_public_key_hash TEXT,
        trusted_device_public_key_algorithm TEXT,
        trusted_device_name TEXT,
        created_by TEXT NOT NULL DEFAULT 'remote-connect',
        approved_by TEXT,
        approved_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        developer_id UUID REFERENCES developers(id) ON DELETE SET NULL,
        client_id TEXT,
        credential_id UUID REFERENCES remote_mcp_credentials(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        approved_at TIMESTAMPTZ,
        denied_at TIMESTAMPTZ,
        redeemed_at TIMESTAMPTZ,
        CHECK (device_code_prefix <> ''),
        CHECK (device_code_hash <> ''),
        CHECK (poll_token_prefix <> ''),
        CHECK (poll_token_hash <> ''),
        CHECK (hash_version <> ''),
        CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'redeemed')),
        CHECK (target IN ('codex', 'cursor', 'claude_code', 'generic'))
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_connect_requests_device_active
        ON remote_connect_requests (device_code_prefix, device_code_hash)
        WHERE status IN ('pending', 'approved')
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_connect_requests_poll_active
        ON remote_connect_requests (poll_token_prefix, poll_token_hash)
        WHERE status IN ('pending', 'approved')
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_connect_requests_status_time
        ON remote_connect_requests (status, created_at DESC)
    `);
    await this.pool.query(`
      ALTER TABLE remote_connect_requests
        ADD COLUMN IF NOT EXISTS repo_remote_hash TEXT,
        ADD COLUMN IF NOT EXISTS requested_by_ip_hash TEXT,
        ADD COLUMN IF NOT EXISTS trusted_device_key_prefix TEXT,
        ADD COLUMN IF NOT EXISTS trusted_device_public_key_fingerprint TEXT,
        ADD COLUMN IF NOT EXISTS trusted_device_public_key_hash TEXT,
        ADD COLUMN IF NOT EXISTS trusted_device_public_key_algorithm TEXT,
        ADD COLUMN IF NOT EXISTS trusted_device_name TEXT,
        ADD COLUMN IF NOT EXISTS approved_by TEXT,
        ADD COLUMN IF NOT EXISTS approved_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS developer_id UUID REFERENCES developers(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS client_id TEXT,
        ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES remote_mcp_credentials(id) ON DELETE SET NULL
    `);
  }

  async ensureRemoteTrustedDeviceSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS remote_trusted_devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
        device_key_prefix TEXT NOT NULL,
        device_public_key_fingerprint TEXT NOT NULL,
        device_public_key_hash TEXT NOT NULL,
        hash_version TEXT NOT NULL DEFAULT 'sha256-v1',
        public_key_algorithm TEXT NOT NULL DEFAULT 'unknown',
        device_name TEXT,
        label TEXT,
        created_by TEXT NOT NULL DEFAULT 'remote-connect-approval',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        CHECK (device_key_prefix <> ''),
        CHECK (device_public_key_fingerprint <> ''),
        CHECK (device_public_key_hash <> ''),
        CHECK (hash_version <> ''),
        CHECK (public_key_algorithm <> '')
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_trusted_devices_prefix_active
        ON remote_trusted_devices (developer_id, device_key_prefix, device_public_key_fingerprint)
        WHERE revoked_at IS NULL
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_trusted_devices_developer_time
        ON remote_trusted_devices (developer_id, created_at DESC)
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS remote_trusted_device_challenges (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        device_id UUID NOT NULL REFERENCES remote_trusted_devices(id) ON DELETE CASCADE,
        challenge_nonce_prefix TEXT NOT NULL,
        challenge_nonce_hash TEXT NOT NULL,
        hash_version TEXT NOT NULL DEFAULT 'sha256-v1',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CHECK (challenge_nonce_prefix <> ''),
        CHECK (challenge_nonce_hash <> ''),
        CHECK (hash_version <> '')
      )
    `);
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_trusted_device_challenges_once
        ON remote_trusted_device_challenges (device_id, challenge_nonce_hash)
    `);
  }

  async ensureRemoteConnectBootstrapTokenSchema() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS remote_connect_bootstrap_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        developer_id UUID NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
        token_prefix TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        hash_version TEXT NOT NULL DEFAULT 'sha256-v1',
        target TEXT NOT NULL DEFAULT 'codex',
        label TEXT,
        allow_project_create BOOLEAN NOT NULL DEFAULT false,
        created_by TEXT NOT NULL DEFAULT 'remote-connect-bootstrap',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        redeemed_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        redeemed_client_id TEXT,
        redeemed_project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
        CHECK (token_prefix <> ''),
        CHECK (token_hash <> ''),
        CHECK (hash_version <> ''),
        CHECK (target IN ('codex', 'cursor', 'claude_code', 'generic'))
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_connect_bootstrap_tokens_prefix_active
        ON remote_connect_bootstrap_tokens (token_prefix, token_hash)
        WHERE redeemed_at IS NULL AND revoked_at IS NULL
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_remote_connect_bootstrap_tokens_scope
        ON remote_connect_bootstrap_tokens (developer_id, project_id, created_at DESC)
    `);
  }

  async startSystemActivity(input: SystemActivityInput): Promise<SystemActivityRecord> {
    await this.ensureSystemActivitySchema();
    const activity = normalizeSystemActivityStart(input);
    const result = await this.pool.query<SystemActivityRecord>(
      `
        INSERT INTO system_activity_events (
          trace_id, parent_trace_id, developer_id, project_id, session_id, surface, operation,
          actor_kind, actor_id, client_kind, client_version, related_ids, redacted_metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `,
      [
        activity.trace_id,
        activity.parent_trace_id,
        activity.developer_id,
        activity.project_id,
        activity.session_id,
        activity.surface,
        activity.operation,
        activity.actor_kind,
        activity.actor_id,
        activity.client_kind,
        activity.client_version,
        JSON.stringify(activity.related_ids),
        JSON.stringify(activity.redacted_metadata)
      ]
    );
    return result.rows[0] as SystemActivityRecord;
  }

  async finishSystemActivity(input: FinishSystemActivityInput) {
    await this.ensureSystemActivitySchema();
    const activity = normalizeSystemActivityFinish(input);
    const result = await this.pool.query<SystemActivityRecord>(
      `
        UPDATE system_activity_events
        SET status = $2,
            finished_at = now(),
            duration_ms = greatest(0, floor(extract(epoch FROM (now() - started_at)) * 1000)::int),
            error_code = $3,
            error_message = $4,
            related_ids = related_ids || $5::jsonb,
            redacted_metadata = redacted_metadata || $6::jsonb,
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [
        activity.id,
        activity.status,
        activity.error_code ?? null,
        activity.error_message,
        JSON.stringify(activity.related_ids),
        JSON.stringify(activity.redacted_metadata)
      ]
    );
    return result.rows[0] ?? null;
  }

  async getSystemAuditReport(input: SystemAuditReportInput = {}) {
    await this.ensureSystemActivitySchema();
    let projectId = stringOrNull(input.project_id);
    const projectPath = stringOrNull(input.project_path);
    if (!projectId && projectPath) {
      const project = await this.pool.query<{ id: string }>(
        "SELECT id FROM projects WHERE primary_path = $1 ORDER BY created_at DESC LIMIT 1",
        [projectPath]
      );
      projectId = project.rows[0]?.id ?? null;
    }

    const untilDate = auditDateOrNull(input.until) ?? new Date();
    const sinceDate =
      auditDateOrNull(input.since) ?? new Date(untilDate.getTime() - 24 * 60 * 60 * 1000);
    const limit = boundedAuditLimit(input.limit);
    const slowMs = Math.max(1, Number(input.slow_ms ?? 1000));
    const filters = {
      project_id: projectId,
      project_path: projectPath,
      since: auditIso(sinceDate),
      until: auditIso(untilDate),
      surface: stringOrNull(input.surface),
      status: stringOrNull(input.status),
      limit,
      slow_ms: slowMs,
      default_window_hours: input.since ? null : 24
    };

    const where = ["started_at >= $1::timestamptz", "started_at <= $2::timestamptz"];
    const values: unknown[] = [filters.since, filters.until];
    if (projectId) {
      values.push(projectId);
      where.push(`project_id = $${values.length}`);
    }
    if (filters.surface) {
      values.push(filters.surface);
      where.push(`surface = $${values.length}`);
    }
    if (filters.status) {
      values.push(filters.status);
      where.push(`status = $${values.length}`);
    }
    values.push(limit);
    const limitPlaceholder = `$${values.length}`;
    const activityResult = await this.pool.query<
      SystemActivityRecord & {
        activity_id: string;
      }
    >(
      `
        SELECT id AS activity_id, trace_id, parent_trace_id, developer_id, project_id, session_id,
               surface, operation, actor_kind, actor_id, client_kind, client_version, status,
               duration_ms, error_code, error_message, related_ids, redacted_metadata,
               started_at, finished_at, created_at, updated_at
        FROM system_activity_events
        WHERE ${where.join(" AND ")}
        ORDER BY started_at DESC
        LIMIT ${limitPlaceholder}
      `,
      values
    );
    const rows = activityResult.rows;
    const timeline = rows.map((row) => ({
      activity_id: row.activity_id,
      trace_id: row.trace_id,
      parent_trace_id: row.parent_trace_id,
      project_id: row.project_id,
      session_id: row.session_id,
      surface: row.surface,
      operation: row.operation,
      status: row.status,
      duration_ms: row.duration_ms,
      error_code: row.error_code,
      started_at: row.started_at,
      finished_at: row.finished_at,
      route_template:
        typeof row.redacted_metadata?.route_template === "string"
          ? row.redacted_metadata.route_template
          : null,
      related_ids: row.related_ids,
      links: {
        activity_id: row.activity_id,
        trace_id: row.trace_id,
        project_id: row.project_id,
        session_id: row.session_id
      }
    }));
    const failures = timeline
      .filter((row) => row.status === "error" || (row.status === "skipped" && row.error_code))
      .map((row) => ({
        activity_id: row.activity_id,
        trace_id: row.trace_id,
        surface: row.surface,
        operation: row.operation,
        status: row.status,
        error_code: row.error_code,
        started_at: row.started_at,
        links: row.links
      }));
    const slowOperations = timeline
      .filter((row) => typeof row.duration_ms === "number" && row.duration_ms >= slowMs)
      .slice(0, 10);
    const topErrors = Object.entries(auditCountBy(failures, "error_code"))
      .map(([error_code, count]) => ({ error_code, count }))
      .sort(
        (left, right) => right.count - left.count || left.error_code.localeCompare(right.error_code)
      )
      .slice(0, 10);

    const projectWhere = projectId ? "AND project_id = $3" : "";
    const projectValues = projectId
      ? [filters.since, filters.until, projectId]
      : [filters.since, filters.until];
    const capture = await this.pool.query<{
      sessions_started: number;
      active_sessions: number;
      events: number;
      checkpoints: number;
      recall_traces: number;
      pending_embeddings: number;
      failed_embeddings: number;
    }>(
      `
        SELECT
          (SELECT count(*)::int FROM sessions
            WHERE started_at >= $1::timestamptz AND started_at <= $2::timestamptz ${projectWhere}) AS sessions_started,
          (SELECT count(*)::int FROM sessions
            WHERE status = 'active' ${projectId ? "AND project_id = $3" : ""}) AS active_sessions,
          (SELECT count(*)::int FROM events
            WHERE occurred_at >= $1::timestamptz AND occurred_at <= $2::timestamptz ${projectWhere}) AS events,
          (SELECT count(*)::int FROM checkpoints
            WHERE updated_at >= $1::timestamptz AND updated_at <= $2::timestamptz ${projectWhere}) AS checkpoints,
          (SELECT count(*)::int FROM recall_traces
            WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz ${projectWhere}) AS recall_traces,
          (SELECT count(*)::int FROM chunks
            WHERE embed_status = 'pending' ${projectId ? "AND project_id = $3" : ""}) AS pending_embeddings,
          (SELECT count(*)::int FROM chunks
            WHERE embed_status = 'failed' ${projectId ? "AND project_id = $3" : ""}) AS failed_embeddings
      `,
      projectValues
    );
    const modelProvider = await this.pool.query<{
      provider: string;
      model: string;
      status: string;
      calls: number;
      avg_latency_ms: number | null;
      errors: number;
    }>(
      `
        SELECT provider, model, status, count(*)::int AS calls,
               round(avg(latency_ms))::int AS avg_latency_ms,
               count(*) FILTER (WHERE status = 'failed')::int AS errors
        FROM model_calls
        WHERE created_at >= $1::timestamptz
          AND created_at <= $2::timestamptz
          ${projectWhere}
        GROUP BY provider, model, status
        ORDER BY calls DESC, provider ASC, model ASC
        LIMIT 20
      `,
      projectValues
    );
    const modelRows = modelProvider.rows;
    const modelFailures = modelRows.reduce((total, row) => total + Number(row.errors ?? 0), 0);
    const pendingStarted = timeline.filter((row) => row.status === "started").length;
    const recommendations = [];
    if (failures.length > 0) {
      recommendations.push(
        auditRecommendation(
          "warning",
          "Review failed or skipped operations before claiming the system is healthy.",
          {
            failure_count: failures.length,
            top_errors: topErrors
          }
        )
      );
    }
    if (pendingStarted > 0) {
      recommendations.push(
        auditRecommendation(
          "warning",
          "Some activity rows are still open; check for crashed or long-running operations.",
          {
            started_count: pendingStarted
          }
        )
      );
    }
    if (Number(capture.rows[0]?.pending_embeddings ?? 0) > 0) {
      recommendations.push(
        auditRecommendation(
          "warning",
          "Pending embeddings are present; verify local model recovery.",
          {
            pending_embeddings: capture.rows[0]?.pending_embeddings ?? 0
          }
        )
      );
    }
    if (modelFailures > 0) {
      recommendations.push(
        auditRecommendation(
          "warning",
          "Model provider failures were recorded in the selected window.",
          {
            failed_model_calls: modelFailures
          }
        )
      );
    }
    if (rows.length === 0) {
      recommendations.push(
        auditRecommendation("info", "No system activity rows matched these filters.", filters)
      );
    }
    if (recommendations.length === 0) {
      recommendations.push(
        auditRecommendation("ok", "No urgent audit issues were detected in this window.", {
          checked_rows: rows.length
        })
      );
    }

    return {
      schema_version: 1,
      generated_at: new Date().toISOString(),
      filters,
      summary: {
        total: rows.length,
        by_status: auditCountBy(rows, "status"),
        by_surface: auditCountBy(rows, "surface"),
        by_operation: auditCountBy(rows, "operation"),
        failures: failures.length,
        slow_operations: slowOperations.length,
        pending_started: pendingStarted,
        window_truncated: rows.length >= limit
      },
      timeline,
      failures,
      slow_operations: slowOperations,
      top_errors: topErrors,
      model_provider: {
        total_calls: modelRows.reduce((total, row) => total + Number(row.calls ?? 0), 0),
        failed_calls: modelFailures,
        by_provider_model: modelRows
      },
      capture: capture.rows[0] ?? {
        sessions_started: 0,
        active_sessions: 0,
        events: 0,
        checkpoints: 0,
        recall_traces: 0,
        pending_embeddings: 0,
        failed_embeddings: 0
      },
      recommendations
    };
  }

  private async upsertProjectSource(
    client: PoolClient,
    input: ProjectSourceInput,
    options: { failSoftIfMissing?: boolean } = {}
  ) {
    const secretFindings = rawSecretLikeFindings(
      {
        label: input.label,
        uri: input.uri,
        metadata: input.metadata ?? {}
      },
      "project_source"
    );
    if (secretFindings.length > 0) {
      throw new Error(
        `VALIDATION_ERROR: project source records must not store raw secrets (${secretFindings.join(", ")})`
      );
    }
    try {
      if (input.is_primary) {
        await client.query(
          `
            UPDATE project_sources
            SET is_primary = false, updated_at = now()
            WHERE project_id = $1
              AND status = 'active'
              AND is_primary = true
              AND NOT (source_kind = $2 AND uri IS NOT DISTINCT FROM $3)
          `,
          [input.project_id, input.source_kind, input.uri ?? null]
        );
      }
      const updated = await client.query(
        `
          UPDATE project_sources
          SET label = $4,
              is_primary = $5,
              status = $6,
              metadata = $7,
              updated_at = now()
          WHERE project_id = $1
            AND source_kind = $2
            AND uri IS NOT DISTINCT FROM $3
          RETURNING id, project_id, source_kind, label, uri, is_primary, status, metadata, created_at, updated_at
        `,
        [
          input.project_id,
          input.source_kind,
          input.uri ?? null,
          input.label,
          input.is_primary === true,
          input.status ?? "active",
          JSON.stringify(input.metadata ?? {})
        ]
      );
      if (updated.rows[0]) return updated.rows[0];
      const inserted = await client.query(
        `
          INSERT INTO project_sources (
            project_id, source_kind, label, uri, is_primary, status, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING id, project_id, source_kind, label, uri, is_primary, status, metadata, created_at, updated_at
        `,
        [
          input.project_id,
          input.source_kind,
          input.label,
          input.uri ?? null,
          input.is_primary === true,
          input.status ?? "active",
          JSON.stringify(input.metadata ?? {})
        ]
      );
      return inserted.rows[0] ?? null;
    } catch (error) {
      if (options.failSoftIfMissing && (error as { code?: string }).code === "42P01") return null;
      throw error;
    }
  }

  private async upsertPrimaryWorkspaceSource(
    client: PoolClient,
    input: { projectId: string; projectPath: string | null; label: string; source: string }
  ) {
    if (!input.projectPath) return null;
    return this.upsertProjectSource(
      client,
      {
        project_id: input.projectId,
        source_kind: "workspace_path",
        label: input.label,
        uri: input.projectPath,
        is_primary: true,
        status: "active",
        metadata: {
          compatibility_primary_path: true,
          created_by: input.source
        }
      },
      { failSoftIfMissing: true }
    );
  }

  async ensureProject(projectPath?: string | null): Promise<ProjectContext> {
    const developerId = this.config.developerId ?? this.fallbackDeveloperId;
    const primaryPath =
      projectPath ?? this.config.projectPath ?? (this.config.projectId ? null : process.cwd());
    const usesConfiguredProjectBinding =
      !projectPath || (Boolean(this.config.projectPath) && primaryPath === this.config.projectPath);
    if (
      this.projectContext &&
      this.projectContext.developerId === developerId &&
      (usesConfiguredProjectBinding || primaryPath === this.config.projectPath)
    ) {
      return this.projectContext;
    }
    return withTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO developers (id, name)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET updated_at = now()
        `,
        [developerId, "Recallant Developer"]
      );

      let projectId = usesConfiguredProjectBinding ? this.config.projectId : undefined;
      const projectName = primaryPath?.split("/").filter(Boolean).at(-1) ?? "recallant-project";
      if (!projectId) {
        const existing = await client.query<{ id: string }>(
          `
            SELECT p.id
            FROM projects p
            WHERE p.developer_id = $1
              AND p.primary_path IS NOT DISTINCT FROM $2
            ORDER BY (
              (SELECT count(*) FROM sessions s WHERE s.project_id = p.id) +
              (SELECT count(*) FROM events e WHERE e.project_id = p.id) +
              (SELECT count(*) FROM agent_memories m WHERE m.project_id = p.id)
            ) DESC,
            p.updated_at DESC
            LIMIT 1
          `,
          [developerId, primaryPath]
        );
        projectId = existing.rows[0]?.id ?? randomUUID();
      }
      await client.query(
        `
          INSERT INTO projects (id, developer_id, name, primary_path)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET primary_path = coalesce(EXCLUDED.primary_path, projects.primary_path),
              updated_at = now()
        `,
        [projectId, developerId, projectName, primaryPath]
      );
      await this.ensureDefaultModelSettings(client);
      await this.upsertPrimaryWorkspaceSource(client, {
        projectId,
        projectPath: primaryPath,
        label: projectName,
        source: "ensureProject"
      });

      const context = { developerId, projectId };
      if (usesConfiguredProjectBinding) {
        this.projectContext = context;
      }
      return context;
    });
  }

  async projectPrimaryPath(projectId: string | null | undefined) {
    if (!projectId) return null;
    const result = await this.pool.query<{ primary_path: string | null }>(
      "SELECT primary_path FROM projects WHERE id = $1",
      [projectId]
    );
    return result.rows[0]?.primary_path ?? null;
  }

  async registerProject(input: {
    projectId: string;
    developerId?: string;
    projectPath: string;
    name?: string;
    captureProfile?: CaptureProfile;
  }) {
    const developerId = input.developerId ?? this.config.developerId ?? this.fallbackDeveloperId;
    const projectName =
      input.name ?? input.projectPath.split("/").filter(Boolean).at(-1) ?? "recallant-project";
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO developers (id, name)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET updated_at = now()
        `,
        [developerId, "Recallant Developer"]
      );
      await client.query(
        `
          INSERT INTO projects (id, developer_id, name, primary_path)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              primary_path = EXCLUDED.primary_path,
              updated_at = now()
        `,
        [input.projectId, developerId, projectName, input.projectPath]
      );
      await this.upsertPrimaryWorkspaceSource(client, {
        projectId: input.projectId,
        projectPath: input.projectPath,
        label: projectName,
        source: "registerProject"
      });
      await this.ensureDefaultModelSettings(client);
      await client.query(
        `
          INSERT INTO project_settings (project_id, key, value, reason, updated_by)
          VALUES ($1, 'project_lifecycle', $2, 'recallant project registration', 'recallant-cli')
          ON CONFLICT (project_id, key) DO UPDATE
          SET value = EXCLUDED.value, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()
        `,
        [
          input.projectId,
          JSON.stringify({
            status: "active",
            visibility: "active",
            searchable: true,
            reactivated_at: new Date().toISOString()
          })
        ]
      );
      await client.query(
        `
          INSERT INTO project_settings (project_id, key, value, reason, updated_by)
          VALUES ($1, 'capture_profile', $2, 'recallant init', 'recallant-cli')
          ON CONFLICT (project_id, key) DO UPDATE
          SET value = EXCLUDED.value, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()
        `,
        [input.projectId, JSON.stringify(input.captureProfile ?? "standard")]
      );
      await client.query(
        `
          INSERT INTO settings_audit_events (
            scope_kind, scope_id, key, old_value, new_value, actor_kind, actor_id, reason
          )
          VALUES ('project', $1, 'capture_profile', NULL, $2, 'system', 'recallant-cli', 'recallant init')
        `,
        [input.projectId, JSON.stringify(input.captureProfile ?? "standard")]
      );
      await client.query(
        `
          INSERT INTO settings_audit_events (
            scope_kind, scope_id, key, old_value, new_value, actor_kind, actor_id, reason
          )
          VALUES ('project', $1, 'project_lifecycle', NULL, $2, 'system', 'recallant-cli', 'recallant project registration')
        `,
        [
          input.projectId,
          JSON.stringify({
            status: "active",
            visibility: "active",
            searchable: true
          })
        ]
      );
    });
    return { developerId, projectId: input.projectId };
  }

  async createMemorySpace(input: {
    name: string;
    developerId?: string;
    projectKind?: "repo" | "subproject" | "workspace" | "personal_domain" | "other";
    memoryDomain?: string;
    primaryPath?: string | null;
  }) {
    const developerId = input.developerId ?? this.config.developerId ?? this.fallbackDeveloperId;
    const projectId = randomUUID();
    const projectKind = input.projectKind ?? (input.primaryPath ? "repo" : "other");
    const memoryDomain = input.memoryDomain ?? "agent_work";
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO developers (id, name)
          VALUES ($1, $2)
          ON CONFLICT (id) DO UPDATE SET updated_at = now()
        `,
        [developerId, "Recallant Developer"]
      );
      await client.query(
        `
          INSERT INTO projects (id, developer_id, name, primary_path, project_kind, memory_domain)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [projectId, developerId, input.name, input.primaryPath ?? null, projectKind, memoryDomain]
      );
      await this.ensureDefaultModelSettings(client);
      if (input.primaryPath) {
        await this.upsertPrimaryWorkspaceSource(client, {
          projectId,
          projectPath: input.primaryPath,
          label: input.name,
          source: "createMemorySpace"
        });
      }
    });
    return {
      project_id: projectId,
      developer_id: developerId,
      name: input.name,
      project_kind: projectKind,
      memory_domain: memoryDomain,
      primary_path: input.primaryPath ?? null,
      memory_profile: memorySpaceProfile({
        project_kind: projectKind,
        memory_domain: memoryDomain,
        primary_path: input.primaryPath ?? null
      })
    };
  }

  async attachProjectSource(input: ProjectSourceInput) {
    const source = await withTransaction(this.pool, async (client) =>
      this.upsertProjectSource(client, input)
    );
    return source ? this.enrichProjectSource(source) : null;
  }

  async listProjectSources(projectId: string) {
    const result = await this.pool.query(
      `
        SELECT id, project_id, source_kind, label, uri, is_primary, status, metadata,
               created_at, updated_at
        FROM project_sources
        WHERE project_id = $1
        ORDER BY is_primary DESC, status, source_kind, label
      `,
      [projectId]
    );
    return result.rows.map((row) => this.enrichProjectSource(row));
  }

  async detachProjectSource(input: { source_id: string; reason?: string | null }) {
    const result = await this.pool.query(
      `
        UPDATE project_sources
        SET status = 'detached',
            is_primary = false,
            metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb,
            updated_at = now()
        WHERE id = $1
        RETURNING id, project_id, source_kind, label, uri, is_primary, status, metadata,
                  created_at, updated_at
      `,
      [
        input.source_id,
        JSON.stringify({
          detached_at: new Date().toISOString(),
          detach_reason: input.reason ?? "recallant source detach"
        })
      ]
    );
    return result.rows[0] ? this.enrichProjectSource(result.rows[0]) : null;
  }

  private enrichProjectSource<T extends Record<string, unknown>>(source: T) {
    const status = String(source.status ?? "active");
    const sourceKind = String(source.source_kind ?? "other");
    const label = typeof source.label === "string" ? source.label : "";
    const uri = typeof source.uri === "string" ? source.uri : "";
    const metadata =
      source.metadata && typeof source.metadata === "object"
        ? (source.metadata as Record<string, unknown>)
        : {};
    const isPrimary = source.is_primary === true;
    const hasCapabilityBinding = Boolean(
      metadata.capability_binding_id ||
      ["ready", "active", "configured"].includes(
        String(metadata.capability_binding_status ?? "").toLowerCase()
      )
    );
    const consentPolicy = sourceKind === "connector" ? connectorConsentPolicy(metadata) : null;
    const capabilityBindingStatus = hasCapabilityBinding
      ? "ready"
      : ["connector", "server_path"].includes(sourceKind) ||
          (sourceKind === "repo" && /^(?:[a-z][a-z0-9+.-]*:|https?:\/\/)/i.test(uri))
        ? "needed"
        : "not_required";
    const isRemoteReference =
      /^(?:[a-z][a-z0-9+.-]*:|[A-Za-z0-9_.-]+:\/|[A-Za-z0-9_.-]+:~?\/)/.test(uri) ||
      /^https?:\/\//i.test(uri);
    const locationRequired = [
      "workspace_path",
      "repo",
      "server_path",
      "document_collection",
      "connector"
    ].includes(sourceKind);
    let healthStatus = "ready";
    let healthLabel = isPrimary ? "Primary source ready" : "Source ready";
    let healthReason = "Recallant can show this source as provenance for source-linked memories.";
    let actionNeeded = "No action needed.";

    if (status === "detached") {
      healthStatus = "detached";
      healthLabel = "Detached from active use";
      healthReason =
        "This source binding is kept for audit/history, but it is not active for new work.";
      actionNeeded = "Attach a new source or reattach this one if it should be used again.";
    } else if (status !== "active") {
      healthStatus = "needs_attention";
      healthLabel = `${status.replaceAll("_", " ")} source`;
      healthReason = "This source is not in normal active state.";
      actionNeeded = "Review the source state before relying on it.";
    } else if (sourceKind === "connector") {
      if (hasCapabilityBinding) {
        if (consentPolicy?.capture_allowed === true) {
          healthLabel = "Connector reference ready";
          healthReason =
            "Owner consent and governed capability metadata are recorded for this connector. Raw secrets stay outside Recallant memory.";
          actionNeeded = "Use governed recall/import flows when connector data is needed.";
        } else {
          healthStatus = "needs_setup";
          healthLabel = "Connector consent needed";
          healthReason =
            "A governed capability reference is recorded, but connector capture is inactive until owner consent and review policy allow it.";
          actionNeeded = "Record explicit consent before treating this connector as capture-ready.";
        }
      } else {
        healthStatus = "needs_setup";
        healthLabel = "Connector source needs setup";
        healthReason =
          "The connector reference is recorded, but connector capture/authorization is not active in this slice. Raw secrets must stay outside Recallant memory.";
        actionNeeded =
          "Keep it as a planned source until connector capability binding is implemented through governed confirmation.";
      }
    } else if (locationRequired && !uri) {
      healthStatus = "needs_setup";
      healthLabel = "Location missing";
      healthReason =
        "This source type normally needs a folder, repository, connector, or document reference.";
      actionNeeded = "Add a location/reference or convert it to a manual/virtual source.";
    } else if (["workspace_path", "repo", "server_path"].includes(sourceKind) && isAbsolute(uri)) {
      if (!existsSync(uri)) {
        healthStatus = "needs_attention";
        healthLabel = "Local path not found";
        healthReason =
          "Recallant can keep this source as provenance, but the recorded local path is not reachable right now.";
        actionNeeded = "Check the path, mount, or source binding before relying on this source.";
      } else {
        let stats: ReturnType<typeof statSync> | null = null;
        try {
          stats = statSync(uri);
        } catch {
          healthStatus = "needs_attention";
          healthLabel = "Local path not readable";
          healthReason =
            "The recorded local path exists, but Recallant cannot read its filesystem status.";
          actionNeeded = "Check permissions or attach a source path Recallant can inspect.";
        }
        const expectsDirectory = ["workspace_path", "repo"].includes(sourceKind);
        if (stats && expectsDirectory && !stats.isDirectory()) {
          healthStatus = "needs_attention";
          healthLabel = "Path is not a folder";
          healthReason =
            "This source is expected to point at a folder or repository, but the recorded path is not a directory.";
          actionNeeded = "Attach the correct folder or change the source kind.";
        } else if (stats) {
          healthLabel = isPrimary ? "Primary local source ready" : "Local source ready";
          healthReason =
            "The recorded local path exists and Recallant can use it as source provenance.";
        }
      }
    } else if (sourceKind === "server_path" && uri) {
      if (hasCapabilityBinding) {
        healthLabel = "Server source reference ready";
        healthReason =
          "Recallant has a governed server/source binding reference. Health does not probe remote paths or secrets.";
        actionNeeded = "Use governed access/import workflows when this server source is needed.";
      } else {
        healthStatus = "needs_setup";
        healthLabel = "Server source needs access binding";
        healthReason =
          "The server path is recorded as provenance, but Recallant will not probe remote/server paths without a governed capability binding.";
        actionNeeded =
          "Attach a governed capability binding or a reachable local/server path before relying on live access.";
      }
    } else if (sourceKind === "repo" && uri && isRemoteReference) {
      healthStatus = "needs_setup";
      healthLabel = "Repository source needs sync or import";
      healthReason =
        "The remote repository reference is recorded, but Recallant has not verified a local checkout or governed import/sync path.";
      actionNeeded = "Attach a local repo path or run a governed repository import/sync workflow.";
    } else if (sourceKind === "document_collection" && uri) {
      healthLabel = "Document source reference ready";
      healthReason =
        "The document collection reference can be shown as provenance. Connector-backed capture still requires separate governed setup.";
    }

    return {
      ...source,
      display_label: label || uri || "Unnamed source",
      source_kind_label: this.projectSourceKindLabel(sourceKind),
      source_access_contract: {
        access_kind:
          sourceKind === "connector"
            ? "connector"
            : isRemoteReference
              ? "remote_reference"
              : ["manual", "virtual", "other"].includes(sourceKind)
                ? "owner_supplied_reference"
                : "local_or_static_reference",
        capability_binding_status: capabilityBindingStatus,
        capture_readiness:
          sourceKind === "connector" && consentPolicy?.capture_allowed !== true
            ? "consent_or_capability_needed"
            : healthStatus === "ready" && capabilityBindingStatus !== "needed"
              ? "ready_or_reference_only"
              : "governed_setup_needed",
        health_check_policy:
          sourceKind === "connector"
            ? "Connector endpoints are not contacted by source health checks."
            : isRemoteReference
              ? "Remote paths and repositories are not probed without governed access."
              : "Local/static references may be checked when they are safe to inspect.",
        secrets_policy: "Raw secrets stay outside Recallant memory.",
        connector_consent_policy: consentPolicy
      },
      source_health: {
        status: healthStatus,
        label: healthLabel,
        reason: healthReason,
        action_needed: actionNeeded
      }
    };
  }

  private projectSourceKindLabel(sourceKind: string) {
    const labels: Record<string, string> = {
      workspace_path: "Workspace folder",
      repo: "Repository",
      server_path: "Server path",
      document_collection: "Document collection",
      connector: "Connector",
      manual: "Manual source",
      virtual: "Virtual source",
      other: "Source"
    };
    return labels[sourceKind] ?? "Source";
  }

  private async sourceFilter(input?: string | null) {
    if (!input) return null;
    const result = await this.pool.query(
      `
        SELECT id, label, uri, source_kind, metadata
        FROM project_sources
        WHERE id = $1
      `,
      [input]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const values = new Set<string>([String(row.id)]);
    for (const value of [row.label, row.uri]) {
      if (typeof value !== "string" || value.trim().length === 0) continue;
      values.add(value);
      const basename = value.split(/[\\/]/).filter(Boolean).pop();
      if (basename) values.add(basename);
    }
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
    for (const key of ["source_path", "path", "uri", "label"]) {
      const value = (metadata as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim().length > 0) values.add(value);
    }
    return {
      source_id: String(row.id),
      label: typeof row.label === "string" ? row.label : null,
      uri: typeof row.uri === "string" ? row.uri : null,
      source_kind: typeof row.source_kind === "string" ? row.source_kind : null,
      match_values: Array.from(values)
    };
  }

  private addSourceFilterClause(
    clauses: string[],
    values: unknown[],
    sourceFilter: SourceFilter | null,
    memoryAlias = "m"
  ) {
    if (!sourceFilter) return;
    values.push(sourceFilter.source_id);
    const sourceIdParam = values.length;
    values.push(sourceFilter.match_values);
    const valuesParam = values.length;
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM agent_memory_source_refs source_filter_refs
        WHERE source_filter_refs.memory_id = ${memoryAlias}.id
          AND (
            source_filter_refs.source_id = $${sourceIdParam}
            OR source_filter_refs.source_id = ANY($${valuesParam}::text[])
            OR source_filter_refs.metadata->>'project_source_id' = $${sourceIdParam}
            OR source_filter_refs.metadata->>'source_id' = $${sourceIdParam}
            OR source_filter_refs.metadata->>'source_path' = ANY($${valuesParam}::text[])
            OR source_filter_refs.metadata->>'path' = ANY($${valuesParam}::text[])
          )
      )
    `);
  }

  private addSourceEvidenceFilterClause(input: {
    clauses: string[];
    values: unknown[];
    sourceFilter: SourceFilter | null;
    chunkAlias?: string;
    eventAlias?: string;
    paramOffset?: number;
  }) {
    if (!input.sourceFilter) return;
    const chunkAlias = input.chunkAlias ?? "c";
    const eventAlias = input.eventAlias ?? "ev";
    const paramOffset = input.paramOffset ?? 0;
    input.values.push(input.sourceFilter.source_id);
    const sourceIdParam = paramOffset + input.values.length;
    input.values.push(input.sourceFilter.match_values);
    const valuesParam = paramOffset + input.values.length;
    input.clauses.push(`
      (
        ${eventAlias}.payload->'source_ref'->>'project_source_id' = $${sourceIdParam}
        OR ${eventAlias}.payload->'source_ref'->>'source_id' = $${sourceIdParam}
        OR ${eventAlias}.payload->'metadata'->>'project_source_id' = $${sourceIdParam}
        OR ${eventAlias}.payload->'metadata'->>'source_id' = $${sourceIdParam}
        OR ${eventAlias}.payload->'source_ref'->>'path' = ANY($${valuesParam}::text[])
        OR ${eventAlias}.payload->'source_ref'->>'uri' = ANY($${valuesParam}::text[])
        OR ${eventAlias}.payload->'metadata'->>'source_path' = ANY($${valuesParam}::text[])
        OR ${eventAlias}.payload->'metadata'->>'path' = ANY($${valuesParam}::text[])
        OR EXISTS (
          SELECT 1
          FROM raw_artifacts source_filter_artifacts
          WHERE source_filter_artifacts.source_event_id = ${chunkAlias}.source_event_id
            AND (
              source_filter_artifacts.uri = ANY($${valuesParam}::text[])
              OR source_filter_artifacts.metadata->>'project_source_id' = $${sourceIdParam}
              OR source_filter_artifacts.metadata->>'source_id' = $${sourceIdParam}
              OR source_filter_artifacts.metadata->>'source_path' = ANY($${valuesParam}::text[])
              OR source_filter_artifacts.metadata->>'path' = ANY($${valuesParam}::text[])
            )
        )
        OR EXISTS (
          SELECT 1
          FROM agent_memory_source_refs source_filter_memory_refs
          JOIN agent_memories source_filter_memories
            ON source_filter_memories.id = source_filter_memory_refs.memory_id
          WHERE source_filter_memories.project_id = ${chunkAlias}.project_id
            AND source_filter_memories.use_policy <> 'do_not_use'
            AND (
              source_filter_memory_refs.source_id IN (
                ${chunkAlias}.id::text,
                ${chunkAlias}.source_event_id::text
              )
              AND (
                source_filter_memory_refs.metadata->>'project_source_id' = $${sourceIdParam}
                OR source_filter_memory_refs.metadata->>'source_id' = $${sourceIdParam}
                OR source_filter_memory_refs.metadata->>'source_path' = ANY($${valuesParam}::text[])
                OR source_filter_memory_refs.metadata->>'path' = ANY($${valuesParam}::text[])
              )
            )
        )
      )
    `);
  }

  async listMemorySpaces() {
    const context = await this.ensureProject();
    const result = await this.pool.query(
      `
        SELECT
          p.id AS project_id,
          p.name,
          p.primary_path,
          p.project_kind,
          p.memory_domain,
          p.updated_at,
          coalesce(
            jsonb_agg(
              jsonb_build_object(
                'source_id', ps.id,
                'source_kind', ps.source_kind,
                'label', ps.label,
                'uri', ps.uri,
                'is_primary', ps.is_primary,
                'status', ps.status,
                'metadata', ps.metadata,
                'updated_at', ps.updated_at
              )
              ORDER BY ps.is_primary DESC, ps.status, ps.source_kind, ps.label
            ) FILTER (WHERE ps.id IS NOT NULL),
            '[]'::jsonb
          ) AS sources
        FROM projects p
        LEFT JOIN project_sources ps ON ps.project_id = p.id
        WHERE p.developer_id = $1
        GROUP BY p.id
        ORDER BY p.updated_at DESC
      `,
      [context.developerId]
    );
    return result.rows.map((row) => ({
      ...row,
      memory_profile: memorySpaceProfile(row),
      sources: Array.isArray(row.sources)
        ? row.sources.map((source: unknown) =>
            this.enrichProjectSource(source as Record<string, unknown>)
          )
        : []
    }));
  }

  async getProjectBinding(projectId: string) {
    const result = await this.pool.query<{
      project_id: string;
      developer_id: string;
      name: string;
      primary_path: string | null;
    }>(
      `
        SELECT id AS project_id, developer_id, name, primary_path
        FROM projects
        WHERE id = $1
        LIMIT 1
      `,
      [projectId]
    );
    return result.rows[0] ?? null;
  }

  private async assertRemoteMcpCredentialScope(projectId: string, developerId: string) {
    const binding = await this.getProjectBinding(projectId);
    if (!binding) throw new Error("VALIDATION_ERROR: remote MCP project scope was not found");
    if (binding.developer_id !== developerId) {
      throw new Error("VALIDATION_ERROR: remote MCP developer scope does not match project");
    }
    return binding;
  }

  private async recordRemoteMcpCredentialAudit(input: {
    operation: string;
    status: "success" | "skipped" | "error";
    projectId?: string | null;
    developerId?: string | null;
    clientId?: string | null;
    credentialId?: string | null;
    credentialPrefix?: string | null;
    actorId?: string | null;
    errorCode?: string | null;
    metadata?: JsonObject | null;
  }) {
    try {
      const activity = await this.startSystemActivity({
        developer_id: input.developerId ?? null,
        project_id: input.projectId ?? null,
        surface: "remote_mcp_credentials",
        operation: `remote_mcp_credential.${input.operation}`,
        actor_kind: input.actorId ? "user" : "system",
        actor_id: input.actorId ?? "remote_mcp_credentials",
        client_kind: "remote_mcp_admin",
        related_ids: {
          credential_id: input.credentialId ?? null,
          credential_prefix: input.credentialPrefix ?? null,
          client_id: input.clientId ?? null
        },
        metadata: {
          audit_policy: "remote_mcp_credential_redacted_no_raw_secret_no_hash",
          ...input.metadata
        }
      });
      await this.finishSystemActivity({
        id: activity.id,
        status: input.status,
        error_code: input.errorCode ?? null,
        error_message: input.errorCode ?? null,
        metadata: {
          operation: `remote_mcp_credential.${input.operation}`,
          credential_id: input.credentialId ?? null,
          credential_prefix: input.credentialPrefix ?? null,
          client_id: input.clientId ?? null
        }
      });
    } catch {
      // Credential lifecycle should not fail because audit storage is unavailable.
    }
  }

  private async recordRemoteOnboardingInviteAudit(input: {
    operation: string;
    status: "success" | "skipped" | "error";
    projectId?: string | null;
    developerId?: string | null;
    inviteId?: string | null;
    tokenPrefix?: string | null;
    clientId?: string | null;
    credentialId?: string | null;
    actorId?: string | null;
    errorCode?: string | null;
    metadata?: JsonObject | null;
  }) {
    try {
      const activity = await this.startSystemActivity({
        developer_id: input.developerId ?? null,
        project_id: input.projectId ?? null,
        surface: "remote_onboarding_invites",
        operation: `remote_onboarding_invite.${input.operation}`,
        actor_kind: input.actorId ? "user" : "system",
        actor_id: input.actorId ?? "remote_onboarding_invites",
        client_kind: "remote_onboarding_invite",
        related_ids: {
          invite_id: input.inviteId ?? null,
          token_prefix: input.tokenPrefix ?? null,
          credential_id: input.credentialId ?? null,
          client_id: input.clientId ?? null
        },
        metadata: {
          audit_policy: "remote_onboarding_invite_redacted_no_raw_token",
          ...input.metadata
        }
      });
      await this.finishSystemActivity({
        id: activity.id,
        status: input.status,
        error_code: input.errorCode ?? null,
        error_message: input.errorCode ?? null,
        metadata: {
          operation: `remote_onboarding_invite.${input.operation}`,
          invite_id: input.inviteId ?? null,
          token_prefix: input.tokenPrefix ?? null,
          credential_id: input.credentialId ?? null,
          client_id: input.clientId ?? null
        }
      });
    } catch {
      // Invite lifecycle should not fail because audit storage is unavailable.
    }
  }

  private async recordRemoteConnectRequestAudit(input: {
    operation: string;
    status: "success" | "skipped" | "error";
    requestId?: string | null;
    projectId?: string | null;
    developerId?: string | null;
    deviceCodePrefix?: string | null;
    pollTokenPrefix?: string | null;
    credentialId?: string | null;
    clientId?: string | null;
    actorId?: string | null;
    errorCode?: string | null;
    metadata?: JsonObject | null;
  }) {
    try {
      const activity = await this.startSystemActivity({
        developer_id: input.developerId ?? null,
        project_id: input.projectId ?? null,
        surface: "remote_connect_requests",
        operation: `remote_connect_request.${input.operation}`,
        actor_kind: input.actorId ? "user" : "system",
        actor_id: input.actorId ?? "remote_connect_requests",
        client_kind: "remote_connect",
        related_ids: {
          request_id: input.requestId ?? null,
          device_code_prefix: input.deviceCodePrefix ?? null,
          poll_token_prefix: input.pollTokenPrefix ?? null,
          credential_id: input.credentialId ?? null,
          client_id: input.clientId ?? null
        },
        metadata: {
          audit_policy: "remote_connect_redacted_no_raw_device_secret_no_raw_credential",
          ...input.metadata
        }
      });
      await this.finishSystemActivity({
        id: activity.id,
        status: input.status,
        error_code: input.errorCode ?? null,
        error_message: input.errorCode ?? null,
        metadata: {
          operation: `remote_connect_request.${input.operation}`,
          request_id: input.requestId ?? null,
          device_code_prefix: input.deviceCodePrefix ?? null,
          poll_token_prefix: input.pollTokenPrefix ?? null,
          credential_id: input.credentialId ?? null,
          client_id: input.clientId ?? null
        }
      });
    } catch {
      // Remote connect lifecycle should not fail because audit storage is unavailable.
    }
  }

  private async recordRemoteTrustedDeviceAudit(input: {
    operation: string;
    status: "success" | "skipped" | "error";
    developerId?: string | null;
    deviceId?: string | null;
    deviceKeyPrefix?: string | null;
    publicKeyFingerprint?: string | null;
    actorId?: string | null;
    errorCode?: string | null;
    metadata?: JsonObject | null;
  }) {
    try {
      const activity = await this.startSystemActivity({
        developer_id: input.developerId ?? null,
        project_id: null,
        surface: "remote_trusted_devices",
        operation: `remote_trusted_device.${input.operation}`,
        actor_kind: input.actorId ? "user" : "system",
        actor_id: input.actorId ?? "remote_trusted_devices",
        client_kind: "remote_connect",
        related_ids: {
          device_id: input.deviceId ?? null,
          device_key_prefix: input.deviceKeyPrefix ?? null,
          public_key_fingerprint: input.publicKeyFingerprint ?? null
        },
        metadata: {
          audit_policy: "remote_trusted_device_redacted_no_private_key_no_raw_secret",
          ...input.metadata
        }
      });
      await this.finishSystemActivity({
        id: activity.id,
        status: input.status,
        error_code: input.errorCode ?? null,
        error_message: input.errorCode ?? null,
        metadata: {
          operation: `remote_trusted_device.${input.operation}`,
          device_id: input.deviceId ?? null,
          device_key_prefix: input.deviceKeyPrefix ?? null,
          public_key_fingerprint: input.publicKeyFingerprint ?? null
        }
      });
    } catch {
      // Trusted-device lifecycle should not fail because audit storage is unavailable.
    }
  }

  private async recordRemoteConnectBootstrapTokenAudit(input: {
    operation: string;
    status: "success" | "skipped" | "error";
    projectId?: string | null;
    developerId?: string | null;
    tokenId?: string | null;
    tokenPrefix?: string | null;
    clientId?: string | null;
    actorId?: string | null;
    errorCode?: string | null;
    metadata?: JsonObject | null;
  }) {
    try {
      const activity = await this.startSystemActivity({
        developer_id: input.developerId ?? null,
        project_id: input.projectId ?? null,
        surface: "remote_connect_bootstrap_tokens",
        operation: `remote_connect_bootstrap_token.${input.operation}`,
        actor_kind: input.actorId ? "user" : "system",
        actor_id: input.actorId ?? "remote_connect_bootstrap_tokens",
        client_kind: "remote_connect",
        related_ids: {
          token_id: input.tokenId ?? null,
          token_prefix: input.tokenPrefix ?? null,
          client_id: input.clientId ?? null
        },
        metadata: {
          audit_policy: "remote_connect_bootstrap_redacted_no_raw_token_no_hash",
          ...input.metadata
        }
      });
      await this.finishSystemActivity({
        id: activity.id,
        status: input.status,
        error_code: input.errorCode ?? null,
        error_message: input.errorCode ?? null,
        metadata: {
          operation: `remote_connect_bootstrap_token.${input.operation}`,
          token_id: input.tokenId ?? null,
          token_prefix: input.tokenPrefix ?? null,
          client_id: input.clientId ?? null
        }
      });
    } catch {
      // Bootstrap-token lifecycle should not fail because audit storage is unavailable.
    }
  }

  async createRemoteOnboardingInvite(
    input: CreateRemoteOnboardingInviteInput
  ): Promise<CreateRemoteOnboardingInviteResult> {
    await this.ensureRemoteOnboardingInviteSchema();
    const projectId = normalizeRemoteMcpCredentialString(input.projectId);
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    if (!projectId || !developerId) {
      throw new Error("VALIDATION_ERROR: projectId and developerId are required");
    }
    await this.assertRemoteMcpCredentialScope(projectId, developerId);

    const token = generateRemoteOnboardingInviteToken();
    const tokenPrefix = extractRemoteOnboardingInvitePrefix(token);
    if (!tokenPrefix) throw new Error("Failed to generate remote onboarding invite token prefix");
    const expiresAt =
      normalizeRemoteMcpCredentialDate(input.expiresAt) ?? defaultRemoteOnboardingInviteExpiry();
    const target = normalizeRemoteOnboardingTarget(input.target);
    const createdBy = normalizeRemoteMcpCredentialString(input.createdBy) ?? "cli";
    const result = await this.pool.query<RemoteOnboardingInviteRow>(
      `
        INSERT INTO remote_onboarding_invites (
          project_id, developer_id, token_prefix, token_hash, hash_version, target, label,
          created_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        projectId,
        developerId,
        tokenPrefix,
        hashRemoteOnboardingInviteToken(token),
        remoteOnboardingInviteHashVersion,
        target,
        normalizeRemoteMcpCredentialString(input.label),
        createdBy,
        expiresAt
      ]
    );
    const invite = summarizeRemoteOnboardingInvite(result.rows[0] as RemoteOnboardingInviteRow);
    await this.recordRemoteOnboardingInviteAudit({
      operation: "create",
      status: "success",
      projectId,
      developerId,
      inviteId: invite.id,
      tokenPrefix: invite.token_prefix,
      actorId: createdBy,
      metadata: {
        target: invite.target,
        label_present: Boolean(invite.label),
        expires_at: invite.expires_at.toISOString()
      }
    });
    return { token, invite };
  }

  async redeemRemoteOnboardingInvite(
    input: RedeemRemoteOnboardingInviteInput
  ): Promise<RedeemRemoteOnboardingInviteResult> {
    await this.ensureRemoteOnboardingInviteSchema();
    const token = normalizeRemoteMcpCredentialString(input.token);
    if (!token) throw new Error("VALIDATION_ERROR: remote onboarding invite token is required");
    const tokenPrefix = extractRemoteOnboardingInvitePrefix(token);
    const tokenHash = hashRemoteOnboardingInviteToken(token);
    if (!tokenPrefix) {
      await this.recordRemoteOnboardingInviteAudit({
        operation: "redeem",
        status: "skipped",
        errorCode: "invalid_token",
        metadata: { result: "invalid_token" }
      });
      throw new Error("VALIDATION_ERROR: remote onboarding invite token is invalid");
    }
    const redeemedBy = normalizeRemoteMcpCredentialString(input.redeemedBy) ?? "remote-invite";
    const result = await withTransaction(this.pool, async (client) => {
      const candidates = await client.query<RemoteOnboardingInviteRow>(
        `
          SELECT *
          FROM remote_onboarding_invites
          WHERE token_prefix = $1
          ORDER BY created_at DESC
          FOR UPDATE
        `,
        [tokenPrefix]
      );
      const inviteRow = candidates.rows.find(
        (row) =>
          row.hash_version === remoteOnboardingInviteHashVersion &&
          constantTimeRemoteOnboardingHashEquals(row.token_hash, tokenHash)
      );
      if (!inviteRow) throw new Error("VALIDATION_ERROR: remote onboarding invite not found");
      const inviteStatus = remoteOnboardingInviteStatus(inviteRow);
      if (inviteStatus !== "active") {
        throw new Error(`VALIDATION_ERROR: remote onboarding invite is ${inviteStatus}`);
      }

      const clientId =
        normalizeRemoteMcpCredentialString(input.clientId) ?? `remote-${randomUUID()}`;
      const secret = generateRemoteMcpCredentialSecret();
      const credentialPrefix = extractRemoteMcpCredentialPrefix(secret);
      if (!credentialPrefix) throw new Error("Failed to generate remote MCP credential prefix");
      const credential = await client.query<RemoteMcpCredentialRow>(
        `
          INSERT INTO remote_mcp_credentials (
            project_id, developer_id, client_id, label, credential_prefix, credential_hash,
            hash_version, created_by, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        [
          inviteRow.project_id,
          inviteRow.developer_id,
          clientId,
          inviteRow.label ?? "remote invite",
          credentialPrefix,
          hashRemoteMcpCredentialSecret(secret),
          remoteMcpCredentialHashVersion,
          redeemedBy,
          null
        ]
      );
      const updatedInvite = await client.query<RemoteOnboardingInviteRow>(
        `
          UPDATE remote_onboarding_invites
          SET redeemed_at = now(),
              redeemed_client_id = $2,
              redeemed_credential_id = $3,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [inviteRow.id, clientId, credential.rows[0]?.id]
      );
      return {
        invite: summarizeRemoteOnboardingInvite(updatedInvite.rows[0] as RemoteOnboardingInviteRow),
        secret,
        credential: summarizeRemoteMcpCredential(credential.rows[0] as RemoteMcpCredentialRow),
        client_id: clientId,
        target: inviteRow.target
      };
    });
    await this.recordRemoteOnboardingInviteAudit({
      operation: "redeem",
      status: "success",
      projectId: result.invite.project_id,
      developerId: result.invite.developer_id,
      inviteId: result.invite.id,
      tokenPrefix: result.invite.token_prefix,
      clientId: result.client_id,
      credentialId: result.credential.id,
      actorId: redeemedBy,
      metadata: {
        target: result.target,
        result: "redeemed"
      }
    });
    await this.recordRemoteMcpCredentialAudit({
      operation: "create",
      status: "success",
      projectId: result.credential.project_id,
      developerId: result.credential.developer_id,
      clientId: result.credential.client_id,
      credentialId: result.credential.id,
      credentialPrefix: result.credential.credential_prefix,
      actorId: redeemedBy,
      metadata: {
        created_from: "remote_onboarding_invite",
        invite_id: result.invite.id,
        label_present: Boolean(result.credential.label),
        expires_at: null
      }
    });
    return result;
  }

  async createRemoteTrustedDevice(
    input: CreateRemoteTrustedDeviceInput
  ): Promise<RemoteTrustedDeviceSummary> {
    await this.ensureRemoteTrustedDeviceSchema();
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    const deviceKeyPrefix = normalizeRemoteMcpCredentialString(input.deviceKeyPrefix);
    const publicKeyFingerprint = normalizeRemoteMcpCredentialString(input.publicKeyFingerprint);
    if (!developerId || !deviceKeyPrefix || !publicKeyFingerprint) {
      throw new Error(
        "VALIDATION_ERROR: developerId, deviceKeyPrefix, and publicKeyFingerprint are required"
      );
    }
    const publicKeyMaterial =
      normalizeRemoteMcpCredentialString(input.publicKeyMaterial) ?? publicKeyFingerprint;
    const publicKeyHash =
      normalizeRemoteMcpCredentialString(input.publicKeyHash) ??
      hashRemoteTrustedDevicePublicKey(publicKeyMaterial);
    const expiresAt =
      normalizeRemoteMcpCredentialDate(input.expiresAt) ?? defaultRemoteTrustedDeviceExpiry();
    const createdBy =
      normalizeRemoteMcpCredentialString(input.createdBy) ?? "remote-connect-approval";
    const result = await this.pool.query<RemoteTrustedDeviceRow>(
      `
        INSERT INTO remote_trusted_devices (
          developer_id, device_key_prefix, device_public_key_fingerprint,
          device_public_key_hash, hash_version, public_key_algorithm, device_name, label,
          created_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        developerId,
        deviceKeyPrefix,
        publicKeyFingerprint,
        publicKeyHash,
        remoteTrustedDeviceHashVersion,
        normalizeRemoteMcpCredentialString(input.publicKeyAlgorithm) ?? "unknown",
        normalizeRemoteMcpCredentialString(input.deviceName),
        normalizeRemoteMcpCredentialString(input.label),
        createdBy,
        expiresAt
      ]
    );
    const device = summarizeRemoteTrustedDevice(result.rows[0] as RemoteTrustedDeviceRow);
    await this.recordRemoteTrustedDeviceAudit({
      operation: "create",
      status: "success",
      developerId,
      deviceId: device.id,
      deviceKeyPrefix: device.device_key_prefix,
      publicKeyFingerprint: device.device_public_key_fingerprint,
      actorId: createdBy,
      metadata: {
        device_name_present: Boolean(device.device_name),
        label_present: Boolean(device.label),
        expires_at: device.expires_at?.toISOString() ?? null
      }
    });
    return device;
  }

  async verifyRemoteTrustedDevice(
    input: VerifyRemoteTrustedDeviceInput
  ): Promise<VerifyRemoteTrustedDeviceResult> {
    await this.ensureRemoteTrustedDeviceSchema();
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    const deviceKeyPrefix = normalizeRemoteMcpCredentialString(input.deviceKeyPrefix);
    const publicKeyFingerprint = normalizeRemoteMcpCredentialString(input.publicKeyFingerprint);
    if (!developerId || !deviceKeyPrefix || !publicKeyFingerprint) {
      await this.recordRemoteTrustedDeviceAudit({
        operation: "verify",
        status: "skipped",
        developerId,
        deviceKeyPrefix,
        publicKeyFingerprint,
        errorCode: "missing_device",
        metadata: { result: "missing_device" }
      });
      return {
        ok: false,
        code: "missing_device",
        message: "Trusted device developer, prefix, and fingerprint are required."
      };
    }
    const publicKeyMaterial =
      normalizeRemoteMcpCredentialString(input.publicKeyMaterial) ?? publicKeyFingerprint;
    const presentedHash = hashRemoteTrustedDevicePublicKey(publicKeyMaterial);
    const candidates = await this.pool.query<RemoteTrustedDeviceRow>(
      `
        SELECT *
        FROM remote_trusted_devices
        WHERE developer_id = $1
          AND device_key_prefix = $2
          AND device_public_key_fingerprint = $3
        ORDER BY created_at DESC
      `,
      [developerId, deviceKeyPrefix, publicKeyFingerprint]
    );
    const matched = candidates.rows.find((row) => {
      if (row.hash_version !== remoteTrustedDeviceHashVersion) return false;
      const expectedBuffer = Buffer.from(row.device_public_key_hash, "hex");
      const actualBuffer = Buffer.from(presentedHash, "hex");
      return (
        expectedBuffer.length === actualBuffer.length &&
        timingSafeEqual(expectedBuffer, actualBuffer)
      );
    });
    if (!matched) {
      await this.recordRemoteTrustedDeviceAudit({
        operation: "verify",
        status: "skipped",
        developerId,
        deviceKeyPrefix,
        publicKeyFingerprint,
        errorCode: "invalid_device",
        metadata: { result: "invalid_device" }
      });
      return {
        ok: false,
        code: "invalid_device",
        message: "Trusted device was not recognized."
      };
    }
    const summary = summarizeRemoteTrustedDevice(matched);
    if (summary.status !== "active") {
      await this.recordRemoteTrustedDeviceAudit({
        operation: "verify",
        status: "skipped",
        developerId,
        deviceId: summary.id,
        deviceKeyPrefix: summary.device_key_prefix,
        publicKeyFingerprint: summary.device_public_key_fingerprint,
        errorCode: summary.status,
        metadata: { result: summary.status }
      });
      return {
        ok: false,
        code: summary.status,
        message: `Trusted device is ${summary.status}.`,
        device: summary
      };
    }
    const updated = await this.pool.query<RemoteTrustedDeviceRow>(
      `
        UPDATE remote_trusted_devices
        SET last_used_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [matched.id]
    );
    const device = summarizeRemoteTrustedDevice(updated.rows[0] as RemoteTrustedDeviceRow);
    await this.recordRemoteTrustedDeviceAudit({
      operation: "verify",
      status: "success",
      developerId,
      deviceId: device.id,
      deviceKeyPrefix: device.device_key_prefix,
      publicKeyFingerprint: device.device_public_key_fingerprint,
      actorId: normalizeRemoteMcpCredentialString(input.verifiedBy) ?? "remote-connect",
      metadata: {
        result: "success",
        challenge_nonce_present: Boolean(normalizeRemoteMcpCredentialString(input.challengeNonce))
      }
    });
    return { ok: true, device };
  }

  async verifyRemoteTrustedDeviceChallenge(
    input: VerifyRemoteTrustedDeviceChallengeInput
  ): Promise<VerifyRemoteTrustedDeviceResult> {
    await this.ensureRemoteTrustedDeviceSchema();
    const deviceKeyPrefix = normalizeRemoteMcpCredentialString(input.deviceKeyPrefix);
    const publicKeyFingerprint = normalizeRemoteMcpCredentialString(input.publicKeyFingerprint);
    const publicKeyMaterial = normalizeRemoteMcpCredentialString(input.publicKeyMaterial);
    const challengeNonce = normalizeRemoteMcpCredentialString(input.challengeNonce);
    if (!deviceKeyPrefix || !publicKeyFingerprint || !publicKeyMaterial || !challengeNonce) {
      await this.recordRemoteTrustedDeviceAudit({
        operation: "verify_challenge",
        status: "skipped",
        deviceKeyPrefix,
        publicKeyFingerprint,
        errorCode: "missing_device",
        metadata: { result: "missing_device" }
      });
      return {
        ok: false,
        code: "missing_device",
        message: "Trusted device prefix, fingerprint, public key, and challenge nonce are required."
      };
    }

    const presentedHash = hashRemoteTrustedDevicePublicKey(publicKeyMaterial);
    const candidates = await this.pool.query<RemoteTrustedDeviceRow>(
      `
        SELECT *
        FROM remote_trusted_devices
        WHERE device_key_prefix = $1
          AND device_public_key_fingerprint = $2
        ORDER BY created_at DESC
      `,
      [deviceKeyPrefix, publicKeyFingerprint]
    );
    const matched = candidates.rows.find((row) => {
      if (row.hash_version !== remoteTrustedDeviceHashVersion) return false;
      const expectedBuffer = Buffer.from(row.device_public_key_hash, "hex");
      const actualBuffer = Buffer.from(presentedHash, "hex");
      return (
        expectedBuffer.length === actualBuffer.length &&
        timingSafeEqual(expectedBuffer, actualBuffer)
      );
    });
    if (!matched) {
      await this.recordRemoteTrustedDeviceAudit({
        operation: "verify_challenge",
        status: "skipped",
        deviceKeyPrefix,
        publicKeyFingerprint,
        errorCode: "invalid_device",
        metadata: { result: "invalid_device" }
      });
      return {
        ok: false,
        code: "invalid_device",
        message: "Trusted device was not recognized."
      };
    }

    const summary = summarizeRemoteTrustedDevice(matched);
    if (summary.status !== "active") {
      await this.recordRemoteTrustedDeviceAudit({
        operation: "verify_challenge",
        status: "skipped",
        developerId: summary.developer_id,
        deviceId: summary.id,
        deviceKeyPrefix: summary.device_key_prefix,
        publicKeyFingerprint: summary.device_public_key_fingerprint,
        errorCode: summary.status,
        metadata: { result: summary.status }
      });
      return {
        ok: false,
        code: summary.status,
        message: `Trusted device is ${summary.status}.`,
        device: summary
      };
    }

    const challengeNonceHash = hashRemoteTrustedDeviceChallengeNonce(challengeNonce);
    const challengeNoncePrefix = challengeNonceHash.slice(0, 24);
    try {
      await this.pool.query(
        `
          INSERT INTO remote_trusted_device_challenges (
            device_id, challenge_nonce_prefix, challenge_nonce_hash, hash_version
          )
          VALUES ($1, $2, $3, $4)
        `,
        [matched.id, challengeNoncePrefix, challengeNonceHash, remoteTrustedDeviceHashVersion]
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "23505"
      ) {
        await this.recordRemoteTrustedDeviceAudit({
          operation: "verify_challenge",
          status: "skipped",
          developerId: summary.developer_id,
          deviceId: summary.id,
          deviceKeyPrefix: summary.device_key_prefix,
          publicKeyFingerprint: summary.device_public_key_fingerprint,
          errorCode: "replayed",
          metadata: { result: "replayed", challenge_nonce_prefix: challengeNoncePrefix }
        });
        return {
          ok: false,
          code: "replayed",
          message: "Trusted device challenge was already used.",
          device: summary
        };
      }
      throw error;
    }

    const updated = await this.pool.query<RemoteTrustedDeviceRow>(
      `
        UPDATE remote_trusted_devices
        SET last_used_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [matched.id]
    );
    const device = summarizeRemoteTrustedDevice(updated.rows[0] as RemoteTrustedDeviceRow);
    await this.recordRemoteTrustedDeviceAudit({
      operation: "verify_challenge",
      status: "success",
      developerId: device.developer_id,
      deviceId: device.id,
      deviceKeyPrefix: device.device_key_prefix,
      publicKeyFingerprint: device.device_public_key_fingerprint,
      actorId: normalizeRemoteMcpCredentialString(input.verifiedBy) ?? "remote-connect",
      metadata: { result: "success", challenge_nonce_prefix: challengeNoncePrefix }
    });
    return { ok: true, device };
  }

  async revokeRemoteTrustedDevice(
    input: RevokeRemoteTrustedDeviceInput
  ): Promise<RemoteTrustedDeviceSummary> {
    await this.ensureRemoteTrustedDeviceSchema();
    const revokedBy =
      normalizeRemoteMcpCredentialString(input.revokedBy) ?? "remote-connect-approval";
    const result = await this.pool.query<RemoteTrustedDeviceRow>(
      `
        UPDATE remote_trusted_devices
        SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [input.deviceId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("VALIDATION_ERROR: trusted device not found");
    const device = summarizeRemoteTrustedDevice(row);
    await this.recordRemoteTrustedDeviceAudit({
      operation: "revoke",
      status: "success",
      developerId: device.developer_id,
      deviceId: device.id,
      deviceKeyPrefix: device.device_key_prefix,
      publicKeyFingerprint: device.device_public_key_fingerprint,
      actorId: revokedBy,
      metadata: { result: "revoked" }
    });
    return device;
  }

  async createRemoteConnectBootstrapToken(
    input: CreateRemoteConnectBootstrapTokenInput
  ): Promise<CreateRemoteConnectBootstrapTokenResult> {
    await this.ensureRemoteConnectBootstrapTokenSchema();
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    if (!developerId) throw new Error("VALIDATION_ERROR: developerId is required");
    const projectId = normalizeRemoteMcpCredentialString(input.projectId);
    if (projectId) await this.assertRemoteMcpCredentialScope(projectId, developerId);
    const token = generateRemoteConnectBootstrapToken();
    const tokenPrefix = extractRemoteConnectBootstrapPrefix(token);
    if (!tokenPrefix) throw new Error("Failed to generate remote connect bootstrap token prefix");
    const expiresAt =
      normalizeRemoteMcpCredentialDate(input.expiresAt) ??
      defaultRemoteConnectBootstrapTokenExpiry();
    const createdBy =
      normalizeRemoteMcpCredentialString(input.createdBy) ?? "remote-connect-bootstrap";
    const result = await this.pool.query<RemoteConnectBootstrapTokenRow>(
      `
        INSERT INTO remote_connect_bootstrap_tokens (
          project_id, developer_id, token_prefix, token_hash, hash_version, target, label,
          allow_project_create, created_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        projectId,
        developerId,
        tokenPrefix,
        hashRemoteConnectBootstrapToken(token),
        remoteConnectBootstrapTokenHashVersion,
        normalizeRemoteOnboardingTarget(input.target),
        normalizeRemoteMcpCredentialString(input.label),
        input.allowProjectCreate === true,
        createdBy,
        expiresAt
      ]
    );
    const bootstrapToken = summarizeRemoteConnectBootstrapToken(
      result.rows[0] as RemoteConnectBootstrapTokenRow
    );
    await this.recordRemoteConnectBootstrapTokenAudit({
      operation: "create",
      status: "success",
      projectId,
      developerId,
      tokenId: bootstrapToken.id,
      tokenPrefix: bootstrapToken.token_prefix,
      actorId: createdBy,
      metadata: {
        target: bootstrapToken.target,
        allow_project_create: bootstrapToken.allow_project_create,
        expires_at: bootstrapToken.expires_at.toISOString()
      }
    });
    return { token, bootstrap_token: bootstrapToken };
  }

  async redeemRemoteConnectBootstrapToken(
    input: RedeemRemoteConnectBootstrapTokenInput
  ): Promise<RedeemRemoteConnectBootstrapTokenResult> {
    await this.ensureRemoteConnectBootstrapTokenSchema();
    const token = normalizeRemoteMcpCredentialString(input.token);
    if (!token) throw new Error("VALIDATION_ERROR: remote connect bootstrap token is required");
    const tokenPrefix = extractRemoteConnectBootstrapPrefix(token);
    const tokenHash = hashRemoteConnectBootstrapToken(token);
    if (!tokenPrefix) {
      await this.recordRemoteConnectBootstrapTokenAudit({
        operation: "redeem",
        status: "skipped",
        errorCode: "invalid_token",
        metadata: { result: "invalid_token" }
      });
      throw new Error("VALIDATION_ERROR: remote connect bootstrap token is invalid");
    }
    const clientId = normalizeRemoteMcpCredentialString(input.clientId) ?? `remote-${randomUUID()}`;
    const redeemedBy =
      normalizeRemoteMcpCredentialString(input.redeemedBy) ?? "remote-connect-bootstrap";
    const result = await withTransaction(this.pool, async (client) => {
      const candidates = await client.query<RemoteConnectBootstrapTokenRow>(
        `
          SELECT *
          FROM remote_connect_bootstrap_tokens
          WHERE token_prefix = $1
          ORDER BY created_at DESC
          FOR UPDATE
        `,
        [tokenPrefix]
      );
      const row = candidates.rows.find(
        (candidate) =>
          candidate.hash_version === remoteConnectBootstrapTokenHashVersion &&
          constantTimeRemoteConnectBootstrapHashEquals(candidate.token_hash, tokenHash)
      );
      if (!row) throw new Error("VALIDATION_ERROR: remote connect bootstrap token not found");
      const status = remoteConnectBootstrapTokenStatus(row);
      if (status !== "active") {
        throw new Error(`VALIDATION_ERROR: remote connect bootstrap token is ${status}`);
      }
      const requestedProjectId = normalizeRemoteMcpCredentialString(input.projectId);
      let redeemedProjectId = row.project_id ?? requestedProjectId;
      if (row.project_id && requestedProjectId && row.project_id !== requestedProjectId) {
        throw new Error("VALIDATION_ERROR: remote connect bootstrap project scope mismatch");
      }
      if (!redeemedProjectId && row.allow_project_create !== true) {
        throw new Error(
          "VALIDATION_ERROR: remote connect bootstrap token requires an existing project scope"
        );
      }
      if (!redeemedProjectId && row.allow_project_create === true) {
        redeemedProjectId = randomUUID();
        await client.query(
          `
            INSERT INTO developers (id, name)
            VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE SET updated_at = now()
          `,
          [row.developer_id, "Recallant Developer"]
        );
        await client.query(
          `
            INSERT INTO projects (id, developer_id, name, primary_path, project_kind, memory_domain)
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            redeemedProjectId,
            row.developer_id,
            normalizeRemoteMcpCredentialString(input.projectName) ?? "remote project",
            null,
            "workspace",
            "agent_work"
          ]
        );
        await this.ensureDefaultModelSettings(client);
      }
      const updated = await client.query<RemoteConnectBootstrapTokenRow>(
        `
          UPDATE remote_connect_bootstrap_tokens
          SET redeemed_at = now(),
              redeemed_client_id = $2,
              redeemed_project_id = $3,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [row.id, clientId, redeemedProjectId]
      );
      const bootstrapToken = summarizeRemoteConnectBootstrapToken(
        updated.rows[0] as RemoteConnectBootstrapTokenRow
      );
      return {
        bootstrap_token: bootstrapToken,
        project_id: redeemedProjectId ?? null,
        developer_id: row.developer_id,
        client_id: clientId,
        target: row.target
      };
    });
    await this.recordRemoteConnectBootstrapTokenAudit({
      operation: "redeem",
      status: "success",
      projectId: result.project_id,
      developerId: result.developer_id,
      tokenId: result.bootstrap_token.id,
      tokenPrefix: result.bootstrap_token.token_prefix,
      clientId,
      actorId: redeemedBy,
      metadata: { result: "redeemed", target: result.target }
    });
    return result;
  }

  async revokeRemoteConnectBootstrapToken(
    input: RevokeRemoteConnectBootstrapTokenInput
  ): Promise<RemoteConnectBootstrapTokenSummary> {
    await this.ensureRemoteConnectBootstrapTokenSchema();
    const revokedBy =
      normalizeRemoteMcpCredentialString(input.revokedBy) ?? "remote-connect-bootstrap";
    const result = await this.pool.query<RemoteConnectBootstrapTokenRow>(
      `
        UPDATE remote_connect_bootstrap_tokens
        SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [input.tokenId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("VALIDATION_ERROR: remote connect bootstrap token not found");
    const bootstrapToken = summarizeRemoteConnectBootstrapToken(row);
    await this.recordRemoteConnectBootstrapTokenAudit({
      operation: "revoke",
      status: "success",
      projectId: bootstrapToken.project_id,
      developerId: bootstrapToken.developer_id,
      tokenId: bootstrapToken.id,
      tokenPrefix: bootstrapToken.token_prefix,
      actorId: revokedBy,
      metadata: { result: "revoked" }
    });
    return bootstrapToken;
  }

  async createRemoteConnectRequest(
    input: CreateRemoteConnectRequestInput = {}
  ): Promise<CreateRemoteConnectRequestResult> {
    await this.ensureRemoteConnectRequestSchema();
    const deviceCode = generateRemoteConnectSecret("conn");
    const pollToken = generateRemoteConnectSecret("poll");
    const deviceCodePrefix = extractRemoteConnectPrefix(deviceCode, "conn");
    const pollTokenPrefix = extractRemoteConnectPrefix(pollToken, "poll");
    if (!deviceCodePrefix || !pollTokenPrefix) {
      throw new Error("Failed to generate remote connect request secrets");
    }
    const expiresAt =
      normalizeRemoteMcpCredentialDate(input.expiresAt) ?? defaultRemoteConnectExpiry();
    const target = normalizeRemoteOnboardingTarget(input.target);
    const createdBy = normalizeRemoteMcpCredentialString(input.createdBy) ?? "remote-connect";
    const trustedDevicePublicKeyMaterial = normalizeRemoteMcpCredentialString(
      input.trustedDevicePublicKeyMaterial
    );
    const trustedDevicePublicKeyHash =
      normalizeRemoteMcpCredentialString(input.trustedDevicePublicKeyHash) ??
      (trustedDevicePublicKeyMaterial
        ? hashRemoteTrustedDevicePublicKey(trustedDevicePublicKeyMaterial)
        : null);
    const result = await this.pool.query<RemoteConnectRequestRow>(
      `
        INSERT INTO remote_connect_requests (
          device_code_prefix, device_code_hash, poll_token_prefix, poll_token_hash, hash_version,
          status, target, project_display_name, project_fingerprint, project_path_hint_redacted,
          repo_remote_hash, requested_by_ip_hash, trusted_device_key_prefix,
          trusted_device_public_key_fingerprint, trusted_device_public_key_hash,
          trusted_device_public_key_algorithm, trusted_device_name, created_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *
      `,
      [
        deviceCodePrefix,
        hashRemoteConnectSecret(deviceCode),
        pollTokenPrefix,
        hashRemoteConnectSecret(pollToken),
        remoteConnectHashVersion,
        target,
        normalizeRemoteMcpCredentialString(input.projectDisplayName),
        normalizeRemoteMcpCredentialString(input.projectFingerprint),
        normalizeRemoteMcpCredentialString(input.projectPathHintRedacted),
        normalizeRemoteMcpCredentialString(input.repoRemoteHash),
        normalizeRemoteMcpCredentialString(input.requestedByIpHash),
        normalizeRemoteMcpCredentialString(input.trustedDeviceKeyPrefix),
        normalizeRemoteMcpCredentialString(input.trustedDevicePublicKeyFingerprint),
        trustedDevicePublicKeyHash,
        normalizeRemoteMcpCredentialString(input.trustedDevicePublicKeyAlgorithm),
        normalizeRemoteMcpCredentialString(input.trustedDeviceName),
        createdBy,
        expiresAt
      ]
    );
    const request = summarizeRemoteConnectRequest(result.rows[0] as RemoteConnectRequestRow);
    await this.recordRemoteConnectRequestAudit({
      operation: "create",
      status: "success",
      requestId: request.id,
      deviceCodePrefix: request.device_code_prefix,
      pollTokenPrefix: request.poll_token_prefix,
      actorId: createdBy,
      metadata: {
        target: request.target,
        project_display_name_present: Boolean(request.project_display_name),
        project_fingerprint_present: Boolean(request.project_fingerprint),
        trusted_device_registration_present: Boolean(request.trusted_device_key_prefix),
        expires_at: request.expires_at.toISOString()
      }
    });
    return { device_code: deviceCode, poll_token: pollToken, request };
  }

  async approveRemoteConnectRequest(
    input: ApproveRemoteConnectRequestInput
  ): Promise<RemoteConnectRequestSummary> {
    await this.ensureRemoteConnectRequestSchema();
    const deviceCode = normalizeRemoteMcpCredentialString(input.deviceCode);
    const projectId = normalizeRemoteMcpCredentialString(input.projectId);
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    if (!deviceCode || !projectId || !developerId) {
      throw new Error("VALIDATION_ERROR: deviceCode, projectId, and developerId are required");
    }
    await this.assertRemoteMcpCredentialScope(projectId, developerId);
    const deviceCodePrefix = extractRemoteConnectPrefix(deviceCode, "conn");
    const deviceCodeHash = hashRemoteConnectSecret(deviceCode);
    if (!deviceCodePrefix)
      throw new Error("VALIDATION_ERROR: remote connect device code is invalid");
    const approvedBy =
      normalizeRemoteMcpCredentialString(input.approvedBy) ?? "remote-connect-approval";
    const result = await withTransaction(this.pool, async (client) => {
      const candidates = await client.query<RemoteConnectRequestRow>(
        `
          SELECT *
          FROM remote_connect_requests
          WHERE device_code_prefix = $1
          ORDER BY created_at DESC
          FOR UPDATE
        `,
        [deviceCodePrefix]
      );
      const row = candidates.rows.find(
        (candidate) =>
          candidate.hash_version === remoteConnectHashVersion &&
          constantTimeRemoteConnectHashEquals(candidate.device_code_hash, deviceCodeHash)
      );
      if (!row) throw new Error("VALIDATION_ERROR: remote connect request not found");
      const status = remoteConnectRequestStatus(row);
      if (status !== "pending") {
        throw new Error(`VALIDATION_ERROR: remote connect request is ${status}`);
      }
      const clientId =
        normalizeRemoteMcpCredentialString(input.clientId) ?? `remote-${randomUUID()}`;
      const updated = await client.query<RemoteConnectRequestRow>(
        `
          UPDATE remote_connect_requests
          SET status = 'approved',
              approved_by = $2,
              approved_project_id = $3,
              developer_id = $4,
              client_id = $5,
              approved_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [row.id, approvedBy, projectId, developerId, clientId]
      );
      return summarizeRemoteConnectRequest(updated.rows[0] as RemoteConnectRequestRow);
    });
    await this.recordRemoteConnectRequestAudit({
      operation: "approve",
      status: "success",
      requestId: result.id,
      projectId,
      developerId,
      deviceCodePrefix: result.device_code_prefix,
      pollTokenPrefix: result.poll_token_prefix,
      clientId: result.client_id,
      actorId: approvedBy,
      metadata: { result: "approved", target: result.target }
    });
    return result;
  }

  async getRemoteConnectRequestForApproval(
    input: GetRemoteConnectRequestForApprovalInput
  ): Promise<RemoteConnectRequestSummary | null> {
    await this.ensureRemoteConnectRequestSchema();
    const deviceCode = normalizeRemoteMcpCredentialString(input.deviceCode);
    if (!deviceCode) throw new Error("VALIDATION_ERROR: remote connect device code is required");
    const deviceCodePrefix = extractRemoteConnectPrefix(deviceCode, "conn");
    const deviceCodeHash = hashRemoteConnectSecret(deviceCode);
    if (!deviceCodePrefix)
      throw new Error("VALIDATION_ERROR: remote connect device code is invalid");
    const candidates = await this.pool.query<RemoteConnectRequestRow>(
      `
        SELECT *
        FROM remote_connect_requests
        WHERE device_code_prefix = $1
        ORDER BY created_at DESC
      `,
      [deviceCodePrefix]
    );
    const row = candidates.rows.find(
      (candidate) =>
        candidate.hash_version === remoteConnectHashVersion &&
        constantTimeRemoteConnectHashEquals(candidate.device_code_hash, deviceCodeHash)
    );
    return row ? summarizeRemoteConnectRequest(row) : null;
  }

  async getRemoteConnectTrustedDeviceRegistrationForApproval(
    input: GetRemoteConnectRequestForApprovalInput
  ): Promise<RemoteConnectTrustedDeviceRegistrationSummary | null> {
    await this.ensureRemoteConnectRequestSchema();
    const deviceCode = normalizeRemoteMcpCredentialString(input.deviceCode);
    if (!deviceCode) throw new Error("VALIDATION_ERROR: remote connect device code is required");
    const deviceCodePrefix = extractRemoteConnectPrefix(deviceCode, "conn");
    const deviceCodeHash = hashRemoteConnectSecret(deviceCode);
    if (!deviceCodePrefix)
      throw new Error("VALIDATION_ERROR: remote connect device code is invalid");
    const candidates = await this.pool.query<RemoteConnectRequestRow>(
      `
        SELECT *
        FROM remote_connect_requests
        WHERE device_code_prefix = $1
        ORDER BY created_at DESC
      `,
      [deviceCodePrefix]
    );
    const row = candidates.rows.find(
      (candidate) =>
        candidate.hash_version === remoteConnectHashVersion &&
        constantTimeRemoteConnectHashEquals(candidate.device_code_hash, deviceCodeHash)
    );
    if (
      !row?.trusted_device_key_prefix ||
      !row.trusted_device_public_key_fingerprint ||
      !row.trusted_device_public_key_hash
    ) {
      return null;
    }
    return {
      device_key_prefix: row.trusted_device_key_prefix,
      public_key_fingerprint: row.trusted_device_public_key_fingerprint,
      public_key_hash: row.trusted_device_public_key_hash,
      public_key_algorithm: row.trusted_device_public_key_algorithm,
      device_name: row.trusted_device_name
    };
  }

  async denyRemoteConnectRequest(
    input: DenyRemoteConnectRequestInput
  ): Promise<RemoteConnectRequestSummary> {
    await this.ensureRemoteConnectRequestSchema();
    const deviceCode = normalizeRemoteMcpCredentialString(input.deviceCode);
    if (!deviceCode) throw new Error("VALIDATION_ERROR: remote connect device code is required");
    const deviceCodePrefix = extractRemoteConnectPrefix(deviceCode, "conn");
    const deviceCodeHash = hashRemoteConnectSecret(deviceCode);
    if (!deviceCodePrefix)
      throw new Error("VALIDATION_ERROR: remote connect device code is invalid");
    const deniedBy =
      normalizeRemoteMcpCredentialString(input.deniedBy) ?? "remote-connect-approval";
    const result = await withTransaction(this.pool, async (client) => {
      const candidates = await client.query<RemoteConnectRequestRow>(
        `
          SELECT *
          FROM remote_connect_requests
          WHERE device_code_prefix = $1
          ORDER BY created_at DESC
          FOR UPDATE
        `,
        [deviceCodePrefix]
      );
      const row = candidates.rows.find(
        (candidate) =>
          candidate.hash_version === remoteConnectHashVersion &&
          constantTimeRemoteConnectHashEquals(candidate.device_code_hash, deviceCodeHash)
      );
      if (!row) throw new Error("VALIDATION_ERROR: remote connect request not found");
      const status = remoteConnectRequestStatus(row);
      if (status !== "pending") {
        throw new Error(`VALIDATION_ERROR: remote connect request is ${status}`);
      }
      const updated = await client.query<RemoteConnectRequestRow>(
        `
          UPDATE remote_connect_requests
          SET status = 'denied',
              approved_by = $2,
              denied_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [row.id, deniedBy]
      );
      return summarizeRemoteConnectRequest(updated.rows[0] as RemoteConnectRequestRow);
    });
    await this.recordRemoteConnectRequestAudit({
      operation: "deny",
      status: "success",
      requestId: result.id,
      deviceCodePrefix: result.device_code_prefix,
      pollTokenPrefix: result.poll_token_prefix,
      actorId: deniedBy,
      metadata: { result: "denied", target: result.target }
    });
    return result;
  }

  async pollRemoteConnectRequest(
    input: PollRemoteConnectRequestInput
  ): Promise<PollRemoteConnectRequestResult> {
    await this.ensureRemoteConnectRequestSchema();
    const pollToken = normalizeRemoteMcpCredentialString(input.pollToken);
    if (!pollToken) throw new Error("VALIDATION_ERROR: remote connect poll token is required");
    const pollTokenPrefix = extractRemoteConnectPrefix(pollToken, "poll");
    const pollTokenHash = hashRemoteConnectSecret(pollToken);
    if (!pollTokenPrefix) {
      await this.recordRemoteConnectRequestAudit({
        operation: "poll",
        status: "skipped",
        errorCode: "invalid_poll_token",
        metadata: { result: "invalid_poll_token" }
      });
      throw new Error("VALIDATION_ERROR: remote connect poll token is invalid");
    }
    const redeemedBy = normalizeRemoteMcpCredentialString(input.redeemedBy) ?? "remote-connect";
    const result = await withTransaction(this.pool, async (client) => {
      const candidates = await client.query<RemoteConnectRequestRow>(
        `
          SELECT *
          FROM remote_connect_requests
          WHERE poll_token_prefix = $1
          ORDER BY created_at DESC
          FOR UPDATE
        `,
        [pollTokenPrefix]
      );
      const row = candidates.rows.find(
        (candidate) =>
          candidate.hash_version === remoteConnectHashVersion &&
          constantTimeRemoteConnectHashEquals(candidate.poll_token_hash, pollTokenHash)
      );
      if (!row) return { status: "expired" as const, request: null };
      const status = remoteConnectRequestStatus(row);
      if (status !== "approved") {
        if (status === "expired" && row.status !== "expired") {
          const expired = await client.query<RemoteConnectRequestRow>(
            `
              UPDATE remote_connect_requests
              SET status = 'expired', updated_at = now()
              WHERE id = $1 AND status IN ('pending', 'approved')
              RETURNING *
            `,
            [row.id]
          );
          return {
            status: "expired" as const,
            request: summarizeRemoteConnectRequest(expired.rows[0] ?? row)
          };
        }
        return {
          status,
          request: summarizeRemoteConnectRequest(row)
        } as PollRemoteConnectRequestResult;
      }
      if (!row.approved_project_id || !row.developer_id || !row.client_id) {
        throw new Error("VALIDATION_ERROR: approved remote connect request is missing scope");
      }
      const secret = generateRemoteMcpCredentialSecret();
      const credentialPrefix = extractRemoteMcpCredentialPrefix(secret);
      if (!credentialPrefix) throw new Error("Failed to generate remote MCP credential prefix");
      const credential = await client.query<RemoteMcpCredentialRow>(
        `
          INSERT INTO remote_mcp_credentials (
            project_id, developer_id, client_id, label, credential_prefix, credential_hash,
            hash_version, created_by, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *
        `,
        [
          row.approved_project_id,
          row.developer_id,
          row.client_id,
          row.project_display_name ?? "remote connect",
          credentialPrefix,
          hashRemoteMcpCredentialSecret(secret),
          remoteMcpCredentialHashVersion,
          redeemedBy,
          null
        ]
      );
      const updated = await client.query<RemoteConnectRequestRow>(
        `
          UPDATE remote_connect_requests
          SET status = 'redeemed',
              credential_id = $2,
              redeemed_at = now(),
              updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [row.id, credential.rows[0]?.id]
      );
      const request = summarizeRemoteConnectRequest(updated.rows[0] as RemoteConnectRequestRow);
      return {
        status: "approved" as const,
        request,
        secret,
        credential: summarizeRemoteMcpCredential(credential.rows[0] as RemoteMcpCredentialRow),
        project_id: row.approved_project_id,
        developer_id: row.developer_id,
        client_id: row.client_id,
        target: row.target
      };
    });
    await this.recordRemoteConnectRequestAudit({
      operation: "poll",
      status: "success",
      requestId: result.request?.id ?? null,
      projectId: result.status === "approved" ? result.project_id : null,
      developerId: result.status === "approved" ? result.developer_id : null,
      pollTokenPrefix,
      credentialId: result.status === "approved" ? result.credential.id : null,
      clientId: result.status === "approved" ? result.client_id : result.request?.client_id,
      actorId: redeemedBy,
      metadata: {
        result: result.status,
        target: result.request?.target ?? null
      }
    });
    if (result.status === "approved") {
      await this.recordRemoteMcpCredentialAudit({
        operation: "create",
        status: "success",
        projectId: result.project_id,
        developerId: result.developer_id,
        clientId: result.client_id,
        credentialId: result.credential.id,
        credentialPrefix: result.credential.credential_prefix,
        actorId: redeemedBy,
        metadata: {
          created_from: "remote_connect_request",
          request_id: result.request.id,
          expires_at: null
        }
      });
    }
    return result;
  }

  async createRemoteMcpCredential(
    input: CreateRemoteMcpCredentialInput
  ): Promise<CreateRemoteMcpCredentialResult> {
    const projectId = normalizeRemoteMcpCredentialString(input.projectId);
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    if (!projectId || !developerId) {
      throw new Error("VALIDATION_ERROR: projectId and developerId are required");
    }
    await this.assertRemoteMcpCredentialScope(projectId, developerId);

    const secret = generateRemoteMcpCredentialSecret();
    const credentialPrefix = extractRemoteMcpCredentialPrefix(secret);
    if (!credentialPrefix) throw new Error("Failed to generate remote MCP credential prefix");
    const credentialHash = hashRemoteMcpCredentialSecret(secret);
    const expiresAt = normalizeRemoteMcpCredentialDate(input.expiresAt);
    const clientId = normalizeRemoteMcpCredentialString(input.clientId);
    const createdBy = normalizeRemoteMcpCredentialString(input.createdBy) ?? "cli";
    const result = await this.pool.query<RemoteMcpCredentialRow>(
      `
        INSERT INTO remote_mcp_credentials (
          project_id, developer_id, client_id, label, credential_prefix, credential_hash,
          hash_version, created_by, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [
        projectId,
        developerId,
        clientId,
        normalizeRemoteMcpCredentialString(input.label),
        credentialPrefix,
        credentialHash,
        remoteMcpCredentialHashVersion,
        createdBy,
        expiresAt
      ]
    );
    const credential = summarizeRemoteMcpCredential(result.rows[0] as RemoteMcpCredentialRow);
    await this.recordRemoteMcpCredentialAudit({
      operation: "create",
      status: "success",
      projectId,
      developerId,
      clientId,
      credentialId: credential.id,
      credentialPrefix: credential.credential_prefix,
      actorId: createdBy,
      metadata: {
        label_present: Boolean(credential.label),
        expires_at: credential.expires_at?.toISOString() ?? null
      }
    });
    return { secret, credential };
  }

  async listRemoteMcpCredentials(
    input: ListRemoteMcpCredentialsInput
  ): Promise<RemoteMcpCredentialSummary[]> {
    const projectId = normalizeRemoteMcpCredentialString(input.projectId);
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    if (!projectId || !developerId) {
      throw new Error("VALIDATION_ERROR: projectId and developerId are required");
    }
    await this.assertRemoteMcpCredentialScope(projectId, developerId);
    const clientId = normalizeRemoteMcpCredentialString(input.clientId);
    const values: unknown[] = [projectId, developerId];
    const where = ["project_id = $1", "developer_id = $2"];
    if (clientId) {
      values.push(clientId);
      where.push(`client_id = $${values.length}`);
    }
    if (!input.includeRevoked) where.push("revoked_at IS NULL");
    const result = await this.pool.query<RemoteMcpCredentialRow>(
      `
        SELECT *
        FROM remote_mcp_credentials
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC
      `,
      values
    );
    return result.rows.map((row) => summarizeRemoteMcpCredential(row));
  }

  async verifyRemoteMcpCredential(
    input: VerifyRemoteMcpCredentialInput
  ): Promise<VerifyRemoteMcpCredentialResult> {
    const bearerToken = normalizeRemoteMcpCredentialString(input.bearerToken);
    const projectId = normalizeRemoteMcpCredentialString(input.projectId);
    const developerId = normalizeRemoteMcpCredentialString(input.developerId);
    const clientId = normalizeRemoteMcpCredentialString(input.clientId);
    if (!bearerToken) {
      await this.recordRemoteMcpCredentialAudit({
        operation: "verify",
        status: "skipped",
        projectId,
        developerId,
        clientId,
        errorCode: "missing_token",
        metadata: { result: "missing_token" }
      });
      return {
        ok: false,
        code: "missing_token",
        message: "Remote MCP bearer token is required."
      };
    }
    const prefix = extractRemoteMcpCredentialPrefix(bearerToken);
    const presentedHash = hashRemoteMcpCredentialSecret(bearerToken);
    const candidates = prefix
      ? await this.pool.query<RemoteMcpCredentialRow>(
          "SELECT * FROM remote_mcp_credentials WHERE credential_prefix = $1 ORDER BY created_at DESC",
          [prefix]
        )
      : { rows: [] as RemoteMcpCredentialRow[] };

    const matched = candidates.rows.find(
      (row) =>
        row.hash_version === remoteMcpCredentialHashVersion &&
        constantTimeRemoteMcpHashEquals(row.credential_hash, presentedHash)
    );
    if (!matched) {
      await this.recordRemoteMcpCredentialAudit({
        operation: "verify",
        status: "skipped",
        projectId,
        developerId,
        clientId,
        credentialPrefix: prefix,
        errorCode: "invalid_token",
        metadata: { result: "invalid_token" }
      });
      return { ok: false, code: "invalid_token", message: "Remote MCP credential is not valid." };
    }

    const summary = summarizeRemoteMcpCredential(matched);
    let failureCode: RemoteMcpCredentialVerifyFailureCode | null = null;
    if (matched.project_id !== projectId) failureCode = "wrong_project";
    else if (matched.developer_id !== developerId) failureCode = "wrong_developer";
    else if (matched.client_id && matched.client_id !== clientId) failureCode = "wrong_client";
    else if (summary.status === "expired") failureCode = "expired";
    else if (summary.status === "revoked") {
      const rotated = await this.pool.query<{ id: string }>(
        "SELECT id FROM remote_mcp_credentials WHERE rotated_from_credential_id = $1 LIMIT 1",
        [matched.id]
      );
      failureCode = rotated.rows[0] ? "rotated" : "revoked";
    }

    if (failureCode) {
      await this.recordRemoteMcpCredentialAudit({
        operation: "verify",
        status: "skipped",
        projectId: matched.project_id,
        developerId: matched.developer_id,
        clientId: matched.client_id,
        credentialId: matched.id,
        credentialPrefix: matched.credential_prefix,
        errorCode: failureCode,
        metadata: {
          result: failureCode,
          requested_project_id: projectId,
          requested_developer_id: developerId,
          requested_client_id: clientId
        }
      });
      return {
        ok: false,
        code: failureCode,
        message: `Remote MCP credential rejected: ${failureCode}.`,
        credential: summary
      };
    }

    const updated = await this.pool.query<RemoteMcpCredentialRow>(
      `
        UPDATE remote_mcp_credentials
        SET last_used_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [matched.id]
    );
    const credential = summarizeRemoteMcpCredential(updated.rows[0] as RemoteMcpCredentialRow);
    await this.recordRemoteMcpCredentialAudit({
      operation: "verify",
      status: "success",
      projectId: credential.project_id,
      developerId: credential.developer_id,
      clientId: credential.client_id,
      credentialId: credential.id,
      credentialPrefix: credential.credential_prefix,
      metadata: { result: "success" }
    });
    return { ok: true, credential };
  }

  async rotateRemoteMcpCredential(
    input: RotateRemoteMcpCredentialInput
  ): Promise<RotateRemoteMcpCredentialResult> {
    const rotatedBy = normalizeRemoteMcpCredentialString(input.rotatedBy) ?? "cli";
    const expiresAt = normalizeRemoteMcpCredentialDate(input.expiresAt);
    const secret = generateRemoteMcpCredentialSecret();
    const credentialPrefix = extractRemoteMcpCredentialPrefix(secret);
    if (!credentialPrefix) throw new Error("Failed to generate remote MCP credential prefix");
    const credentialHash = hashRemoteMcpCredentialSecret(secret);

    const result = await withTransaction(this.pool, async (client) => {
      const existing = await client.query<RemoteMcpCredentialRow>(
        "SELECT * FROM remote_mcp_credentials WHERE id = $1 FOR UPDATE",
        [input.credentialId]
      );
      const previousRow = existing.rows[0];
      if (!previousRow) throw new Error("VALIDATION_ERROR: remote MCP credential not found");
      const previous = await client.query<RemoteMcpCredentialRow>(
        `
          UPDATE remote_mcp_credentials
          SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
          WHERE id = $1
          RETURNING *
        `,
        [previousRow.id]
      );
      const next = await client.query<RemoteMcpCredentialRow>(
        `
          INSERT INTO remote_mcp_credentials (
            project_id, developer_id, client_id, label, credential_prefix, credential_hash,
            hash_version, created_by, rotated_from_credential_id, expires_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *
        `,
        [
          previousRow.project_id,
          previousRow.developer_id,
          previousRow.client_id,
          previousRow.label,
          credentialPrefix,
          credentialHash,
          remoteMcpCredentialHashVersion,
          rotatedBy,
          previousRow.id,
          expiresAt ?? previousRow.expires_at
        ]
      );
      return {
        previous: summarizeRemoteMcpCredential(previous.rows[0] as RemoteMcpCredentialRow),
        credential: summarizeRemoteMcpCredential(next.rows[0] as RemoteMcpCredentialRow)
      };
    });
    await this.recordRemoteMcpCredentialAudit({
      operation: "rotate",
      status: "success",
      projectId: result.credential.project_id,
      developerId: result.credential.developer_id,
      clientId: result.credential.client_id,
      credentialId: result.credential.id,
      credentialPrefix: result.credential.credential_prefix,
      actorId: rotatedBy,
      metadata: {
        rotated_from_credential_id: result.previous.id,
        previous_credential_prefix: result.previous.credential_prefix
      }
    });
    return { secret, ...result };
  }

  async revokeRemoteMcpCredential(
    input: RevokeRemoteMcpCredentialInput
  ): Promise<RemoteMcpCredentialSummary> {
    const revokedBy = normalizeRemoteMcpCredentialString(input.revokedBy) ?? "cli";
    const result = await this.pool.query<RemoteMcpCredentialRow>(
      `
        UPDATE remote_mcp_credentials
        SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
        WHERE id = $1
        RETURNING *
      `,
      [input.credentialId]
    );
    const row = result.rows[0];
    if (!row) throw new Error("VALIDATION_ERROR: remote MCP credential not found");
    const credential = summarizeRemoteMcpCredential(row);
    await this.recordRemoteMcpCredentialAudit({
      operation: "revoke",
      status: "success",
      projectId: credential.project_id,
      developerId: credential.developer_id,
      clientId: credential.client_id,
      credentialId: credential.id,
      credentialPrefix: credential.credential_prefix,
      actorId: revokedBy,
      metadata: { result: "revoked" }
    });
    return credential;
  }

  async startSession(input: StartSessionInput) {
    const project = input.project_id
      ? await this.contextForProject(input.project_id)
      : await this.ensureProject(input.project_path);
    return withTransaction(this.pool, async (client) => {
      const previous = await client.query(
        `
          SELECT id, last_seen_at, extract(epoch from (now() - last_seen_at)) / 60 AS age_minutes
          FROM sessions
          WHERE project_id = $1 AND status = 'active' AND ended_at IS NULL
          ORDER BY last_seen_at DESC
          LIMIT 1
        `,
        [project.projectId]
      );
      const previousSession = previous.rows[0];
      const staleThresholdMinutes = await this.resolveStaleSessionThreshold(
        client,
        project.projectId,
        project.developerId
      );
      const ageMinutes = Number(previousSession?.age_minutes ?? 0);
      const previousIsStale = previousSession ? ageMinutes >= staleThresholdMinutes : false;
      if (previousSession) {
        if (previousIsStale) {
          await client.query(
            `
              UPDATE sessions
              SET status = 'interrupted', ended_reason = 'crash_or_unknown', last_seen_at = now()
              WHERE id = $1
            `,
            [previousSession.id]
          );
        }
      }

      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO sessions (project_id, client_kind, client_version, recovered_from_session_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [
          project.projectId,
          input.client_kind,
          input.client_version ?? null,
          previousSession?.id ?? null
        ]
      );

      const checkpoint = await client.query(
        "SELECT payload, updated_at FROM checkpoints WHERE project_id = $1",
        [project.projectId]
      );

      return {
        session_id: inserted.rows[0]?.id,
        project_id: project.projectId,
        checkpoint: checkpoint.rows[0] ?? { payload: null, updated_at: null },
        previous_unclosed_session: previousSession
          ? {
              session_id: previousSession.id,
              last_seen_at: previousSession.last_seen_at,
              last_event_id: await this.findLastEventId(client, previousSession.id),
              recovery_status: "needs_review",
              is_stale: previousIsStale,
              age_minutes: ageMinutes,
              stale_after_minutes: staleThresholdMinutes
            }
          : null,
        recommended_next_calls: ["memory_get_context_pack"]
      };
    });
  }

  async heartbeat(sessionId: string, status: string, note?: string | null, metadata?: JsonObject) {
    const boundedMetadata = { ...(metadata ?? {}), note: note ?? undefined };
    const result = await this.pool.query(
      `
        UPDATE sessions
        SET last_seen_at = now(),
            last_heartbeat_at = now(),
            heartbeat_status = $2,
            heartbeat_metadata = $3
        WHERE id = $1
        RETURNING id, last_seen_at, last_heartbeat_at
      `,
      [sessionId, status, JSON.stringify(boundedMetadata)]
    );
    return result.rows[0];
  }

  async appendTurn(input: AppendTurnInput) {
    assertMaxChars(
      "memory_append_turn.text",
      input.text,
      readPositiveIntEnv("RECALLANT_APPEND_TURN_MAX_CHARS", 200_000)
    );
    const context = await this.contextForSession(input.session_id);
    return withTransaction(this.pool, async (client) => {
      await this.touchSession(client, input.session_id);
      const existing = await this.findDedup(client, context.projectId, input.dedup_key);
      if (existing) return { event_id: existing, status: "duplicate" };

      const policy = await this.resolveCapturePolicy(
        client,
        context.projectId,
        context.developerId,
        input.session_id
      );
      const capturedText = capText(input.text, policy.turnTextMaxChars) ?? "";
      const payload = {
        schema_version: 1,
        text: capturedText,
        attachments: [],
        raw_artifacts: [],
        capture: {
          profile: policy.profile,
          source: policy.source,
          ...truncationMetadata(input.text, capturedText)
        }
      };
      const event = await this.insertEvent(client, {
        projectId: context.projectId,
        sessionId: input.session_id ?? null,
        ingestSource: "mcp_append",
        kind: input.role === "user" ? "turn_user" : "turn_assistant",
        occurredAt: parseIsoOrNow(input.occurred_at),
        payload
      });
      await this.insertDedup(client, context.projectId, input.dedup_key, event.id);

      const chunkIds = await this.insertChunks(client, {
        projectId: context.projectId,
        developerId: context.developerId,
        eventId: event.id,
        text: capturedText
      });
      const embeddingResult = await this.embedChunks(client, {
        developerId: context.developerId,
        projectId: context.projectId,
        sessionId: input.session_id ?? null,
        chunkIds,
        texts: chunkText(capturedText)
      });
      return {
        event_id: event.id,
        chunk_ids: chunkIds,
        status: "created",
        capture_profile: policy.profile,
        captured_text_chars: capturedText.length,
        embedding: embeddingResult
      };
    });
  }

  async search(input: {
    query: string;
    mode?: string;
    top_k?: number;
    max_chars_total?: number;
    session_id?: string | null;
    source_id?: string | null;
    scope?: string;
    scope_kind?: string | null;
    audience?: string | null;
    graph_expand?: boolean;
    graph_budget_nodes?: number;
    include_archived?: boolean;
  }) {
    const context = input.session_id
      ? await this.contextForSession(input.session_id)
      : await this.ensureProject();
    const lifecycle = await this.getProjectLifecycle(context.projectId);
    if (projectLifecycleIsDetached(lifecycle)) {
      return {
        hits: [],
        truncated: false,
        route: null,
        lifecycle,
        warnings: ["Project is detached from active Recallant search."]
      };
    }
    const broadQueryWarning = broadStartupQueryWarning(input.query);
    if (input.session_id && broadQueryWarning) {
      return {
        hits: [],
        truncated: false,
        route: null,
        rejected: true,
        error_code: "BROAD_STARTUP_QUERY",
        warnings: [broadQueryWarning],
        policy: {
          start_with_context_pack: true,
          use_specific_evidence_queries: true
        }
      };
    }
    const route = await this.resolveEmbeddingRoute(
      this.pool,
      context.projectId,
      context.developerId
    );
    const mode = input.mode ?? "hybrid";
    const topK = input.top_k ?? 8;
    const candidateLimit = Math.max(topK * 2, 8);
    const sourceFilter = await this.sourceFilter(input.source_id);
    const filter = this.buildSearchFilter({
      projectId: context.projectId,
      developerId: context.developerId,
      scope: input.scope ?? "project",
      scopeKind: input.scope_kind ?? null,
      audience: input.audience ?? null,
      includeArchived: input.include_archived === true,
      sourceFilter,
      startIndex: 2
    });
    const candidates = new Map<
      string,
      {
        id: string;
        text: string;
        source_event_id: string;
        occurred_at: string;
        event_payload: unknown;
        vectorScore: number;
        lexicalScore: number;
        paths: Set<string>;
      }
    >();

    if (mode === "hybrid" || mode === "vector_only") {
      let queryVector: number[] | null = null;
      if (route.provider === "deterministic") {
        queryVector = deterministicEmbedding(input.query, route.dims);
      } else if (route.provider === "ollama") {
        try {
          const queryEmbedding = await fetchOllamaEmbedding(route, input.query);
          queryVector = queryEmbedding.embedding;
          await this.recordModelCall(this.pool, {
            developerId: context.developerId,
            projectId: context.projectId,
            sessionId: input.session_id ?? null,
            route,
            purpose: "query_embedding",
            status: "success",
            metadata: {
              text_count: 1,
              ...summarizeOllamaEmbeddingResults([queryEmbedding])
            }
          });
        } catch (error) {
          const failureSummary = summarizeOllamaEmbeddingFailure(error, 1);
          await this.recordModelCall(this.pool, {
            developerId: context.developerId,
            projectId: context.projectId,
            sessionId: input.session_id ?? null,
            route,
            purpose: "query_embedding",
            status: "failed",
            errorCode: "UNAVAILABLE",
            metadata: { text_count: 1, ...failureSummary }
          });
        }
      }
      if (queryVector) {
        if (route.provider !== "ollama") {
          await this.recordModelCall(this.pool, {
            developerId: context.developerId,
            projectId: context.projectId,
            sessionId: input.session_id ?? null,
            route,
            purpose: "query_embedding",
            status: "success",
            metadata: { text_count: 1 }
          });
        }
        const vectorRows = await this.pool.query<{
          id: string;
          text: string;
          source_event_id: string;
          occurred_at: string;
          event_payload: unknown;
          distance: number;
        }>(
          `
          SELECT c.id, c.text, c.source_event_id, ev.occurred_at, ev.payload AS event_payload,
                 e.vector <=> $1::vector AS distance
          FROM chunks c
          JOIN events ev ON ev.id = c.source_event_id
          JOIN embeddings e ON e.chunk_id = c.id
          WHERE ${filter.whereSql}
          ORDER BY e.vector <=> $1::vector
          LIMIT $${filter.params.length + 2}::int
        `,
          [vectorLiteral(queryVector), ...filter.params, candidateLimit]
        );
        for (const row of vectorRows.rows) {
          candidates.set(row.id, {
            id: row.id,
            text: row.text,
            source_event_id: row.source_event_id,
            occurred_at: row.occurred_at,
            event_payload: row.event_payload,
            vectorScore: Math.max(0, 1 - Number(row.distance)),
            lexicalScore: 0,
            paths: new Set(["vector"])
          });
        }
      }
    }

    if (mode === "hybrid" || mode === "lexical_only" || candidates.size === 0) {
      const lexicalRows = await this.pool.query<{
        id: string;
        text: string;
        source_event_id: string;
        occurred_at: string;
        event_payload: unknown;
        rank: number;
      }>(
        `
          SELECT c.id, c.text, c.source_event_id, ev.occurred_at, ev.payload AS event_payload,
                 ts_rank_cd(c.tsv, plainto_tsquery('simple', $1)) AS rank
          FROM chunks c
          JOIN events ev ON ev.id = c.source_event_id
          WHERE ${filter.whereSql}
            AND c.tsv @@ plainto_tsquery('simple', $1)
          ORDER BY rank DESC, c.created_at DESC
          LIMIT $${filter.params.length + 2}::int
        `,
        [input.query, ...filter.params, candidateLimit]
      );
      for (const row of lexicalRows.rows) {
        const existing = candidates.get(row.id);
        if (existing) {
          existing.lexicalScore = Number(row.rank);
          existing.event_payload = existing.event_payload ?? row.event_payload;
          existing.paths.add("lexical");
        } else {
          candidates.set(row.id, {
            id: row.id,
            text: row.text,
            source_event_id: row.source_event_id,
            occurred_at: row.occurred_at,
            event_payload: row.event_payload,
            vectorScore: 0,
            lexicalScore: Number(row.rank),
            paths: new Set(["lexical"])
          });
        }
      }
    }

    const rows = Array.from(candidates.values())
      .map((candidate) => ({
        id: candidate.id,
        text: candidate.text,
        source_event_id: candidate.source_event_id,
        occurred_at: candidate.occurred_at,
        event_payload: candidate.event_payload,
        score:
          (candidate.vectorScore * 0.65 + candidate.lexicalScore * 0.35) *
          retrievalDecay(candidate.occurred_at),
        path: Array.from(candidate.paths).join("+"),
        superseded_by: null as string | null
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, topK);

    if (rows.length > 0) {
      const superseded = await this.pool.query<{ dst_id: string; src_id: string }>(
        `
          SELECT dst_id, src_id
          FROM edges
          WHERE project_id = $1
            AND relation_type = 'supersedes'
            AND src_kind = 'chunk'
            AND dst_kind = 'chunk'
            AND dst_id = ANY($2::text[])
        `,
        [context.projectId, rows.map((row) => row.id)]
      );
      const supersededBy = new Map(superseded.rows.map((row) => [row.dst_id, row.src_id]));
      const penalty = readFloatEnvInRange("RECALLANT_SUPERSEDES_SCORE_MULTIPLIER", 0.2, 0, 1);
      for (const row of rows) {
        const replacement = supersededBy.get(row.id);
        if (replacement) {
          row.score *= penalty;
          row.path = `${row.path}+superseded`;
          row.superseded_by = replacement;
        }
      }
      rows.sort((left, right) => right.score - left.score);
    }

    if (input.graph_expand && rows.length > 0) {
      const graphRows = await this.expandGraphRows({
        projectId: context.projectId,
        seedChunkIds: rows.map((row) => row.id),
        budget: input.graph_budget_nodes ?? 8,
        sourceFilter,
        existingChunkIds: new Set(rows.map((row) => row.id))
      });
      rows.push(...graphRows);
      rows.sort((left, right) => right.score - left.score);
    }

    let usedChars = 0;
    const maxChars = input.max_chars_total ?? 12_000;
    const hits = [];
    for (const row of rows) {
      if (usedChars >= maxChars) break;
      const remaining = maxChars - usedChars;
      const excerpt = row.text.slice(0, remaining);
      usedChars += excerpt.length;
      hits.push({
        chunk_id: row.id,
        source_event_id: row.source_event_id,
        score: row.score,
        path: row.path,
        why: row.path,
        superseded_by: row.superseded_by,
        occurred_at: row.occurred_at,
        provenance: this.eventSourceProvenance(row.event_payload),
        text_excerpt: excerpt,
        excerpt
      });
    }
    if (hits.length > 0) {
      await this.pool.query(
        `
          UPDATE chunks
          SET last_accessed_at = now(), access_count = access_count + 1
          WHERE id = ANY($1::uuid[])
        `,
        [hits.map((hit) => hit.chunk_id)]
      );
    }
    return {
      hits,
      truncated: rows.length > hits.length,
      source_filter: sourceFilter
        ? {
            source_id: sourceFilter.source_id,
            label: sourceFilter.label,
            source_kind: sourceFilter.source_kind
          }
        : null,
      route: { provider: route.provider, model: route.model, dims: route.dims }
    };
  }

  async fetchChunk(chunkId: string, maxChars = 16_000) {
    const result = await this.pool.query(
      `
        UPDATE chunks
        SET last_accessed_at = now(), access_count = access_count + 1
        WHERE id = $1
        RETURNING id AS chunk_id, text, source_event_id, scope, scope_kind, scope_id, audience,
                  embed_status, embed_model, archived_at, created_at
      `,
      [chunkId]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown chunk_id: ${chunkId}`);
    return {
      ...row,
      text: String(row.text ?? "").slice(0, maxChars),
      truncated: String(row.text ?? "").length > maxChars
    };
  }

  async archiveChunk(input: ArchiveInput) {
    const result = await this.pool.query<{ id: string; archived_at: string | null }>(
      `
        UPDATE chunks
        SET archived_at = CASE WHEN $2 = 'archive' THEN now() ELSE NULL END
        WHERE id = $1
        RETURNING id, archived_at
      `,
      [input.chunk_id, input.action]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`VALIDATION_ERROR: unknown chunk_id ${input.chunk_id}`);
    return {
      ok: true,
      chunk_id: row.id,
      action: input.action,
      archived_at: row.archived_at
    };
  }

  async linkMemory(input: LinkMemoryInput) {
    const context = await this.ensureProject();
    const result = await this.pool.query<{ id: string }>(
      `
        INSERT INTO edges (project_id, src_kind, src_id, dst_kind, dst_id, relation_type, weight, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `,
      [
        context.projectId,
        input.src_kind,
        input.src_id,
        input.dst_kind,
        input.dst_id,
        input.relation_type,
        input.weight ?? 1,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return { edge_id: result.rows[0]?.id };
  }

  async getContextPack(input: ContextPackInput) {
    const context = await this.contextForSession(input.session_id);
    await withTransaction(this.pool, async (client) => {
      await this.touchSession(client, input.session_id);
      await this.insertEvent(client, {
        projectId: context.projectId,
        sessionId: input.session_id,
        ingestSource: "mcp_context",
        kind: "tool_result",
        occurredAt: new Date(),
        payload: {
          schema_version: 1,
          text: input.task_hint
            ? `Context pack requested for: ${input.task_hint}`
            : "Context pack requested.",
          metadata: {
            capture_kind: "context_read",
            include_raw_evidence: input.include_raw_evidence ?? "auto",
            include_recovery: input.include_recovery ?? true,
            max_chars_total: input.max_chars_total ?? null
          }
        }
      });
    });
    const checkpoint = await this.getCheckpoint(context.projectId);
    const recovery = await this.pool.query(
      `
        SELECT id AS session_id, last_seen_at, status
        FROM sessions
        WHERE project_id = $1 AND status = 'interrupted'
        ORDER BY last_seen_at DESC
        LIMIT 3
      `,
      [context.projectId]
    );
    const rules = await this.pool.query(
      `
        SELECT
          m.id AS memory_id,
          m.title,
          m.body,
          m.scope,
          m.scope_kind,
          m.scope_id,
          m.use_policy,
          coalesce(
            jsonb_agg(to_jsonb(r) ORDER BY r.created_at ASC)
              FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
          ) AS source_refs
        FROM agent_memories m
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE m.developer_id = $1 AND (m.project_id = $2 OR m.scope = 'developer')
          AND m.status = 'accepted' AND m.use_policy = 'instruction_grade'
        GROUP BY m.id
        ORDER BY m.updated_at DESC
        LIMIT 8
      `,
      [context.developerId, context.projectId]
    );
    const working =
      input.task_hint && input.task_hint.trim()
        ? await this.recallAgentMemories({
            project_id: context.projectId,
            query: input.task_hint,
            top_k: 8,
            max_chars_total: Math.floor((input.max_chars_total ?? 12_000) / 2)
          })
        : { memories: [], trace_id: null };
    const evidence =
      input.include_raw_evidence === "always" && input.task_hint
        ? await this.search({
            session_id: input.session_id,
            query: input.task_hint,
            mode: "hybrid",
            top_k: 4,
            max_chars_total: Math.floor((input.max_chars_total ?? 12_000) / 3)
          })
        : { hits: [] };
    const postureSetting = await this.pool.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = 'documentation_posture'",
      [context.projectId]
    );
    const starterDocsSetting = await this.pool.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = 'starter_docs'",
      [context.projectId]
    );
    const projectSettings = await this.pool.query<{
      key: string;
      value: unknown;
      updated_at: string;
    }>(
      `
        SELECT key, value, updated_at
        FROM project_settings
        WHERE project_id = $1
          AND key IN (
            'documentation_posture',
            'starter_docs',
            'runtime_profile',
            'project_profile',
            'capability_profile'
          )
        ORDER BY updated_at DESC, key ASC
        LIMIT 12
      `,
      [context.projectId]
    );
    const projectSources = await this.pool.query(
      `
        SELECT id, source_kind, label, uri, status, metadata, updated_at
        FROM project_sources
        WHERE project_id = $1
          AND status IN ('active', 'needs_review')
        ORDER BY is_primary DESC, updated_at DESC, label ASC
        LIMIT 12
      `,
      [context.projectId]
    );
    const contextMemories = await this.pool.query(
      `
        SELECT id, memory_type, scope_kind, scope_id, title, body, status, metadata, updated_at
        FROM agent_memories
        WHERE developer_id = $1
          AND (project_id = $2 OR scope = 'developer')
          AND status = 'accepted'
          AND use_policy <> 'do_not_use'
          AND (
            scope_kind IN ('environment', 'domain', 'capability')
            OR memory_type IN ('environment_fact', 'domain_fact', 'capability_fact')
          )
        ORDER BY updated_at DESC
        LIMIT 12
      `,
      [context.developerId, context.projectId]
    );
    const importEvents = await this.pool.query(
      `
        SELECT id, payload AS metadata, occurred_at
        FROM events
        WHERE project_id = $1
          AND kind = 'import_batch'
        ORDER BY occurred_at DESC
        LIMIT 12
      `,
      [context.projectId]
    );
    const documentationPosture = documentationPostureSection(postureSetting.rows[0]?.value);
    const canonCapabilityContext = deriveCanonCapabilityContext({
      documentation_posture: documentationPosture,
      starter_docs: starterDocsSetting.rows[0]?.value,
      project_settings: projectSettings.rows,
      project_sources: projectSources.rows,
      memories: contextMemories.rows,
      imports: importEvents.rows.map((row) => ({
        id: row.id,
        metadata: row.metadata,
        source_path:
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? stringOrNull((row.metadata as Record<string, unknown>).source_path)
            : null
      })),
      max_items_per_category: 8
    });
    return {
      context_pack_id: randomUUID(),
      project_id: context.projectId,
      session_id: input.session_id,
      profile: "compact",
      sections: {
        checkpoint,
        documentation_posture: documentationPosture,
        canon_capability_context: canonCapabilityContext,
        recovery: input.include_recovery === false ? [] : recovery.rows,
        binding_rules: rules.rows.map((memory) => this.withSourceProvenance(memory)),
        working_memories: working.memories.filter(
          (memory: { use_policy?: string }) => memory.use_policy !== "instruction_grade"
        ),
        operational_bindings: [],
        local_spool_status: input.local_spool_status ?? { status: "unknown" },
        evidence_excerpts: evidence.hits,
        suggested_next_fetches: []
      },
      trace_id: "trace_id" in working ? working.trace_id : null,
      truncated: false,
      budget: { max_chars_total: input.max_chars_total ?? 12_000 }
    };
  }

  async forget(input: ForgetInput) {
    const targetId = input.target.id;
    if (!targetId) throw new Error("VALIDATION_ERROR: forget target id is required");
    const affected = await this.countForgetTarget(input.target.kind, targetId);
    if (input.dry_run !== false || input.confirmation?.confirmed !== true) {
      return {
        erasure_id: randomUUID(),
        status: "pending_confirmation",
        requires_confirmation: true,
        affected,
        warnings: ["Dry run only. No Recallant-controlled content was erased."],
        redacted_receipt: {}
      };
    }
    const erasureId = randomUUID();
    await withTransaction(this.pool, async (client) => {
      if (input.target.kind === "chunk") {
        await client.query("DELETE FROM embeddings WHERE chunk_id = $1", [targetId]);
        await client.query(
          "UPDATE chunks SET text = '[REDACTED]', archived_at = now() WHERE id = $1",
          [targetId]
        );
      } else if (input.target.kind === "event") {
        await client.query(
          "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE source_event_id = $1)",
          [targetId]
        );
        await client.query(
          "UPDATE chunks SET text = '[REDACTED]', archived_at = now() WHERE source_event_id = $1",
          [targetId]
        );
        await client.query("UPDATE events SET payload = $2 WHERE id = $1", [
          targetId,
          JSON.stringify({ redacted: true, erasure_id: erasureId })
        ]);
      } else if (input.target.kind === "agent_memory") {
        await client.query(
          "UPDATE agent_memories SET title = '[REDACTED]', body = '[REDACTED]', status = 'archived', use_policy = 'do_not_use' WHERE id = $1",
          [targetId]
        );
        await client.query(
          "UPDATE agent_memory_source_refs SET quote = NULL WHERE memory_id = $1",
          [targetId]
        );
      }
      await client.query(
        `
          INSERT INTO erasure_requests (
            id, developer_id, project_id, requested_by, request_source, target_selector,
            reason, status, requires_confirmation, confirmed_by, confirmed_at, executed_at, redacted_receipt
          )
          VALUES ($1, coalesce((SELECT developer_id FROM projects LIMIT 1), gen_random_uuid()), NULL,
                  'owner', 'mcp', $2, $3, 'completed', true, 'owner', now(), now(), $4)
        `,
        [
          erasureId,
          JSON.stringify({ kind: input.target.kind, id: targetId }),
          input.reason ?? null,
          JSON.stringify({ affected, content_redacted: true })
        ]
      );
    });
    return {
      erasure_id: erasureId,
      status: "completed",
      requires_confirmation: false,
      affected,
      warnings: [],
      redacted_receipt: { affected, content_redacted: true }
    };
  }

  async appendEvent(input: AppendEventInput) {
    assertMaxChars(
      "memory_append_event.text",
      input.text,
      readPositiveIntEnv("RECALLANT_APPEND_EVENT_TEXT_MAX_CHARS", 100_000)
    );
    const artifactExcerptMaxChars = readPositiveIntEnv(
      "RECALLANT_RAW_ARTIFACT_EXCERPT_MAX_CHARS",
      16_000
    );
    for (const [index, artifact] of (input.raw_artifacts ?? []).entries()) {
      assertMaxChars(
        `memory_append_event.raw_artifacts[${index}].excerpt`,
        artifact.excerpt,
        artifactExcerptMaxChars
      );
    }
    const context = await this.contextForSession(input.session_id);
    return withTransaction(this.pool, async (client) => {
      await this.touchSession(client, input.session_id);
      const existing = await this.findDedup(client, context.projectId, input.dedup_key);
      if (existing) return { event_id: existing, raw_artifact_ids: [], status: "duplicate" };

      const policy = await this.resolveCapturePolicy(
        client,
        context.projectId,
        context.developerId,
        input.session_id
      );
      const capturedText = capText(input.text, policy.workflowTextMaxChars);
      const payload = {
        schema_version: 1,
        text: capturedText,
        metadata: input.metadata ?? {},
        raw_artifacts: [],
        capture: {
          profile: policy.profile,
          source: policy.source,
          ...truncationMetadata(input.text, capturedText)
        }
      };
      const event = await this.insertEvent(client, {
        projectId: context.projectId,
        sessionId: input.session_id ?? null,
        ingestSource: "mcp_append",
        kind: input.event_kind,
        occurredAt: parseIsoOrNow(input.occurred_at),
        payload
      });

      const rawArtifactIds = [];
      for (const artifact of input.raw_artifacts ?? []) {
        const inserted = await client.query<{ id: string }>(
          `
            INSERT INTO raw_artifacts (
              project_id, session_id, source_event_id, artifact_kind, storage_backend,
              uri, sha256, size_bytes, content_type, excerpt, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
          `,
          [
            context.projectId,
            input.session_id ?? null,
            event.id,
            artifact.artifact_kind,
            artifact.storage_backend,
            artifact.uri ?? "",
            artifact.sha256 ?? null,
            artifact.size_bytes ?? null,
            artifact.content_type ?? null,
            artifact.excerpt ?? null,
            JSON.stringify(artifact.metadata ?? {})
          ]
        );
        rawArtifactIds.push(inserted.rows[0]?.id);
      }

      await client.query("UPDATE events SET payload = payload || $2::jsonb WHERE id = $1", [
        event.id,
        JSON.stringify({ raw_artifact_ids: rawArtifactIds })
      ]);
      await this.insertDedup(client, context.projectId, input.dedup_key, event.id);

      const chunkIds = capturedText
        ? await this.insertChunks(client, {
            projectId: context.projectId,
            developerId: context.developerId,
            eventId: event.id,
            text: capturedText
          })
        : [];
      const embeddingResult =
        chunkIds.length > 0
          ? await this.embedChunks(client, {
              developerId: context.developerId,
              projectId: context.projectId,
              sessionId: input.session_id ?? null,
              chunkIds,
              texts: chunkText(capturedText ?? "")
            })
          : { status: "skipped", reason: "empty_event_text" };

      return {
        event_id: event.id,
        chunk_ids: chunkIds,
        raw_artifact_ids: rawArtifactIds,
        status: "created",
        capture_profile: policy.profile,
        captured_text_chars: capturedText?.length ?? 0,
        embedding: embeddingResult
      };
    });
  }

  async importSource(input: ImportSourceInput) {
    assertMaxChars(
      "recallant_import.import_text",
      input.import_text,
      readPositiveIntEnv("RECALLANT_IMPORT_TEXT_MAX_CHARS", 250_000)
    );
    const context = await this.ensureProject(input.project_path);
    const resultClasses = input.result_classes?.length
      ? input.result_classes
      : [input.result_class];
    const dedupKey =
      input.dedup_key ??
      `import:${input.source_path}:${input.source_sha256}:${resultClasses.sort().join(",")}`;
    return withTransaction(this.pool, async (client) => {
      const existing = await this.findDedup(client, context.projectId, dedupKey);
      if (existing) {
        const counts = await client.query<{
          chunk_count: number;
          raw_artifact_count: number;
          memory_ids: string[];
        }>(
          `
            SELECT
              (SELECT count(*)::int FROM chunks WHERE source_event_id = $1) AS chunk_count,
              (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $1) AS raw_artifact_count,
              coalesce(
                (SELECT array_agg(id::text)
                 FROM agent_memories
                 WHERE metadata->>'import_dedup_key' = $2),
                ARRAY[]::text[]
              ) AS memory_ids
          `,
          [existing, dedupKey]
        );
        const row = counts.rows[0];
        return {
          status: "duplicate",
          event_id: existing,
          chunk_count: row?.chunk_count ?? 0,
          raw_artifact_count: row?.raw_artifact_count ?? 0,
          memory_ids: row?.memory_ids ?? [],
          dedup_key: dedupKey
        };
      }

      const event = await this.insertEvent(client, {
        projectId: context.projectId,
        sessionId: null,
        ingestSource: "cli_import",
        kind: "import_batch",
        occurredAt: new Date(),
        payload: {
          schema_version: 1,
          source_ref: {
            path: input.source_path,
            sha256: input.source_sha256,
            size_bytes: input.source_size_bytes ?? null,
            content_type: input.content_type ?? null
          },
          source_type: input.source_type,
          result_class: input.result_class,
          result_classes: resultClasses,
          scope_kind: input.scope_kind ?? "project",
          scope_id: input.scope_id ?? null,
          audience: input.audience ?? [{ kind: "all_agents", id: null }],
          risk: input.risk ?? "low",
          risks: input.risks ?? [],
          secret_references: input.secret_references ?? [],
          text_excerpt: input.bounded_excerpt ?? input.import_text.slice(0, 500),
          metadata: input.metadata ?? {}
        }
      });
      await this.insertDedup(client, context.projectId, dedupKey, event.id);

      const rawArtifact = await client.query<{ id: string }>(
        `
          INSERT INTO raw_artifacts (
            project_id, session_id, source_event_id, artifact_kind, storage_backend,
            uri, sha256, size_bytes, content_type, excerpt, metadata
          )
          VALUES ($1, NULL, $2, 'transcript_export', 'postgres_inline', $3, $4, $5, $6, $7, $8)
          RETURNING id
        `,
        [
          context.projectId,
          event.id,
          `import://${input.source_path}`,
          input.source_sha256,
          input.source_size_bytes ?? null,
          input.content_type ?? "text/markdown",
          input.bounded_excerpt ?? input.import_text.slice(0, 500),
          JSON.stringify({
            source_type: input.source_type,
            result_classes: resultClasses,
            secret_policy: "secret values redacted before import"
          })
        ]
      );
      const rawArtifactId = rawArtifact.rows[0]?.id;

      const audience = input.audience ?? [{ kind: "all_agents", id: null }];
      const scopeKind = input.scope_kind ?? "project";
      const chunkIds = await this.insertChunks(client, {
        projectId: context.projectId,
        developerId: context.developerId,
        eventId: event.id,
        text: input.import_text,
        scope: "project",
        scopeKind,
        scopeId:
          input.scope_id ?? (scopeKind === "project" ? context.projectId : input.source_path),
        audience
      });
      const embedding = await this.embedChunks(client, {
        developerId: context.developerId,
        projectId: context.projectId,
        sessionId: null,
        chunkIds,
        texts: chunkText(input.import_text)
      });

      const isHighRisk =
        input.risk === "high" ||
        (input.risks ?? []).some((risk) => risk.severity === "high") ||
        resultClasses.some((resultClass) =>
          [
            "secret_reference_names_only",
            "capability_binding",
            "connector_account_binding",
            "possible_conflict"
          ].includes(resultClass)
        );
      const memory = await client.query<{ id: string; status: string; use_policy: string }>(
        `
          INSERT INTO agent_memories (
            developer_id, project_id, scope, scope_kind, scope_id, audience,
            memory_type, title, body, status, use_policy, confidence, created_by, metadata
          )
          VALUES ($1, $2, 'project', $3, $4, $5, $6, $7, $8, $9, $10, $11, 'import', $12)
          RETURNING id, status, use_policy
        `,
        [
          context.developerId,
          context.projectId,
          scopeKind,
          input.scope_id ?? (scopeKind === "project" ? context.projectId : input.source_path),
          JSON.stringify(audience),
          importMemoryType(resultClasses),
          `Imported ${input.source_path}`,
          importMemoryBody(input, resultClasses),
          isHighRisk ? "needs_review" : "candidate",
          isHighRisk ? "evidence_only" : "recall_allowed",
          isHighRisk ? 0.6 : 0.75,
          JSON.stringify({
            import_dedup_key: dedupKey,
            import_event_id: event.id,
            raw_artifact_id: rawArtifactId ?? null,
            result_class: input.result_class,
            result_classes: resultClasses,
            risk: input.risk ?? "low",
            risks: input.risks ?? [],
            policy_reason: isHighRisk
              ? "import_high_risk_review_required"
              : "import_candidate_review_required"
          })
        ]
      );
      const memoryId = memory.rows[0]?.id;
      if (!memoryId) throw new Error("Failed to create import candidate memory");
      await client.query(
        `
          INSERT INTO agent_memory_source_refs (memory_id, source_kind, source_id, quote, metadata)
          VALUES ($1, 'event', $2, $3, $4)
        `,
        [
          memoryId,
          event.id,
          input.bounded_excerpt ?? input.import_text.slice(0, 500),
          JSON.stringify({
            source_path: input.source_path,
            source_sha256: input.source_sha256,
            raw_artifact_id: rawArtifactId ?? null
          })
        ]
      );

      return {
        status: "created",
        event_id: event.id,
        raw_artifact_ids: rawArtifactId ? [rawArtifactId] : [],
        chunk_ids: chunkIds,
        memory_ids: [memoryId],
        memory_status: memory.rows[0]?.status,
        memory_use_policy: memory.rows[0]?.use_policy,
        embedding,
        dedup_key: dedupKey
      };
    });
  }

  async createAgentMemory(input: CreateAgentMemoryInput) {
    if (input.created_by === "agent" && (input.source_refs?.length ?? 0) === 0) {
      throw new Error("VALIDATION_ERROR: agent-created memories require source_refs");
    }
    const context = input.project_id
      ? await this.contextForProject(input.project_id)
      : await this.ensureProject(input.project_path);
    return withTransaction(this.pool, async (client) => {
      const policy = this.classifyAgentMemory(input);
      const result = await client.query<{ id: string; status: string; use_policy: string }>(
        `
          INSERT INTO agent_memories (
            developer_id, project_id, scope, scope_kind, scope_id, audience,
            memory_type, title, body, status, use_policy, confidence, created_by, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id, status, use_policy
        `,
        [
          context.developerId,
          input.scope === "project" ? context.projectId : null,
          input.scope,
          input.scope_kind ?? input.scope,
          input.scope_id ?? (input.scope === "project" ? context.projectId : context.developerId),
          JSON.stringify(input.audience ?? [{ kind: "all_agents", id: null }]),
          input.memory_type,
          input.title,
          input.body,
          policy.status,
          policy.usePolicy,
          input.confidence ?? null,
          input.created_by,
          JSON.stringify({ ...(input.metadata ?? {}), policy_reason: policy.reason })
        ]
      );
      const memoryId = result.rows[0]?.id;
      if (!memoryId) throw new Error("Failed to create agent memory");
      for (const ref of input.source_refs ?? []) {
        await client.query(
          `
            INSERT INTO agent_memory_source_refs (memory_id, source_kind, source_id, quote, metadata)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            memoryId,
            ref.source_kind,
            ref.source_id,
            ref.quote ?? null,
            JSON.stringify(ref.metadata ?? {})
          ]
        );
      }
      return {
        memory_id: memoryId,
        status: result.rows[0]?.status,
        use_policy: result.rows[0]?.use_policy,
        review_reason: policy.reason
      };
    });
  }

  async reviewAgentMemory(input: ReviewAgentMemoryInput) {
    return withTransaction(this.pool, async (client) => {
      const before = await client.query("SELECT * FROM agent_memories WHERE id = $1", [
        input.memory_id
      ]);
      const previous = before.rows[0];
      if (!previous) throw new Error(`Unknown memory_id: ${input.memory_id}`);

      const action = input.action === "approve" ? "accept" : input.action;
      if (action === "promote_instruction") {
        const sourceRefs = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM agent_memory_source_refs WHERE memory_id = $1",
          [input.memory_id]
        );
        if (Number(sourceRefs.rows[0]?.count ?? 0) === 0) {
          return {
            ok: false,
            memory_id: input.memory_id,
            status: previous.status,
            use_policy: previous.use_policy,
            error_code: "source_refs_required",
            message: "Promotion to instruction_grade requires visible source refs."
          };
        }
      }
      const updates: string[] = ["updated_at = now()"];
      const values: unknown[] = [input.memory_id];
      const set = (sql: string, value: unknown) => {
        values.push(value);
        updates.push(`${sql} = $${values.length}`);
      };

      if (action === "accept") {
        set("status", "accepted");
        set("use_policy", "recall_allowed");
        set("accepted_by", input.actor_kind);
      } else if (action === "reject") {
        set("status", "rejected");
        set("use_policy", "do_not_use");
        set("rejected_by", input.actor_kind);
      } else if (action === "archive") {
        set("status", "archived");
      } else if (action === "unarchive") {
        set("status", "accepted");
      } else if (action === "mark_stale") {
        set("status", "stale");
        set("use_policy", "evidence_only");
      } else if (action === "promote_instruction") {
        set("status", "accepted");
        set("use_policy", "instruction_grade");
        set("accepted_by", input.actor_kind);
      } else if (action === "demote_instruction") {
        set("use_policy", "recall_allowed");
      } else if (action === "supersede") {
        set("status", "superseded");
        set("use_policy", "evidence_only");
        set("superseded_by", input.superseded_by ?? null);
      } else if (action === "edit") {
        if (input.patch?.title !== undefined) set("title", input.patch.title);
        if (input.patch?.body !== undefined) set("body", input.patch.body);
        if (input.patch?.scope !== undefined) set("scope", input.patch.scope);
        if (input.patch?.scope_kind !== undefined) set("scope_kind", input.patch.scope_kind);
        if (input.patch?.scope_id !== undefined) set("scope_id", input.patch.scope_id);
        if (input.patch?.audience !== undefined)
          set("audience", JSON.stringify(input.patch.audience));
        if (input.patch?.memory_type !== undefined) set("memory_type", input.patch.memory_type);
      } else if (action === "merge") {
        for (const mergeId of input.merge_memory_ids ?? []) {
          await client.query(
            `
              UPDATE agent_memories
              SET status = 'superseded',
                  use_policy = 'evidence_only',
                  superseded_by = $1,
                  updated_at = now()
              WHERE id = $2
            `,
            [input.memory_id, mergeId]
          );
        }
      }

      set("review_reason", input.note ?? action);
      await client.query(`UPDATE agent_memories SET ${updates.join(", ")} WHERE id = $1`, values);
      await client.query(
        `
          INSERT INTO agent_memory_review_actions (memory_id, action, actor_kind, note, metadata)
          VALUES ($1, $2, $3, $4, $5)
        `,
        [
          input.memory_id,
          action,
          input.actor_kind,
          input.note ?? null,
          JSON.stringify({
            previous,
            patch: input.patch ?? {},
            merge_memory_ids: input.merge_memory_ids ?? []
          })
        ]
      );
      const after = await client.query<{ status: string; use_policy: string }>(
        "SELECT status, use_policy FROM agent_memories WHERE id = $1",
        [input.memory_id]
      );
      return { ok: true, memory_id: input.memory_id, ...after.rows[0] };
    });
  }

  async listAgentMemories(input: ListAgentMemoriesInput) {
    const context = await this.ensureProject();
    const sourceFilter = await this.sourceFilter(input.source_id);
    if (input.view === "duplicates") {
      const values: unknown[] = [input.project_id ?? context.projectId, context.developerId];
      const clauses = [
        "developer_id = $2::uuid",
        "(project_id = $1::uuid OR scope = 'developer')",
        "status IN ('candidate', 'needs_review', 'accepted')",
        "use_policy <> 'do_not_use'"
      ];
      if (input.scope_kind) {
        values.push(input.scope_kind);
        clauses.push(`scope_kind = $${values.length}`);
      }
      values.push(input.limit ?? 50);
      const result = await this.pool.query(
        `
          WITH scoped AS (
            SELECT *,
              lower(regexp_replace(trim(title), '[^a-z0-9]+', ' ', 'gi')) AS duplicate_key
            FROM agent_memories
            WHERE ${clauses.join(" AND ")}
          ),
          duplicate_groups AS (
            SELECT duplicate_key, array_agg(id::text ORDER BY updated_at DESC) AS peer_ids
            FROM scoped
            WHERE duplicate_key <> ''
            GROUP BY duplicate_key
            HAVING count(*) > 1
          )
          SELECT
            s.id AS memory_id, s.memory_type, s.title, s.body, s.status, s.use_policy,
            s.scope, s.scope_kind, s.scope_id, s.audience, s.confidence, s.created_by,
            s.updated_at, true AS possible_duplicate, g.peer_ids AS duplicate_peer_ids,
            jsonb_build_object(
              'reason', 'same normalized title in overlapping project/developer scope',
              'auto_deleted', false,
              'recommended_actions', jsonb_build_array('merge', 'archive', 'supersede')
            ) AS duplicate_report
          FROM scoped s
          JOIN duplicate_groups g ON g.duplicate_key = s.duplicate_key
          ORDER BY s.updated_at DESC
          LIMIT $${values.length}::int
        `,
        values
      );
      return { memories: result.rows };
    }

    if (input.view === "conflicts") {
      const values: unknown[] = [input.project_id ?? context.projectId, context.developerId];
      const clauses = [
        "developer_id = $2::uuid",
        "(project_id = $1::uuid OR scope = 'developer')",
        "status = 'accepted'",
        "use_policy <> 'do_not_use'"
      ];
      if (input.scope_kind) {
        values.push(input.scope_kind);
        clauses.push(`scope_kind = $${values.length}`);
      }
      values.push(input.limit ?? 50);
      const result = await this.pool.query(
        `
          WITH scoped AS (
            SELECT *,
              lower(regexp_replace(trim(title), '[^a-z0-9]+', ' ', 'gi')) AS conflict_key,
              coalesce(scope_kind, scope) AS normalized_scope_kind,
              coalesce(scope_id, '') AS normalized_scope_id,
              coalesce(audience, '[]'::jsonb) AS normalized_audience
            FROM agent_memories
            WHERE ${clauses.join(" AND ")}
          ),
          conflict_groups AS (
            SELECT
              conflict_key,
              normalized_scope_kind,
              normalized_scope_id,
              normalized_audience,
              array_agg(id::text ORDER BY updated_at DESC) AS peer_ids,
              count(DISTINCT body) AS distinct_bodies,
              count(DISTINCT use_policy) AS distinct_authorities,
              bool_or(
                (title || ' ' || body) ~* '(secret|deploy|deployment|production|destructive|delete|erase|paid|billing|api|provider|model|server|account|connector)'
              ) AS high_risk
            FROM scoped
            WHERE conflict_key <> ''
            GROUP BY conflict_key, normalized_scope_kind, normalized_scope_id, normalized_audience
            HAVING count(*) > 1 AND count(DISTINCT body) > 1
          )
          SELECT
            s.id AS memory_id, s.memory_type, s.title, s.body, s.status, s.use_policy,
            s.scope, s.scope_kind, s.scope_id, s.audience, s.confidence, s.created_by,
            s.updated_at, true AS possible_conflict, g.peer_ids AS conflict_peer_ids,
            (
              SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at ASC), '[]'::jsonb)
              FROM agent_memory_source_refs r
              WHERE r.memory_id = s.id
            ) AS source_refs,
            CASE WHEN g.high_risk OR g.distinct_authorities = 1 THEN 'needs_review' ELSE 'suggest_supersede' END AS review_status,
            jsonb_build_object(
              'adr', 'ADR-0041',
              'applicability', 'overlapping scope and audience',
              'authority', CASE WHEN g.distinct_authorities = 1 THEN 'equal authority tier' ELSE 'different authority tiers' END,
              'scope_specificity', 'same scope_kind and scope_id',
              'recency', 'newer accepted records are candidates to supersede older equal-scope records',
              'resolution', CASE WHEN g.high_risk OR g.distinct_authorities = 1 THEN 'needs owner review; do not silently resolve' ELSE 'suggest supersede with audit edge' END
            ) AS conflict_report
          FROM scoped s
          JOIN conflict_groups g
            ON g.conflict_key = s.conflict_key
           AND g.normalized_scope_kind = s.normalized_scope_kind
           AND g.normalized_scope_id = s.normalized_scope_id
           AND g.normalized_audience = s.normalized_audience
          ORDER BY s.updated_at DESC
          LIMIT $${values.length}::int
        `,
        values
      );
      return { memories: result.rows.map((row) => this.withSourceProvenance(row)) };
    }

    const values: unknown[] = [input.project_id ?? context.projectId, context.developerId];
    const clauses = ["m.developer_id = $2::uuid"];
    if (input.view === "all") clauses.push("$1::uuid IS NOT NULL");
    if (input.view !== "all") clauses.push("(m.project_id = $1::uuid OR m.scope = 'developer')");
    if (input.view === "inbox") {
      clauses.push(
        `(
          m.status IN ('candidate', 'needs_review')
          OR m.metadata->>'policy_reason' LIKE '%high_risk%'
          OR m.metadata::text ILIKE '%possible_duplicate%'
          OR m.metadata::text ILIKE '%possible_conflict%'
          OR m.metadata::text ILIKE '%recommended_action%'
          OR m.metadata::text ILIKE '%review_candidate_action%'
          OR m.metadata::text ILIKE '%scope_change%'
          OR m.metadata::text ILIKE '%long_term%'
        )`
      );
    } else if (input.view === "rules") {
      clauses.push("m.status = 'accepted' AND m.use_policy = 'instruction_grade'");
    } else if (input.view === "candidates") {
      clauses.push("m.status IN ('candidate', 'needs_review')");
    } else if (input.status) {
      values.push(input.status);
      clauses.push(`m.status = $${values.length}`);
    }
    if (input.use_policy) {
      values.push(input.use_policy);
      clauses.push(`m.use_policy = $${values.length}`);
    }
    if (input.scope) {
      values.push(input.scope);
      clauses.push(`m.scope = $${values.length}`);
    }
    if (input.scope_kind) {
      values.push(input.scope_kind);
      clauses.push(`m.scope_kind = $${values.length}`);
    }
    if (input.memory_type) {
      values.push(input.memory_type);
      clauses.push(`m.memory_type = $${values.length}`);
    }
    if (input.memory_domain) {
      values.push(input.memory_domain);
      clauses.push(`m.memory_domain = $${values.length}`);
    }
    this.addSourceFilterClause(clauses, values, sourceFilter, "m");
    values.push(input.limit ?? 50);
    const result = await this.pool.query(
      `
        SELECT
          m.id AS memory_id,
          m.memory_domain,
          m.memory_type,
          m.title,
          m.body,
          m.status,
          m.use_policy,
          m.scope,
          m.scope_kind,
          m.scope_id,
          m.audience,
          m.confidence,
          m.created_by,
          m.metadata,
          m.updated_at,
          coalesce(
            jsonb_agg(to_jsonb(r) ORDER BY r.created_at ASC)
              FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
          ) AS source_refs
        FROM agent_memories m
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE ${clauses.join(" AND ")}
        GROUP BY m.id
        ORDER BY m.updated_at DESC
        LIMIT $${values.length}::int
      `,
      values
    );
    return { memories: result.rows.map((row) => this.withSourceProvenance(row)) };
  }

  async getAgentMemory(memoryId: string) {
    const memory = await this.pool.query("SELECT * FROM agent_memories WHERE id = $1", [memoryId]);
    const sourceRefs = await this.pool.query(
      "SELECT * FROM agent_memory_source_refs WHERE memory_id = $1 ORDER BY created_at ASC",
      [memoryId]
    );
    const reviewActions = await this.pool.query(
      "SELECT * FROM agent_memory_review_actions WHERE memory_id = $1 ORDER BY created_at DESC",
      [memoryId]
    );
    const memoryRow = memory.rows[0] ?? null;
    const memorySpace = memoryRow
      ? await this.pool.query(
          `
            SELECT id AS project_id, name, project_kind, memory_domain, primary_path
            FROM projects
            WHERE id = $1
          `,
          [memoryRow.project_id]
        )
      : null;
    const redactedSourceRefs = sourceRefs.rows.map((sourceRef) => this.redactSourceRef(sourceRef));
    const isUuid = (value: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const projectSourceIds = [
      ...new Set(
        redactedSourceRefs
          .flatMap((sourceRef) => {
            const record = sourceRef as Record<string, unknown>;
            const metadata =
              record.metadata && typeof record.metadata === "object"
                ? (record.metadata as Record<string, unknown>)
                : {};
            return [
              typeof record.source_id === "string" ? record.source_id : null,
              typeof metadata.project_source_id === "string" ? metadata.project_source_id : null,
              typeof metadata.source_id === "string" ? metadata.source_id : null
            ];
          })
          .filter((value): value is string => typeof value === "string" && isUuid(value))
      )
    ];
    const projectSourceRows =
      projectSourceIds.length > 0
        ? await this.pool.query(
            `
              SELECT id, project_id, source_kind, label, uri, is_primary, status, metadata,
                     created_at, updated_at
              FROM project_sources
              WHERE id = ANY($1::uuid[])
            `,
            [projectSourceIds]
          )
        : { rows: [] as Record<string, unknown>[] };
    const projectSourcesById = new Map(
      projectSourceRows.rows.map((source) => {
        const enriched = this.enrichProjectSource(source);
        return [String(enriched.id), enriched];
      })
    );
    const resolvedSourceRefs = redactedSourceRefs.map((sourceRef) => {
      const record = sourceRef as Record<string, unknown>;
      const metadata =
        record.metadata && typeof record.metadata === "object"
          ? (record.metadata as Record<string, unknown>)
          : {};
      const projectSourceId =
        (typeof metadata.project_source_id === "string" ? metadata.project_source_id : null) ??
        (typeof metadata.source_id === "string" ? metadata.source_id : null) ??
        (typeof record.source_id === "string" ? record.source_id : null);
      const projectSource = projectSourceId ? projectSourcesById.get(projectSourceId) : null;
      return {
        ...record,
        project_source: projectSource
          ? {
              source_id: projectSource.id,
              label: projectSource.display_label,
              source_kind: projectSource.source_kind,
              source_kind_label: projectSource.source_kind_label,
              status: projectSource.status,
              source_health: projectSource.source_health,
              is_primary: projectSource.is_primary
            }
          : null
      };
    });
    const memoryWithProvenance = memoryRow
      ? this.withSourceProvenance({ ...memoryRow, source_refs: redactedSourceRefs })
      : null;
    return {
      memory: memoryWithProvenance,
      memory_space: memorySpace?.rows[0] ?? null,
      source_refs: redactedSourceRefs,
      resolved_source_refs: resolvedSourceRefs,
      review_actions: reviewActions.rows,
      related_memories: []
    };
  }

  async recallAgentMemories(input: RecallAgentMemoriesInput) {
    const context = input.project_id
      ? await this.contextForProject(input.project_id)
      : await this.ensureProject();
    const lifecycle = await this.getProjectLifecycle(context.projectId);
    if (projectLifecycleIsDetached(lifecycle)) {
      return {
        trace_id: null,
        memories: [],
        truncated: false,
        lifecycle,
        warnings: ["Project is detached from active Recallant governed-memory recall."]
      };
    }
    const statuses = ["accepted"];
    if (input.include_candidates) statuses.push("candidate");
    if (input.include_needs_review) statuses.push("needs_review");
    if (input.include_stale) statuses.push("stale");
    const terms = Array.from(
      new Set(
        input.query
          .split(/[^A-Za-z0-9_-]+/)
          .map((term) => term.trim())
          .filter((term) => term.length >= 3)
          .slice(0, 8)
      )
    );
    const values: unknown[] = [context.developerId, context.projectId, input.query, statuses];
    const clauses = [
      "m.developer_id = $1::uuid",
      "(m.project_id = $2::uuid OR m.scope = 'developer')",
      "m.status = ANY($4::text[])",
      "m.use_policy <> 'do_not_use'"
    ];
    if (terms.length > 0) {
      clauses.push("$3::text IS NOT NULL");
      const termClauses = terms.map((term) => {
        values.push(term);
        return `(m.title ILIKE '%' || $${values.length} || '%' OR m.body ILIKE '%' || $${values.length} || '%' OR m.memory_type ILIKE '%' || $${values.length} || '%')`;
      });
      clauses.push(`(${termClauses.join(" OR ")})`);
    } else {
      clauses.push(
        "(m.title ILIKE '%' || $3 || '%' OR m.body ILIKE '%' || $3 || '%' OR m.memory_type ILIKE '%' || $3 || '%')"
      );
    }
    if (!input.include_candidates) clauses.push("m.status <> 'candidate'");
    if (!input.include_needs_review) clauses.push("m.status <> 'needs_review'");
    if (!input.include_stale) clauses.push("m.status <> 'stale'");
    if (input.memory_types && input.memory_types.length > 0) {
      values.push(input.memory_types);
      clauses.push(`m.memory_type = ANY($${values.length}::text[])`);
    }
    if (input.scope_kind) {
      values.push(input.scope_kind);
      clauses.push(`m.scope_kind = $${values.length}`);
    }
    const sourceFilter = await this.sourceFilter(input.source_id);
    this.addSourceFilterClause(clauses, values, sourceFilter, "m");
    const result = await this.pool.query(
      `
        SELECT
          m.id AS memory_id,
          m.memory_type,
          m.title,
          m.body,
          m.status,
          m.use_policy,
          m.scope,
          m.scope_kind,
          m.scope_id,
          m.audience,
          m.confidence,
          m.updated_at,
          coalesce(
            jsonb_agg(to_jsonb(r) ORDER BY r.created_at ASC)
              FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
          ) AS source_refs
        FROM agent_memories m
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE ${clauses.join(" AND ")}
        GROUP BY m.id
        ORDER BY
          CASE m.use_policy WHEN 'instruction_grade' THEN 0 WHEN 'recall_allowed' THEN 1 ELSE 2 END,
          m.updated_at DESC
        LIMIT $${values.length + 1}::int
      `,
      [...values, input.top_k ?? 8]
    );
    let usedChars = 0;
    const maxChars = input.max_chars_total ?? 12_000;
    const memories = [];
    for (const row of result.rows) {
      if (usedChars >= maxChars) break;
      const body = String(row.body ?? "");
      const remaining = maxChars - usedChars;
      memories.push(this.withSourceProvenance({ ...row, body: body.slice(0, remaining) }));
      usedChars += Math.min(body.length, remaining);
    }
    const trace = await this.pool.query<{ id: string }>(
      `
        INSERT INTO recall_traces (
          developer_id, project_id, tool_name, query, returned_memory_ids, metadata
        )
        VALUES ($1, $2, 'memory_recall_agent_memories', $3, $4, $5)
        RETURNING id
      `,
      [
        context.developerId,
        context.projectId,
        input.query,
        JSON.stringify(memories.map((memory) => memory.memory_id)),
        JSON.stringify({
          truncated: result.rows.length > memories.length,
          source_id: sourceFilter?.source_id ?? null
        })
      ]
    );
    return {
      trace_id: trace.rows[0]?.id,
      memories,
      truncated: result.rows.length > memories.length
    };
  }

  async crossProjectRecall(input: CrossProjectRecallInput) {
    const context = input.session_id
      ? await this.contextForSession(input.session_id)
      : await this.ensureProject();
    const mode = input.mode ?? "similar_projects";
    const statuses = ["accepted"];
    if (mode === "all_projects_review") statuses.push("candidate", "needs_review", "stale");
    if (input.include_candidates) statuses.push("candidate");
    if (input.include_needs_review) statuses.push("needs_review");
    if (input.include_stale) statuses.push("stale");
    const uniqueStatuses = Array.from(new Set(statuses));
    const values: unknown[] = [context.developerId, context.projectId, input.query, uniqueStatuses];
    const clauses = [
      "m.developer_id = $1::uuid",
      "m.status = ANY($4::text[])",
      "m.use_policy <> 'do_not_use'",
      "(m.title ILIKE '%' || $3 || '%' OR m.body ILIKE '%' || $3 || '%' OR m.memory_type ILIKE '%' || $3 || '%' OR coalesce(m.scope_kind, '') ILIKE '%' || $3 || '%')"
    ];

    if (input.include_detached !== true) {
      clauses.push(
        "(m.project_id IS NULL OR (coalesce(lifecycle.value->>'visibility', 'active') <> 'hidden' AND coalesce(lifecycle.value->>'status', 'active') NOT IN ('detached', 'sandbox_cleaned')))"
      );
    }

    if (mode === "same_project") {
      clauses.push("(m.project_id = $2::uuid OR m.scope = 'developer')");
    } else if (mode === "developer_rules") {
      clauses.push("m.scope = 'developer'");
      clauses.push("m.status = 'accepted'");
      clauses.push("m.use_policy = 'instruction_grade'");
    } else if (mode === "environment") {
      clauses.push(
        "m.scope_kind = ANY(ARRAY['environment', 'capability', 'connector_account', 'domain'])"
      );
    } else if (mode === "similar_projects") {
      clauses.push("m.project_id IS NOT NULL");
      clauses.push("m.project_id <> $2::uuid");
    }

    if (input.scope_kind) {
      values.push(input.scope_kind);
      clauses.push(`m.scope_kind = $${values.length}`);
    }
    if (input.memory_types && input.memory_types.length > 0) {
      values.push(input.memory_types);
      clauses.push(`m.memory_type = ANY($${values.length}::text[])`);
    }
    values.push(input.top_k ?? 8);
    const rows = await this.pool.query<{
      memory_id: string;
      memory_type: string;
      title: string;
      body: string;
      status: string;
      use_policy: string;
      scope: string;
      scope_kind: string | null;
      scope_id: string | null;
      audience: unknown;
      confidence: number | null;
      updated_at: string;
      project_id: string | null;
      project_name: string | null;
      primary_path: string | null;
      source_refs: unknown;
    }>(
      `
        SELECT
          m.id AS memory_id,
          m.memory_type,
          m.title,
          m.body,
          m.status,
          m.use_policy,
          m.scope,
          m.scope_kind,
          m.scope_id,
          m.audience,
          m.confidence,
          m.updated_at,
          m.project_id,
          p.name AS project_name,
          p.primary_path,
          coalesce(
            jsonb_agg(to_jsonb(r) ORDER BY r.created_at ASC)
              FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
          ) AS source_refs
        FROM agent_memories m
        LEFT JOIN projects p ON p.id = m.project_id
        LEFT JOIN project_settings lifecycle
          ON lifecycle.project_id = p.id
         AND lifecycle.key = 'project_lifecycle'
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE ${clauses.join(" AND ")}
        GROUP BY m.id, p.id
        ORDER BY
          CASE m.use_policy WHEN 'instruction_grade' THEN 0 WHEN 'recall_allowed' THEN 1 ELSE 2 END,
          CASE WHEN m.project_id = $2::uuid THEN 0 ELSE 1 END,
          m.updated_at DESC
        LIMIT $${values.length}::int
      `,
      values
    );

    let usedChars = 0;
    const maxChars = input.max_chars_total ?? 12_000;
    const results = [];
    for (const row of rows.rows) {
      if (usedChars >= maxChars) break;
      const body = redactSecretValues(String(row.body ?? ""));
      const remaining = maxChars - usedChars;
      const bodyExcerpt = body.slice(0, remaining);
      usedChars += bodyExcerpt.length;
      const sourceRefs = Array.isArray(row.source_refs)
        ? row.source_refs.map((sourceRef) => this.redactSourceRef(sourceRef))
        : [];
      const sourcePath = this.sourcePathFromRefs(sourceRefs);
      const sourceProject = {
        project_id: row.project_id,
        name: row.project_name,
        primary_path: row.primary_path
      };
      const sameProject = row.project_id === context.projectId || row.scope === "developer";
      results.push({
        memory_id: row.memory_id,
        memory_type: row.memory_type,
        title: redactSecretValues(row.title),
        body: bodyExcerpt,
        status: row.status,
        use_policy: row.use_policy,
        scope: row.scope,
        scope_kind: row.scope_kind,
        scope_id: row.scope_id,
        audience: row.audience,
        confidence: row.confidence,
        updated_at: row.updated_at,
        source_project: sourceProject,
        source_path: sourcePath,
        source_refs: sourceRefs,
        why: `${mode}: matched query text in governed memory`,
        applicability: sameProject
          ? "directly_applicable"
          : mode === "environment"
            ? "verify_before_applying"
            : "example_only",
        applicability_warning: sameProject
          ? "This record already applies to the current project or developer scope."
          : "This is source-linked evidence from another project. Do not treat it as a current-project rule unless you apply it locally and create current-project memory or promote a general rule through review.",
        promotion_policy:
          "Cross-project results remain evidence/examples. Applying a pattern requires current-project memory with source refs; broad rules require review."
      });
    }

    const trace = await this.pool.query<{ id: string }>(
      `
        INSERT INTO recall_traces (
          developer_id, project_id, tool_name, query, returned_memory_ids, metadata
        )
        VALUES ($1, $2, 'memory_cross_project_recall', $3, $4, $5)
        RETURNING id
      `,
      [
        context.developerId,
        context.projectId,
        input.query,
        JSON.stringify(results.map((result) => result.memory_id)),
        JSON.stringify({
          mode,
          include_detached: input.include_detached === true,
          truncated: rows.rows.length > results.length
        })
      ]
    );

    return {
      trace_id: trace.rows[0]?.id,
      mode,
      current_project_id: context.projectId,
      results,
      truncated: rows.rows.length > results.length,
      policy: {
        default_context_pack_includes_cross_project_examples: false,
        cross_project_results_are_binding_rules: false,
        source_linked_examples_only: mode === "similar_projects" || mode === "all_projects_review"
      }
    };
  }

  async reportRecallUsage(input: ReportRecallUsageInput) {
    await this.pool.query(
      `
        UPDATE recall_traces
        SET used_memory_ids = $2, ignored_memory_ids = $3, used_chunk_ids = $4,
            metadata = coalesce(metadata, '{}'::jsonb) || $5::jsonb
        WHERE id = $1
      `,
      [
        input.trace_id,
        JSON.stringify(input.used_memory_ids ?? []),
        JSON.stringify(input.ignored_memory_ids ?? []),
        JSON.stringify(input.used_chunk_ids ?? []),
        JSON.stringify({ usage_note: input.note ?? null })
      ]
    );
    return { ok: true, trace_id: input.trace_id };
  }

  async sanitizeProject(input: ProjectSanitizeInput) {
    const mode = input.mode ?? "purge";
    if (mode === "detach") {
      return this.detachProject({
        project_id: input.project_id,
        project_path: input.project_path,
        mode: input.detach_mode ?? "live",
        dry_run: input.dry_run,
        reason: input.reason,
        actor_kind: input.actor_kind,
        actor_id: input.actor_id,
        confirmation: {
          confirmed: input.confirmation?.confirmed
        }
      });
    }

    const target = await this.findProjectForManagement(input);
    const project = target.project;
    if (!project) {
      return {
        ok: false,
        action: "project_sanitize",
        status: "not_found",
        mode,
        dry_run: true,
        writes_database: false,
        project: null,
        target_resolution: target.target_resolution,
        affected: {},
        warnings: [
          ...target.warnings,
          "No matching managed project was found. No data was changed."
        ]
      };
    }

    const affected = await this.countProjectRecords(project.project_id);
    const previousLifecycle = await this.getProjectLifecycle(project.project_id);
    const confirmationToken = projectSanitizeConfirmationToken(mode, project);
    const dryRun =
      input.dry_run !== false ||
      input.confirmation?.confirmed !== true ||
      input.confirmation?.confirmation_token !== confirmationToken;
    const deleteKeys = [
      "projects",
      "project_sources",
      "sessions",
      "session_overrides",
      "events",
      "raw_artifacts",
      "chunks",
      "embeddings",
      "edges",
      "checkpoints",
      "agent_memories",
      "agent_memory_source_refs",
      "agent_memory_review_actions",
      "ingest_dedup_keys",
      "project_settings",
      "client_adapter_settings",
      "settings_audit_events"
    ];
    const deidentifyKeys = [
      "recall_traces",
      "model_calls",
      "paid_api_approvals",
      "erasure_requests",
      "system_activity_events"
    ];
    const plannedDeletedRecords = sumCounts(affected, deleteKeys);
    const plannedDeidentifiedRecords = sumCounts(affected, deidentifyKeys);
    const plan = {
      delete_records: Object.fromEntries(deleteKeys.map((key) => [key, countValue(affected, key)])),
      deidentify_records: Object.fromEntries(
        deidentifyKeys.map((key) => [key, countValue(affected, key)])
      ),
      retain_records: {
        redacted_erasure_receipt: 1
      },
      local_disconnect: {
        planned_by: "cli",
        writes_files: false,
        reason:
          "Database planning does not touch project files. CLI project-sanitize performs local disconnect after DB confirmation."
      }
    };
    const confirmation = {
      required: true,
      token: confirmationToken,
      token_hint: "Pass this exact value with --confirm-token after reviewing the dry-run."
    };

    if (dryRun) {
      return {
        ok: true,
        action: "project_sanitize",
        status: "pending_confirmation",
        mode,
        dry_run: true,
        writes_database: false,
        project,
        target_resolution: target.target_resolution,
        previous_lifecycle: previousLifecycle,
        affected,
        plan,
        confirmation,
        warnings: [
          ...target.warnings,
          "Dry run only. No Recallant records, project files, or local artifacts were changed.",
          "Project purge is irreversible for Recallant-controlled project memory and capture records.",
          "Project purge does not delete source files, secrets, downloads, or arbitrary project data."
        ]
      };
    }

    const erasureId = randomUUID();
    const redactedReceipt = {
      action: "project_sanitize",
      mode,
      project_id: project.project_id,
      project_name: project.name,
      primary_path_present: Boolean(project.primary_path),
      affected,
      deleted_records_planned: plannedDeletedRecords,
      deidentified_records_planned: plannedDeidentifiedRecords,
      system_activity_events_policy: "deidentified_governance_audit_rows_retained",
      content_removed: true
    };

    let deletedSettingsAudit = 0;
    let deidentifiedRecallTraces = 0;
    let deidentifiedModelCalls = 0;
    let updatedPaidApprovals = 0;
    let deidentifiedErasureRequests = 0;
    let deidentifiedSystemActivity = 0;
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `
          INSERT INTO erasure_requests (
            id, developer_id, project_id, requested_by, request_source, target_selector,
            reason, status, requires_confirmation, confirmed_by, confirmed_at, executed_at,
            redacted_receipt
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', true, $8, now(), now(), $9)
        `,
        [
          erasureId,
          project.developer_id,
          project.project_id,
          input.actor_id ?? "owner",
          input.request_source ?? "cli",
          JSON.stringify({ kind: "project", id: project.project_id, mode }),
          input.reason ?? "recallant project sanitize purge",
          input.actor_id ?? "owner",
          JSON.stringify(redactedReceipt)
        ]
      );

      const recallTraceResult = await client.query(
        `
          UPDATE recall_traces
          SET query = NULL,
              returned_chunk_ids = '[]'::jsonb,
              returned_memory_ids = '[]'::jsonb,
              used_chunk_ids = NULL,
              used_memory_ids = NULL,
              ignored_memory_ids = NULL,
              metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb
          WHERE project_id = $1
        `,
        [
          project.project_id,
          JSON.stringify({ project_purged: true, project_purge_erasure_id: erasureId })
        ]
      );
      deidentifiedRecallTraces = recallTraceResult.rowCount ?? 0;

      const modelCallResult = await client.query(
        `
          UPDATE model_calls
          SET memory_domain = NULL,
              metadata = coalesce(metadata, '{}'::jsonb) || $2::jsonb
          WHERE project_id = $1
        `,
        [
          project.project_id,
          JSON.stringify({ project_purged: true, project_purge_erasure_id: erasureId })
        ]
      );
      deidentifiedModelCalls = modelCallResult.rowCount ?? 0;

      const paidApprovalResult = await client.query(
        `
          UPDATE paid_api_approval_requests
          SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
              decided_by = CASE WHEN status = 'pending' THEN $2 ELSE decided_by END,
              decision_note = CASE
                WHEN status = 'pending' THEN 'Project purged before approval'
                ELSE decision_note
              END,
              decided_at = CASE WHEN status = 'pending' THEN now() ELSE decided_at END
          WHERE project_id = $1
        `,
        [project.project_id, input.actor_id ?? "recallant-cli"]
      );
      updatedPaidApprovals = paidApprovalResult.rowCount ?? 0;

      const erasureRequestResult = await client.query(
        `
          UPDATE erasure_requests
          SET target_selector = $2,
              redacted_receipt = coalesce(redacted_receipt, '{}'::jsonb) || $3::jsonb
          WHERE project_id = $1
            AND id <> $4
        `,
        [
          project.project_id,
          JSON.stringify({ project_purged: true, previous_selector_redacted: true }),
          JSON.stringify({ project_purged: true, project_purge_erasure_id: erasureId }),
          erasureId
        ]
      );
      deidentifiedErasureRequests = erasureRequestResult.rowCount ?? 0;

      const systemActivityResult = await client.query(
        `
          UPDATE system_activity_events
          SET project_id = NULL,
              session_id = NULL,
              related_ids = (coalesce(related_ids, '{}'::jsonb) - 'project_id' - 'session_id') || $2::jsonb,
              redacted_metadata = (coalesce(redacted_metadata, '{}'::jsonb) - 'project_id' - 'project_path' - 'session_id') || $3::jsonb
          WHERE project_id = $1
        `,
        [
          project.project_id,
          JSON.stringify({ project_purged: true, project_purge_erasure_id: erasureId }),
          JSON.stringify({
            project_purged: true,
            project_purge_erasure_id: erasureId,
            project_identity_redacted: true
          })
        ]
      );
      deidentifiedSystemActivity = systemActivityResult.rowCount ?? 0;

      const settingsAuditResult = await client.query(
        "DELETE FROM settings_audit_events WHERE scope_kind = 'project' AND scope_id = $1",
        [project.project_id]
      );
      deletedSettingsAudit = settingsAuditResult.rowCount ?? 0;

      await client.query("DELETE FROM projects WHERE id = $1", [project.project_id]);
    });

    return {
      ok: true,
      action: "project_sanitize",
      status: "purged",
      mode,
      dry_run: false,
      writes_database: true,
      project,
      target_resolution: target.target_resolution,
      previous_lifecycle: previousLifecycle,
      affected,
      plan,
      erasure_id: erasureId,
      redacted_receipt: redactedReceipt,
      changes: {
        physically_deleted_records: plannedDeletedRecords,
        settings_audit_events_deleted: deletedSettingsAudit,
        deidentified_records:
          deidentifiedRecallTraces +
          deidentifiedModelCalls +
          updatedPaidApprovals +
          deidentifiedErasureRequests +
          deidentifiedSystemActivity,
        recall_traces_deidentified: deidentifiedRecallTraces,
        model_calls_deidentified: deidentifiedModelCalls,
        paid_api_approvals_cancelled_or_deidentified: updatedPaidApprovals,
        erasure_requests_deidentified: deidentifiedErasureRequests,
        system_activity_events_deidentified: deidentifiedSystemActivity,
        retained_redacted_receipts: countValue(affected, "erasure_requests") + 1,
        files_changed: 0
      },
      warnings: [
        ...target.warnings,
        "Recallant database records for this project were purged or de-identified.",
        "System activity ledger rows were retained only as de-identified governance evidence.",
        "No project files were touched by the database purge.",
        "Run local disconnect cleanup separately or through the CLI orchestration to remove local Recallant artifacts."
      ]
    };
  }

  async detachProject(input: DetachProjectInput) {
    const mode = input.mode ?? "live";
    const target = await this.findProjectForManagement(input);
    const project = target.project;
    if (!project) {
      return {
        ok: false,
        action: "project_detach",
        status: "not_found",
        dry_run: true,
        writes_database: false,
        project: null,
        target_resolution: target.target_resolution,
        affected: {},
        warnings: [
          ...target.warnings,
          "No matching managed project was found. No data was changed."
        ]
      };
    }

    const affected = await this.countProjectRecords(project.project_id);
    const previousLifecycle = await this.getProjectLifecycle(project.project_id);
    const dryRun = input.dry_run !== false || input.confirmation?.confirmed !== true;
    const lifecycle: ProjectLifecycle = {
      status: mode === "sandbox" ? "sandbox_cleaned" : "detached",
      visibility: "hidden",
      searchable: false,
      detached_at: new Date().toISOString(),
      detach_mode: mode,
      reason: input.reason ?? null
    };
    const localCleanupPlan =
      mode === "sandbox"
        ? [
            {
              action: "optional_local_cleanup",
              writes_files: false,
              reason:
                "After reviewing this dry-run, a separate explicit local cleanup may remove .recallant/config, bootstrap edits, or the sandbox copy."
            }
          ]
        : [
            {
              action: "none",
              writes_files: false,
              reason: "Live project detach does not touch project files."
            }
          ];

    if (dryRun) {
      return {
        ok: true,
        action: "project_detach",
        status: "pending_confirmation",
        dry_run: true,
        writes_database: false,
        mode,
        project,
        target_resolution: target.target_resolution,
        previous_lifecycle: previousLifecycle,
        planned_lifecycle: lifecycle,
        affected,
        local_cleanup_plan: localCleanupPlan,
        warnings: [
          ...target.warnings,
          "Dry run only. No Recallant records, project files, or local sandbox files were changed.",
          "Ordinary detach is not permanent erasure. Use the separate forget-forever workflow for sensitive or wrong memory."
        ]
      };
    }

    let archivedChunks = 0;
    let closedSessions = 0;
    let cancelledPaidApprovals = 0;
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `
          UPDATE projects
          SET updated_at = now()
          WHERE id = $1
        `,
        [project.project_id]
      );
      await client.query(
        `
          INSERT INTO project_settings (project_id, key, value, reason, updated_by)
          VALUES ($1, 'project_lifecycle', $2, $3, $4)
          ON CONFLICT (project_id, key) DO UPDATE
          SET value = EXCLUDED.value,
              reason = EXCLUDED.reason,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
        `,
        [
          project.project_id,
          JSON.stringify(lifecycle),
          input.reason ?? `recallant detach ${mode}`,
          input.actor_id ?? "recallant-cli"
        ]
      );
      await client.query(
        `
          INSERT INTO settings_audit_events (
            scope_kind, scope_id, key, old_value, new_value, actor_kind, actor_id, reason
          )
          VALUES ('project', $1, 'project_lifecycle', $2, $3, $4, $5, $6)
        `,
        [
          project.project_id,
          JSON.stringify(previousLifecycle),
          JSON.stringify(lifecycle),
          input.actor_kind ?? "system",
          input.actor_id ?? "recallant-cli",
          input.reason ?? `recallant detach ${mode}`
        ]
      );
      const sessionResult = await client.query(
        `
          UPDATE sessions
          SET status = 'closed',
              ended_reason = 'superseded',
              ended_at = coalesce(ended_at, now()),
              last_seen_at = now()
          WHERE project_id = $1
            AND status = 'active'
            AND ended_at IS NULL
        `,
        [project.project_id]
      );
      closedSessions = sessionResult.rowCount ?? 0;
      if (mode === "sandbox") {
        const chunkResult = await client.query(
          `
            UPDATE chunks
            SET archived_at = coalesce(archived_at, now())
            WHERE project_id = $1
              AND archived_at IS NULL
          `,
          [project.project_id]
        );
        archivedChunks = chunkResult.rowCount ?? 0;
      }
      const paidResult = await client.query(
        `
          UPDATE paid_api_approval_requests
          SET status = 'cancelled',
              decided_by = $2,
              decision_note = 'Project detached before approval',
              decided_at = now()
          WHERE project_id = $1
            AND status = 'pending'
        `,
        [project.project_id, input.actor_id ?? "recallant-cli"]
      );
      cancelledPaidApprovals = paidResult.rowCount ?? 0;
    });

    return {
      ok: true,
      action: "project_detach",
      status: "detached",
      dry_run: false,
      writes_database: true,
      mode,
      project,
      target_resolution: target.target_resolution,
      previous_lifecycle: previousLifecycle,
      lifecycle,
      affected,
      changes: {
        closed_active_sessions: closedSessions,
        archived_chunks: archivedChunks,
        cancelled_paid_approvals: cancelledPaidApprovals,
        physically_deleted_records: 0,
        files_changed: 0
      },
      local_cleanup_plan: localCleanupPlan,
      warnings: [
        ...target.warnings,
        "No project files were touched.",
        "No physical records were deleted.",
        "Sensitive or wrong memory still requires the separate confirmed forget-forever workflow."
      ]
    };
  }

  private async resolveProjectContext(input?: {
    project_id?: string | null;
    project_path?: string | null;
  }): Promise<ProjectContext> {
    if (!input?.project_id) return this.ensureProject(input?.project_path);
    const project = await this.pool.query<{ developer_id: string }>(
      "SELECT developer_id FROM projects WHERE id = $1",
      [input.project_id]
    );
    const developerId = project.rows[0]?.developer_id;
    if (!developerId) throw new Error(`Project not found: ${input.project_id}`);
    return { projectId: input.project_id, developerId };
  }

  async pendingEmbeddingStatus(input?: {
    project_id?: string | null;
    project_path?: string | null;
  }) {
    const context = await this.resolveProjectContext(input);
    const status = await this.pool.query(
      `
        SELECT
          (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND archived_at IS NULL) AS active_chunks,
          (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND archived_at IS NULL AND embed_status = 'pending') AS pending_chunks,
          (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND archived_at IS NULL AND embed_status = 'embedded') AS embedded_chunks,
          (
            SELECT jsonb_build_object(
              'status', status,
              'error_code', error_code,
              'provider', provider,
              'model', model,
              'metadata', metadata,
              'created_at', created_at
            )
            FROM model_calls
            WHERE project_id = $1
              AND purpose = 'chunk_embedding'
              AND status = 'failed'
            ORDER BY created_at DESC
            LIMIT 1
          ) AS latest_failure,
          (
            SELECT jsonb_build_object(
              'status', status,
              'error_code', error_code,
              'provider', provider,
              'model', model,
              'metadata', metadata,
              'created_at', created_at
            )
            FROM model_calls
            WHERE project_id = $1
              AND purpose = 'chunk_embedding'
            ORDER BY created_at DESC
            LIMIT 1
          ) AS latest_attempt
      `,
      [context.projectId]
    );
    const row = status.rows[0] ?? {};
    const pendingChunks = Number(row.pending_chunks ?? 0);
    const recoveryCommand = `recallant recover-embeddings --project-id ${context.projectId} --limit 50`;
    return {
      project_id: context.projectId,
      active_chunks: Number(row.active_chunks ?? 0),
      embedded_chunks: Number(row.embedded_chunks ?? 0),
      pending_chunks: pendingChunks,
      latest_failure: row.latest_failure ?? null,
      latest_attempt: row.latest_attempt ?? null,
      recovery_available: true,
      recommendation: pendingChunks > 0 ? recoveryCommand : "No pending embeddings to recover.",
      recovery: {
        available: true,
        recommended: pendingChunks > 0,
        attempted: Boolean(row.latest_attempt),
        latest_attempt: row.latest_attempt ?? null,
        latest_failure: row.latest_failure ?? null,
        command: pendingChunks > 0 ? recoveryCommand : null,
        scope: "project",
        default_limit: 50
      }
    };
  }

  async recoverPendingEmbeddings(input?: {
    project_id?: string | null;
    project_path?: string | null;
    limit?: number | null;
    dry_run?: boolean | null;
  }) {
    const context = await this.resolveProjectContext(input);
    const limit = Math.min(Math.max(Number(input?.limit ?? 50), 1), 500);
    const before = await this.pendingEmbeddingStatus({ project_id: context.projectId });
    return withTransaction(this.pool, async (client) => {
      const pending = await client.query<{ id: string; text: string }>(
        `
          SELECT id, text
          FROM chunks
          WHERE project_id = $1
            AND archived_at IS NULL
            AND embed_status = 'pending'
          ORDER BY created_at ASC, id ASC
          LIMIT $2
        `,
        [context.projectId, limit]
      );
      if (input?.dry_run) {
        return {
          status: "dry_run",
          project_id: context.projectId,
          limit,
          pending_before: before.pending_chunks,
          eligible_chunks: pending.rows.length,
          recovery_available: true
        };
      }
      if (pending.rows.length === 0) {
        return {
          status: "nothing_to_do",
          project_id: context.projectId,
          limit,
          pending_before: before.pending_chunks,
          recovered_chunks: 0,
          remaining_pending: before.pending_chunks
        };
      }
      const embedding = await this.embedChunks(client, {
        developerId: context.developerId,
        projectId: context.projectId,
        sessionId: null,
        chunkIds: pending.rows.map((row) => row.id),
        texts: pending.rows.map((row) => row.text)
      });
      const after = await client.query<{ pending_chunks: number; embedding_rows: number }>(
        `
          SELECT
            (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND archived_at IS NULL AND embed_status = 'pending') AS pending_chunks,
            (
              SELECT count(*)::int
              FROM embeddings e
              JOIN chunks c ON c.id = e.chunk_id
              WHERE c.project_id = $1
                AND c.archived_at IS NULL
            ) AS embedding_rows
        `,
        [context.projectId]
      );
      const pendingAfter = Number(after.rows[0]?.pending_chunks ?? 0);
      return {
        status: embedding.status === "embedded" ? "completed" : "pending",
        project_id: context.projectId,
        limit,
        attempted_chunks: pending.rows.length,
        recovered_chunks: embedding.status === "embedded" ? pending.rows.length : 0,
        remaining_pending: pendingAfter,
        embedding_rows: Number(after.rows[0]?.embedding_rows ?? 0),
        embedding,
        warning:
          embedding.status === "embedded"
            ? null
            : "Pending embeddings remain because the embedding provider is unavailable."
      };
    });
  }

  async getReviewDashboard(input?: {
    project_id?: string | null;
    selected_memory_id?: string | null;
    source_id?: string | null;
    rule_scope?: string | null;
    rule_scope_kind?: string | null;
    rule_memory_type?: string | null;
    rule_memory_domain?: string | null;
  }) {
    const context = await this.ensureProject();
    const dashboardProjectId = input?.project_id ?? context.projectId;
    const projects = await this.pool.query(
      `
        WITH project_usage AS (
          SELECT
            p.id,
            p.developer_id,
            p.name,
            p.primary_path,
            p.project_kind,
            p.memory_domain,
            p.updated_at,
            (SELECT count(*)::int FROM sessions s WHERE s.project_id = p.id) AS session_count,
            (SELECT count(*)::int FROM sessions s WHERE s.project_id = p.id AND s.status = 'active') AS active_sessions,
            (SELECT count(*)::int FROM sessions s WHERE s.project_id = p.id AND s.status = 'interrupted') AS interrupted_sessions,
            (SELECT count(*)::int FROM events e WHERE e.project_id = p.id) AS event_count,
            (SELECT count(*)::int FROM agent_memories m WHERE m.project_id = p.id) AS memory_count,
            (SELECT updated_at FROM checkpoints c WHERE c.project_id = p.id) AS checkpoint_updated_at,
            (
              SELECT max(e.created_at)
              FROM events e
              WHERE e.project_id = p.id
                AND e.payload->'metadata'->>'capture_kind' = 'context_read'
            ) AS last_context_read_at,
            (
              SELECT max(activity_at)
              FROM (
                SELECT max(e.created_at) AS activity_at
                FROM events e
                WHERE e.project_id = p.id
                  AND (
                    e.payload->'metadata'->>'capture_kind' LIKE 'agent_%'
                    OR e.kind IN ('turn_user', 'turn_assistant', 'tool_result', 'file_change', 'checkpoint')
                  )
                UNION ALL
                SELECT max(m.updated_at) AS activity_at
                FROM agent_memories m
                WHERE m.project_id = p.id
              ) AS memory_activity
            ) AS last_memory_write_at
          FROM projects p
          LEFT JOIN project_settings lifecycle
            ON lifecycle.project_id = p.id
           AND lifecycle.key = 'project_lifecycle'
          WHERE p.developer_id = $1
            AND coalesce(lifecycle.value->>'visibility', 'active') <> 'hidden'
            AND coalesce(lifecycle.value->>'status', 'active') NOT IN ('detached', 'sandbox_cleaned')
        ),
        ranked AS (
          SELECT *,
            row_number() OVER (
              PARTITION BY coalesce(primary_path, id::text)
              ORDER BY (session_count + event_count + memory_count) DESC, updated_at DESC
            ) AS rank
          FROM project_usage
        )
        SELECT id AS project_id, developer_id, name, primary_path, project_kind, memory_domain, updated_at,
               session_count, active_sessions, interrupted_sessions, event_count, memory_count,
               checkpoint_updated_at, last_context_read_at, last_memory_write_at
        FROM ranked
        WHERE rank = 1
        ORDER BY updated_at DESC
        LIMIT 20
      `,
      [context.developerId]
    );
    const projectIds = projects.rows.map((project) => project.project_id);
    const sourcesByProject = new Map<string, unknown[]>();
    if (projectIds.length > 0) {
      try {
        const sourceRows = await this.pool.query(
          `
            SELECT id AS source_id, project_id, source_kind, label, uri, is_primary, status,
                   metadata, created_at, updated_at
            FROM project_sources
            WHERE project_id = ANY($1::uuid[])
            ORDER BY is_primary DESC, status, source_kind, label
          `,
          [projectIds]
        );
        for (const source of sourceRows.rows) {
          const key = String(source.project_id);
          const rows = sourcesByProject.get(key) ?? [];
          rows.push(this.enrichProjectSource(source));
          sourcesByProject.set(key, rows);
        }
      } catch (error) {
        if ((error as { code?: string }).code !== "42P01") throw error;
      }
    }
    projects.rows = projects.rows.map((project) => ({
      ...project,
      memory_profile: memorySpaceProfile(project),
      sources: sourcesByProject.get(String(project.project_id)) ?? []
    }));
    const currentProject =
      projects.rows.find((project) => project.project_id === dashboardProjectId) ?? null;
    const currentSources = Array.isArray(currentProject?.sources)
      ? (currentProject.sources as Array<Record<string, unknown>>)
      : [];
    const selectedSourceId = input?.source_id && input.source_id !== "all" ? input.source_id : null;
    const sourceFilter = await this.sourceFilter(selectedSourceId);
    const effectiveSourceId = sourceFilter?.source_id ?? null;
    const ruleMemoryDomain =
      input?.rule_memory_domain === "all"
        ? undefined
        : (input?.rule_memory_domain ?? currentProject?.memory_domain ?? "agent_work");
    const inbox = await this.listAgentMemories({
      view: "inbox",
      project_id: dashboardProjectId,
      source_id: effectiveSourceId,
      limit: 25
    });
    const rules = await this.listAgentMemories({
      view: "rules",
      project_id: dashboardProjectId,
      source_id: effectiveSourceId,
      scope: input?.rule_scope && input.rule_scope !== "all" ? input.rule_scope : undefined,
      scope_kind:
        input?.rule_scope_kind && input.rule_scope_kind !== "all"
          ? input.rule_scope_kind
          : undefined,
      memory_type:
        input?.rule_memory_type && input.rule_memory_type !== "all"
          ? input.rule_memory_type
          : undefined,
      memory_domain: ruleMemoryDomain,
      limit: 25
    });
    const sourceClauses: string[] = [];
    const sourceValues: unknown[] = [context.developerId, dashboardProjectId];
    this.addSourceFilterClause(sourceClauses, sourceValues, sourceFilter, "m");
    const sourceWhere = sourceClauses.length > 0 ? `AND ${sourceClauses.join(" AND ")}` : "";
    const importCandidates = await this.pool.query(
      `
        SELECT
          m.id AS memory_id,
          m.memory_type,
          m.title,
          m.body,
          m.status,
          m.use_policy,
          m.scope,
          m.scope_kind,
          m.scope_id,
          m.audience,
          m.confidence,
          m.created_by,
          m.metadata,
          m.updated_at,
          coalesce(
            jsonb_agg(to_jsonb(r) ORDER BY r.created_at ASC)
              FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
          ) AS source_refs
        FROM agent_memories m
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE m.developer_id = $1
          AND (m.project_id = $2 OR m.scope = 'developer')
          AND m.created_by = 'import'
          AND m.status IN ('candidate', 'needs_review')
          ${sourceWhere}
        GROUP BY m.id
        ORDER BY m.updated_at DESC
        LIMIT 25
      `,
      sourceValues
    );
    const duplicateConflicts = await this.pool.query(
      `
        SELECT
          m.id AS memory_id,
          m.memory_type,
          m.title,
          m.body,
          m.status,
          m.use_policy,
          m.scope,
          m.scope_kind,
          m.scope_id,
          m.audience,
          m.confidence,
          m.created_by,
          m.metadata,
          m.updated_at,
          coalesce(
            jsonb_agg(to_jsonb(r) ORDER BY r.created_at ASC)
              FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
          ) AS source_refs
        FROM agent_memories m
        LEFT JOIN agent_memory_source_refs r ON r.memory_id = m.id
        WHERE m.developer_id = $1
          AND (m.project_id = $2 OR m.scope = 'developer')
          AND (
            m.metadata::text ILIKE '%possible_duplicate%'
            OR m.metadata::text ILIKE '%possible_conflict%'
            OR m.metadata::text ILIKE '%duplicate%'
            OR m.metadata::text ILIKE '%conflict%'
          )
        GROUP BY m.id
        ORDER BY m.updated_at DESC
        LIMIT 25
      `,
      [context.developerId, dashboardProjectId]
    );
    const importCandidateRows = importCandidates.rows.map((row) => this.withSourceProvenance(row));
    const duplicateConflictRows = duplicateConflicts.rows.map((row) =>
      this.withSourceProvenance(row)
    );
    const migrationReview = summarizeMigrationReview(importCandidateRows, duplicateConflictRows);
    const critical = await this.pool.query(
      `
        SELECT
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'active' AND ended_at IS NULL) AS active_sessions,
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'interrupted') AS interrupted_sessions,
          (SELECT count(*)::int FROM agent_memories WHERE (project_id = $1 OR scope = 'developer') AND status IN ('candidate', 'needs_review')) AS pending_review,
          (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND archived_at IS NULL AND embed_status = 'pending') AS pending_embeddings,
          (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $1 AND status = 'pending') AS pending_paid_approvals,
          (
            SELECT coalesce((payload->'metadata'->'local_spool_status'->>'unsynced_count')::int, 0)
            FROM events
            WHERE project_id = $1
              AND payload->'metadata'->>'capture_kind' = 'context_read'
              AND payload->'metadata'->'local_spool_status' IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
          ) AS unsynced_spool_records,
          (
            SELECT count(*)::int
            FROM agent_memories
            WHERE developer_id = $2
              AND (project_id = $1 OR scope = 'developer')
              AND status NOT IN ('rejected', 'archived', 'superseded')
              AND (
                metadata::text ILIKE '%possible_conflict%'
                OR metadata::text ILIKE '%conflict%'
              )
              AND (title || ' ' || body) ~* '(secret|deploy|deployment|production|destructive|delete|erase|paid|billing|api|provider|model|server|account|connector)'
          ) AS high_risk_conflicts
      `,
      [dashboardProjectId, context.developerId]
    );
    const costs = await this.pool.query(
      `
        SELECT project_id, provider, model, purpose,
               coalesce(sum(cost_actual_usd), 0)::float AS actual_usd,
               coalesce(sum(cost_estimate_usd), 0)::float AS estimated_usd,
               count(*)::int AS call_count
        FROM model_calls
        WHERE developer_id = $1
          AND created_at >= now() - interval '30 days'
          AND (
            project_id = $2
            OR project_id IN (
              SELECT id
              FROM projects
              WHERE developer_id = $1
            )
          )
        GROUP BY project_id, provider, model, purpose
        ORDER BY estimated_usd DESC, call_count DESC
        LIMIT 20
      `,
      [context.developerId, dashboardProjectId]
    );
    const costSummary = await this.pool.query(
      `
        SELECT
          (
            SELECT coalesce(sum(cost_estimate_usd), 0)::float
            FROM model_calls
            WHERE developer_id = $1
              AND project_id = $2
              AND created_at >= date_trunc('day', now())
          ) AS current_day_estimated_usd,
          (
            SELECT coalesce(sum(cost_actual_usd), 0)::float
            FROM model_calls
            WHERE developer_id = $1
              AND project_id = $2
              AND created_at >= date_trunc('day', now())
          ) AS current_day_actual_usd,
          (
            SELECT count(*)::int
            FROM model_calls
            WHERE developer_id = $1
              AND project_id = $2
              AND created_at >= date_trunc('day', now())
          ) AS current_day_calls,
          (
            SELECT coalesce(sum(cost_estimate_usd), 0)::float
            FROM model_calls
            WHERE developer_id = $1
              AND project_id = $2
              AND created_at >= date_trunc('month', now())
          ) AS current_month_estimated_usd,
          (
            SELECT coalesce(sum(cost_actual_usd), 0)::float
            FROM model_calls
            WHERE developer_id = $1
              AND project_id = $2
              AND created_at >= date_trunc('month', now())
          ) AS current_month_actual_usd,
          (
            SELECT count(*)::int
            FROM model_calls
            WHERE developer_id = $1
              AND project_id = $2
              AND created_at >= date_trunc('month', now())
          ) AS current_month_calls,
          (
            SELECT count(*)::int
            FROM paid_api_approval_requests
            WHERE developer_id = $1
              AND project_id = $2
              AND status = 'pending'
          ) AS pending_approval_count,
          (
            SELECT coalesce(sum(cost_estimate_usd), 0)::float
            FROM paid_api_approval_requests
            WHERE developer_id = $1
              AND project_id = $2
              AND status = 'pending'
          ) AS pending_approval_estimated_usd
      `,
      [context.developerId, dashboardProjectId]
    );
    const pendingPaidApprovals = await this.pool.query(
      `
        SELECT id AS approval_id, provider, model, purpose,
               coalesce(cost_estimate_usd, 0)::float AS estimated_usd,
               status, requested_by, created_at, expires_at
        FROM paid_api_approval_requests
        WHERE developer_id = $1
          AND project_id = $2
          AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 10
      `,
      [context.developerId, dashboardProjectId]
    );
    const settings = await this.pool.query(
      `
        SELECT key, value, 'project_settings' AS source
        FROM project_settings
        WHERE project_id = $1
        UNION ALL
        SELECT key, value, 'system_settings' AS source
        FROM system_settings
        WHERE key IN ('capture_profile', 'embedding_route', 'paid_api_mode')
           OR is_secret_ref = true
           OR key ILIKE '%secret%'
           OR key ILIKE '%api_key%'
           OR key ILIKE '%token%'
           OR key ILIKE '%database_url%'
        ORDER BY key, source
      `,
      [dashboardProjectId]
    );
    const readiness = await this.pool.query(
      `
        SELECT
          EXISTS (SELECT 1 FROM projects WHERE id = $1) AS project_registered,
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'active') AS active_sessions,
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'closed') AS closed_sessions,
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'interrupted') AS interrupted_sessions,
          (SELECT count(*)::int FROM events WHERE project_id = $1) AS event_count,
          (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND archived_at IS NULL) AS active_chunk_count,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND status = 'accepted') AS accepted_memory_count,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND status IN ('candidate', 'needs_review')) AS review_memory_count,
          (SELECT updated_at FROM checkpoints WHERE project_id = $1) AS checkpoint_updated_at,
          (SELECT max(created_at) FROM events WHERE project_id = $1 AND payload->'metadata'->>'capture_kind' = 'context_read') AS last_context_read_at,
          (
            SELECT max(activity_at)
            FROM (
              SELECT max(created_at) AS activity_at
              FROM events
              WHERE project_id = $1
                AND (
                  payload->'metadata'->>'capture_kind' LIKE 'agent_%'
                  OR kind IN ('turn_user', 'turn_assistant', 'tool_result', 'file_change', 'checkpoint')
                )
              UNION ALL
              SELECT max(updated_at) AS activity_at
              FROM agent_memories
              WHERE project_id = $1
            ) AS memory_activity
          ) AS last_memory_write_at,
          (
            SELECT count(*)::int
            FROM events
            WHERE project_id = $1
              AND (
                payload->'metadata'->>'capture_kind' = 'context_read'
                OR payload->'metadata'->>'capture_kind' LIKE 'agent_%'
              )
          ) AS capture_event_count,
          (
            SELECT count(*)::int
            FROM agent_memories
            WHERE project_id = $1
              AND metadata->>'created_from' = 'recallant_agent_event'
          ) AS captured_decision_count,
          (SELECT max(last_seen_at) FROM sessions WHERE project_id = $1) AS last_session_at
      `,
      [dashboardProjectId]
    );
    const activitySourceClauses: string[] = [];
    const activitySourceValues: unknown[] = [dashboardProjectId];
    this.addSourceFilterClause(activitySourceClauses, activitySourceValues, sourceFilter, "m");
    const activitySourceWhere =
      activitySourceClauses.length > 0 ? `AND ${activitySourceClauses.join(" AND ")}` : "";
    const recentActivity = await this.pool.query(
      `
        SELECT activity_kind, title, body, source_summary, occurred_at
        FROM (
          SELECT
            'session' AS activity_kind,
            'Agent session started' AS title,
            client_kind || coalesce(' / ' || client_version, '') AS body,
            NULL::text AS source_summary,
            started_at AS occurred_at
          FROM sessions
          WHERE project_id = $1
          UNION ALL
          SELECT
            'context_read' AS activity_kind,
            'Context was read' AS title,
            'Agent requested a startup Context Pack' AS body,
            NULL::text AS source_summary,
            created_at AS occurred_at
          FROM events
          WHERE project_id = $1
            AND payload->'metadata'->>'capture_kind' = 'context_read'
          UNION ALL
          SELECT
            'memory_write' AS activity_kind,
            'Memory was written' AS title,
            title AS body,
            (
              SELECT coalesce(
                r.metadata->>'source_path',
                r.metadata->>'path',
                r.source_kind || coalesce(' ' || left(r.source_id, 8), '')
              )
              FROM agent_memory_source_refs r
              WHERE r.memory_id = m.id
              ORDER BY r.created_at ASC
              LIMIT 1
            ) AS source_summary,
            updated_at AS occurred_at
          FROM agent_memories m
          WHERE project_id = $1
            ${activitySourceWhere}
          UNION ALL
          SELECT
            'checkpoint' AS activity_kind,
            'Checkpoint updated' AS title,
            coalesce(payload->>'current_focus', payload->>'summary', 'Project checkpoint') AS body,
            NULL::text AS source_summary,
            updated_at AS occurred_at
          FROM checkpoints
          WHERE project_id = $1
        ) activity
        ORDER BY occurred_at DESC NULLS LAST
        LIMIT 30
      `,
      activitySourceValues
    );
    const selectedMemoryId =
      input?.selected_memory_id ??
      importCandidates.rows[0]?.memory_id ??
      inbox.memories[0]?.memory_id ??
      rules.memories[0]?.memory_id;
    const selectedDetail = selectedMemoryId ? await this.getAgentMemory(selectedMemoryId) : null;
    const selectedProject = await this.pool.query<{ primary_path: string | null }>(
      "SELECT primary_path FROM projects WHERE id = $1",
      [dashboardProjectId]
    );
    const dashboardContextMemories = await this.pool.query(
      `
        SELECT id, memory_type, scope_kind, scope_id, title, body, status, metadata, updated_at
        FROM agent_memories
        WHERE developer_id = $1
          AND (project_id = $2 OR scope = 'developer')
          AND status = 'accepted'
          AND use_policy <> 'do_not_use'
          AND (
            scope_kind IN ('environment', 'domain', 'capability')
            OR memory_type IN ('environment_fact', 'domain_fact', 'capability_fact')
          )
        ORDER BY updated_at DESC
        LIMIT 12
      `,
      [context.developerId, dashboardProjectId]
    );
    const localProjectPath = selectedProject.rows[0]?.primary_path ?? null;
    const documentationPosture = documentationPostureSection(
      settings.rows.find(
        (setting) =>
          setting.key === "documentation_posture" && setting.source === "project_settings"
      )?.value
    );
    const starterDocs = starterDocsSection(
      settings.rows.find(
        (setting) => setting.key === "starter_docs" && setting.source === "project_settings"
      )?.value
    );
    const canonCapabilityContext = deriveCanonCapabilityContext({
      documentation_posture: documentationPosture,
      starter_docs: starterDocs,
      project_settings: settings.rows,
      project_sources: currentSources,
      memories: dashboardContextMemories.rows,
      imports: importCandidateRows.map((row) => ({
        id: row.memory_id,
        metadata: row.metadata,
        source_path: row.provenance?.source_path
      })),
      max_items_per_category: 8
    });
    return {
      current_project_id: dashboardProjectId,
      current_project: currentProject,
      projects: projects.rows,
      documentation_posture: documentationPosture,
      starter_docs: starterDocs,
      canon_capability_context: canonCapabilityContext,
      critical: critical.rows[0],
      inbox: inbox.memories,
      import_candidates: importCandidateRows,
      duplicate_conflicts: duplicateConflictRows,
      migration_review: migrationReview,
      selected_detail: selectedDetail,
      available_review_actions: [
        "accept",
        "reject",
        "promote_instruction",
        "demote_instruction",
        "archive",
        "unarchive",
        "mark_stale",
        "edit",
        "merge",
        "supersede"
      ],
      rules: rules.memories,
      rule_filters: {
        scope: input?.rule_scope ?? "all",
        scope_kind: input?.rule_scope_kind ?? "all",
        memory_type: input?.rule_memory_type ?? "all",
        memory_domain: ruleMemoryDomain ?? "all",
        source_id: effectiveSourceId ?? "all"
      },
      source_filters: {
        selected_source_id: effectiveSourceId ?? "all",
        selected_source:
          currentSources.find(
            (source) => String(source.source_id ?? source.id) === String(effectiveSourceId ?? "")
          ) ?? null,
        sources: currentSources
      },
      costs: costs.rows,
      cost_summary: costSummary.rows[0],
      pending_paid_api_approvals: pendingPaidApprovals.rows,
      settings: settings.rows,
      project_readiness: readiness.rows[0],
      recent_activity: recentActivity.rows,
      project_cleanup: {
        dry_run_first: true,
        permanent_erasure_separate: true,
        detach_command: `recallant detach --project-id ${dashboardProjectId} --dry-run`,
        sanitize_detach_command: `recallant project-sanitize --project-id ${dashboardProjectId} --mode detach --dry-run`,
        purge_command: `recallant project-sanitize --project-id ${dashboardProjectId} --mode purge --dry-run`,
        sandbox_cleanup_command: `recallant detach --project-id ${dashboardProjectId} --mode sandbox --dry-run`,
        local_cleanup_command: localProjectPath
          ? `recallant local-cleanup --project-dir ${JSON.stringify(localProjectPath)} --dry-run`
          : null
      },
      chat: {
        placeholder: "Ask Recallant about memory, context packs, cleanup, or settings.",
        destructive_actions_require_confirmation: true
      }
    };
  }

  async setProjectSetting(input: ProjectSettingInput) {
    const context = input.project_id ? { projectId: input.project_id } : await this.ensureProject();
    if (isDangerousSetting(input.key, input.value) && input.confirmation?.confirmed !== true) {
      return {
        ok: false,
        status: "confirmation_required",
        key: input.key,
        dangerous: true
      };
    }
    return withTransaction(this.pool, async (client) => {
      const previous = await client.query<{ value: unknown }>(
        "SELECT value FROM project_settings WHERE project_id = $1 AND key = $2",
        [context.projectId, input.key]
      );
      await client.query(
        `
          INSERT INTO project_settings (project_id, key, value, reason, updated_by)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (project_id, key) DO UPDATE
          SET value = EXCLUDED.value,
              reason = EXCLUDED.reason,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
        `,
        [
          context.projectId,
          input.key,
          JSON.stringify(input.value),
          input.reason ?? null,
          input.actor_id ?? input.actor_kind ?? "user"
        ]
      );
      await client.query(
        `
          INSERT INTO settings_audit_events (
            scope_kind, scope_id, key, old_value, new_value, actor_kind, actor_id, reason
          )
          VALUES ('project', $1, $2, $3, $4, $5, $6, $7)
        `,
        [
          context.projectId,
          input.key,
          previous.rows[0]?.value === undefined ? null : JSON.stringify(previous.rows[0]?.value),
          JSON.stringify(input.value),
          input.actor_kind ?? "user",
          input.actor_id ?? null,
          input.reason ?? null
        ]
      );
      return {
        ok: true,
        status: "updated",
        project_id: context.projectId,
        key: input.key,
        source: "project_settings"
      };
    });
  }

  private classifyAgentMemory(input: CreateAgentMemoryInput) {
    const combined = `${input.title}\n${input.body}`;
    if (
      input.created_by === "user" &&
      input.scope === "developer" &&
      input.metadata?.owner_confirmed_global_rule === true
    ) {
      if (hasHighRiskSignal(combined)) {
        return {
          status: "needs_review",
          usePolicy: "evidence_only",
          reason: "owner_global_rule_high_risk_review_required"
        };
      }
      return {
        status: "accepted",
        usePolicy: "instruction_grade",
        reason: "owner_confirmed_developer_instruction"
      };
    }
    if (
      input.created_by === "agent" &&
      (hasHighRiskSignal(combined) || (input.confidence ?? 1) < 0.5)
    ) {
      return {
        status: "needs_review",
        usePolicy: "evidence_only",
        reason: "high_risk_or_low_confidence"
      };
    }
    if (
      input.created_by === "agent" &&
      (hasInstructionSignal(combined) ||
        input.scope === "developer" ||
        input.memory_type === "procedure")
    ) {
      return {
        status: "candidate",
        usePolicy: "recall_allowed",
        reason: "candidate_rule_not_binding"
      };
    }
    return { status: "accepted", usePolicy: "recall_allowed", reason: "ordinary_memory" };
  }

  private buildSearchFilter(input: {
    projectId: string;
    developerId: string;
    scope: string;
    scopeKind: string | null;
    audience: string | null;
    includeArchived?: boolean;
    sourceFilter?: SourceFilter | null;
    startIndex: number;
  }) {
    const clauses = [`c.developer_id = $${input.startIndex}::uuid`];
    if (!input.includeArchived) clauses.push("c.archived_at IS NULL");
    const params: unknown[] = [input.developerId];
    if (input.scope === "developer") {
      clauses.push("c.scope = 'developer'");
    } else if (input.scope === "project") {
      params.push(input.projectId);
      clauses.push(
        `(c.project_id = $${input.startIndex + params.length - 1}::uuid OR c.scope = 'developer')`
      );
    }
    if (input.scopeKind) {
      params.push(input.scopeKind);
      clauses.push(`c.scope_kind = $${input.startIndex + params.length - 1}`);
    } else if (input.scope === "project") {
      clauses.push(
        "(c.scope = 'developer' OR coalesce(c.scope_kind, 'project') IN ('project', 'repo', 'subproject'))"
      );
    }
    if (input.audience) {
      params.push(input.audience);
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(c.audience, '[]'::jsonb)) AS audience_item
          WHERE audience_item->>'kind' = $${input.startIndex + params.length - 1}
        )`
      );
    } else {
      clauses.push(
        `(c.audience IS NULL OR c.audience = '[]'::jsonb OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(coalesce(c.audience, '[]'::jsonb)) AS audience_item
          WHERE audience_item->>'kind' = 'all_agents'
        ))`
      );
    }
    this.addSourceEvidenceFilterClause({
      clauses,
      values: params,
      sourceFilter: input.sourceFilter ?? null,
      chunkAlias: "c",
      eventAlias: "ev",
      paramOffset: input.startIndex - 1
    });
    return { whereSql: clauses.join(" AND "), params };
  }

  private eventSourceProvenance(payload: unknown) {
    const record =
      payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const sourceRef =
      record.source_ref && typeof record.source_ref === "object"
        ? (record.source_ref as Record<string, unknown>)
        : {};
    const metadata =
      record.metadata && typeof record.metadata === "object"
        ? (record.metadata as Record<string, unknown>)
        : {};
    const sourcePath =
      stringOrNull(sourceRef.path) ??
      stringOrNull(metadata.source_path) ??
      stringOrNull(metadata.path) ??
      stringOrNull(sourceRef.uri) ??
      stringOrNull(metadata.uri);
    const sourceKind = stringOrNull(sourceRef.kind) ?? stringOrNull(metadata.source_kind);
    const projectSourceId =
      stringOrNull(sourceRef.project_source_id) ??
      stringOrNull(metadata.project_source_id) ??
      stringOrNull(sourceRef.source_id) ??
      stringOrNull(metadata.source_id);
    return {
      summary: sourcePath
        ? `From source ${sourcePath}`
        : projectSourceId
          ? `From source ${projectSourceId.slice(0, 8)}`
          : "From captured Recallant evidence",
      source_path: sourcePath,
      source_kind: sourceKind,
      project_source_id: projectSourceId
    };
  }

  private async expandGraphRows(input: {
    projectId: string;
    seedChunkIds: string[];
    budget: number;
    sourceFilter?: SourceFilter | null;
    existingChunkIds: Set<string>;
  }) {
    if (input.budget <= 0) return [];
    const values: unknown[] = [input.projectId, input.seedChunkIds];
    const clauses = ["c.archived_at IS NULL"];
    this.addSourceEvidenceFilterClause({
      clauses,
      values,
      sourceFilter: input.sourceFilter ?? null,
      chunkAlias: "c",
      eventAlias: "ev"
    });
    values.push(input.budget);
    const budgetParam = values.length;
    const result = await this.pool.query<{
      id: string;
      text: string;
      source_event_id: string;
      occurred_at: string;
      event_payload: unknown;
      weight: number;
    }>(
      `
        WITH neighbors AS (
          SELECT
            CASE
              WHEN e.src_kind = 'chunk' AND e.src_id = ANY($2::text[]) THEN e.dst_id
              WHEN e.dst_kind = 'chunk' AND e.dst_id = ANY($2::text[]) THEN e.src_id
            END AS chunk_id,
            max(e.weight) AS weight
          FROM edges e
          WHERE e.project_id = $1
            AND (
              (e.src_kind = 'chunk' AND e.src_id = ANY($2::text[]))
              OR (e.dst_kind = 'chunk' AND e.dst_id = ANY($2::text[]))
            )
          GROUP BY chunk_id
        )
        SELECT c.id, c.text, c.source_event_id, ev.occurred_at, ev.payload AS event_payload,
               n.weight
        FROM neighbors n
        JOIN chunks c ON c.id::text = n.chunk_id
        JOIN events ev ON ev.id = c.source_event_id
        WHERE ${clauses.join(" AND ")}
        LIMIT $${budgetParam}
      `,
      values
    );
    return result.rows
      .filter((row) => !input.existingChunkIds.has(row.id))
      .map((row) => ({
        id: row.id,
        text: row.text,
        source_event_id: row.source_event_id,
        occurred_at: row.occurred_at,
        event_payload: row.event_payload,
        score: Number(row.weight) * 0.2,
        path: "graph",
        superseded_by: null
      }));
  }

  private redactSourceRef(sourceRef: unknown) {
    if (!sourceRef || typeof sourceRef !== "object") return sourceRef;
    const record = sourceRef as Record<string, unknown>;
    return {
      ...record,
      quote: typeof record.quote === "string" ? redactSecretValues(record.quote) : record.quote
    };
  }

  private sourcePathFromRefs(sourceRefs: unknown[]) {
    for (const sourceRef of sourceRefs) {
      if (!sourceRef || typeof sourceRef !== "object") continue;
      const metadata = (sourceRef as { metadata?: unknown }).metadata;
      if (!metadata || typeof metadata !== "object") continue;
      const sourcePath = (metadata as { source_path?: unknown }).source_path;
      if (typeof sourcePath === "string" && sourcePath.length > 0) return sourcePath;
    }
    return null;
  }

  private sourceProvenanceFromRefs(sourceRefs: unknown[]) {
    const first =
      sourceRefs.find((sourceRef) => sourceRef && typeof sourceRef === "object") ?? null;
    const sourcePath = this.sourcePathFromRefs(sourceRefs);
    const firstRecord = first as Record<string, unknown> | null;
    const primaryKind =
      typeof firstRecord?.source_kind === "string" ? firstRecord.source_kind : null;
    const primaryId = typeof firstRecord?.source_id === "string" ? firstRecord.source_id : null;
    const primarySummary = primaryKind
      ? `${primaryKind}${primaryId ? ` ${primaryId.slice(0, 8)}` : ""}`
      : null;
    return {
      source_count: sourceRefs.length,
      primary_source_kind: primaryKind,
      primary_source_id: primaryId,
      source_path: sourcePath,
      summary: sourcePath
        ? `From source ${sourcePath}`
        : primarySummary
          ? `From ${primarySummary}`
          : "No source reference recorded"
    };
  }

  private withSourceProvenance<T extends Record<string, unknown>>(row: T) {
    const sourceRefs = Array.isArray(row.source_refs)
      ? row.source_refs.map((sourceRef) => this.redactSourceRef(sourceRef))
      : [];
    return {
      ...row,
      source_refs: sourceRefs,
      provenance: this.sourceProvenanceFromRefs(sourceRefs)
    } as T & {
      source_refs: unknown[];
      provenance: ReturnType<RecallantDb["sourceProvenanceFromRefs"]>;
    };
  }

  private async queryManagedProject(whereClause: string, values: unknown[]) {
    const result = await this.pool.query<ManagedProjectRow>(
      `
        SELECT p.id AS project_id, p.developer_id, p.name, p.primary_path,
               p.project_kind, p.memory_domain, p.updated_at
        FROM projects p
        WHERE ${whereClause}
        ORDER BY (
          (SELECT count(*) FROM sessions s WHERE s.project_id = p.id) +
          (SELECT count(*) FROM events e WHERE e.project_id = p.id) +
          (SELECT count(*) FROM agent_memories m WHERE m.project_id = p.id)
        ) DESC,
        p.updated_at DESC
        LIMIT 1
      `,
      values
    );
    return result.rows[0] ?? null;
  }

  private async findProjectForManagement(input: ProjectManagementTarget): Promise<{
    project: ManagedProjectRow | null;
    target_resolution: ProjectTargetResolution;
    warnings: string[];
  }> {
    const developerId = this.config.developerId ?? this.fallbackDeveloperId;
    const projectId = Object.prototype.hasOwnProperty.call(input, "project_id")
      ? (input.project_id ?? null)
      : (this.config.projectId ?? null);
    const projectPath = Object.prototype.hasOwnProperty.call(input, "project_path")
      ? (input.project_path ?? null)
      : (this.config.projectPath ?? null);
    const baseResolution = {
      requested_project_id: projectId,
      requested_project_path: projectPath,
      resolved_project_id: null
    };
    if (!projectId && !projectPath) {
      return {
        project: null,
        target_resolution: { ...baseResolution, resolved_by: "not_found" },
        warnings: []
      };
    }

    if (projectId) {
      const project = await this.queryManagedProject("p.id = $1::uuid", [projectId]);
      if (project) {
        return {
          project,
          target_resolution: {
            ...baseResolution,
            resolved_project_id: project.project_id,
            resolved_by: "project_id"
          },
          warnings: []
        };
      }
      if (projectPath) {
        const fallbackProject = await this.queryManagedProject(
          "p.developer_id = $1::uuid AND p.primary_path IS NOT DISTINCT FROM $2",
          [developerId, projectPath]
        );
        if (fallbackProject) {
          return {
            project: fallbackProject,
            target_resolution: {
              ...baseResolution,
              resolved_project_id: fallbackProject.project_id,
              resolved_by: "project_path_fallback",
              stale_project_id: projectId
            },
            warnings: [
              `Local project metadata referenced missing project_id ${projectId}; resolved the managed project by path instead.`
            ]
          };
        }
      }
      return {
        project: null,
        target_resolution: {
          ...baseResolution,
          resolved_by: "not_found",
          stale_project_id: projectPath ? projectId : null
        },
        warnings: []
      };
    }

    const project = await this.queryManagedProject(
      "p.developer_id = $1::uuid AND p.primary_path IS NOT DISTINCT FROM $2",
      [developerId, projectPath]
    );
    return {
      project,
      target_resolution: {
        ...baseResolution,
        resolved_project_id: project?.project_id ?? null,
        resolved_by: project ? "project_path" : "not_found"
      },
      warnings: []
    };
  }

  private async countProjectRecords(projectId: string) {
    const result = await this.pool.query(
      `
        SELECT
          (SELECT count(*)::int FROM projects WHERE id = $1) AS projects,
          (SELECT count(*)::int FROM project_sources WHERE project_id = $1) AS project_sources,
          (SELECT count(*)::int FROM sessions WHERE project_id = $1) AS sessions,
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'active' AND ended_at IS NULL) AS active_sessions,
          (SELECT count(*)::int FROM sessions WHERE project_id = $1 AND status = 'interrupted') AS interrupted_sessions,
          (SELECT count(*)::int FROM session_overrides WHERE session_id IN (SELECT id FROM sessions WHERE project_id = $1)) AS session_overrides,
          (SELECT count(*)::int FROM events WHERE project_id = $1) AS events,
          (SELECT count(*)::int FROM events WHERE project_id = $1 AND kind = 'import_batch') AS import_events,
          (SELECT count(*)::int FROM raw_artifacts WHERE project_id = $1) AS raw_artifacts,
          (SELECT count(*)::int FROM chunks WHERE project_id = $1) AS chunks,
          (SELECT count(*)::int FROM chunks WHERE project_id = $1 AND archived_at IS NULL) AS active_chunks,
          (SELECT count(*)::int FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE project_id = $1)) AS embeddings,
          (SELECT count(*)::int FROM edges WHERE project_id = $1) AS edges,
          (SELECT count(*)::int FROM checkpoints WHERE project_id = $1) AS checkpoints,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1) AS agent_memories,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND status NOT IN ('archived', 'rejected', 'superseded')) AS active_agent_memories,
          (SELECT count(*)::int FROM agent_memories WHERE project_id = $1 AND status IN ('candidate', 'needs_review')) AS review_needed_memories,
          (SELECT count(*)::int FROM agent_memory_source_refs r JOIN agent_memories m ON m.id = r.memory_id WHERE m.project_id = $1) AS agent_memory_source_refs,
          (SELECT count(*)::int FROM agent_memory_review_actions a JOIN agent_memories m ON m.id = a.memory_id WHERE m.project_id = $1) AS agent_memory_review_actions,
          (SELECT count(*)::int FROM recall_traces WHERE project_id = $1) AS recall_traces,
          (SELECT count(*)::int FROM ingest_dedup_keys WHERE project_id = $1) AS ingest_dedup_keys,
          (SELECT count(*)::int FROM project_settings WHERE project_id = $1) AS project_settings,
          (SELECT count(*)::int FROM client_adapter_settings WHERE project_id = $1) AS client_adapter_settings,
          (SELECT count(*)::int FROM settings_audit_events WHERE scope_kind = 'project' AND scope_id = $1::text) AS settings_audit_events,
          (SELECT count(*)::int FROM system_activity_events WHERE project_id = $1) AS system_activity_events,
          (SELECT count(*)::int FROM model_calls WHERE project_id = $1) AS model_calls,
          (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $1) AS paid_api_approvals,
          (SELECT count(*)::int FROM paid_api_approval_requests WHERE project_id = $1 AND status = 'pending') AS pending_paid_approvals,
          (SELECT count(*)::int FROM erasure_requests WHERE project_id = $1) AS erasure_requests
      `,
      [projectId]
    );
    return result.rows[0] ?? {};
  }

  private async getProjectLifecycle(projectId: string) {
    const result = await this.pool.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = 'project_lifecycle'",
      [projectId]
    );
    return readProjectLifecycle(result.rows[0]?.value);
  }

  private async countForgetTarget(kind: string, targetId: string) {
    if (kind === "event") {
      const result = await this.pool.query(
        `
          SELECT
            1 AS events,
            (SELECT count(*)::int FROM chunks WHERE source_event_id = $1) AS chunks,
            (SELECT count(*)::int FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE source_event_id = $1)) AS embeddings,
            0 AS agent_memories,
            (SELECT count(*)::int FROM raw_artifacts WHERE source_event_id = $1) AS raw_artifacts,
            0 AS derived_summaries
        `,
        [targetId]
      );
      return result.rows[0];
    }
    if (kind === "chunk") {
      const result = await this.pool.query(
        `
          SELECT
            0 AS events,
            (SELECT count(*)::int FROM chunks WHERE id = $1) AS chunks,
            (SELECT count(*)::int FROM embeddings WHERE chunk_id = $1) AS embeddings,
            0 AS agent_memories,
            0 AS raw_artifacts,
            0 AS derived_summaries
        `,
        [targetId]
      );
      return result.rows[0];
    }
    if (kind === "agent_memory") {
      const result = await this.pool.query(
        `
          SELECT
            0 AS events,
            0 AS chunks,
            0 AS embeddings,
            (SELECT count(*)::int FROM agent_memories WHERE id = $1) AS agent_memories,
            0 AS raw_artifacts,
            0 AS derived_summaries
        `,
        [targetId]
      );
      return result.rows[0];
    }
    return {
      events: 0,
      chunks: 0,
      embeddings: 0,
      agent_memories: 0,
      raw_artifacts: 0,
      derived_summaries: 0
    };
  }

  async setCheckpoint(projectId: string | null | undefined, payload: JsonObject) {
    const context = projectId ? { projectId } : await this.ensureProject();
    const result = await this.pool.query(
      `
        INSERT INTO checkpoints (project_id, payload)
        VALUES ($1, $2)
        ON CONFLICT (project_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
        RETURNING updated_at
      `,
      [context.projectId, JSON.stringify(payload)]
    );
    return result.rows[0];
  }

  async getCheckpoint(projectId?: string | null) {
    const context = projectId ? { projectId } : await this.ensureProject();
    const result = await this.pool.query(
      "SELECT payload, updated_at FROM checkpoints WHERE project_id = $1",
      [context.projectId]
    );
    return result.rows[0] ?? { payload: null, updated_at: null };
  }

  async closeout(
    sessionId: string,
    checkpointPayload: JsonObject,
    endedReason = "closeout",
    localSpoolStatus?: JsonObject | null,
    closeoutDiagnostics?: JsonObject | null
  ) {
    const context = await this.contextForSession(sessionId);
    const checkpoint = await this.setCheckpoint(context.projectId, checkpointPayload);
    await this.pool.query(
      `
        UPDATE sessions
        SET status = 'closed', ended_reason = $2, ended_at = now(), last_seen_at = now()
        WHERE id = $1
      `,
      [sessionId, endedReason]
    );
    const warnings: string[] = [];
    const unsyncedCount =
      typeof localSpoolStatus?.unsynced_count === "number" ? localSpoolStatus.unsynced_count : 0;
    const spoolStatus = String(localSpoolStatus?.status ?? "not_provided");
    if (spoolStatus === "unsynced" || unsyncedCount > 0) {
      warnings.push(
        `Local spool has ${unsyncedCount} unsynced record(s). Run recallant sync-spool.`
      );
    }
    const conflictReport = await this.listAgentMemories({
      view: "conflicts",
      project_id: context.projectId,
      limit: 1
    });
    if (conflictReport.memories.length > 0) {
      warnings.push("Governed memory conflicts exist and should be reviewed before closeout.");
    }
    const modelErrors = await this.pool.query(
      `
        SELECT count(*)::int AS count
        FROM model_calls
        WHERE project_id = $1
          AND status IN ('failed', 'cancelled')
          AND created_at >= now() - interval '24 hours'
      `,
      [context.projectId]
    );
    if (Number(modelErrors.rows[0]?.count ?? 0) > 0) {
      warnings.push("Recent model/provider errors exist for this project.");
    }
    const diagnostics = closeoutDiagnostics ?? {};
    const repoStatus = String(
      diagnostics.repo_sync_status ?? diagnostics.repo_status ?? ""
    ).toLowerCase();
    const repoClean = diagnostics.repo_clean;
    const repoAhead = Number(diagnostics.repo_ahead ?? 0);
    const repoBehind = Number(diagnostics.repo_behind ?? 0);
    if (
      ["incomplete", "unsynced", "dirty", "behind", "diverged"].includes(repoStatus) ||
      repoClean === false ||
      repoAhead > 0 ||
      repoBehind > 0
    ) {
      warnings.push("Repository sync is incomplete; review commit/push status before closeout.");
    }
    const extractionConfidence = Number(diagnostics.extraction_confidence ?? 1);
    if (Number.isFinite(extractionConfidence) && extractionConfidence < 0.5) {
      warnings.push("Closeout extraction confidence is low; owner-readable report is required.");
    }
    for (const key of ["server_errors", "model_errors", "provider_errors"]) {
      const value = diagnostics[key];
      const count = Array.isArray(value) ? value.length : value ? 1 : 0;
      if (count > 0) {
        warnings.push(`${String(key).replaceAll("_", "/")} reported ${count} issue(s).`);
      }
    }
    return {
      ...checkpoint,
      spool_sync_status: spoolStatus,
      report_required: warnings.length > 0,
      warnings
    };
  }

  async closeSession(sessionId: string, endedReason = "client_exit") {
    const result = await this.pool.query(
      `
        UPDATE sessions
        SET status = 'closed', ended_reason = $2, ended_at = coalesce(ended_at, now()), last_seen_at = now()
        WHERE id = $1 AND status = 'active' AND ended_at IS NULL
      `,
      [sessionId, endedReason]
    );
    return { closed: result.rowCount ?? 0 };
  }

  private async contextForSession(sessionId?: string | null): Promise<ProjectContext> {
    if (!sessionId) return this.ensureProject();
    const result = await this.pool.query<{
      project_id: string;
      developer_id: string;
    }>(
      `
        SELECT s.project_id, p.developer_id
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        WHERE s.id = $1
      `,
      [sessionId]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown session_id: ${sessionId}`);
    return { projectId: row.project_id, developerId: row.developer_id };
  }

  private async contextForProject(projectId: string): Promise<ProjectContext> {
    const result = await this.pool.query<{ developer_id: string }>(
      "SELECT developer_id FROM projects WHERE id = $1",
      [projectId]
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Unknown project_id: ${projectId}`);
    return { projectId, developerId: row.developer_id };
  }

  private async resolveCapturePolicy(
    client: PoolClient,
    projectId: string,
    developerId: string,
    sessionId?: string | null
  ): Promise<CapturePolicy> {
    if (sessionId) {
      const sessionOverride = await client.query<{ value: unknown }>(
        `
          SELECT value
          FROM session_overrides
          WHERE session_id = $1
            AND key = 'capture_profile'
            AND cleared_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [sessionId]
      );
      const profile = readCaptureProfile(sessionOverride.rows[0]?.value);
      if (profile) return buildCapturePolicy(profile, "session_overrides");
    }

    const projectSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = 'capture_profile'",
      [projectId]
    );
    const projectProfile = readCaptureProfile(projectSetting.rows[0]?.value);
    if (projectProfile) return buildCapturePolicy(projectProfile, "project_settings");

    const developerSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM developer_settings WHERE developer_id = $1 AND key = 'capture_profile'",
      [developerId]
    );
    const developerProfile = readCaptureProfile(developerSetting.rows[0]?.value);
    if (developerProfile) return buildCapturePolicy(developerProfile, "developer_settings");

    const systemSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM system_settings WHERE key = 'capture_profile'"
    );
    const systemProfile = readCaptureProfile(systemSetting.rows[0]?.value);
    if (systemProfile) return buildCapturePolicy(systemProfile, "system_settings");

    return buildCapturePolicy("standard", "built_in_default");
  }

  private async resolveStaleSessionThreshold(
    client: PoolClient,
    projectId: string,
    developerId: string
  ) {
    const key = "stale_session_threshold_minutes";
    const projectSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = $2",
      [projectId, key]
    );
    const projectValue = readNumberSetting(projectSetting.rows[0]?.value);
    if (projectValue !== null) return projectValue;

    const developerSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM developer_settings WHERE developer_id = $1 AND key = $2",
      [developerId, key]
    );
    const developerValue = readNumberSetting(developerSetting.rows[0]?.value);
    if (developerValue !== null) return developerValue;

    const systemSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM system_settings WHERE key = $1",
      [key]
    );
    const systemValue = readNumberSetting(systemSetting.rows[0]?.value);
    if (systemValue !== null) return systemValue;

    return 480;
  }

  private async insertEvent(
    client: PoolClient,
    input: {
      projectId: string;
      sessionId: string | null;
      ingestSource: string;
      kind: string;
      occurredAt: Date;
      payload: JsonObject;
    }
  ) {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO events (project_id, session_id, ingest_source, kind, occurred_at, payload, payload_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        input.projectId,
        input.sessionId,
        input.ingestSource,
        input.kind,
        input.occurredAt,
        JSON.stringify(input.payload),
        sha256(input.payload)
      ]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Failed to insert event");
    return { id };
  }

  private async insertChunks(
    client: PoolClient,
    input: {
      projectId: string;
      developerId: string;
      eventId: string;
      text: string;
      scope?: "project" | "developer";
      scopeKind?: string | null;
      scopeId?: string | null;
      audience?: unknown[];
    }
  ) {
    const ids: string[] = [];
    for (const [index, text] of chunkText(input.text).entries()) {
      const result = await client.query<{ id: string }>(
        `
          INSERT INTO chunks (
            project_id, developer_id, source_event_id, text, chunk_index,
            token_count_est, scope, scope_kind, scope_id, audience
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `,
        [
          input.projectId,
          input.developerId,
          input.eventId,
          text,
          index,
          estimateTokens(text),
          input.scope ?? "project",
          input.scopeKind ?? "project",
          input.scopeId ?? input.projectId,
          JSON.stringify(input.audience ?? [{ kind: "all_agents", id: null }])
        ]
      );
      const id = result.rows[0]?.id;
      if (id) ids.push(id);
    }
    return ids;
  }

  private async ensureDefaultModelSettings(client: PoolClient) {
    await client.query(
      `
        INSERT INTO system_settings (key, value, updated_by)
        VALUES
          ('embedding_route', $1, 'system'),
          ('embedding_fallback_candidates', $2, 'system'),
          ('paid_api_mode', $3, 'system')
        ON CONFLICT (key) DO NOTHING
      `,
      [
        JSON.stringify({
          route_class: "local_model",
          provider: "ollama",
          model: "nomic-embed-text",
          dims: 768
        }),
        JSON.stringify([
          {
            route_class: "paid_api_provider",
            provider: "openai",
            model: "text-embedding-3-small",
            dims: 1536
          },
          {
            route_class: "paid_api_provider",
            provider: "gemini",
            model: "gemini-embedding-001"
          },
          {
            route_class: "paid_api_provider",
            provider: "gemini",
            model: "gemini-embedding-2"
          }
        ]),
        JSON.stringify("confirm_each")
      ]
    );
  }

  private async resolveEmbeddingRoute(
    client: Pick<Pool | PoolClient, "query">,
    projectId: string,
    developerId: string
  ): Promise<EmbeddingRoute> {
    const key = "embedding_route";
    const projectSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM project_settings WHERE project_id = $1 AND key = $2",
      [projectId, key]
    );
    const projectRoute = this.readEmbeddingRoute(projectSetting.rows[0]?.value, "project_settings");
    if (projectRoute) return projectRoute;

    const developerSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM developer_settings WHERE developer_id = $1 AND key = $2",
      [developerId, key]
    );
    const developerRoute = this.readEmbeddingRoute(
      developerSetting.rows[0]?.value,
      "developer_settings"
    );
    if (developerRoute) return developerRoute;

    const systemSetting = await client.query<{ value: unknown }>(
      "SELECT value FROM system_settings WHERE key = $1",
      [key]
    );
    const systemRoute = this.readEmbeddingRoute(systemSetting.rows[0]?.value, "system_settings");
    if (systemRoute) return systemRoute;

    return {
      routeClass: "local_model",
      provider: "ollama",
      model: "nomic-embed-text",
      dims: 768,
      source: "built_in_default",
      routingReason: "default_local_embedding"
    };
  }

  private readEmbeddingRoute(value: unknown, source: string): EmbeddingRoute | null {
    const object = readObjectSetting(value);
    if (!object) return null;
    const provider = typeof object.provider === "string" ? object.provider : null;
    const model = typeof object.model === "string" ? object.model : null;
    const dims =
      typeof object.dims === "number" && Number.isInteger(object.dims) ? object.dims : 768;
    const routeClass =
      object.route_class === "paid_api_provider" ? "paid_api_provider" : "local_model";
    if (!provider || !model) return null;
    return {
      routeClass,
      provider,
      model,
      dims,
      source,
      routingReason: source === "built_in_default" ? "default_local_embedding" : "settings_override"
    };
  }

  private async embedChunks(
    client: PoolClient,
    input: {
      developerId: string;
      projectId: string;
      sessionId: string | null;
      chunkIds: string[];
      texts: string[];
    }
  ) {
    if (input.chunkIds.length === 0) return { status: "skipped", reason: "no_chunks" };
    const route = await this.resolveEmbeddingRoute(client, input.projectId, input.developerId);
    const existingModels = await client.query<{ embed_model: string; embed_status: string }>(
      `
        SELECT DISTINCT embed_model, embed_status
        FROM chunks
        WHERE project_id = $1 AND embed_model IS NOT NULL
      `,
      [input.projectId]
    );
    const incompatibleModel = existingModels.rows.find(
      (row) => row.embed_model && row.embed_model !== route.model
    );
    if (incompatibleModel) {
      throw new Error(
        `Embedding model switch from ${incompatibleModel.embed_model} to ${route.model} requires explicit reindex`
      );
    }

    if (route.routeClass === "paid_api_provider") {
      const blockedDecision = await this.findBlockingPaidApiDecision(client, {
        developerId: input.developerId,
        projectId: input.projectId,
        route,
        purpose: "chunk_embedding"
      });
      if (blockedDecision) {
        await this.recordModelCall(client, {
          developerId: input.developerId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          route,
          purpose: "chunk_embedding",
          status: "cancelled",
          confirmationStatus: "denied",
          approvalRequestId: blockedDecision.id,
          errorCode: `paid_api_approval_${blockedDecision.status}`,
          metadata: {
            text_count: input.texts.length,
            blocked_before_provider_call: true,
            decision_status: blockedDecision.status,
            fallback_behavior: "defer_or_downgrade_without_provider_call"
          }
        });
        await client.query(
          "UPDATE chunks SET embed_status = 'pending' WHERE id = ANY($1::uuid[])",
          [input.chunkIds]
        );
        return {
          status: "deferred",
          reason: `paid_api_approval_${blockedDecision.status}`,
          provider: route.provider,
          model: route.model,
          approval_request_id: blockedDecision.id,
          fallback_behavior: "defer_or_downgrade_without_provider_call"
        };
      }
      const approval = await this.createPaidApiApproval(client, {
        developerId: input.developerId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        route,
        purpose: "chunk_embedding"
      });
      await this.recordModelCall(client, {
        developerId: input.developerId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        route,
        purpose: "chunk_embedding",
        status: "cancelled",
        confirmationStatus: "required_pending",
        approvalRequestId: approval.id,
        metadata: { text_count: input.texts.length, blocked_before_provider_call: true }
      });
      await client.query("UPDATE chunks SET embed_status = 'pending' WHERE id = ANY($1::uuid[])", [
        input.chunkIds
      ]);
      return {
        status: "pending_approval",
        provider: route.provider,
        model: route.model,
        approval_request_id: approval.id
      };
    }

    if (route.provider === "ollama") {
      try {
        const embeddingResults: OllamaEmbeddingFetchResult[] = [];
        for (const text of input.texts) {
          embeddingResults.push(await fetchOllamaEmbedding(route, text));
        }
        for (const [index, chunkId] of input.chunkIds.entries()) {
          const embedding = embeddingResults[index]?.embedding;
          if (!embedding) throw new Error(`Missing Ollama embedding for chunk ${chunkId}`);
          await client.query(
            `
              INSERT INTO embeddings (chunk_id, model, dims, vector)
              VALUES ($1, $2, $3, $4::vector)
              ON CONFLICT (chunk_id) DO UPDATE
              SET model = EXCLUDED.model, dims = EXCLUDED.dims, vector = EXCLUDED.vector, created_at = now()
            `,
            [chunkId, route.model, route.dims, vectorLiteral(embedding)]
          );
        }
        await client.query(
          "UPDATE chunks SET embed_status = 'embedded', embed_model = $2 WHERE id = ANY($1::uuid[])",
          [input.chunkIds, route.model]
        );
        await this.recordModelCall(client, {
          developerId: input.developerId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          route,
          purpose: "chunk_embedding",
          status: "success",
          metadata: {
            text_count: input.texts.length,
            ...summarizeOllamaEmbeddingResults(embeddingResults)
          }
        });
        const retrySummary = summarizeOllamaEmbeddingResults(embeddingResults);
        return {
          status: "embedded",
          provider: route.provider,
          model: route.model,
          dims: route.dims,
          attempt_count: retrySummary.attempt_count,
          retry_count: retrySummary.retry_count
        };
      } catch (error) {
        const failureSummary = summarizeOllamaEmbeddingFailure(error, input.texts.length);
        await this.recordModelCall(client, {
          developerId: input.developerId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          route,
          purpose: "chunk_embedding",
          status: "failed",
          errorCode: "UNAVAILABLE",
          metadata: {
            text_count: input.texts.length,
            ...failureSummary
          }
        });
        await client.query(
          "UPDATE chunks SET embed_status = 'pending' WHERE id = ANY($1::uuid[])",
          [input.chunkIds]
        );
        return {
          status: "pending",
          provider: route.provider,
          model: route.model,
          error: "UNAVAILABLE",
          attempt_count: failureSummary.attempt_count,
          retry_count: failureSummary.retry_count
        };
      }
    }

    if (route.provider !== "deterministic") {
      await this.recordModelCall(client, {
        developerId: input.developerId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        route,
        purpose: "chunk_embedding",
        status: "failed",
        errorCode: "UNAVAILABLE",
        metadata: { text_count: input.texts.length, message: "Embedding provider is not connected" }
      });
      await client.query("UPDATE chunks SET embed_status = 'pending' WHERE id = ANY($1::uuid[])", [
        input.chunkIds
      ]);
      return {
        status: "pending",
        provider: route.provider,
        model: route.model,
        error: "UNAVAILABLE"
      };
    }

    for (const [index, chunkId] of input.chunkIds.entries()) {
      const embedding = deterministicEmbedding(input.texts[index] ?? "", route.dims);
      await client.query(
        `
          INSERT INTO embeddings (chunk_id, model, dims, vector)
          VALUES ($1, $2, $3, $4::vector)
          ON CONFLICT (chunk_id) DO UPDATE
          SET model = EXCLUDED.model, dims = EXCLUDED.dims, vector = EXCLUDED.vector, created_at = now()
        `,
        [chunkId, route.model, route.dims, vectorLiteral(embedding)]
      );
    }
    await client.query(
      "UPDATE chunks SET embed_status = 'embedded', embed_model = $2 WHERE id = ANY($1::uuid[])",
      [input.chunkIds, route.model]
    );
    await this.recordModelCall(client, {
      developerId: input.developerId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      route,
      purpose: "chunk_embedding",
      status: "success",
      metadata: { text_count: input.texts.length }
    });
    return { status: "embedded", provider: route.provider, model: route.model, dims: route.dims };
  }

  private async findBlockingPaidApiDecision(
    client: Pick<Pool | PoolClient, "query">,
    input: {
      developerId: string;
      projectId: string;
      route: EmbeddingRoute;
      purpose: string;
    }
  ) {
    const result = await client.query<{ id: string; status: "denied" | "expired" }>(
      `
        SELECT id, status
        FROM paid_api_approval_requests
        WHERE developer_id = $1
          AND project_id = $2
          AND purpose = $3
          AND provider = $4
          AND model = $5
          AND status IN ('denied', 'expired')
        ORDER BY coalesce(decided_at, expires_at, created_at) DESC
        LIMIT 1
      `,
      [input.developerId, input.projectId, input.purpose, input.route.provider, input.route.model]
    );
    return result.rows[0] ?? null;
  }

  private async createPaidApiApproval(
    client: PoolClient,
    input: {
      developerId: string;
      projectId: string;
      sessionId: string | null;
      route: EmbeddingRoute;
      purpose: string;
    }
  ) {
    const result = await client.query<{ id: string }>(
      `
        INSERT INTO paid_api_approval_requests (
          developer_id, project_id, session_id, purpose, provider, model,
          routing_reason, attempted_routes, requested_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'system')
        RETURNING id
      `,
      [
        input.developerId,
        input.projectId,
        input.sessionId,
        input.purpose,
        input.route.provider,
        input.route.model,
        input.route.routingReason,
        JSON.stringify([{ provider: input.route.provider, model: input.route.model }])
      ]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Failed to create paid API approval request");
    return { id };
  }

  private async recordModelCall(
    client: Pick<Pool | PoolClient, "query">,
    input: {
      developerId: string;
      projectId: string;
      sessionId: string | null;
      route: EmbeddingRoute;
      purpose: string;
      status: "success" | "failed" | "cancelled";
      confirmationStatus?: string;
      approvalRequestId?: string;
      errorCode?: string;
      metadata?: JsonObject;
    }
  ) {
    await client.query(
      `
        INSERT INTO model_calls (
          developer_id, project_id, session_id, memory_domain, route_class,
          provider, model, purpose, routing_reason, confirmation_status,
          approval_request_id, status, error_code, metadata
        )
        VALUES ($1, $2, $3, 'agent_work', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        input.developerId,
        input.projectId,
        input.sessionId,
        input.route.routeClass,
        input.route.provider,
        input.route.model,
        input.purpose,
        input.route.routingReason,
        input.confirmationStatus ?? "not_required",
        input.approvalRequestId ?? null,
        input.status,
        input.errorCode ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
  }

  private async findLastEventId(client: PoolClient, sessionId: string) {
    const result = await client.query<{ id: string }>(
      "SELECT id FROM events WHERE session_id = $1 ORDER BY occurred_at DESC, created_at DESC LIMIT 1",
      [sessionId]
    );
    return result.rows[0]?.id ?? null;
  }

  private async touchSession(client: PoolClient, sessionId?: string | null) {
    if (!sessionId) return;
    await client.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [sessionId]);
  }

  private async findDedup(client: PoolClient, projectId: string, dedupKey?: string | null) {
    if (!dedupKey) return null;
    const result = await client.query<{ event_id: string }>(
      "SELECT event_id FROM ingest_dedup_keys WHERE project_id = $1 AND dedup_key = $2",
      [projectId, dedupKey]
    );
    return result.rows[0]?.event_id ?? null;
  }

  private async insertDedup(
    client: PoolClient,
    projectId: string,
    dedupKey: string | null | undefined,
    eventId: string
  ) {
    if (!dedupKey) return;
    await client.query(
      `
        INSERT INTO ingest_dedup_keys (project_id, dedup_key, event_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (project_id, dedup_key) DO NOTHING
      `,
      [projectId, dedupKey, eventId]
    );
  }
}

let cachedDb: RecallantDb | null | undefined;

export function createRecallantDbFromEnv() {
  const databaseUrl = process.env.RECALLANT_DATABASE_URL;
  if (!databaseUrl) return null;
  cachedDb ??= new RecallantDb({
    databaseUrl,
    developerId: process.env.RECALLANT_DEVELOPER_ID,
    projectId: process.env.RECALLANT_PROJECT_ID,
    projectPath: process.env.RECALLANT_PROJECT_PATH
  });
  return cachedDb;
}

export function createRecallantDbFromConfig(config: RecallantDbConfig) {
  return new RecallantDb(config);
}

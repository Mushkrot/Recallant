import {
  agentObservationKindValues,
  type AgentObservationKind,
  type ClientKind
} from "@recallant/contracts";

export const supportedClientKinds: readonly ClientKind[] = [
  "codex",
  "cursor",
  "claude_code",
  "windsurf",
  "generic",
  "other"
];

const supportedClientKindSet = new Set<string>(supportedClientKinds);

export function normalizeClientKind(value: string | null | undefined): ClientKind {
  if (!value) return "other";
  const normalized = value.trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "claude" || normalized === "claudecode") return "claude_code";
  return supportedClientKindSet.has(normalized) ? (normalized as ClientKind) : "other";
}

export type AgentObservationAdapterDescriptor = {
  client_kind: ClientKind;
  contract_version: 1;
  transport: "mcp" | "cli" | "project_hook" | "generic";
  supported_observation_kinds: readonly AgentObservationKind[];
  project_scoped: true;
  global_configuration_write: false;
};

export function agentObservationAdapterDescriptor(input: {
  client_kind?: string | null;
  transport?: AgentObservationAdapterDescriptor["transport"];
}): AgentObservationAdapterDescriptor {
  return {
    client_kind: normalizeClientKind(input.client_kind),
    contract_version: 1,
    transport: input.transport ?? "generic",
    supported_observation_kinds: agentObservationKindValues,
    project_scoped: true,
    global_configuration_write: false
  };
}

import { codexHookEventNames, type CodexHookEventName } from "@recallant/adapters";

export const recallantCodexHookCommand = "recallant codex-hook";
export const recallantCodexHookTimeoutSeconds = 5;

type JsonObject = Record<string, unknown>;

type CodexHookHandler = {
  type: "command";
  command: string;
  timeout: number;
};

type CodexHookGroup = {
  hooks: CodexHookHandler[];
};

export type CodexHookConfigRenderResult =
  | {
      ok: true;
      content: string;
      changed: boolean;
      preserved_handler_count: number;
      managed_event_count: number;
    }
  | {
      ok: false;
      code: "invalid_json" | "invalid_shape";
      message: string;
    };

export type CodexHookConfigReadiness = {
  status: "missing" | "invalid_json" | "invalid_shape" | "partial" | "configured";
  configured: boolean;
  configured_events: CodexHookEventName[];
  missing_events: CodexHookEventName[];
  command: string;
  timeout_seconds: number;
  writes_global_config: false;
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfig(
  existingText: string | null
): { ok: true; value: JsonObject } | Extract<CodexHookConfigRenderResult, { ok: false }> {
  if (existingText === null) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(existingText) as unknown;
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: ".codex/hooks.json is not valid JSON; Recallant did not overwrite it."
    };
  }
  if (!isObject(parsed) || (parsed.hooks !== undefined && !isObject(parsed.hooks))) {
    return {
      ok: false,
      code: "invalid_shape",
      message: ".codex/hooks.json must contain a JSON object with an optional hooks object."
    };
  }
  return { ok: true, value: parsed };
}

function isRecallantHandler(value: unknown) {
  if (!isObject(value) || value.type !== "command" || typeof value.command !== "string") {
    return false;
  }
  return value.command.trim() === recallantCodexHookCommand;
}

function managedGroup(): CodexHookGroup {
  return {
    hooks: [
      {
        type: "command",
        command: recallantCodexHookCommand,
        timeout: recallantCodexHookTimeoutSeconds
      }
    ]
  };
}

export function renderCodexHookConfig(existingText: string | null): CodexHookConfigRenderResult {
  const parsed = parseConfig(existingText);
  if (!parsed.ok) return parsed;

  const existingHooks = isObject(parsed.value.hooks) ? parsed.value.hooks : {};
  const nextHooks: JsonObject = { ...existingHooks };
  let preservedHandlerCount = 0;

  for (const eventName of codexHookEventNames) {
    const groups = existingHooks[eventName];
    if (groups !== undefined && !Array.isArray(groups)) {
      return {
        ok: false,
        code: "invalid_shape",
        message: `.codex/hooks.json hooks.${eventName} must be an array.`
      };
    }
    const preservedGroups: unknown[] = [];
    for (const group of Array.isArray(groups) ? groups : []) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        return {
          ok: false,
          code: "invalid_shape",
          message: `.codex/hooks.json hooks.${eventName} contains an invalid matcher group.`
        };
      }
      const preservedHandlers = group.hooks.filter((handler) => !isRecallantHandler(handler));
      preservedHandlerCount += preservedHandlers.length;
      if (preservedHandlers.length > 0) {
        preservedGroups.push({ ...group, hooks: preservedHandlers });
      }
    }
    nextHooks[eventName] = [...preservedGroups, managedGroup()];
  }

  const next: JsonObject = {
    ...parsed.value,
    ...(typeof parsed.value.description === "string"
      ? {}
      : { description: "Recallant automatic Codex audit capture." }),
    hooks: nextHooks
  };
  const content = `${JSON.stringify(next, null, 2)}\n`;
  return {
    ok: true,
    content,
    changed: existingText !== content,
    preserved_handler_count: preservedHandlerCount,
    managed_event_count: codexHookEventNames.length
  };
}

export function inspectCodexHookConfig(existingText: string | null): CodexHookConfigReadiness {
  if (existingText === null) {
    return {
      status: "missing",
      configured: false,
      configured_events: [],
      missing_events: [...codexHookEventNames],
      command: recallantCodexHookCommand,
      timeout_seconds: recallantCodexHookTimeoutSeconds,
      writes_global_config: false
    };
  }
  const parsed = parseConfig(existingText);
  if (!parsed.ok) {
    return {
      status: parsed.code,
      configured: false,
      configured_events: [],
      missing_events: [...codexHookEventNames],
      command: recallantCodexHookCommand,
      timeout_seconds: recallantCodexHookTimeoutSeconds,
      writes_global_config: false
    };
  }
  const hooks = isObject(parsed.value.hooks) ? parsed.value.hooks : {};
  const configuredEvents = codexHookEventNames.filter((eventName) => {
    const groups = hooks[eventName];
    return (
      Array.isArray(groups) &&
      groups.some(
        (group) =>
          isObject(group) &&
          Array.isArray(group.hooks) &&
          group.hooks.some((handler) => isRecallantHandler(handler))
      )
    );
  });
  const missingEvents = codexHookEventNames.filter(
    (eventName) => !configuredEvents.includes(eventName)
  );
  return {
    status:
      missingEvents.length === 0
        ? "configured"
        : configuredEvents.length > 0
          ? "partial"
          : "missing",
    configured: missingEvents.length === 0,
    configured_events: configuredEvents,
    missing_events: missingEvents,
    command: recallantCodexHookCommand,
    timeout_seconds: recallantCodexHookTimeoutSeconds,
    writes_global_config: false
  };
}

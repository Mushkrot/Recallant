type DashboardRow = Record<string, unknown>;

type DashboardLike = {
  current_project_id?: unknown;
  current_project?: DashboardRow | null;
  projects?: DashboardRow[];
  critical?: DashboardRow | null;
  inbox?: DashboardRow[];
  import_candidates?: DashboardRow[];
  duplicate_conflicts?: DashboardRow[];
  rules?: DashboardRow[];
  costs?: DashboardRow[];
  settings?: DashboardRow[];
  project_cleanup?: DashboardRow | null;
};

type ChatTargetProject = {
  project_id: string;
  project_name: string;
  current_project_id: string;
  current_project_name: string;
  reason: string;
  switched: boolean;
  ambiguous: boolean;
};

export type ManagementChatLanguage = "en" | "ru";

export type ManagementChatIntent =
  | "status"
  | "next_steps"
  | "cleanup"
  | "settings"
  | "cost"
  | "context_pack"
  | "cross_project"
  | "review"
  | "general";

export type ManagementChatAction = {
  label: string;
  kind: "read_only" | "dry_run" | "confirmation_required";
  command?: string;
  reason: string;
};

export type ManagementChatResponse = {
  language: ManagementChatLanguage;
  intent: ManagementChatIntent;
  answer: string;
  confirmation_required: boolean;
  destructive_or_sensitive: boolean;
  facts: {
    project_id: string;
    project_name: string;
    current_project_id: string;
    current_project_name: string;
    target_project_id: string;
    target_project_name: string;
    target_project_reason: string;
    target_project_switched: boolean;
    target_project_ambiguous: boolean;
    pending_review: number;
    import_candidates: number;
    conflicts_or_duplicates: number;
    active_rules: number;
    pending_paid_approvals: number;
    interrupted_sessions: number;
  };
  proposed_actions: ManagementChatAction[];
};

export function buildManagementChatResponse(input: {
  message: string;
  dashboard: DashboardLike;
}): ManagementChatResponse {
  const message = input.message.trim();
  const dashboard = input.dashboard;
  const language = detectLanguage(message);
  const intent = detectIntent(message);
  const targetProject = resolveTargetProject(message, dashboard);
  const facts = dashboardFacts(dashboard, targetProject);
  const destructiveOrSensitive = isDestructiveOrSensitive(message, intent);
  const proposedActions = actionsForIntent(
    intent,
    dashboard,
    facts,
    targetProject,
    language,
    destructiveOrSensitive
  );
  const answer = answerForIntent(intent, facts, language, destructiveOrSensitive);
  return {
    language,
    intent,
    answer,
    confirmation_required: destructiveOrSensitive,
    destructive_or_sensitive: destructiveOrSensitive,
    facts,
    proposed_actions: proposedActions
  };
}

function detectLanguage(message: string): ManagementChatLanguage {
  return /[а-яё]/iu.test(message) ? "ru" : "en";
}

function includesAny(message: string, words: string[]) {
  const normalized = message.toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function detectIntent(message: string): ManagementChatIntent {
  if (!message) return "general";
  if (
    includesAny(message, [
      "удал",
      "отцеп",
      "очист",
      "forget",
      "delete",
      "erase",
      "detach",
      "cleanup",
      "clean up"
    ])
  ) {
    return "cleanup";
  }
  if (includesAny(message, ["стоим", "платн", "api", "cost", "paid", "token", "approval"])) {
    return "cost";
  }
  if (includesAny(message, ["настрой", "setting", "settings", "profile", "route"])) {
    return "settings";
  }
  if (includesAny(message, ["context pack", "контекст", "startup", "запуск", "следующему агент"])) {
    return "context_pack";
  }
  if (
    includesAny(message, [
      "других проект",
      "другого проект",
      "cross-project",
      "cross project",
      "similar project",
      "пример"
    ])
  ) {
    return "cross_project";
  }
  if (includesAny(message, ["review", "провер", "кандидат", "правил", "memory", "памят"])) {
    return "review";
  }
  if (includesAny(message, ["что дальше", "next", "следующ", "делать", "recommend", "рекоменду"])) {
    return "next_steps";
  }
  if (includesAny(message, ["status", "статус", "состоя", "health"])) return "status";
  return "general";
}

function isDestructiveOrSensitive(message: string, intent: ManagementChatIntent) {
  if (intent === "cleanup") return true;
  return includesAny(message, [
    "навсегда",
    "permanent",
    "forever",
    "секрет",
    "secret",
    "public",
    "firewall",
    "paid api",
    "auto_with_caps",
    "global",
    "developer-wide"
  ]);
}

function asNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function asRows(value: unknown) {
  return Array.isArray(value) ? (value as DashboardRow[]) : [];
}

function projectId(row: DashboardRow | null | undefined, fallback: unknown) {
  return String(row?.project_id ?? row?.id ?? fallback ?? "");
}

function projectName(row: DashboardRow | null | undefined, fallback: unknown) {
  return (
    stringValue(row?.name) ||
    stringValue(row?.title) ||
    stringValue(row?.primary_path) ||
    shortId(row?.project_id ?? row?.id ?? fallback)
  );
}

function messageWantsSandbox(message: string) {
  return includesAny(message, ["sandbox", "песочн", "тестов", "test project", "pilot"]);
}

function isSandboxProject(row: DashboardRow) {
  const name = projectName(row, row.project_id).toLowerCase();
  const path = stringValue(row.primary_path).toLowerCase();
  const kind = stringValue(row.project_kind).toLowerCase();
  return (
    name.includes("sandbox") ||
    name.includes("pilot") ||
    path.includes("/recallant-pilots/") ||
    path.includes("sandbox") ||
    kind.includes("sandbox")
  );
}

function resolveTargetProject(message: string, dashboard: DashboardLike): ChatTargetProject {
  const projects = asRows(dashboard.projects);
  const currentProject = dashboard.current_project ?? {};
  const currentProjectId = projectId(currentProject, dashboard.current_project_id);
  const currentProjectName = projectName(currentProject, dashboard.current_project_id);
  const currentTarget = {
    project_id: currentProjectId,
    project_name: currentProjectName || "current project",
    current_project_id: currentProjectId,
    current_project_name: currentProjectName || "current project",
    reason: "current_project",
    switched: false,
    ambiguous: false
  };

  if (!messageWantsSandbox(message) || isSandboxProject(currentProject)) return currentTarget;

  const sandboxProjects = projects.filter(isSandboxProject);
  if (sandboxProjects.length === 1) {
    const target = sandboxProjects[0] ?? {};
    return {
      project_id: projectId(target, currentProjectId),
      project_name: projectName(target, currentProjectId) || "sandbox project",
      current_project_id: currentProjectId,
      current_project_name: currentProjectName || "current project",
      reason: "message_asked_for_sandbox",
      switched: true,
      ambiguous: false
    };
  }

  return {
    ...currentTarget,
    reason: sandboxProjects.length > 1 ? "multiple_sandbox_projects" : "sandbox_project_not_found",
    ambiguous: true
  };
}

function dashboardFacts(
  dashboard: DashboardLike,
  targetProject: ChatTargetProject
): ManagementChatResponse["facts"] {
  const currentProject = dashboard.current_project ?? {};
  const critical = dashboard.critical ?? {};
  return {
    project_id: targetProject.project_id,
    project_name: targetProject.project_name,
    current_project_id: projectId(currentProject, dashboard.current_project_id),
    current_project_name: projectName(currentProject, dashboard.current_project_id),
    target_project_id: targetProject.project_id,
    target_project_name: targetProject.project_name,
    target_project_reason: targetProject.reason,
    target_project_switched: targetProject.switched,
    target_project_ambiguous: targetProject.ambiguous,
    pending_review: asNumber(critical.pending_review),
    import_candidates: asRows(dashboard.import_candidates).length,
    conflicts_or_duplicates: asRows(dashboard.duplicate_conflicts).length,
    active_rules: asRows(dashboard.rules).length,
    pending_paid_approvals: asNumber(critical.pending_paid_approvals),
    interrupted_sessions: asNumber(critical.interrupted_sessions)
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function shortId(value: unknown) {
  return String(value ?? "").slice(0, 8);
}

function answerForIntent(
  intent: ManagementChatIntent,
  facts: ManagementChatResponse["facts"],
  language: ManagementChatLanguage,
  destructiveOrSensitive: boolean
) {
  if (language === "ru") return answerRu(intent, facts, destructiveOrSensitive);
  return answerEn(intent, facts, destructiveOrSensitive);
}

function targetLineRu(facts: ManagementChatResponse["facts"]) {
  if (facts.target_project_ambiguous) {
    return `Открытый проект: ${facts.current_project_name}. Запрос похож на sandbox, но целевой sandbox-проект не определен однозначно.`;
  }
  if (facts.target_project_switched) {
    return `Открытый проект: ${facts.current_project_name}. Целевой проект для этого запроса: ${facts.target_project_name}.`;
  }
  return `Проект: ${facts.project_name}.`;
}

function targetLineEn(facts: ManagementChatResponse["facts"]) {
  if (facts.target_project_ambiguous) {
    return `Open project: ${facts.current_project_name}. The request looks sandbox-related, but the target sandbox project is not unambiguous.`;
  }
  if (facts.target_project_switched) {
    return `Open project: ${facts.current_project_name}. Target project for this request: ${facts.target_project_name}.`;
  }
  return `Project: ${facts.project_name}.`;
}

function answerRu(
  intent: ManagementChatIntent,
  facts: ManagementChatResponse["facts"],
  destructiveOrSensitive: boolean
) {
  const baseline = `${targetLineRu(facts)} На проверке: ${facts.pending_review}, импорт-кандидатов: ${facts.import_candidates}, конфликтов/дубликатов: ${facts.conflicts_or_duplicates}, активных правил: ${facts.active_rules}.`;
  if (facts.target_project_ambiguous && destructiveOrSensitive) {
    return `${baseline}\n\nЯ не буду подставлять открытый проект в опасную команду, потому что запрос похож на sandbox cleanup, а целевой sandbox-проект не выбран однозначно. Сначала выбери нужный проект слева или уточни название.`;
  }
  if (destructiveOrSensitive) {
    const switchNote = facts.target_project_switched
      ? " Я не подставляю открытый проект в команду, потому что запрос явно похож на sandbox cleanup."
      : "";
    return `${baseline}\n\nЭто похоже на действие, которое может удалить, отцепить проект, открыть доступ, затронуть секреты или расходы.${switchNote} Я не выполняю такие действия прямо из чата. Сначала нужна предварительная проверка без изменений, затем явное подтверждение через обычный безопасный путь Recallant.`;
  }
  switch (intent) {
    case "next_steps":
      if (facts.pending_review > 0) {
        return `${baseline}\n\nСледующий оптимальный шаг: разобрать Review Inbox. Начни с импортированных кандидатов и конфликтов, оставляя старые проектные файлы как evidence-only, пока ты явно не решишь сделать из них активные правила.`;
      }
      return `${baseline}\n\nСрочных решений нет. Следующий полезный шаг: запустить обычную рабочую сессию агента и проверить, что он берет стартовый контекст из Recallant без ручного чтения старых логов.`;
    case "cleanup":
      return `${baseline}\n\nДля очистки безопасный порядок такой: сначала предварительная проверка без изменений, потом подтверждение. Обычное отцепление проекта не удаляет память навсегда; чувствительную или ошибочную память нужно отправлять в отдельный workflow полного удаления.`;
    case "settings":
      return `${baseline}\n\nНастройки проекта управляются на стороне Recallant. Опасные изменения, например paid API auto mode или сильное расширение capture/context, должны идти через подтверждение и audit.`;
    case "cost":
      if (facts.pending_paid_approvals > 0) {
        return `${baseline}\n\nЕсть ожидающие paid API approvals: ${facts.pending_paid_approvals}. Пока они не подтверждены, Recallant не должен делать платные вызовы автоматически.`;
      }
      return `${baseline}\n\nОжидающих paid API approvals нет. Если режим paid_api_mode = confirm_each, платные вызовы остаются заблокированы до явного подтверждения.`;
    case "context_pack":
      return `${baseline}\n\nContext Pack должен быть коротким стартовым пакетом для агента: активные правила, последние важные решения, checkpoint и подсказки что запросить дальше. Он не должен тащить всю историю проекта в окно контекста.`;
    case "cross_project":
      return `${baseline}\n\nCross-project recall работает как библиотека примеров, а не как смешанная каша памяти. Агент может попросить примеры из других проектов, но они остаются source-linked evidence, пока их явно не применили к текущему проекту.`;
    case "review":
      return `${baseline}\n\nReview нужен только для важных или рискованных вещей: кандидаты в правила, конфликты, дубликаты, high-risk guidance и imported history. Обычные низкорисковые воспоминания не должны превращаться в ручную очередь.`;
    case "status":
    case "general":
      return `${baseline}\n\nСистема готова для управляемой проверки этого проекта. Если хочешь действовать безопасно, сначала разбираем review/конфликты, потом проверяем старт агента через context pack.`;
  }
}

function answerEn(
  intent: ManagementChatIntent,
  facts: ManagementChatResponse["facts"],
  destructiveOrSensitive: boolean
) {
  const baseline = `${targetLineEn(facts)} Pending review: ${facts.pending_review}, import candidates: ${facts.import_candidates}, conflicts/duplicates: ${facts.conflicts_or_duplicates}, active rules: ${facts.active_rules}.`;
  if (facts.target_project_ambiguous && destructiveOrSensitive) {
    return `${baseline}\n\nI will not substitute the open project into a risky command because the request looks sandbox-related and the target sandbox project is not unambiguous. Select the target project on the left or name it explicitly first.`;
  }
  if (destructiveOrSensitive) {
    const switchNote = facts.target_project_switched
      ? " I am not using the open project for the command because the request explicitly looks sandbox-related."
      : "";
    return `${baseline}\n\nThis looks like an operation that can delete, detach, expose access, touch secrets, or affect cost.${switchNote} I will not execute it directly from chat. Run a dry-run first, then confirm through the normal Recallant policy path.`;
  }
  switch (intent) {
    case "next_steps":
      if (facts.pending_review > 0) {
        return `${baseline}\n\nRecommended next step: clear the Review Inbox, starting with imported candidates and conflicts. Keep old project files as evidence-only unless you explicitly promote them into active rules.`;
      }
      return `${baseline}\n\nNo urgent decisions are waiting. The next useful step is to start an agent session and verify that it gets startup context from Recallant without manually reading old logs.`;
    case "cleanup":
      return `${baseline}\n\nSafe cleanup order: dry-run first, then confirmation. Ordinary detach does not permanently erase memory; sensitive or wrong memory belongs in the separate forget-forever workflow.`;
    case "settings":
      return `${baseline}\n\nProject settings are managed centrally in Recallant. Dangerous changes, such as paid API auto mode or large capture/context increases, must go through confirmation and audit.`;
    case "cost":
      if (facts.pending_paid_approvals > 0) {
        return `${baseline}\n\nThere are pending paid API approvals: ${facts.pending_paid_approvals}. Recallant should not make paid calls automatically until they are approved.`;
      }
      return `${baseline}\n\nThere are no pending paid API approvals. With paid_api_mode = confirm_each, paid calls remain blocked until explicitly confirmed.`;
    case "context_pack":
      return `${baseline}\n\nThe Context Pack should be a compact startup packet for the agent: active rules, important recent decisions, checkpoint, and suggested next fetches. It should not load the whole project history into context.`;
    case "cross_project":
      return `${baseline}\n\nCross-project recall is a library of examples, not mixed memory soup. Agents can ask for examples from other projects, but those results stay source-linked evidence until applied to the current project.`;
    case "review":
      return `${baseline}\n\nReview is for important or risky material: rule candidates, conflicts, duplicates, high-risk guidance, and imported history. Low-risk routine memories should not become manual queue work.`;
    case "status":
    case "general":
      return `${baseline}\n\nThis project is ready for managed review. The safe order is review/conflicts first, then verify agent startup through the context pack.`;
  }
}

function actionsForIntent(
  intent: ManagementChatIntent,
  dashboard: DashboardLike,
  facts: ManagementChatResponse["facts"],
  targetProject: ChatTargetProject,
  language: ManagementChatLanguage,
  destructiveOrSensitive: boolean
): ManagementChatAction[] {
  if (destructiveOrSensitive || intent === "cleanup") {
    if (targetProject.ambiguous) {
      return [
        {
          label: language === "ru" ? "Уточнить целевой проект" : "Clarify target project",
          kind: "read_only",
          reason:
            language === "ru"
              ? "Запрос похож на sandbox cleanup, но Recallant не должен подставлять открытый проект в опасную команду."
              : "The request looks sandbox-related, and Recallant should not put the open project into a risky command."
        }
      ];
    }
    const cleanup = dashboard.project_cleanup ?? {};
    const detachCommand =
      targetProject.project_id === facts.current_project_id
        ? stringValue(cleanup.detach_command)
        : `recallant detach --project-id ${targetProject.project_id} --dry-run`;
    return [
      {
        label:
          language === "ru"
            ? "Сначала предварительная проверка detach"
            : "Run detach dry-run first",
        kind: "dry_run",
        command: detachCommand,
        reason:
          language === "ru"
            ? `Показывает, что будет затронуто в проекте ${targetProject.project_name}, без изменения данных.`
            : `Shows what would be affected in ${targetProject.project_name} without changing data.`
      },
      {
        label:
          language === "ru" ? "Полное удаление только отдельно" : "Use forget forever separately",
        kind: "confirmation_required",
        reason:
          language === "ru"
            ? "Постоянное удаление чувствительной или ошибочной памяти требует отдельного подтверждения."
            : "Permanent erasure of sensitive or wrong memory requires a separate confirmation."
      }
    ];
  }

  if (intent === "cost") {
    return [
      {
        label: language === "ru" ? "Проверить Cost / Paid API" : "Review Cost / Paid API",
        kind: "read_only",
        reason:
          language === "ru"
            ? `Ожидающих paid approvals: ${facts.pending_paid_approvals}.`
            : `Pending paid approvals: ${facts.pending_paid_approvals}.`
      }
    ];
  }

  if (facts.pending_review > 0) {
    return [
      {
        label: language === "ru" ? "Открыть первый Review item" : "Open the first review item",
        kind: "read_only",
        reason:
          language === "ru"
            ? "Это ближайшее безопасное решение владельца."
            : "This is the nearest safe owner decision."
      }
    ];
  }

  return [
    {
      label: language === "ru" ? "Проверить context pack" : "Check the context pack",
      kind: "read_only",
      reason:
        language === "ru"
          ? "Показывает, что получит следующий агент на старте."
          : "Shows what the next agent will receive at startup."
    }
  ];
}

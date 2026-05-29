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
  const facts = dashboardFacts(dashboard);
  const destructiveOrSensitive = isDestructiveOrSensitive(message, intent);
  const proposedActions = actionsForIntent(
    intent,
    dashboard,
    facts,
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

function dashboardFacts(dashboard: DashboardLike): ManagementChatResponse["facts"] {
  const currentProject = dashboard.current_project ?? {};
  const critical = dashboard.critical ?? {};
  const projectName =
    stringValue(currentProject.name) ||
    stringValue(currentProject.primary_path) ||
    shortId(dashboard.current_project_id);
  return {
    project_id: String(dashboard.current_project_id ?? ""),
    project_name: projectName || "current project",
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

function answerRu(
  intent: ManagementChatIntent,
  facts: ManagementChatResponse["facts"],
  destructiveOrSensitive: boolean
) {
  const baseline = `Проект: ${facts.project_name}. На проверке: ${facts.pending_review}, импорт-кандидатов: ${facts.import_candidates}, конфликтов/дубликатов: ${facts.conflicts_or_duplicates}, активных правил: ${facts.active_rules}.`;
  if (destructiveOrSensitive) {
    return `${baseline}\n\nЭто похоже на действие, которое может удалить, отцепить проект, открыть доступ, затронуть секреты или расходы. Я не выполняю такие действия прямо из чата. Сначала нужна предварительная проверка без изменений, затем явное подтверждение через обычный безопасный путь Recallant.`;
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
  const baseline = `Project: ${facts.project_name}. Pending review: ${facts.pending_review}, import candidates: ${facts.import_candidates}, conflicts/duplicates: ${facts.conflicts_or_duplicates}, active rules: ${facts.active_rules}.`;
  if (destructiveOrSensitive) {
    return `${baseline}\n\nThis looks like an operation that can delete, detach, expose access, touch secrets, or affect cost. I will not execute it directly from chat. Run a dry-run first, then confirm through the normal Recallant policy path.`;
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
  language: ManagementChatLanguage,
  destructiveOrSensitive: boolean
): ManagementChatAction[] {
  if (destructiveOrSensitive || intent === "cleanup") {
    const cleanup = dashboard.project_cleanup ?? {};
    return [
      {
        label:
          language === "ru"
            ? "Сначала предварительная проверка detach"
            : "Run detach dry-run first",
        kind: "dry_run",
        command: stringValue(cleanup.detach_command),
        reason:
          language === "ru"
            ? "Показывает, что будет затронуто, без изменения данных."
            : "Shows what would be affected without changing data."
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

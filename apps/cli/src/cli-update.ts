import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const officialRecallantRepository = "Mushkrot/Recallant";
export const officialRecallantRepositoryUrl = "https://github.com/Mushkrot/Recallant.git";
export const officialRecallantBranch = "main";
export const officialRecallantLatestCommitUrl =
  "https://api.github.com/repos/Mushkrot/Recallant/commits/main";

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchImplementation = (
  input: string,
  init: {
    headers: Record<string, string>;
    signal: AbortSignal;
  }
) => Promise<FetchResponse>;

export type RecallantCliUpdateCheck = {
  status: "current" | "update_available" | "pinned" | "custom_build" | "unavailable";
  current_version: string;
  current_revision: string | null;
  latest_revision: string | null;
  official_repository: typeof officialRecallantRepository;
  channel: string;
  message: string;
};

function isOfficialRecallantRepositoryUrl(value: string | null) {
  if (!value) return false;
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)(?:Mushkrot\/Recallant)(?:\.git)?\/?$/i.test(
    value.trim()
  );
}

type CommandResult = Pick<SpawnSyncReturns<string>, "status" | "stdout" | "stderr" | "error">;

type CommandRunner = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    timeout: number;
  }
) => CommandResult;

export type RecallantCliUpdateApplyResult = {
  status: "updated" | "blocked" | "failed";
  previous_revision: string | null;
  installed_revision: string | null;
  executable: string | null;
  message: string;
};

function normalizeGitRevision(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(normalized) ? normalized : null;
}

function releaseVersionFromCliVersion(value: string) {
  return value.trim().split("+", 1)[0] ?? "";
}

function isMatchingOfficialVersionTag(tag: string, currentVersion: string) {
  return tag === `v${releaseVersionFromCliVersion(currentVersion)}`;
}

function shortRevision(value: string | null) {
  return value?.slice(0, 8) ?? "unknown";
}

function commandFailure(result: CommandResult, fallback: string) {
  const firstLine = String(result.stderr || result.stdout || result.error?.message || fallback)
    .trim()
    .split("\n")[0];
  return firstLine || fallback;
}

function defaultCommandRunner(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    encoding: "utf8";
    timeout: number;
  }
) {
  return spawnSync(command, [...args], options);
}

function runGitRevision(repoRoot: string, ref: string, runCommand: CommandRunner) {
  const result = runCommand("git", ["-C", repoRoot, "rev-parse", ref], {
    cwd: repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 15_000
  });
  return result.status === 0 ? normalizeGitRevision(result.stdout) : null;
}

export async function checkRecallantCliUpdate(input: {
  currentVersion: string;
  currentRevision: string | null;
  currentBranch: string | null;
  currentTag?: string | null;
  currentRepositoryUrl: string | null;
  currentAheadOfTrackingBranch: boolean;
  timeoutMs?: number;
  latestCommitUrl?: string;
  fetchImplementation?: FetchImplementation;
}): Promise<RecallantCliUpdateCheck> {
  const currentRevision = normalizeGitRevision(input.currentRevision);
  const base = {
    current_version: input.currentVersion,
    current_revision: currentRevision,
    latest_revision: null,
    official_repository: officialRecallantRepository,
    channel: officialRecallantBranch
  } as const;
  if (!currentRevision) {
    return {
      ...base,
      status: "unavailable",
      message: "The installed build does not include a comparable Git revision."
    };
  }
  if (!isOfficialRecallantRepositoryUrl(input.currentRepositoryUrl)) {
    return {
      ...base,
      status: "custom_build",
      message: "The installed CLI is not linked to the official Recallant repository."
    };
  }
  if (input.currentAheadOfTrackingBranch) {
    return {
      ...base,
      status: "custom_build",
      message: "The installed CLI contains local commits newer than its tracked official branch."
    };
  }
  if (input.currentTag) {
    if (!isMatchingOfficialVersionTag(input.currentTag, input.currentVersion)) {
      return {
        ...base,
        channel: input.currentTag,
        status: "custom_build",
        message: `The installed CLI version does not match official tag ${input.currentTag}.`
      };
    }
    return {
      ...base,
      channel: input.currentTag,
      status: "pinned",
      message: `Recallant is pinned to ${input.currentTag}; the main development channel was not checked.`
    };
  }
  if (input.currentBranch && input.currentBranch !== officialRecallantBranch) {
    return {
      ...base,
      status: "custom_build",
      message: `The installed CLI is on custom branch ${input.currentBranch}.`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 2_000);
  try {
    const fetchImplementation = input.fetchImplementation ?? (fetch as FetchImplementation);
    const response = await fetchImplementation(
      input.latestCommitUrl ?? officialRecallantLatestCommitUrl,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": `Recallant-CLI/${input.currentVersion}`,
          "x-github-api-version": "2022-11-28"
        },
        signal: controller.signal
      }
    );
    if (!response.ok) {
      return {
        ...base,
        status: "unavailable",
        message: `The official repository returned HTTP ${response.status}.`
      };
    }
    const payload = (await response.json()) as { sha?: unknown };
    const latestRevision = normalizeGitRevision(payload.sha);
    if (!latestRevision) {
      return {
        ...base,
        status: "unavailable",
        message: "The official repository did not return a valid revision."
      };
    }
    if (latestRevision === currentRevision) {
      return {
        ...base,
        latest_revision: latestRevision,
        status: "current",
        message: "Recallant is up to date."
      };
    }
    return {
      ...base,
      latest_revision: latestRevision,
      status: "update_available",
      message: `Recallant ${shortRevision(currentRevision)} can be updated to ${shortRevision(latestRevision)}.`
    };
  } catch {
    return {
      ...base,
      status: "unavailable",
      message: "The update check could not reach the official repository."
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function renderRecallantCliUpdateAvailable(check: RecallantCliUpdateCheck) {
  const width = 64;
  const innerWidth = width - 4;
  const row = (text = "") => `│ ${text.slice(0, innerWidth).padEnd(innerWidth)} │`;
  return [
    `╭${"─".repeat(width - 2)}╮`,
    row("Recallant update available"),
    row(),
    row(`${shortRevision(check.current_revision)}  →  ${shortRevision(check.latest_revision)}`),
    row(`Official channel: ${check.official_repository} ${check.channel}`),
    `╰${"─".repeat(width - 2)}╯`
  ].join("\n");
}

export function applyRecallantCliUpdate(input: {
  repoRoot: string;
  currentRevision: string | null;
  expectedLatestRevision: string;
  userHome?: string;
  runCommand?: CommandRunner;
  fileExists?: (path: string) => boolean;
}): RecallantCliUpdateApplyResult {
  const runCommand = input.runCommand ?? defaultCommandRunner;
  const fileExists = input.fileExists ?? existsSync;
  const currentRevision = normalizeGitRevision(input.currentRevision);
  const expectedLatestRevision = normalizeGitRevision(input.expectedLatestRevision);
  const installScript = join(input.repoRoot, "scripts", "install-recallant-cli.sh");
  if (!expectedLatestRevision || !fileExists(installScript)) {
    return {
      status: "blocked",
      previous_revision: currentRevision,
      installed_revision: null,
      executable: null,
      message: "This installation does not have a safe checkout-based update path."
    };
  }

  const status = runCommand("git", ["-C", input.repoRoot, "status", "--porcelain"], {
    cwd: input.repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 15_000
  });
  if (status.status !== 0) {
    return {
      status: "blocked",
      previous_revision: currentRevision,
      installed_revision: null,
      executable: null,
      message: "Recallant could not verify that its installation checkout is safe to update."
    };
  }
  if (String(status.stdout).trim()) {
    return {
      status: "blocked",
      previous_revision: currentRevision,
      installed_revision: null,
      executable: null,
      message:
        "The Recallant installation checkout has local changes, so automatic update was skipped."
    };
  }

  const fetchResult = runCommand(
    "git",
    [
      "-C",
      input.repoRoot,
      "fetch",
      "--quiet",
      officialRecallantRepositoryUrl,
      officialRecallantBranch
    ],
    {
      cwd: input.repoRoot,
      env: { ...process.env },
      encoding: "utf8",
      timeout: 120_000
    }
  );
  if (fetchResult.status !== 0) {
    return {
      status: "failed",
      previous_revision: currentRevision,
      installed_revision: null,
      executable: null,
      message: commandFailure(fetchResult, "Could not fetch the official Recallant update.")
    };
  }
  const fetchedRevision = runGitRevision(input.repoRoot, "FETCH_HEAD", runCommand);
  if (!fetchedRevision || fetchedRevision !== expectedLatestRevision) {
    return {
      status: "failed",
      previous_revision: currentRevision,
      installed_revision: fetchedRevision,
      executable: null,
      message: "The fetched revision changed during the update check. Run onboarding again."
    };
  }

  const branchResult = runCommand(
    "git",
    ["-C", input.repoRoot, "symbolic-ref", "--short", "-q", "HEAD"],
    {
      cwd: input.repoRoot,
      env: { ...process.env },
      encoding: "utf8",
      timeout: 15_000
    }
  );
  const branch = branchResult.status === 0 ? String(branchResult.stdout).trim() : null;
  if (branch && branch !== officialRecallantBranch) {
    return {
      status: "blocked",
      previous_revision: currentRevision,
      installed_revision: fetchedRevision,
      executable: null,
      message: `The Recallant installation uses custom branch ${branch}; automatic update was skipped.`
    };
  }
  const checkoutArgs = branch
    ? ["-C", input.repoRoot, "merge", "--ff-only", "FETCH_HEAD"]
    : ["-C", input.repoRoot, "checkout", "--quiet", "--detach", "FETCH_HEAD"];
  const checkoutResult = runCommand("git", checkoutArgs, {
    cwd: input.repoRoot,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 60_000
  });
  if (checkoutResult.status !== 0) {
    return {
      status: "failed",
      previous_revision: currentRevision,
      installed_revision: fetchedRevision,
      executable: null,
      message: commandFailure(checkoutResult, "The Recallant checkout could not be updated safely.")
    };
  }

  const installEnv = {
    ...process.env,
    ...(input.userHome ? { HOME: input.userHome } : {}),
    RECALLANT_HOME: input.repoRoot
  };
  const dependencies = runCommand("npm", ["install"], {
    cwd: input.repoRoot,
    env: installEnv,
    encoding: "utf8",
    timeout: 180_000
  });
  if (dependencies.status !== 0) {
    return {
      status: "failed",
      previous_revision: currentRevision,
      installed_revision: fetchedRevision,
      executable: null,
      message: commandFailure(dependencies, "Recallant dependencies could not be refreshed.")
    };
  }
  const install = runCommand("bash", [installScript, "--user"], {
    cwd: input.repoRoot,
    env: installEnv,
    encoding: "utf8",
    timeout: 180_000
  });
  if (install.status !== 0) {
    return {
      status: "failed",
      previous_revision: currentRevision,
      installed_revision: fetchedRevision,
      executable: null,
      message: commandFailure(install, "Recallant CLI could not be installed.")
    };
  }

  const executable = join(input.userHome ?? homedir(), ".local", "bin", "recallant");
  if (!fileExists(executable)) {
    return {
      status: "failed",
      previous_revision: currentRevision,
      installed_revision: fetchedRevision,
      executable: null,
      message: "Recallant updated its checkout, but the user-local CLI executable is missing."
    };
  }
  return {
    status: "updated",
    previous_revision: currentRevision,
    installed_revision: fetchedRevision,
    executable,
    message: `Recallant was updated to ${shortRevision(fetchedRevision)}.`
  };
}

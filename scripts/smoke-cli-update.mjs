import {
  applyRecallantCliUpdate,
  checkRecallantCliUpdate,
  officialRecallantRepositoryUrl,
  renderRecallantCliUpdateAvailable
} from "../apps/cli/dist/cli-update.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const currentRevision = "a".repeat(40);
const latestRevision = "b".repeat(40);
const current = await checkRecallantCliUpdate({
  currentVersion: "0.1.0-dev.0+aaaaaaaa",
  currentRevision,
  currentBranch: "main",
  currentRepositoryUrl: officialRecallantRepositoryUrl,
  currentAheadOfTrackingBranch: false,
  fetchImplementation: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sha: currentRevision })
  })
});
assert(current.status === "current", `Expected current update status: ${JSON.stringify(current)}`);

const available = await checkRecallantCliUpdate({
  currentVersion: "0.1.0-dev.0+aaaaaaaa",
  currentRevision,
  currentBranch: null,
  currentRepositoryUrl: officialRecallantRepositoryUrl,
  currentAheadOfTrackingBranch: false,
  fetchImplementation: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sha: latestRevision })
  })
});
assert(
  available.status === "update_available" && available.latest_revision === latestRevision,
  `Expected update_available: ${JSON.stringify(available)}`
);
const rendered = renderRecallantCliUpdateAvailable(available);
assert(rendered.includes("Recallant update available"), `Missing update heading: ${rendered}`);
assert(rendered.includes("aaaaaaaa  →  bbbbbbbb"), `Missing revision transition: ${rendered}`);
assert(rendered.includes("Mushkrot/Recallant main"), `Missing official channel: ${rendered}`);

let pinnedFetchCalled = false;
const pinned = await checkRecallantCliUpdate({
  currentVersion: "0.1.0-dev.0+aaaaaaaa",
  currentRevision,
  currentBranch: null,
  currentTag: "v0.1.0-dev.0",
  currentRepositoryUrl: officialRecallantRepositoryUrl,
  currentAheadOfTrackingBranch: false,
  fetchImplementation: async () => {
    pinnedFetchCalled = true;
    throw new Error("a pinned prerelease must not query the main update channel");
  }
});
assert(pinned.status === "pinned", `Expected pinned prerelease: ${JSON.stringify(pinned)}`);
assert(pinned.channel === "v0.1.0-dev.0", `Expected tagged channel: ${JSON.stringify(pinned)}`);
assert(
  pinnedFetchCalled === false,
  "Pinned prerelease unexpectedly queried the official main update channel"
);

let customFetchCalled = false;
const custom = await checkRecallantCliUpdate({
  currentVersion: "0.1.0-dev.0+aaaaaaaa",
  currentRevision,
  currentBranch: "feature/custom",
  currentRepositoryUrl: officialRecallantRepositoryUrl,
  currentAheadOfTrackingBranch: false,
  fetchImplementation: async () => {
    customFetchCalled = true;
    throw new Error("custom builds must not query the update channel");
  }
});
assert(custom.status === "custom_build", `Expected custom_build: ${JSON.stringify(custom)}`);
assert(
  customFetchCalled === false,
  "Custom branch unexpectedly queried the official update channel"
);

const fork = await checkRecallantCliUpdate({
  currentVersion: "0.1.0-dev.0+aaaaaaaa",
  currentRevision,
  currentBranch: "main",
  currentRepositoryUrl: "https://github.com/example/Recallant.git",
  currentAheadOfTrackingBranch: false,
  fetchImplementation: async () => {
    throw new Error("forked builds must not query the update channel");
  }
});
assert(fork.status === "custom_build", `Expected fork to be custom: ${JSON.stringify(fork)}`);

const localAhead = await checkRecallantCliUpdate({
  currentVersion: "0.1.0-dev.0+aaaaaaaa",
  currentRevision,
  currentBranch: "main",
  currentRepositoryUrl: officialRecallantRepositoryUrl,
  currentAheadOfTrackingBranch: true,
  fetchImplementation: async () => {
    throw new Error("locally newer builds must not query or downgrade from the update channel");
  }
});
assert(
  localAhead.status === "custom_build",
  `Expected locally newer build to be custom: ${JSON.stringify(localAhead)}`
);

const unavailable = await checkRecallantCliUpdate({
  currentVersion: "0.1.0-dev.0+aaaaaaaa",
  currentRevision,
  currentBranch: "main",
  currentRepositoryUrl: officialRecallantRepositoryUrl,
  currentAheadOfTrackingBranch: false,
  fetchImplementation: async () => {
    throw new Error("offline");
  }
});
assert(
  unavailable.status === "unavailable",
  `Offline update check should fail open: ${JSON.stringify(unavailable)}`
);

const commands = [];
const runCommand = (command, args) => {
  commands.push([command, ...args]);
  if (command === "git" && args.includes("status")) {
    return { status: 0, stdout: "", stderr: "", error: undefined };
  }
  if (command === "git" && args.includes("rev-parse")) {
    return { status: 0, stdout: `${latestRevision}\n`, stderr: "", error: undefined };
  }
  if (command === "git" && args.includes("symbolic-ref")) {
    return { status: 1, stdout: "", stderr: "", error: undefined };
  }
  return { status: 0, stdout: "", stderr: "", error: undefined };
};
const applied = applyRecallantCliUpdate({
  repoRoot: "/tmp/recallant-cli-update-smoke",
  currentRevision,
  expectedLatestRevision: latestRevision,
  runCommand,
  fileExists: () => true
});
assert(applied.status === "updated", `Expected safe update: ${JSON.stringify(applied)}`);
assert(
  commands.some(
    ([command, ...args]) =>
      command === "git" && args.includes(officialRecallantRepositoryUrl) && args.includes("main")
  ),
  `Update did not fetch the official repository: ${JSON.stringify(commands)}`
);
assert(
  commands.some(([command, ...args]) => command === "git" && args.includes("--detach")),
  `Detached bootstrap checkout was not updated safely: ${JSON.stringify(commands)}`
);
assert(
  commands.some(([command, ...args]) => command === "npm" && args[0] === "install"),
  `Dependencies were not refreshed: ${JSON.stringify(commands)}`
);
assert(
  commands.some(([command, ...args]) => command === "bash" && args.at(-1) === "--user"),
  `User-local CLI install was not invoked: ${JSON.stringify(commands)}`
);

const dirty = applyRecallantCliUpdate({
  repoRoot: "/tmp/recallant-cli-update-smoke",
  currentRevision,
  expectedLatestRevision: latestRevision,
  runCommand: (command, args) => {
    if (command === "git" && args.includes("status")) {
      return { status: 0, stdout: " M apps/cli/src/index.ts\n", stderr: "", error: undefined };
    }
    throw new Error("Dirty checkout must stop before fetching or installing");
  },
  fileExists: () => true
});
assert(dirty.status === "blocked", `Dirty checkout must be blocked: ${JSON.stringify(dirty)}`);

process.stdout.write(
  `${JSON.stringify(
    {
      cli_update_smoke: {
        status: "pass",
        update_check: "official_main_revision",
        tagged_prerelease_behavior: "pinned_no_channel_switch",
        offline_behavior: "fail_open",
        custom_branch_behavior: "no_auto_update",
        install_source: officialRecallantRepositoryUrl,
        checkout_safety: "clean_only",
        terminal_ui: "boxed_update_prompt"
      }
    },
    null,
    2
  )}\n`
);

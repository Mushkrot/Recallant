import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path) {
  return readFile(join(repoRoot, path), "utf8");
}

function mustNotMatch(text, patterns, label) {
  for (const pattern of patterns) {
    assert(!pattern.test(text), `${label} contains forbidden public pattern: ${pattern}`);
  }
}

const publicDocs = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/README.md",
  "docs/QUICKSTART.md",
  "docs/WHY_RECALLANT.md",
  "docs/COMPARISON.md",
  "docs/ARCHITECTURE.md",
  "docs/SELF_HOSTING.md",
  "docs/CLIENT_SETUP.md",
  "docs/SECURITY.md",
  "docs/ROADMAP.md"
];

const forbidden = [
  /recallant\.unicloud\.ca/i,
  /highmac/i,
  /\/ai\/recallant(?:-data)?/i,
  /\/opt\/secure-configs/i,
  /\bPOSTGRES_PASSWORD\s*=/i,
  /\bRECALLANT_AUTH_TOKEN\s*=/i,
  /\bRECALLANT_SESSION_SECRET\s*=/i,
  /\b[A-Z0-9_]*API_KEY\s*=\s*[^<\s]/i,
  /postgres(?:ql)?:\/\/[^ <>"')]+:[^ <>"')]+@/i
];

for (const path of publicDocs) {
  const text = await read(path);
  mustNotMatch(text, forbidden, path);
}

process.stdout.write("Public security smoke passed\n");

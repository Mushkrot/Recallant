import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function read(path) {
  return readFile(join(repoRoot, path), "utf8");
}

function mustInclude(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} missing ${marker}`);
  }
}

function mustNotMatch(text, patterns, label) {
  for (const pattern of patterns) {
    assert(!pattern.test(text), `${label} contains forbidden public-path pattern: ${pattern}`);
  }
}

const normalPublicDocs = [
  "README.md",
  "docs/QUICKSTART.md",
  "docs/SELF_HOSTING.md",
  "docs/CLIENT_SETUP.md"
];

const forbiddenInNormalPublicPath = [
  /recallant\.unicloud\.ca/i,
  /highmac/i,
  /\/ai\/recallant(?:-data)?/i,
  /\/opt\/secure-configs/i,
  /\bPOSTGRES_PASSWORD\s*=/i,
  /\bRECALLANT_AUTH_TOKEN\s*=/i,
  /\bRECALLANT_SESSION_SECRET\s*=/i,
  /\b[A-Z0-9_]*API_KEY\s*=/i,
  /postgres(?:ql)?:\/\/[^ <>"')]+/i
];

for (const path of normalPublicDocs) {
  const text = await read(path);
  mustNotMatch(text, forbiddenInNormalPublicPath, path);
}

const review = await read("docs/PUBLIC_SECURITY_REVIEW.md");
mustInclude(
  review,
  [
    "Reviewed Public Path",
    "Public Defaults",
    "What The Public Path Must Not Expose",
    "OWNER_SERVER.md",
    "npm run public-security:smoke",
    "manual security review"
  ],
  "docs/PUBLIC_SECURITY_REVIEW.md"
);

const release = await read("docs/RELEASE.md");
mustInclude(
  release,
  [
    "What Must Not Be Released As Public Defaults",
    "Cloudflare hostname",
    "raw env values"
  ],
  "docs/RELEASE.md"
);

const screenshots = await read("docs/PUBLIC_SCREENSHOTS.md");
mustInclude(screenshots, ["Redaction Rules", "owner-server paths", "private hostnames"], "docs/PUBLIC_SCREENSHOTS.md");

process.stdout.write("Public security smoke passed\n");

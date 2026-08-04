import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import type {
  CreateGraphCandidateInput,
  GraphCandidateEndpointRef,
  GraphCandidateSourceRef
} from "@recallant/contracts";

export type VaultLinkKind = "markdown" | "wiki" | "external" | "media";

export type VaultSecretReference = {
  code: string;
  name: string;
};

export type VaultHeading = {
  level: number;
  title: string;
  anchor: string;
  line: number;
};

export type VaultLink = {
  kind: VaultLinkKind;
  target: string;
  label?: string | null;
  anchor?: string | null;
  line: number;
};

export type VaultFileInventory = {
  path: string;
  source_id: string;
  sha256: string;
  size_bytes: number;
  frontmatter: Record<string, string | string[]>;
  frontmatter_keys: string[];
  tags: string[];
  headings: VaultHeading[];
  links: VaultLink[];
  media_references: VaultLink[];
  block_anchors: string[];
  risk: "low" | "needs_review";
  secret_references: VaultSecretReference[];
};

export type VaultInventoryResult = {
  action: "vault_inventory";
  dry_run: true;
  writes_memory: false;
  writes_files: false;
  read_only: true;
  vault_dir: string;
  summary: {
    markdown_files: number;
    skipped_files: number;
    headings: number;
    tags: number;
    links: number;
    media_references: number;
    unsafe_files: number;
  };
  files: VaultFileInventory[];
  skipped: Array<{ path: string; reason: string }>;
  warnings: string[];
  governance: {
    default_mode: "dry_run";
    persistence: "none";
    media_policy: "references_only";
    secret_policy: "names_and_codes_only";
    obsidian_policy: "compatible_markdown_subset_no_plugin";
  };
};

export type VaultCandidateProposal = {
  proposal_id: string;
  source_path: string;
  candidate: CreateGraphCandidateInput;
};

export type VaultCandidatePlan = {
  action: "vault_candidates";
  dry_run: true;
  writes_database: false;
  inventory_summary: VaultInventoryResult["summary"];
  summary: {
    proposals: number;
    node_candidates: number;
    edge_candidates: number;
    needs_review: number;
    blocked_files: number;
  };
  proposals: VaultCandidateProposal[];
  blocked_files: Array<{ path: string; reason: string; codes: string[] }>;
  governance: {
    default_mode: "dry_run";
    persistence: "requires_write_candidates_and_confirm";
    retrieval: "not_default_retrieval_active";
    extraction_method: "vault_bridge";
  };
};

export type VaultMarkdownExportFile = {
  path: string;
  title: string;
  content: string;
  size_bytes: number;
};

export type VaultMarkdownExportPlan = {
  action: "vault_export";
  dry_run: true;
  writes_files: false;
  output_dir: string;
  files: VaultMarkdownExportFile[];
  summary: {
    files: number;
    candidate_proposals: number;
    open_questions: number;
    review_items: number;
  };
  governance: {
    default_mode: "dry_run";
    write_policy: "requires_write_and_confirm";
    artifact_policy: "markdown_only_no_raw_media";
    secret_policy: "no_raw_secret_values";
  };
};

export type VaultInventoryOptions = {
  vaultDir: string;
  includePrefixes?: readonly string[];
  excludePrefixes?: readonly string[];
  maxFileBytes?: number;
};

const defaultMaxFileBytes = 250_000;
const markdownExtensions = new Set([".md", ".markdown"]);
const mediaExtensions = new Set([
  ".avif",
  ".bmp",
  ".flac",
  ".gif",
  ".jpeg",
  ".jpg",
  ".m4a",
  ".mov",
  ".mp3",
  ".mp4",
  ".ogg",
  ".pdf",
  ".png",
  ".svg",
  ".wav",
  ".webm",
  ".webp"
]);
const ignoredDirectoryNames = new Set([
  ".git",
  ".obsidian",
  ".recallant",
  ".supergoal",
  "Recallant",
  "build",
  "coverage",
  "dist",
  "node_modules"
]);

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function toPosixPath(path: string) {
  return path.split(sep).join("/");
}

function normalizePrefix(prefix: string) {
  return toPosixPath(prefix).replace(/^\/+/, "").replace(/\/+$/, "");
}

function pathMatchesPrefix(path: string, prefix: string) {
  const normalized = normalizePrefix(prefix);
  return normalized === "" || path === normalized || path.startsWith(`${normalized}/`);
}

function isIncluded(path: string, includePrefixes: readonly string[]) {
  return (
    includePrefixes.length === 0 ||
    includePrefixes.some((prefix) => pathMatchesPrefix(path, prefix))
  );
}

function isExcluded(path: string, excludePrefixes: readonly string[]) {
  return excludePrefixes.some((prefix) => pathMatchesPrefix(path, prefix));
}

function relativeVaultPath(vaultDir: string, path: string) {
  return toPosixPath(relative(vaultDir, path));
}

function shouldIgnoreDirectory(name: string) {
  return ignoredDirectoryNames.has(name) || (name.startsWith(".") && name !== ".");
}

function isMarkdownPath(path: string) {
  return markdownExtensions.has(extname(path).toLowerCase());
}

function isMediaTarget(target: string) {
  const cleanTarget = target.split("#")[0]?.split("?")[0] ?? target;
  return mediaExtensions.has(extname(cleanTarget).toLowerCase());
}

function slugifyHeading(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]().]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueSorted(values: Iterable<string>) {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function sanitizeScalar(value: string) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
  return secretLikePattern().test(trimmed) ? "<redacted>" : trimmed;
}

function parseScalarOrList(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => sanitizeScalar(item))
      .filter(Boolean);
  }
  if (trimmed.includes(",") && trimmed.length < 200) {
    return trimmed
      .split(",")
      .map((item) => sanitizeScalar(item))
      .filter(Boolean);
  }
  return sanitizeScalar(trimmed);
}

function parseFrontmatter(content: string) {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { frontmatter: {} as Record<string, string | string[]>, body: content };
  }
  const normalized = content.replaceAll("\r\n", "\n");
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {} as Record<string, string | string[]>, body: content };

  const block = normalized.slice(4, end);
  const frontmatter: Record<string, string | string[]> = {};
  let listKey: string | null = null;
  for (const line of block.split("\n")) {
    const listMatch = line.match(/^\s*-\s+(.+)$/);
    if (listKey && listMatch) {
      const existing = Array.isArray(frontmatter[listKey])
        ? (frontmatter[listKey] as string[])
        : [];
      frontmatter[listKey] = [...existing, sanitizeScalar(listMatch[1] ?? "")].filter(Boolean);
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      listKey = null;
      continue;
    }
    const key = match[1] ?? "";
    const value = match[2] ?? "";
    if (/secret|token|password|passwd|api[_-]?key|database[_-]?url|dsn/i.test(key)) {
      frontmatter[key] = "<redacted>";
      listKey = null;
      continue;
    }
    if (value.trim() === "") {
      frontmatter[key] = [];
      listKey = key;
      continue;
    }
    frontmatter[key] = parseScalarOrList(value);
    listKey = null;
  }
  return { frontmatter, body: normalized.slice(end + "\n---\n".length) };
}

function lineNumberForIndex(content: string, index: number) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function secretLikePattern() {
  return /\b(?:api[_-]?key|provider[_-]?(?:token|secret)|raw[_-]?credential|password|passwd|secret|token|database[_-]?url|dsn)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/i;
}

function detectSecretReferences(content: string, frontmatter: Record<string, string | string[]>) {
  const refs: VaultSecretReference[] = [];
  for (const key of Object.keys(frontmatter)) {
    if (/secret|token|password|passwd|api[_-]?key|database[_-]?url|dsn/i.test(key)) {
      refs.push({ code: "secret_like_frontmatter_key", name: key });
    }
  }
  const assignment = content.match(
    /\b(api[_-]?key|provider[_-]?(?:token|secret)|raw[_-]?credential|password|passwd|secret|token|database[_-]?url|dsn)\s*[:=]/i
  );
  if (assignment?.[1]) {
    refs.push({ code: "raw_secret_value_detected", name: assignment[1] });
  } else if (secretLikePattern().test(content)) {
    refs.push({ code: "raw_secret_value_detected", name: "token_like_value" });
  }
  return refs;
}

function parseTags(body: string, frontmatter: Record<string, string | string[]>) {
  const tags: string[] = [];
  for (const key of ["tag", "tags"]) {
    const value = frontmatter[key];
    if (Array.isArray(value)) tags.push(...value);
    if (typeof value === "string") tags.push(...value.split(/[,\s]+/));
  }
  for (const match of body.matchAll(/(^|[\s([{])#([A-Za-z0-9_/-]{2,})\b/g)) {
    tags.push(match[2] ?? "");
  }
  return uniqueSorted(tags.map((tag) => tag.replace(/^#/, "")));
}

function parseHeadings(body: string) {
  const headings: VaultHeading[] = [];
  const usedAnchors = new Map<string, number>();
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;
    const title = (match[2] ?? "").trim();
    const baseAnchor = slugifyHeading(title) || `heading-${index + 1}`;
    const seen = usedAnchors.get(baseAnchor) ?? 0;
    usedAnchors.set(baseAnchor, seen + 1);
    headings.push({
      level: match[1]?.length ?? 1,
      title,
      anchor: seen > 0 ? `${baseAnchor}-${seen + 1}` : baseAnchor,
      line: index + 1
    });
  }
  return headings;
}

function parseBlockAnchors(body: string) {
  return uniqueSorted(
    Array.from(body.matchAll(/\^([A-Za-z0-9-]{3,})\b/g), (match) => match[1] ?? "")
  );
}

function splitTargetAndAnchor(target: string) {
  const [pathPart, anchorPart] = target.split("#");
  return { target: (pathPart ?? target).trim(), anchor: anchorPart?.trim() || null };
}

function addLink(
  links: VaultLink[],
  kind: VaultLinkKind,
  target: string,
  line: number,
  label?: string | null
) {
  const split = splitTargetAndAnchor(target);
  links.push({
    kind:
      kind === "external" || isMediaTarget(split.target)
        ? isMediaTarget(split.target)
          ? "media"
          : kind
        : kind,
    target: split.target,
    label: label ?? null,
    anchor: split.anchor,
    line
  });
}

function parseLinks(body: string) {
  const links: VaultLink[] = [];

  for (const match of body.matchAll(/!\[([^\]]*)]\(([^)]+)\)/g)) {
    addLink(
      links,
      "media",
      match[2] ?? "",
      lineNumberForIndex(body, match.index ?? 0),
      match[1] ?? null
    );
  }
  for (const match of body.matchAll(/(?<!!)\[([^\]]+)]\(([^)]+)\)/g)) {
    const target = match[2] ?? "";
    addLink(
      links,
      target.startsWith("http://") || target.startsWith("https://") ? "external" : "markdown",
      target,
      lineNumberForIndex(body, match.index ?? 0),
      match[1] ?? null
    );
  }
  for (const match of body.matchAll(/!\[\[([^\]]+)]]/g)) {
    addLink(
      links,
      "media",
      match[1]?.split("|")[0] ?? "",
      lineNumberForIndex(body, match.index ?? 0),
      null
    );
  }
  for (const match of body.matchAll(/(?<!!)\[\[([^\]]+)]]/g)) {
    const [target, label] = (match[1] ?? "").split("|");
    addLink(links, "wiki", target ?? "", lineNumberForIndex(body, match.index ?? 0), label ?? null);
  }
  for (const match of body.matchAll(/\bhttps?:\/\/[^\s)>\]]+/g)) {
    addLink(links, "external", match[0] ?? "", lineNumberForIndex(body, match.index ?? 0), null);
  }

  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.kind}:${link.target}:${link.anchor ?? ""}:${link.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectVaultFiles(
  vaultDir: string,
  options: Required<Pick<VaultInventoryOptions, "includePrefixes" | "excludePrefixes">>,
  currentDir = vaultDir
) {
  const files: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    const absolutePath = join(currentDir, entry.name);
    const relativePath = relativeVaultPath(vaultDir, absolutePath);
    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name)) {
        skipped.push({ path: relativePath, reason: "ignored_directory" });
        continue;
      }
      const child = await collectVaultFiles(vaultDir, options, absolutePath);
      files.push(...child.files);
      skipped.push(...child.skipped);
      continue;
    }
    if (
      !isIncluded(relativePath, options.includePrefixes) ||
      isExcluded(relativePath, options.excludePrefixes)
    ) {
      skipped.push({ path: relativePath, reason: "filtered" });
      continue;
    }
    if (!isMarkdownPath(entry.name)) {
      skipped.push({
        path: relativePath,
        reason: isMediaTarget(entry.name) ? "media_reference_only" : "non_markdown"
      });
      continue;
    }
    files.push(absolutePath);
  }
  return { files: files.sort((left, right) => left.localeCompare(right)), skipped };
}

export async function inventoryVault(
  options: VaultInventoryOptions
): Promise<VaultInventoryResult> {
  const vaultDir = resolve(options.vaultDir);
  const vaultStats = await stat(vaultDir);
  if (!vaultStats.isDirectory()) {
    throw new Error("VALIDATION_ERROR: vault inventory requires a directory");
  }

  const includePrefixes = options.includePrefixes ?? [];
  const excludePrefixes = options.excludePrefixes ?? [];
  const maxFileBytes = options.maxFileBytes ?? defaultMaxFileBytes;
  const collected = await collectVaultFiles(vaultDir, { includePrefixes, excludePrefixes });
  const files: VaultFileInventory[] = [];
  const skipped = [...collected.skipped];
  const vaultIdentity = sha256(vaultDir).slice(0, 16);

  for (const absolutePath of collected.files) {
    const relativePath = relativeVaultPath(vaultDir, absolutePath);
    const fileStats = await stat(absolutePath);
    if (fileStats.size > maxFileBytes) {
      skipped.push({ path: relativePath, reason: "markdown_file_too_large" });
      continue;
    }
    const content = await readFile(absolutePath, "utf8");
    const { frontmatter, body } = parseFrontmatter(content);
    const links = parseLinks(body);
    const mediaReferences = links.filter((link) => link.kind === "media");
    const secretReferences = detectSecretReferences(content, frontmatter);
    files.push({
      path: relativePath,
      source_id: `vault:${vaultIdentity}:${sha256(relativePath).slice(0, 16)}`,
      sha256: sha256(content),
      size_bytes: fileStats.size,
      frontmatter,
      frontmatter_keys: Object.keys(frontmatter).sort((left, right) => left.localeCompare(right)),
      tags: parseTags(body, frontmatter),
      headings: parseHeadings(body),
      links,
      media_references: mediaReferences,
      block_anchors: parseBlockAnchors(body),
      risk: secretReferences.length > 0 ? "needs_review" : "low",
      secret_references: secretReferences
    });
  }

  const tags = new Set(files.flatMap((file) => file.tags));
  return {
    action: "vault_inventory",
    dry_run: true,
    writes_memory: false,
    writes_files: false,
    read_only: true,
    vault_dir: vaultDir,
    summary: {
      markdown_files: files.length,
      skipped_files: skipped.length,
      headings: files.reduce((sum, file) => sum + file.headings.length, 0),
      tags: tags.size,
      links: files.reduce((sum, file) => sum + file.links.length, 0),
      media_references: files.reduce((sum, file) => sum + file.media_references.length, 0),
      unsafe_files: files.filter((file) => file.risk !== "low").length
    },
    files,
    skipped: skipped.sort((left, right) => left.path.localeCompare(right.path)),
    warnings: files.some((file) => file.risk !== "low")
      ? ["Secret-like content was detected; only names and codes are reported."]
      : [],
    governance: {
      default_mode: "dry_run",
      persistence: "none",
      media_policy: "references_only",
      secret_policy: "names_and_codes_only",
      obsidian_policy: "compatible_markdown_subset_no_plugin"
    }
  };
}

export function formatVaultInventoryText(result: VaultInventoryResult) {
  const lines = [
    "Recallant vault inventory",
    `Vault: ${result.vault_dir}`,
    "Mode: read-only dry run",
    `Markdown files: ${result.summary.markdown_files}`,
    `Tags: ${result.summary.tags}`,
    `Headings: ${result.summary.headings}`,
    `Links: ${result.summary.links}`,
    `Media references: ${result.summary.media_references}`,
    `Unsafe files: ${result.summary.unsafe_files}`,
    "Planned changes: none"
  ];
  for (const file of result.files) {
    lines.push(
      `- ${file.path} risk=${file.risk} headings=${file.headings.length} tags=${file.tags.length} links=${file.links.length}`
    );
  }
  if (result.warnings.length > 0) {
    lines.push("Warnings:");
    for (const warning of result.warnings) lines.push(`- ${warning}`);
  }
  return `${lines.join("\n")}\n`;
}

function candidateSourceRef(
  file: VaultFileInventory,
  anchor?: string | null
): GraphCandidateSourceRef {
  return {
    source_kind: "external",
    source_id: file.source_id,
    path: file.path,
    anchor: anchor ?? null,
    metadata: {
      extraction_method: "vault_bridge",
      file_sha256: file.sha256,
      source_type: "markdown_vault_note"
    }
  };
}

function noteEndpoint(file: VaultFileInventory): GraphCandidateEndpointRef {
  return {
    kind: "source",
    id: file.source_id,
    label: file.path,
    metadata: {
      source_type: "markdown_vault_note",
      path: file.path
    }
  };
}

function headingEndpoint(
  file: VaultFileInventory,
  heading: VaultHeading
): GraphCandidateEndpointRef {
  return {
    kind: "source",
    id: `${file.source_id}#${heading.anchor}`,
    label: `${file.path}#${heading.anchor}`,
    metadata: {
      source_type: "markdown_vault_heading",
      path: file.path,
      anchor: heading.anchor,
      heading_level: heading.level
    }
  };
}

function tagEndpoint(tag: string): GraphCandidateEndpointRef {
  return {
    kind: "topic",
    id: `vault-tag:${sha256(tag.toLowerCase()).slice(0, 16)}`,
    label: `#${tag}`,
    metadata: {
      tag
    }
  };
}

function normalizeNoteLookupPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "").toLowerCase();
}

function linkEndpoint(
  link: VaultLink,
  filesByNotePath: Map<string, VaultFileInventory>
): GraphCandidateEndpointRef {
  if (link.kind === "external" || link.kind === "media") {
    return {
      kind: "external",
      id: `${link.kind}:${sha256(link.target).slice(0, 24)}`,
      label: link.target,
      metadata: {
        link_kind: link.kind,
        target: link.target,
        anchor: link.anchor ?? null
      }
    };
  }

  const normalized = normalizeNoteLookupPath(decodeURIComponent(link.target));
  const matched = filesByNotePath.get(normalized) ?? filesByNotePath.get(`${normalized}.md`);
  if (matched) return noteEndpoint(matched);
  return {
    kind: "external",
    id: `vault-unresolved:${sha256(link.target).slice(0, 24)}`,
    label: link.target,
    metadata: {
      link_kind: link.kind,
      target: link.target,
      anchor: link.anchor ?? null,
      unresolved: true
    }
  };
}

function proposalId(file: VaultFileInventory, suffix: string) {
  return `vault-proposal:${sha256(`${file.source_id}:${suffix}`).slice(0, 24)}`;
}

function baseCandidate(file: VaultFileInventory, anchor?: string | null) {
  return {
    extraction_method: "vault_bridge" as const,
    created_by: "agent" as const,
    source_refs: [candidateSourceRef(file, anchor)],
    confidence: file.risk === "low" ? 0.74 : 0.45,
    lifecycle_state: file.risk === "low" ? ("candidate" as const) : ("needs_review" as const),
    metadata: {
      vault_bridge: true,
      source_path: file.path,
      source_id: file.source_id,
      risk: file.risk
    }
  };
}

function noteSourceCandidate(file: VaultFileInventory): CreateGraphCandidateInput {
  return {
    ...baseCandidate(file),
    candidate_kind: "node",
    node_kind: "source",
    title: `Vault note: ${file.path}`,
    summary:
      file.risk === "low"
        ? `Source-linked Markdown vault note ${file.path}.`
        : `Source-linked Markdown vault note ${file.path} requires review before use.`
  };
}

function tagCandidate(file: VaultFileInventory, tag: string): CreateGraphCandidateInput {
  return {
    ...baseCandidate(file, `tag:${tag}`),
    candidate_kind: "node",
    node_kind: "topic",
    title: `Vault tag: #${tag}`,
    summary: `Topic candidate derived from vault tag #${tag}.`,
    metadata: {
      ...baseCandidate(file, `tag:${tag}`).metadata,
      tag
    }
  };
}

function headingCandidate(
  file: VaultFileInventory,
  heading: VaultHeading
): CreateGraphCandidateInput {
  return {
    ...baseCandidate(file, heading.anchor),
    candidate_kind: "node",
    node_kind: "source",
    title: `Vault heading: ${file.path}#${heading.anchor}`,
    summary: `Source-linked Markdown heading "${heading.title}" in ${file.path}.`,
    metadata: {
      ...baseCandidate(file, heading.anchor).metadata,
      anchor: heading.anchor,
      heading_level: heading.level
    }
  };
}

function edgeCandidate(
  file: VaultFileInventory,
  relationType: string,
  src: GraphCandidateEndpointRef,
  dst: GraphCandidateEndpointRef,
  suffix: string,
  summary: string
): CreateGraphCandidateInput {
  return {
    ...baseCandidate(file),
    candidate_kind: "edge",
    relation_type: relationType,
    src,
    dst,
    title: `Vault ${relationType}: ${suffix}`,
    summary
  };
}

export function buildVaultCandidatePlan(inventory: VaultInventoryResult): VaultCandidatePlan {
  const proposals: VaultCandidateProposal[] = [];
  const blockedFiles: VaultCandidatePlan["blocked_files"] = [];
  const filesByNotePath = new Map<string, VaultFileInventory>();
  for (const file of inventory.files) {
    filesByNotePath.set(normalizeNoteLookupPath(file.path), file);
  }

  const addProposal = (
    file: VaultFileInventory,
    suffix: string,
    candidate: CreateGraphCandidateInput
  ) => {
    proposals.push({
      proposal_id: proposalId(file, suffix),
      source_path: file.path,
      candidate
    });
  };

  for (const file of inventory.files) {
    addProposal(file, "note-source", noteSourceCandidate(file));
    if (file.risk !== "low") {
      blockedFiles.push({
        path: file.path,
        reason: "secret_like_content",
        codes: file.secret_references.map((ref) => ref.code)
      });
      continue;
    }

    const note = noteEndpoint(file);
    for (const tag of file.tags) {
      addProposal(file, `tag:${tag}`, tagCandidate(file, tag));
      addProposal(
        file,
        `about:${tag}`,
        edgeCandidate(
          file,
          "about",
          note,
          tagEndpoint(tag),
          `${file.path} -> #${tag}`,
          `Vault note ${file.path} is about tag #${tag}.`
        )
      );
    }
    for (const heading of file.headings) {
      addProposal(file, `heading:${heading.anchor}`, headingCandidate(file, heading));
      addProposal(
        file,
        `heading-derived:${heading.anchor}`,
        edgeCandidate(
          file,
          "derived_from",
          headingEndpoint(file, heading),
          note,
          `${file.path}#${heading.anchor} -> ${file.path}`,
          `Vault heading ${heading.title} is derived from note ${file.path}.`
        )
      );
    }
    for (const link of file.links) {
      addProposal(
        file,
        `link:${link.kind}:${link.target}:${link.anchor ?? ""}`,
        edgeCandidate(
          file,
          "mentions",
          note,
          linkEndpoint(link, filesByNotePath),
          `${file.path} -> ${link.target}`,
          `Vault note ${file.path} mentions ${link.target}.`
        )
      );
    }
  }

  return {
    action: "vault_candidates",
    dry_run: true,
    writes_database: false,
    inventory_summary: inventory.summary,
    summary: {
      proposals: proposals.length,
      node_candidates: proposals.filter((proposal) => proposal.candidate.candidate_kind === "node")
        .length,
      edge_candidates: proposals.filter((proposal) => proposal.candidate.candidate_kind === "edge")
        .length,
      needs_review: proposals.filter(
        (proposal) => proposal.candidate.lifecycle_state === "needs_review"
      ).length,
      blocked_files: blockedFiles.length
    },
    proposals,
    blocked_files: blockedFiles,
    governance: {
      default_mode: "dry_run",
      persistence: "requires_write_candidates_and_confirm",
      retrieval: "not_default_retrieval_active",
      extraction_method: "vault_bridge"
    }
  };
}

export function formatVaultCandidateText(plan: VaultCandidatePlan) {
  const lines = [
    "Recallant vault candidate proposal",
    "Mode: dry run",
    `Proposals: ${plan.summary.proposals}`,
    `Node candidates: ${plan.summary.node_candidates}`,
    `Edge candidates: ${plan.summary.edge_candidates}`,
    `Needs review: ${plan.summary.needs_review}`,
    `Blocked files: ${plan.summary.blocked_files}`,
    "Planned database writes: none"
  ];
  for (const proposal of plan.proposals.slice(0, 25)) {
    lines.push(
      `- ${proposal.candidate.candidate_kind} ${proposal.proposal_id} ${proposal.source_path} ${proposal.candidate.lifecycle_state ?? "candidate"}`
    );
  }
  if (plan.proposals.length > 25) lines.push(`- ... ${plan.proposals.length - 25} more`);
  return `${lines.join("\n")}\n`;
}

function markdownEscape(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function vaultSourceLink(filePath: string, anchor?: string | null) {
  const encoded = filePath
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const suffix = anchor ? `#${encodeURIComponent(anchor)}` : "";
  return `[${markdownEscape(filePath)}](../${encoded}${suffix})`;
}

function markdownTable(rows: readonly string[][]) {
  if (rows.length === 0) return "";
  const [header, ...body] = rows;
  return [
    `| ${header?.map(markdownEscape).join(" | ")} |`,
    `| ${header?.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(markdownEscape).join(" | ")} |`)
  ].join("\n");
}

function renderDecisions(inventory: VaultInventoryResult, candidates: VaultCandidatePlan) {
  const decisionFiles = inventory.files.filter((file) =>
    file.tags.some((tag) => /decision|decisions|adr/i.test(tag))
  );
  const rows = decisionFiles.map((file) => [
    vaultSourceLink(file.path),
    file.tags.map((tag) => `#${tag}`).join(", "),
    String(candidates.proposals.filter((proposal) => proposal.source_path === file.path).length)
  ]);
  return [
    "# Recallant Decisions",
    "",
    "Generated from a read-only vault bridge preview.",
    "",
    rows.length
      ? markdownTable([["Source", "Tags", "Candidate proposals"], ...rows])
      : "No decision-tagged vault notes were found in this preview.",
    ""
  ].join("\n");
}

function renderCheckpoints(inventory: VaultInventoryResult, candidates: VaultCandidatePlan) {
  return [
    "# Recallant Checkpoints",
    "",
    "Generated from a read-only vault bridge preview.",
    "",
    "- Markdown files inspected: " + inventory.summary.markdown_files,
    "- Candidate proposals: " + candidates.summary.proposals,
    "- Needs review: " + candidates.summary.needs_review,
    "- Blocked files: " + candidates.summary.blocked_files,
    "- Media policy: references only",
    "- Persistence policy: explicit confirmation required",
    ""
  ].join("\n");
}

function renderOpenQuestions(inventory: VaultInventoryResult, candidates: VaultCandidatePlan) {
  const unresolvedLinks = inventory.files.flatMap((file) =>
    file.links
      .filter((link) => link.kind === "external" || link.kind === "media")
      .map((link) => [
        vaultSourceLink(file.path, link.anchor),
        link.kind,
        link.target,
        "Review whether this should become a governed source edge."
      ])
  );
  const blocked = candidates.blocked_files.map((file) => [
    vaultSourceLink(file.path),
    "needs_review",
    file.codes.join(", "),
    "Review unsafe source before any promotion."
  ]);
  const rows = [...unresolvedLinks, ...blocked];
  return [
    "# Recallant Open Questions",
    "",
    "Generated from a read-only vault bridge preview.",
    "",
    rows.length
      ? markdownTable([["Source", "Kind", "Target or code", "Question"], ...rows])
      : "No open-question items were found in this preview.",
    ""
  ].join("\n");
}

function renderMemoryReview(candidates: VaultCandidatePlan) {
  const rows = candidates.proposals.map((proposal) => [
    proposal.proposal_id,
    proposal.candidate.candidate_kind,
    proposal.candidate.lifecycle_state ?? "candidate",
    vaultSourceLink(proposal.source_path),
    proposal.candidate.title ?? proposal.candidate.summary ?? "Untitled"
  ]);
  return [
    "# Recallant Memory Review",
    "",
    "Generated from vault bridge candidate proposals. These rows are review staging only.",
    "",
    rows.length
      ? markdownTable([["Proposal", "Kind", "State", "Source", "Title"], ...rows])
      : "No candidate proposals were found.",
    ""
  ].join("\n");
}

export function buildVaultMarkdownExportPlan(
  inventory: VaultInventoryResult,
  outputDir?: string
): VaultMarkdownExportPlan {
  const candidates = buildVaultCandidatePlan(inventory);
  const output = outputDir ? resolve(outputDir) : resolve(inventory.vault_dir, "Recallant");
  const files = [
    {
      path: "Decisions.md",
      title: "Recallant Decisions",
      content: renderDecisions(inventory, candidates)
    },
    {
      path: "Checkpoints.md",
      title: "Recallant Checkpoints",
      content: renderCheckpoints(inventory, candidates)
    },
    {
      path: "Open Questions.md",
      title: "Recallant Open Questions",
      content: renderOpenQuestions(inventory, candidates)
    },
    {
      path: "Memory Review.md",
      title: "Recallant Memory Review",
      content: renderMemoryReview(candidates)
    }
  ].map((file) => ({
    ...file,
    size_bytes: Buffer.byteLength(file.content)
  }));
  return {
    action: "vault_export",
    dry_run: true,
    writes_files: false,
    output_dir: output,
    files,
    summary: {
      files: files.length,
      candidate_proposals: candidates.summary.proposals,
      open_questions: inventory.files.reduce(
        (sum, file) =>
          sum +
          file.links.filter((link) => link.kind === "external" || link.kind === "media").length,
        candidates.blocked_files.length
      ),
      review_items: candidates.summary.proposals
    },
    governance: {
      default_mode: "dry_run",
      write_policy: "requires_write_and_confirm",
      artifact_policy: "markdown_only_no_raw_media",
      secret_policy: "no_raw_secret_values"
    }
  };
}

export async function writeVaultMarkdownExport(
  plan: VaultMarkdownExportPlan,
  options: { overwrite?: boolean } = {}
) {
  await mkdir(plan.output_dir, { recursive: true });
  const written: Array<{ path: string; size_bytes: number }> = [];
  for (const file of plan.files) {
    const target = join(plan.output_dir, file.path);
    if (!options.overwrite) {
      try {
        await stat(target);
        throw new Error(
          `VALIDATION_ERROR: export target already exists; pass --overwrite to replace ${file.path}`
        );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("VALIDATION_ERROR:")) throw error;
      }
    }
    await writeFile(target, file.content, "utf8");
    written.push({ path: target, size_bytes: file.size_bytes });
  }
  return written;
}

export function formatVaultMarkdownExportText(plan: VaultMarkdownExportPlan) {
  return (
    [
      "Recallant vault Markdown export",
      "Mode: dry run",
      `Output: ${plan.output_dir}`,
      `Files: ${plan.summary.files}`,
      `Candidate proposals: ${plan.summary.candidate_proposals}`,
      `Open questions: ${plan.summary.open_questions}`,
      "Planned file writes: none",
      ...plan.files.map((file) => `- ${file.path} (${file.size_bytes} bytes)`)
    ].join("\n") + "\n"
  );
}

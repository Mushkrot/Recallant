const pemBeginPrefix = "-----BEGIN ";
const pemBoundarySuffix = "-----";
const privateKeyLabelSuffix = ["PRIVATE", "KEY", "FIXTURE"].join(" ");
const maxPemLabelChars = 64;

type PrivateKeyBlock = {
  start: number;
  end: number;
};

function isPrivateKeyLabel(label: string) {
  if (
    label.length < privateKeyLabelSuffix.length ||
    label.length > maxPemLabelChars ||
    !label.endsWith(privateKeyLabelSuffix)
  ) {
    return false;
  }
  for (const character of label) {
    if (character !== " " && (character < "A" || character > "Z")) return false;
  }
  return true;
}

function findPrivateKeyBlock(value: string, fromIndex: number): PrivateKeyBlock | null {
  let searchIndex = fromIndex;
  while (searchIndex < value.length) {
    const start = value.indexOf(pemBeginPrefix, searchIndex);
    if (start < 0) return null;
    const labelStart = start + pemBeginPrefix.length;
    const labelEnd = value.indexOf(pemBoundarySuffix, labelStart);
    if (labelEnd < 0) return null;
    const label = value.slice(labelStart, labelEnd);
    if (!isPrivateKeyLabel(label)) {
      searchIndex = labelEnd + pemBoundarySuffix.length;
      continue;
    }
    const endMarker = `-----END ${label}-----`;
    const endStart = value.indexOf(endMarker, labelEnd + pemBoundarySuffix.length);
    if (endStart >= 0) return { start, end: endStart + endMarker.length };
    searchIndex = labelEnd + pemBoundarySuffix.length;
  }
  return null;
}

export function containsPrivateKeyBlock(value: string) {
  return findPrivateKeyBlock(value, 0) !== null;
}

export function redactPrivateKeyBlocks(value: string, replacement: string) {
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const block = findPrivateKeyBlock(value, cursor);
    if (!block) break;
    parts.push(value.slice(cursor, block.start), replacement);
    cursor = block.end;
  }
  if (cursor === 0) return value;
  parts.push(value.slice(cursor));
  return parts.join("");
}

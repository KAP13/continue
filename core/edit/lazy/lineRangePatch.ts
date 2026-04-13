/**
 * JSON line-range patches for Apply: avoids LLM full-file output on large files.
 *
 * Line numbers are **1-based within the ORIGINAL CODE** string you are patching
 * (the merge pipeline passes the highlighted range; the chat Apply path passes the open file).
 *
 * Canonical discriminator: `"continue-line-patch": 1` plus `replacements`.
 * Legacy: `"format": "continue-line-patch"` (optional `version`, not required).
 *
 * Example (`replacements` must not overlap):
 * ```json
 * {
 *   "continue-line-patch": 1,
 *   "replacements": [
 *     { "startLine": 10, "endLine": 12, "lines": ["// new", "return x;"] },
 *     { "startLine": 2, "endLine": 2, "oldLines": ["old"], "lines": ["new"] }
 *   ]
 * }
 * ```
 */
import { DiffLine } from "../..";
import { myersDiff } from "../../diff/myers";

/** JSON property name for the v1 marker; same string as legacy \`format\` value. */
export const LINE_PATCH_MARKER_KEY = "continue-line-patch" as const;

/** Legacy "format" field value (same spelling as {@link LINE_PATCH_MARKER_KEY}). */
export const LINE_PATCH_FORMAT = LINE_PATCH_MARKER_KEY;

const LINE_PATCH_MARKER_VALUE_RE = /"continue-line-patch"\s*:\s*1\b/;
const LINE_PATCH_LEGACY_FORMAT_RE = /"format"\s*:\s*"continue-line-patch"/;

/**
 * True when the text plausibly intends to be a continue-line-patch object but may not parse
 * (e.g. trailing commas). Used to avoid treating broken patch JSON as normal source code.
 */
export function looksLikeContinueLinePatchJson(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith("{") &&
    (LINE_PATCH_MARKER_VALUE_RE.test(text) ||
      LINE_PATCH_LEGACY_FORMAT_RE.test(text))
  );
}

/**
 * If the model wrapped JSON in a markdown fence, strip the outer ```…``` wrapper.
 */
export function stripOptionalMarkdownFencedCode(raw: string): string {
  let t = raw.trim();
  if (!t.startsWith("```")) {
    return t;
  }
  const firstNl = t.indexOf("\n");
  if (firstNl === -1) {
    return t
      .replace(/^```\w*/, "")
      .replace(/```\s*$/, "")
      .trim();
  }
  t = t.slice(firstNl + 1);
  const close = t.lastIndexOf("```");
  if (close !== -1) {
    t = t.slice(0, close);
  }
  return t.trim();
}

export interface LineRangeReplacement {
  /** First line to replace (1-based, inclusive). */
  startLine: number;
  /** Last line to replace (1-based, inclusive). */
  endLine: number;
  /** New content; may be empty to delete lines. */
  lines: string[];
  /**
   * If set, must exactly match the replaced slice (including whitespace).
   * Helps the model and runtime catch stale line numbers.
   */
  oldLines?: string[];
}

export interface LineRangePatch {
  format: typeof LINE_PATCH_FORMAT;
  version: 1;
  replacements: LineRangeReplacement[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Accepts JSON numbers or stringified integers (common LLM output). */
function toInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    const t = Math.trunc(v);
    return t === v ? t : undefined;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (/^-?\d+$/.test(s)) {
      return parseInt(s, 10);
    }
  }
  return undefined;
}

function normalizePatchLines(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) {
    return null;
  }
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x === "string") {
      out.push(x);
    } else if (typeof x === "number" && Number.isFinite(x)) {
      out.push(String(x));
    } else if (typeof x === "boolean") {
      out.push(x ? "true" : "false");
    } else if (x === null || x === undefined) {
      out.push("");
    } else {
      return null;
    }
  }
  return out;
}

function normalizeReplacement(v: unknown): LineRangeReplacement | null {
  if (!isRecord(v)) {
    return null;
  }
  const startLine = toInt(v.startLine);
  const endLine = toInt(v.endLine);
  if (startLine === undefined || endLine === undefined) {
    return null;
  }
  const lines = normalizePatchLines(v.lines);
  if (!lines) {
    return null;
  }
  let oldLines: string[] | undefined;
  if (v.oldLines !== undefined) {
    const o = normalizePatchLines(v.oldLines);
    if (!o) {
      return null;
    }
    oldLines = o;
  }
  return { startLine, endLine, lines, oldLines };
}

/**
 * Parse and normalize a continue-line-patch payload, or return null.
 * Models often emit string line indices or non-string "lines" entries; we coerce when safe.
 */
export function tryParseLineRangePatch(text: string): LineRangePatch | null {
  const t = text.trim();
  if (!t.startsWith("{")) {
    return null;
  }
  if (
    !LINE_PATCH_MARKER_VALUE_RE.test(t) &&
    !LINE_PATCH_LEGACY_FORMAT_RE.test(t)
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }

  const markerRaw = parsed[LINE_PATCH_MARKER_KEY];
  const markerInt =
    markerRaw !== undefined ? toInt(markerRaw) : undefined;
  if (markerInt !== undefined && markerInt !== 1) {
    return null;
  }
  const legacyFormatOk = parsed.format === LINE_PATCH_FORMAT;
  if (markerInt !== 1 && !legacyFormatOk) {
    return null;
  }

  if (!Array.isArray(parsed.replacements)) {
    return null;
  }
  const replacements: LineRangeReplacement[] = [];
  for (const item of parsed.replacements) {
    const n = normalizeReplacement(item);
    if (!n) {
      return null;
    }
    replacements.push(n);
  }
  return {
    format: LINE_PATCH_FORMAT,
    version: 1,
    replacements,
  };
}

/**
 * True if `text` is a parseable continue-line-patch (after trim).
 */
export function isLineRangePatchFormat(text: string): boolean {
  return tryParseLineRangePatch(text) !== null;
}

export function parseLineRangePatch(text: string): LineRangePatch {
  const p = tryParseLineRangePatch(text);
  if (!p) {
    throw new Error(
      "Line patch: invalid or incomplete continue-line-patch JSON",
    );
  }
  return p;
}

function validateNonOverlapping(sorted: LineRangeReplacement[]): void {
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (a.endLine >= b.startLine) {
      throw new Error(
        `Line patch: overlapping replacements [${a.startLine}-${a.endLine}] and [${b.startLine}-${b.endLine}]`,
      );
    }
  }
}

/**
 * Applies a v1 line-range patch to full file text and returns Myers diff lines
 * for the vertical diff UI.
 */
export function applyLineRangePatch(
  oldFile: string,
  patchJson: string,
): DiffLine[] {
  const patch = parseLineRangePatch(patchJson);
  const fileLines = oldFile.split(/\r?\n/);
  const n = fileLines.length;

  const sorted = [...patch.replacements].sort(
    (a, b) => a.startLine - b.startLine,
  );
  validateNonOverlapping(sorted);

  for (const r of sorted) {
    if (!Number.isInteger(r.startLine) || !Number.isInteger(r.endLine)) {
      throw new Error("Line patch: startLine and endLine must be integers");
    }
    if (r.startLine < 1 || r.endLine < r.startLine) {
      throw new Error(
        `Line patch: invalid range ${r.startLine}-${r.endLine} (1-based inclusive)`,
      );
    }
    if (r.endLine > n) {
      throw new Error(
        `Line patch: endLine ${r.endLine} exceeds file length ${n} lines`,
      );
    }
    const idx = r.startLine - 1;
    const removeCount = r.endLine - r.startLine + 1;
    const slice = fileLines.slice(idx, idx + removeCount);
    if (r.oldLines !== undefined) {
      if (r.oldLines.length !== slice.length) {
        throw new Error(
          `Line patch: oldLines length ${r.oldLines.length} does not match replaced span ${slice.length}`,
        );
      }
      for (let i = 0; i < slice.length; i++) {
        if (slice[i] !== r.oldLines[i]) {
          throw new Error(
            `Line patch: oldLines mismatch at file line ${r.startLine + i}`,
          );
        }
      }
    }
  }

  const out: string[] = [];
  let lineIdx = 0;
  let repIdx = 0;

  while (lineIdx < n) {
    const r = sorted[repIdx];
    if (r && lineIdx === r.startLine - 1) {
      const removeCount = r.endLine - r.startLine + 1;
      out.push(...r.lines);
      lineIdx += removeCount;
      repIdx++;
      continue;
    }
    out.push(fileLines[lineIdx]!);
    lineIdx++;
  }

  const newContent = out.join("\n");
  return myersDiff(oldFile, newContent);
}

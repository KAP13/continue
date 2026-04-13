import { myersDiff } from "../../diff/myers";
import {
  LINE_PATCH_FORMAT,
  LINE_PATCH_MARKER_KEY,
  applyLineRangePatch,
  isLineRangePatchFormat,
  looksLikeContinueLinePatchJson,
  parseLineRangePatch,
  stripOptionalMarkdownFencedCode,
} from "./lineRangePatch";

describe("isLineRangePatchFormat", () => {
  it("returns false for non-json", () => {
    expect(isLineRangePatchFormat("hello")).toBe(false);
  });

  it("returns false for json without patch discriminator", () => {
    expect(isLineRangePatchFormat('{"foo":1}')).toBe(false);
  });

  it("returns true for minimal valid patch (marker only, no version)", () => {
    const p = JSON.stringify({
      [LINE_PATCH_MARKER_KEY]: 1,
      replacements: [{ startLine: 1, endLine: 1, lines: ["x"] }],
    });
    expect(isLineRangePatchFormat(p)).toBe(true);
  });

  it("returns true for legacy format without version field", () => {
    const p = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      replacements: [{ startLine: 1, endLine: 1, lines: ["y"] }],
    });
    expect(isLineRangePatchFormat(p)).toBe(true);
  });
});

describe("applyLineRangePatch", () => {
  it("replaces a single line", () => {
    const oldFile = "a\nb\nc";
    const patch = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [{ startLine: 2, endLine: 2, lines: ["B"] }],
    });
    const diff = applyLineRangePatch(oldFile, patch);
    const joined = diff
      .map((d) => (d.type === "old" ? "-" : d.type === "new" ? "+" : " ") + d.line)
      .join("\n");
    expect(joined).toContain("-b");
    expect(joined).toContain("+B");
  });

  it("replaces a span with multiple new lines", () => {
    const oldFile = "one\ntwo\nthree";
    const patch = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [{ startLine: 1, endLine: 3, lines: ["1", "3"] }],
    });
    const newText = "1\n3";
    const diff = applyLineRangePatch(oldFile, patch);
    expect(diff.some((d) => d.type === "old")).toBe(true);
    expect(diff.some((d) => d.type === "new")).toBe(true);
    expect(myersDiff(oldFile, newText)).toEqual(diff);
  });

  it("applies two non-overlapping replacements in one patch", () => {
    const oldFile = "a\nb\nc\nd";
    const patch = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [
        { startLine: 1, endLine: 1, lines: ["A"] },
        { startLine: 3, endLine: 3, lines: ["C"] },
      ],
    });
    const diff = applyLineRangePatch(oldFile, patch);
    expect(diff).toEqual(myersDiff(oldFile, "A\nb\nC\nd"));
  });

  it("sorts replacements by startLine when given out of order", () => {
    const oldFile = "a\nb\nc";
    const patch = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [
        { startLine: 3, endLine: 3, lines: ["C"] },
        { startLine: 1, endLine: 1, lines: ["A"] },
      ],
    });
    expect(applyLineRangePatch(oldFile, patch)).toEqual(
      myersDiff(oldFile, "A\nb\nC"),
    );
  });

  it("validates oldLines when provided", () => {
    const oldFile = "keep\nold";
    const patchOk = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [
        {
          startLine: 2,
          endLine: 2,
          oldLines: ["old"],
          lines: ["new"],
        },
      ],
    });
    expect(applyLineRangePatch(oldFile, patchOk)).toBeDefined();

    const patchBad = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [
        {
          startLine: 2,
          endLine: 2,
          oldLines: ["nope"],
          lines: ["new"],
        },
      ],
    });
    expect(() => applyLineRangePatch(oldFile, patchBad)).toThrow(/oldLines mismatch/);
  });

  it("throws on overlapping ranges", () => {
    const oldFile = "a\nb\nc";
    const patch = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [
        { startLine: 1, endLine: 2, lines: ["x"] },
        { startLine: 2, endLine: 3, lines: ["y"] },
      ],
    });
    expect(() => applyLineRangePatch(oldFile, patch)).toThrow(/overlapping/);
  });

  it("throws when endLine past EOF", () => {
    const oldFile = "only";
    const patch = JSON.stringify({
      format: LINE_PATCH_FORMAT,
      version: 1,
      replacements: [{ startLine: 1, endLine: 5, lines: ["x"] }],
    });
    expect(() => applyLineRangePatch(oldFile, patch)).toThrow(/exceeds file length/);
  });
});

describe("looksLikeContinueLinePatchJson", () => {
  it("is true for invalid JSON that still has legacy format field", () => {
    const bad = `{"format":"${LINE_PATCH_FORMAT}","version":1,}`;
    expect(isLineRangePatchFormat(bad)).toBe(false);
    expect(looksLikeContinueLinePatchJson(bad)).toBe(true);
  });

  it("is true for invalid JSON that still has marker", () => {
    const bad = `{"${LINE_PATCH_MARKER_KEY}":1,`;
    expect(isLineRangePatchFormat(bad)).toBe(false);
    expect(looksLikeContinueLinePatchJson(bad)).toBe(true);
  });

  it("is false for unrelated JSON", () => {
    expect(looksLikeContinueLinePatchJson('{"a":1}')).toBe(false);
  });
});

describe("stripOptionalMarkdownFencedCode", () => {
  it("unwraps json fence", () => {
    const inner = `{"${LINE_PATCH_MARKER_KEY}":1,"replacements":[]}`;
    const wrapped = "```json\n" + inner + "\n```";
    expect(stripOptionalMarkdownFencedCode(wrapped)).toBe(inner);
  });
});

describe("parseLineRangePatch", () => {
  it("rejects marker value other than 1", () => {
    const p = JSON.stringify({
      [LINE_PATCH_MARKER_KEY]: 2,
      replacements: [],
    });
    expect(() => parseLineRangePatch(p)).toThrow(/invalid or incomplete/i);
  });
});

describe("tryParseLineRangePatch coercion", () => {
  it("accepts string line indices with marker-only payload", () => {
    const raw = JSON.stringify({
      [LINE_PATCH_MARKER_KEY]: 1,
      replacements: [
        { startLine: "2", endLine: "2", lines: ["b2"] },
      ],
    });
    const patch = applyLineRangePatch("a\nb\nc", raw);
    expect(patch.some((d) => d.type === "new" && d.line === "b2")).toBe(true);
  });
});


import type { DiffLine, ILLM } from "../..";
import { LINE_PATCH_MARKER_KEY } from "./lineRangePatch";
import { applyCodeBlock } from "./applyCodeBlock";

async function collectDiffs(
  gen: AsyncGenerator<DiffLine>,
): Promise<DiffLine[]> {
  const out: DiffLine[] = [];
  for await (const d of gen) {
    out.push(d);
  }
  return out;
}

describe("applyCodeBlock", () => {
  const dummyLlm = {} as unknown as ILLM;

  it("applies continue-line-patch for .ts before tree-sitter full-file rewrite", async () => {
    const oldFile = "export const x = 1;\nexport const y = 2;";
    const patch = JSON.stringify({
      [LINE_PATCH_MARKER_KEY]: 1,
      replacements: [
        { startLine: 2, endLine: 2, lines: ["export const y = 99;"] },
      ],
    });

    const { isInstantApply, diffLinesGenerator } = await applyCodeBlock(
      oldFile,
      patch,
      "src/foo.ts",
      dummyLlm,
      new AbortController(),
    );

    expect(isInstantApply).toBe(true);
    const diffs = await collectDiffs(diffLinesGenerator);
    expect(diffs.some((d) => d.type === "new" && d.line.includes("99"))).toBe(
      true,
    );
    expect(diffs.map((d) => d.line).join("\n")).not.toContain(
      "continue-line-patch",
    );
  });

  it("throws when patch-shaped JSON is invalid", async () => {
    const bad = `{"${LINE_PATCH_MARKER_KEY}":1,`;
    await expect(
      applyCodeBlock("a\nb", bad, "src/foo.ts", dummyLlm, new AbortController()),
    ).rejects.toThrow(/Fix the JSON|invalid or incomplete/i);
  });
});

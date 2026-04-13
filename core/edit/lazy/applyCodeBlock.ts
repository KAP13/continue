import { DiffLine, ILLM } from "../..";
import { generateLines } from "../../diff/util";
import { supportedLanguages } from "../../util/treeSitter";
import { getUriFileExtension } from "../../util/uri";
import { deterministicApplyLazyEdit } from "./deterministic";
import {
  applyLineRangePatch,
  isLineRangePatchFormat,
  looksLikeContinueLinePatchJson,
  stripOptionalMarkdownFencedCode,
} from "./lineRangePatch";
import { streamLazyApply } from "./streamLazyApply";
import { applyUnifiedDiff, isUnifiedDiffFormat } from "./unifiedDiffApply";

function canUseInstantApply(filename: string) {
  const fileExtension = getUriFileExtension(filename);
  return supportedLanguages[fileExtension] !== undefined;
}

export async function applyCodeBlock(
  oldFile: string,
  newLazyFile: string,
  filename: string,
  llm: ILLM,
  abortController: AbortController,
): Promise<{
  isInstantApply: boolean;
  diffLinesGenerator: AsyncGenerator<DiffLine>;
}> {
  const linePatchCandidate = stripOptionalMarkdownFencedCode(newLazyFile);

  // Before tree-sitter "full file rewrite": JSON / diff payloads are not source code.
  if (isLineRangePatchFormat(linePatchCandidate)) {
    try {
      const diffLines = applyLineRangePatch(oldFile, linePatchCandidate);
      return {
        isInstantApply: true,
        diffLinesGenerator: generateLines(diffLines),
      };
    } catch (e) {
      console.error("Failed to apply line-range patch", e);
      const msg =
        e instanceof Error ? e.message : "Failed to apply line-range patch";
      throw new Error(msg);
    }
  }

  if (looksLikeContinueLinePatchJson(linePatchCandidate)) {
    throw new Error(
      "Content looks like continue-line-patch JSON but is invalid or incomplete. Fix the JSON and try Apply again.",
    );
  }

  const unifiedCandidate = stripOptionalMarkdownFencedCode(newLazyFile);
  if (isUnifiedDiffFormat(unifiedCandidate)) {
    try {
      const diffLines = applyUnifiedDiff(oldFile, unifiedCandidate);
      return {
        isInstantApply: true,
        diffLinesGenerator: generateLines(diffLines!),
      };
    } catch (e) {
      console.error("Failed to apply unified diff", e);
    }
  }

  if (canUseInstantApply(filename)) {
    const diffLines = await deterministicApplyLazyEdit({
      oldFile,
      newLazyFile,
      filename,
      onlyFullFileRewrite: true,
    });

    if (diffLines !== undefined) {
      return {
        isInstantApply: true,
        diffLinesGenerator: generateLines(diffLines!),
      };
    }
  }

  return {
    isInstantApply: false,
    diffLinesGenerator: streamLazyApply(
      oldFile,
      filename,
      newLazyFile,
      llm,
      abortController,
    ),
  };
}

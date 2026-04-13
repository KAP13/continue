import {
  ChatMessage,
  DiffLine,
  ILLM,
  Prediction,
  RuleWithSource,
  StreamDiffLinesPayload,
  ToolResultChatMessage,
  UserChatMessage,
} from "../";
import {
  filterCodeBlockLines,
  filterEnglishLinesAtEnd,
  filterEnglishLinesAtStart,
  filterLeadingAndTrailingNewLineInsertion,
  removeTrailingWhitespace,
  skipLines,
  stopAtLines,
} from "../autocomplete/filtering/streamTransforms/lineStream";
import { streamDiff } from "../diff/streamDiff";
import { generateLines, LineStream, streamLines } from "../diff/util";
import {
  applyLineRangePatch,
  isLineRangePatchFormat,
  looksLikeContinueLinePatchJson,
  stripOptionalMarkdownFencedCode,
} from "./lazy/lineRangePatch";
import { getSystemMessageWithRules } from "../llm/rules/getSystemMessageWithRules";
import { gptEditPrompt } from "../llm/templates/edit";
import { defaultApplyPrompt } from "../llm/templates/edit/gpt";
import { findLast } from "../util/findLast";
import { renderChatMessage } from "../util/messageContent";
import { Telemetry } from "../util/posthog";
import { recursiveStream } from "./recursiveStream";

function constructEditPrompt(
  prefix: string,
  highlighted: string,
  suffix: string,
  llm: ILLM,
  userInput: string,
  language: string | undefined,
): string | ChatMessage[] {
  const template = llm.promptTemplates?.edit ?? gptEditPrompt;
  return llm.renderPromptTemplate(template, [], {
    userInput,
    prefix,
    codeToEdit: highlighted,
    suffix,
    language: language ?? "",
  });
}

function constructApplyPrompt(
  originalCode: string,
  newCode: string,
  llm: ILLM,
) {
  const template = llm.promptTemplates?.apply ?? defaultApplyPrompt;
  const rendered = llm.renderPromptTemplate(template, [], {
    original_code: originalCode,
    new_code: newCode,
  });

  return rendered;
}

export async function* addIndentation(
  diffLineGenerator: AsyncGenerator<DiffLine>,
  indentation: string,
): AsyncGenerator<DiffLine> {
  for await (const diffLine of diffLineGenerator) {
    yield {
      ...diffLine,
      line: indentation + diffLine.line,
    };
  }
}

function modelIsInept(model: string): boolean {
  return !(model.includes("gpt") || model.includes("claude"));
}

export async function* streamDiffLines(
  options: StreamDiffLinesPayload,
  llm: ILLM,
  abortController: AbortController,
  overridePrompt: ChatMessage[] | undefined,
  rulesToInclude: RuleWithSource[] | undefined,
): AsyncGenerator<DiffLine> {
  const { type, prefix, highlighted, suffix, input, language } = options;

  void Telemetry.capture(
    "inlineEdit",
    {
      model: llm.model,
      provider: llm.providerName,
    },
    true,
  );

  // Strip common indentation for the LLM, then add back after generation
  let oldLines =
    highlighted.length > 0
      ? highlighted.split("\n")
      : // When highlighted is empty, we need to combine last line of prefix and first line of suffix to determine the line being edited
        [(prefix + suffix).split("\n")[prefix.split("\n").length - 1]];

  // But if that line is empty, we can assume we are insertion-only
  if (oldLines.length === 1 && oldLines[0].trim() === "") {
    oldLines = [];
  }

  // Defaults to creating an edit prompt
  // For apply can be overridden with simply apply prompt
  let prompt =
    overridePrompt ??
    (type === "apply"
      ? constructApplyPrompt(oldLines.join("\n"), options.newCode, llm)
      : constructEditPrompt(prefix, highlighted, suffix, llm, input, language));

  // Rules can be included with edit prompt
  // If any rules are present this will result in using chat instead of legacy completion
  const systemMessage =
    rulesToInclude || llm.baseChatSystemMessage
      ? getSystemMessageWithRules({
          availableRules: rulesToInclude ?? [],
          userMessage:
            typeof prompt === "string"
              ? ({
                  role: "user",
                  content: prompt,
                } as UserChatMessage)
              : (findLast(
                  prompt,
                  (msg) => msg.role === "user" || msg.role === "tool",
                ) as UserChatMessage | ToolResultChatMessage | undefined),
          baseSystemMessage: llm.baseChatSystemMessage,
          contextItems: [],
        }).systemMessage
      : undefined;

  if (systemMessage) {
    if (typeof prompt === "string") {
      prompt = [
        {
          role: "system",
          content: systemMessage,
        },
        {
          role: "user",
          content: prompt,
        },
      ];
    } else {
      const curSysMsg = prompt.find((msg) => msg.role === "system");
      if (curSysMsg) {
        curSysMsg.content = systemMessage + "\n\n" + curSysMsg.content;
      } else {
        prompt.unshift({
          role: "system",
          content: systemMessage,
        });
      }
    }
  }

  const inept = modelIsInept(llm.model);

  const prediction: Prediction = {
    type: "content",
    content: highlighted,
  };

  const completion = recursiveStream(
    llm,
    abortController,
    type,
    prompt,
    prediction,
  );

  async function* applyLineStreamFilters(
    lines: LineStream,
  ): AsyncGenerator<DiffLine> {
    let filtered = filterEnglishLinesAtStart(lines);
    filtered = filterCodeBlockLines(filtered);
    filtered = stopAtLines(filtered, () => {});
    filtered = skipLines(filtered);
    filtered = removeTrailingWhitespace(filtered);
    if (inept) {
      filtered = filterEnglishLinesAtEnd(filtered);
    }
    let diffLines = streamDiff(oldLines, filtered);
    diffLines = filterLeadingAndTrailingNewLineInsertion(diffLines);
    if (highlighted.length === 0) {
      const line = prefix.split("\n").slice(-1)[0];
      const indentation = line.slice(0, line.length - line.trimStart().length);
      diffLines = addIndentation(diffLines, indentation);
    }
    for await (const diffLine of diffLines) {
      yield diffLine;
    }
  }

  async function* linesFromBufferedString(s: string): LineStream {
    const body = stripOptionalMarkdownFencedCode(s);
    for (const line of body.split("\n")) {
      yield line;
    }
  }

  /**
   * Chat Apply and Edit merge both use the same completion shape; continue-line-patch
   * must be handled for `edit` as well, otherwise JSON lines are diffed as replacement code.
   */
  async function* mergeFromBufferedModelOutput(
    raw: string,
  ): AsyncGenerator<DiffLine> {
    const candidate = stripOptionalMarkdownFencedCode(raw);
    if (isLineRangePatchFormat(candidate)) {
      try {
        const patchDiffLines = applyLineRangePatch(highlighted, candidate);
        let patchGen = filterLeadingAndTrailingNewLineInsertion(
          generateLines(patchDiffLines),
        );
        if (highlighted.length === 0) {
          const line = prefix.split("\n").slice(-1)[0];
          const indentation = line.slice(
            0,
            line.length - line.trimStart().length,
          );
          patchGen = addIndentation(patchGen, indentation);
        }
        for await (const diffLine of patchGen) {
          yield diffLine;
        }
        return;
      } catch (e) {
        console.error("Merge: line-range patch failed", e);
        throw e;
      }
    }

    if (looksLikeContinueLinePatchJson(candidate)) {
      throw new Error(
        "Model output looks like continue-line-patch JSON but is invalid or incomplete. Fix the JSON or switch to full-code output.",
      );
    }

    yield* applyLineStreamFilters(linesFromBufferedString(raw));
  }

  let raw = "";
  for await (const chunk of completion) {
    raw += typeof chunk === "string" ? chunk : renderChatMessage(chunk);
  }
  yield* mergeFromBufferedModelOutput(raw);
}

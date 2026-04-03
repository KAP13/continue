import { ToolPolicy } from "@continuedev/terminal-security";
import { Tool } from "../..";
import { ResolvedPath, resolveInputPath } from "../../util/pathResolver";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { evaluateFileAccessPolicy } from "../policies/fileAccess";

export const deleteFileTool: Tool = {
  type: "function",
  displayTitle: "Delete File",
  wouldLikeTo: "delete {{{ filepath }}}",
  isCurrently: "deleting {{{ filepath }}}",
  hasAlready: "deleted {{{ filepath }}}",
  readonly: false,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.DeleteFile,
    description:
      "Permanently delete an existing file from the workspace. Use only when the user explicitly wants the file removed.",
    parameters: {
      type: "object",
      required: ["filepath"],
      properties: {
        filepath: {
          type: "string",
          description:
            "The path of the file to delete. Can be a relative path (from workspace root), absolute path, tilde path (~/...), or file:// URI",
        },
      },
    },
  },
  systemMessageDescription: {
    prefix: `To delete a file with a known filepath, use the ${BuiltInToolNames.DeleteFile} tool. For example, to delete a file located at 'path/to/file.txt', you would respond with this:`,
    exampleArgs: [["filepath", "path/to/the_file.txt"]],
  },
  defaultToolPolicy: "allowedWithPermission",
  toolCallIcon: "TrashIcon",
  preprocessArgs: async (args, { ide }) => {
    const filepath = args.filepath as string;
    const resolvedPath = await resolveInputPath(ide, filepath);

    return {
      resolvedPath,
    };
  },
  evaluateToolCallPolicy: (
    basePolicy: ToolPolicy,
    _: Record<string, unknown>,
    processedArgs?: Record<string, unknown>,
  ): ToolPolicy => {
    const resolvedPath = processedArgs?.resolvedPath as
      | ResolvedPath
      | null
      | undefined;
    if (!resolvedPath) return basePolicy;

    return evaluateFileAccessPolicy(basePolicy, resolvedPath.isWithinWorkspace);
  },
};

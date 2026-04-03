import { resolveInputPath } from "../../util/pathResolver";
import { getUriPathBasename } from "../../util/uri";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { getStringArg } from "../parseArgs";

export const deleteFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, ["filepath", "path", "file_path", "filePath"]);

  const resolvedPath = await resolveInputPath(extras.ide, filepath);
  if (!resolvedPath) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File "${filepath}" does not exist or is not accessible. You might want to check the path and try again.`,
    );
  }

  throwIfFileIsSecurityConcern(resolvedPath.displayPath);

  const exists = await extras.ide.fileExists(resolvedPath.uri);
  if (!exists) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File "${filepath}" does not exist or is not accessible.`,
    );
  }

  await extras.ide.removeFile(resolvedPath.uri);

  if (extras.codeBaseIndexer) {
    void extras.codeBaseIndexer.refreshCodebaseIndexFiles([resolvedPath.uri]);
  }

  return [
    {
      name: getUriPathBasename(resolvedPath.uri),
      description: resolvedPath.displayPath,
      content: "File deleted successfully",
      uri: {
        type: "file",
        value: resolvedPath.uri,
      },
    },
  ];
};

import { resolveRelativePathInDir } from "core/util/ideUtils";
import { v4 as uuid } from "uuid";
import { applyForEditTool } from "../../redux/thunks/handleApplyStateUpdate";
import { ClientToolImpl } from "./callClientTool";

export const editToolImpl: ClientToolImpl = async (
  args,
  toolCallId,
  extras,
) => {
  if (!args.filepath || typeof args.filepath !== "string") {
    throw new Error("`filepath` is required to edit an existing file.");
  }
  if (
    args.changes !== undefined &&
    args.changes !== null &&
    typeof args.changes !== "string"
  ) {
    throw new Error(
      "`changes` must be a string (use an empty string to clear the file).",
    );
  }
  const changesText =
    args.changes === undefined || args.changes === null ? "" : args.changes;

  let filepath = args.filepath;
  if (filepath.startsWith("./")) {
    filepath = filepath.slice(2);
  }

  let firstUriMatch = await resolveRelativePathInDir(
    filepath,
    extras.ideMessenger.ide,
  );

  if (!firstUriMatch) {
    const openFiles = await extras.ideMessenger.ide.getOpenFiles();
    for (const uri of openFiles) {
      if (uri.endsWith(filepath)) {
        firstUriMatch = uri;
        break;
      }
    }
  }

  if (!firstUriMatch) {
    throw new Error(`${filepath} does not exist`);
  }
  const streamId = uuid();
  void extras.dispatch(
    applyForEditTool({
      streamId,
      text: changesText,
      toolCallId,
      filepath: firstUriMatch,
    }),
  );

  return {
    respondImmediately: false,
    output: undefined, // no immediate output - output for edit tools should be added based on apply state coming in
  };
};

import { IDE } from "..";
import { joinPathsToUri } from "../util/uri";

const DEFAULT_TERMINAL_YAML = `# Regexp substitutions for terminal tool commands (applied before execution).
# Example:
# rules:
#   - match: "^ls\\\\s+-la\\\\s*$"
#     replace: "dir"

rules: []
`;

/**
 * Opens the first workspace's `.continue/terminal.yaml`, creating it with a stub
 * if missing.
 */
export async function openWorkspaceTerminalYaml(ide: IDE): Promise<void> {
  const workspaceDirs = await ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    throw new Error(
      "No workspace folder is open. Open a folder to edit .continue/terminal.yaml.",
    );
  }

  const fileUri = joinPathsToUri(
    workspaceDirs[0],
    ".continue",
    "terminal.yaml",
  );

  if (!(await ide.fileExists(fileUri))) {
    await ide.writeFile(fileUri, DEFAULT_TERMINAL_YAML);
  }

  await ide.openFile(fileUri);
}

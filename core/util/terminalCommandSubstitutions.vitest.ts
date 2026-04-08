import { expect, test, vi } from "vitest";

import type { IDE } from "..";
import {
  applyTerminalCommandSubstitutions,
  loadTerminalSubstitutionRules,
  type TerminalSubstitutionRule,
} from "./terminalCommandSubstitutions";

test("applyTerminalCommandSubstitutions replaces by regexp", () => {
  const rules: TerminalSubstitutionRule[] = [
    { match: "^ls\\s+-la\\s*$", replace: "dir" },
  ];
  expect(
    applyTerminalCommandSubstitutions("ls -la", rules),
  ).toBe("dir");
});

test("applyTerminalCommandSubstitutions applies rules in order", () => {
  const rules: TerminalSubstitutionRule[] = [
    { match: "a", replace: "b" },
    { match: "b", replace: "c" },
  ];
  expect(applyTerminalCommandSubstitutions("a", rules)).toBe("c");
});

test("applyTerminalCommandSubstitutions skips invalid regex rules", () => {
  const rules: TerminalSubstitutionRule[] = [
    { match: "(unclosed", replace: "x" },
    { match: "ok", replace: "OK" },
  ];
  expect(applyTerminalCommandSubstitutions("ok", rules)).toBe("OK");
});

test("loadTerminalSubstitutionRules merges workspace files", async () => {
  const ide: Pick<IDE, "getWorkspaceDirs" | "fileExists" | "readFile"> = {
    getWorkspaceDirs: vi.fn().mockResolvedValue(["file:///workspace"]),
    fileExists: vi.fn().mockImplementation((uri: string) =>
      uri.endsWith(".continue/terminal.yaml"),
    ),
    readFile: vi.fn().mockResolvedValue(`rules:
  - match: "^ls$"
    replace: "dir"
`),
  };

  const rules = await loadTerminalSubstitutionRules(ide as IDE);
  expect(rules.length).toBeGreaterThanOrEqual(1);
  expect(applyTerminalCommandSubstitutions("ls", rules)).toBe("dir");
});

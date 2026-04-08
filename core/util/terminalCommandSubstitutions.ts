import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as YAML from "yaml";

import type { IDE } from "..";
import { getContinueGlobalPath } from "./paths";
import { joinPathsToUri } from "./uri";

export interface TerminalSubstitutionRule {
  /** JavaScript RegExp source (not wrapped in slashes). */
  match: string;
  /** Replacement string (supports `$1`, `$&`, etc.). */
  replace: string;
  /** Optional RegExp flags, e.g. `gi`. */
  flags?: string;
}

interface TerminalYamlDoc {
  rules?: unknown[];
}

function parseTerminalYaml(content: string): TerminalSubstitutionRule[] {
  let doc: unknown;
  try {
    doc = YAML.parse(content);
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object") {
    return [];
  }
  const rules = (doc as TerminalYamlDoc).rules;
  if (!Array.isArray(rules)) {
    return [];
  }
  const out: TerminalSubstitutionRule[] = [];
  for (const r of rules) {
    if (!r || typeof r !== "object") {
      continue;
    }
    const row = r as Record<string, unknown>;
    if (typeof row.match !== "string" || typeof row.replace !== "string") {
      continue;
    }
    if (row.match === "") {
      continue;
    }
    out.push({
      match: row.match,
      replace: row.replace,
      flags: typeof row.flags === "string" ? row.flags : undefined,
    });
  }
  return out;
}

export function applyTerminalCommandSubstitutions(
  command: string,
  rules: TerminalSubstitutionRule[],
): string {
  let result = command;
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.match, rule.flags ?? "");
      result = result.replace(re, rule.replace);
    } catch {
      // Invalid regexp — skip rule
    }
  }
  return result;
}

/**
 * Loads substitution rules from ~/.continue/terminal.yaml, then from each
 * workspace folder's .continue/terminal.yaml (in workspace order).
 */
export async function loadTerminalSubstitutionRules(
  ide: IDE,
): Promise<TerminalSubstitutionRule[]> {
  const rules: TerminalSubstitutionRule[] = [];

  const globalPath = path.join(getContinueGlobalPath(), "terminal.yaml");
  try {
    const content = await fs.readFile(globalPath, "utf8");
    rules.push(...parseTerminalYaml(content));
  } catch {
    // Missing or unreadable global file
  }

  try {
    const workspaceDirs = await ide.getWorkspaceDirs();
    for (const folder of workspaceDirs) {
      const fileUri = joinPathsToUri(folder, ".continue", "terminal.yaml");
      try {
        if (await ide.fileExists(fileUri)) {
          const content = await ide.readFile(fileUri);
          rules.push(...parseTerminalYaml(content));
        }
      } catch {
        // Next workspace root
      }
    }
  } catch {
    // No workspace dirs
  }

  return rules;
}

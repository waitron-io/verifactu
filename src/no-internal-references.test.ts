import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("the public repo carries no internal or AI-workflow references", () => {
  it("finds none of the forbidden markers in tracked files", () => {
    // Case-insensitive; scans tracked files only. `git grep` returns exit 1 (no matches) on success.
    const pattern = "claude|codex|superpower|CLAUDE\\.md|docs/(superpowers|compliance|handoffs)";
    let hits: string;
    try {
      hits = execSync(
        `git grep -In -iE '${pattern}' -- . ':(exclude)src/no-internal-references.test.ts'`,
        {
          encoding: "utf8",
        },
      );
    } catch (e: unknown) {
      // git grep exits 1 with empty stdout when there are no matches — that is success.
      const err = e as { status?: number; stdout?: string };
      if (err.status === 1 && !err.stdout) return;
      throw e;
    }
    expect(hits, `internal references found:\n${hits}`).toBe("");
  });
});

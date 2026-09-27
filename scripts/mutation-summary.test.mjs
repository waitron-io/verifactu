import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("mutation summary reports score, thresholds, and survivors without mutant details", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mutation-summary-"));
  const report = join(dir, "mutation.json");
  const summary = join(dir, "summary.md");
  await writeFile(
    report,
    JSON.stringify({
      files: {
        "src/one.ts": {
          mutants: [
            { status: "Killed", description: "a" },
            { status: "Survived", description: "large mutant detail" },
            { status: "NoCoverage", description: "b" },
          ],
        },
        "src/two.ts": { mutants: [{ status: "Timeout", description: "c" }] },
      },
    }),
  );
  const result = spawnSync(process.execPath, ["scripts/mutation-summary.mjs", report, summary], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const markdown = await readFile(summary, "utf8");
  assert.match(markdown, /Mutation score.*50\.00%/);
  assert.match(markdown, /break 90%/);
  assert.match(markdown, /src\/one\.ts.*1/);
  assert.match(markdown, /src\/two\.ts.*0/);
  assert.doesNotMatch(markdown, /large mutant detail/);
  assert.ok(Buffer.byteLength(markdown) < 1024 * 1024);
  assert.match(result.stdout, /summary bytes:/);
});

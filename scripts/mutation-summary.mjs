import { appendFile, readFile } from "node:fs/promises";

const [reportPath, summaryPath] = process.argv.slice(2);
if (!reportPath || !summaryPath) {
  throw new Error("Usage: node scripts/mutation-summary.mjs <report.json> <summary.md>");
}

const report = JSON.parse(await readFile(reportPath, "utf8"));
const { thresholds } = JSON.parse(
  await readFile(new URL("../stryker.config.json", import.meta.url), "utf8"),
);
const rows = [];
const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
for (const [file, result] of Object.entries(report.files)) {
  const fileCounts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0 };
  for (const { status } of result.mutants) {
    if (status in counts) {
      counts[status]++;
      fileCounts[status]++;
    }
  }
  rows.push(
    `| ${file.replaceAll("|", "\\|")} | ${fileCounts.Survived} | ${fileCounts.NoCoverage} |`,
  );
}
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
const score = total ? (100 * (counts.Killed + counts.Timeout)) / total : 100;
const markdown = [
  "## Mutation testing",
  "",
  `Mutation score: **${score.toFixed(2)}%** (${counts.Killed} killed, ${counts.Timeout} timed out, ${counts.Survived} survived, ${counts.NoCoverage} uncovered).`,
  `Thresholds: high ${thresholds.high}%, low ${thresholds.low}%, break ${thresholds.break}%.`,
  "",
  "| File | Survived | No coverage |",
  "| --- | ---: | ---: |",
  ...rows,
  "",
  "The full mutation report (HTML and JSON) is attached to this workflow run as `mutation-report`.",
  "",
].join("\n");
const bytes = Buffer.byteLength(markdown);
if (bytes >= 1024 * 1024)
  throw new Error(`Mutation summary exceeds GitHub's 1 MiB limit: ${bytes} bytes`);
await appendFile(summaryPath, markdown);
console.log(`Mutation summary bytes: ${bytes}`);

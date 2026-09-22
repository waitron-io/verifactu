import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const website = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(website, ".verify-docs-"));
const files = [];

function blocks(locale, page) {
  const path = join(website, "src/content/docs", locale, "guides", `${page}.md`);
  const markdown = readFileSync(path, "utf8");
  return [...markdown.matchAll(/^\`\`\`ts\n([\s\S]*?)^\`\`\`/gm)].map((match) =>
    match[1]
      .replaceAll('from "@waitron/verifactu/testing"', 'from "../../dist/testing/fake-aeat.js"')
      .replaceAll('from "@waitron/verifactu"', 'from "../../dist/index.js"'),
  );
}

function save(name, source) {
  const path = join(work, `${name}.ts`);
  writeFileSync(path, source);
  files.push(path);
}

function expectedLogs(source) {
  const lines = [...source.matchAll(/^console\.log\(.*\);\s*\/\/\s*(.+)$/gm)].map(
    (match) => match[1],
  );
  assert.ok(lines.length > 0, "documented output comments are required");
  return JSON.stringify(lines);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: website, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
}

try {
  for (const locale of ["en", "es"]) {
    const submit = blocks(locale, "submit");
    const qr = blocks(locale, "qr");
    const testing = blocks(locale, "testing");
    assert.equal(submit.length, 8, `${locale} submit guide must have eight TypeScript blocks`);
    assert.equal(qr.length, 3, `${locale} QR guide must have three TypeScript blocks`);
    assert.equal(testing.length, 1, `${locale} testing guide must have one TypeScript block`);

    const setup = `${submit[0]}\n${submit[1]}`;
    save(
      `${locale}-submit`,
      `import assert from "node:assert/strict";
import { createFakeAeat } from "../../dist/testing/fake-aeat.js";
${setup}
${submit[2]}
const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const client = aeat.client();
const savedCsv: string[] = [];
const savedLines: unknown[][] = [];
const waits: number[] = [];
async function storeCsvDurably(csv: string) { savedCsv.push(csv); }
async function storeLineResult(...line: unknown[]) { savedLines.push(line); }
async function scheduleNextSubmissionAfter(ms: number) { waits.push(ms); }
${submit[4]}
assert.equal(response.EstadoEnvio, "Correcto");
assert.equal(savedCsv[0], response.CSV);
assert.equal(savedLines.length, 2);
assert.equal(waits[0], response.TiempoEsperaEnvio * 1000);
${submit[5]}
assert.equal(stored?.DatosRegistroFacturacion.Huella, first.Huella);
${submit[6]}
assert.equal(cancellationResponse.RespuestaLinea[0]?.EstadoRegistro, "Correcto");
assert.equal(aeat.stored().find((item) => item.key.includes("T01/000123"))?.estado, "Anulada");
`,
    );
    save(`${locale}-certificate`, `${setup}\n${submit[3]}`);
    save(
      `${locale}-offline`,
      `import assert from "node:assert/strict";
${setup}
const outputs: string[] = [];
const console = { log: (...items: unknown[]) => outputs.push(items.map(String).join(" ")) };
${submit[7]}
assert.deepEqual(outputs, ${expectedLogs(submit[7])});
`,
    );
    save(
      `${locale}-qr`,
      `import assert from "node:assert/strict";
${setup}
const record = first;
${qr.join("\n")}
assert.ok(svg.includes("<svg"));
`,
    );
    save(
      `${locale}-testing`,
      `import assert from "node:assert/strict";
${setup}
const record = first;
const outputs: string[] = [];
const console = { log: (...items: unknown[]) => outputs.push(items.map(String).join(" ")) };
${testing[0]}
assert.deepEqual(outputs, ${expectedLogs(testing[0])});
`,
    );
  }

  run(process.execPath, [
    join(website, "../node_modules/typescript-7/bin/tsc"),
    "--ignoreConfig",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target",
    "es2022",
    "--module",
    "esnext",
    "--moduleResolution",
    "bundler",
    "--types",
    "node",
    ...files,
  ]);

  for (const file of files.filter((path) => !path.endsWith("-certificate.ts"))) {
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const executable = file.replace(/\.ts$/, ".mjs");
    writeFileSync(executable, output);
    run(process.execPath, [executable]);
  }
  console.log("English and Spanish published submission, QR, and testing snippets pass");
} finally {
  rmSync(work, { recursive: true, force: true });
}

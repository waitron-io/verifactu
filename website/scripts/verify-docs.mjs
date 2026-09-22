import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const website = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(website, ".verify-docs-"));
const files = [];

function blocks(locale, page, section = "guides", extension = "md") {
  const path = join(website, "src/content/docs", locale, section, `${page}.${extension}`);
  const markdown = readFileSync(path, "utf8");
  return [...markdown.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map((match) =>
    match[1]
      .replaceAll('from "@waitron/verifactu/testing"', 'from "../../dist/testing/fake-aeat.js"')
      .replaceAll('from "@waitron/verifactu/facade"', 'from "../../dist/facade.js"')
      .replaceAll('from "@waitron/verifactu"', 'from "../../dist/index.js"'),
  );
}

function snippetPages(locale) {
  const root = join(website, "src/content/docs", locale);
  const pages = [];
  function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (/\.mdx?$/.test(entry.name) && /^```ts$/m.test(readFileSync(path, "utf8"))) {
        pages.push(relative(root, path));
      }
    }
  }
  visit(root);
  return pages.sort();
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
  const readme = [
    ...readFileSync(join(website, "..", "README.md"), "utf8").matchAll(/^```ts\n([\s\S]*?)^```/gm),
  ].map((match) => match[1].replaceAll('from "@waitron/verifactu"', 'from "../../dist/index.js"'));
  assert.equal(readme.length, 3, "README must keep its three TypeScript examples");
  save(
    "readme",
    `import assert from "node:assert/strict";
${readme[0]}
${readme[1]}
assert.deepEqual(issues.filter((issue) => issue.severity === "error"), []);
assert.deepEqual(validate(rectificativa).filter((issue) => issue.severity === "error"), []);
`,
  );

  for (const locale of ["en", "es"]) {
    assert.deepEqual(snippetPages(locale), [
      "guides/alta-record.md",
      "guides/consulta.md",
      "guides/facade.md",
      "guides/huella-chain.md",
      "guides/qr.md",
      "guides/submit.md",
      "guides/testing.md",
      "guides/validation.md",
      "index.mdx",
      "start/getting-started.md",
    ]);
    const home = blocks(locale, "index", "", "mdx");
    const submit = blocks(locale, "submit");
    const qr = blocks(locale, "qr");
    const facade = blocks(locale, "facade");
    const testing = blocks(locale, "testing");
    const gettingStarted = blocks(locale, "getting-started", "start");
    const alta = blocks(locale, "alta-record");
    const chain = blocks(locale, "huella-chain");
    const validation = blocks(locale, "validation");
    const consulta = blocks(locale, "consulta");
    assert.equal(submit.length, 8, `${locale} submit guide must have eight TypeScript blocks`);
    assert.equal(qr.length, 3, `${locale} QR guide must have three TypeScript blocks`);
    assert.equal(testing.length, 1, `${locale} testing guide must have one TypeScript block`);
    assert.equal(home.length, 1, `${locale} homepage must have one TypeScript block`);
    for (const [page, snippets] of [
      ["getting-started", gettingStarted],
      ["alta-record", alta],
      ["huella-chain", chain],
      ["validation", validation],
      ["consulta", consulta],
      ["facade", facade],
    ]) {
      assert.equal(snippets.length, 1, `${locale} ${page} must have one TypeScript block`);
    }

    const setup = `${submit[0]}\n${submit[1]}`;
    save(
      `${locale}-homepage`,
      `import assert from "node:assert/strict";
${home[0]}
assert.deepEqual(validate(record), []);
assert.match(record.Huella, /^[0-9A-F]{64}$/);
`,
    );
    const saleSetup = `${submit[0]}\n${submit[1].split("\nconst first =")[0]}`;
    save(
      `${locale}-facade`,
      `import assert from "node:assert/strict";
import { createFakeAeat } from "../../dist/testing/fake-aeat.js";
${saleSetup}
const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const certificateFetch = fake.fetch;
${facade[0]}
assert.equal(response.RespuestaLinea.length, 2);
assert.equal(second.Encadenamiento.RegistroAnterior?.Huella, first.Huella);
`,
    );
    const starterOutputs = [
      ...gettingStarted[0].matchAll(/^console\.log\(.*\);\s*\/\/\s*(.+)$/gm),
    ].map((match) => match[1]);
    assert.equal(starterOutputs.length, 4, `${locale} getting-started output comments`);
    const recordFixture = gettingStarted[0].split("\nconsole.log(")[0].replace(", validate,", ",");
    save(
      `${locale}-getting-started`,
      `import assert from "node:assert/strict";
const outputs: unknown[][] = [];
const console = { log: (...items: unknown[]) => outputs.push(items) };
${gettingStarted[0]}
assert.equal(outputs[0]?.[0], ${JSON.stringify(starterOutputs[0])});
assert.equal(outputs[1]?.[0], ${JSON.stringify(starterOutputs[1])});
assert.match(String(outputs[2]?.[0]), /^[0-9A-F]{64}$/);
assert.deepEqual(outputs[3]?.[0], []);
`,
    );
    save(
      `${locale}-alta-record`,
      `import assert from "node:assert/strict";
${setup}
const saleInput = { ...sale, NumSerieFactura: "T01/000125", Encadenamiento: { PrimerRegistro: "S" as const } };
${alta[0]}
assert.equal(fullInvoice.TipoFactura, "F1");
assert.deepEqual(validate(fullInvoice).filter((issue) => issue.severity === "error"), []);
`,
    );
    save(
      `${locale}-huella-chain`,
      `import assert from "node:assert/strict";
${saleSetup}
const saleInput = sale;
const nextSaleInput = sale;
${chain[0]}
assert.deepEqual(validate(first), []);
assert.deepEqual(validate(second), []);
assert.equal(second.Encadenamiento.RegistroAnterior?.Huella, first.Huella);
`,
    );
    save(
      `${locale}-validation`,
      `import assert from "node:assert/strict";
${recordFixture}
const outputs: unknown[][] = [];
const console = { log: (...items: unknown[]) => outputs.push(items) };
${validation[0]}
assert.deepEqual(issues, []);
assert.deepEqual(outputs, []);
`,
    );
    save(
      `${locale}-consulta`,
      `import assert from "node:assert/strict";
import { createFakeAeat } from "../../dist/testing/fake-aeat.js";
${setup}
const record = first;
const fake = createFakeAeat();
const client = fake.client();
await client.submit(cabecera, [{ RegistroAlta: record }]);
const outputs: unknown[][] = [];
const console = { log: (...items: unknown[]) => outputs.push(items) };
${consulta[0]}
assert.equal(result.registros.length, 1);
assert.equal(result.registros[0]?.DatosRegistroFacturacion.Huella, record.Huella);
assert.equal(outputs[0]?.[1], "Correcta");
assert.equal(outputs[1]?.[0], record.Huella);
assert.equal(outputs[2]?.[0], record.NombreRazonEmisor);
assert.equal(outputs[3]?.[0], true);
`,
    );
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
  console.log("All English and Spanish published TypeScript snippets pass");
} finally {
  rmSync(work, { recursive: true, force: true });
}

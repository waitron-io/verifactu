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
  return tsBlocks(readFileSync(path, "utf8"));
}

function tsBlocks(markdown) {
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
  return pages.filter((page) => !page.startsWith("simple/")).sort();
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

// The draft docs under simple/ are checked generically: each page's TypeScript blocks run
// together against the offline AEAT, every `console.log(...); // output` comment must match
// what the line prints (text after " (" is explanation), and names the page does not define
// (or only `declare`s, for functions the reader writes) come from the fixtures below.
const SIMPLE_PAGES = [
  "getting-started.md",
  "guides/chain.md",
  "guides/checking.md",
  "guides/lookup.md",
  "guides/qr.md",
  "guides/records.md",
  "guides/replies.md",
  "guides/sending.md",
  "guides/tax.md",
  "guides/testing.md",
  "guides/tools.md",
];

const SIMPLE_EXTRAS = {
  "getting-started.md": {
    after: `__assert.equal(__savedRecords[0], record);
__assert.equal(__savedReplies[0], reply);
__assert.equal(new URL(qrUrl).searchParams.get("importe"), "12.10");
const __testReply = await testClient.submit({ ObligadoEmision: seller }, [{ RegistroAlta: record }]);
__assert.equal(__testReply.RespuestaLinea[0]?.EstadoRegistro, "Correcto");`,
  },
  "guides/lookup.md": { before: "await client.submit(cabecera, [{ RegistroAlta: record }]);" },
  "guides/sending.md": {
    after: `__assert.equal(typeof createCertificateFetch(Buffer.from("test-only"), "test-only"), "function");`,
  },
};

const SIMPLE_FIXTURES = [
  ["software", "__software"],
  ["seller", "__seller"],
  ["cabecera", "__cabecera"],
  ["sale", "__sale"],
  ["record", "__record"],
  ["aeat", "__aeat"],
  ["client", "__client"],
  ["certificateFetch", "__aeat.fetch"],
  ["loadPreviousRecord", "__loadPreviousRecord"],
  ["saveRecord", "__saveRecord"],
  ["saveReply", "__saveReply"],
];

const SIMPLE_PRELUDE = `import __assert from "node:assert/strict";
import * as __vf from "../../dist/index.js";
import * as __testing from "../../dist/testing/fake-aeat.js";
const __software: __vf.SistemaInformatico = {
  NombreRazon: "Example SL",
  NIF: "89890001K",
  NombreSistemaInformatico: "Example POS",
  IdSistemaInformatico: "01",
  Version: "1.0",
  NumeroInstalacion: "001",
  TipoUsoPosibleSoloVerifactu: "S",
  TipoUsoPosibleMultiOT: "N",
  IndicadorMultiplesOT: "N",
};
const __seller = { NombreRazon: "Example SL", NIF: "89890001K" };
const __cabecera: __vf.Cabecera = { ObligadoEmision: __seller };
const __issuedAt = new Date("2026-07-20T12:00:00Z");
const __sale = {
  IDEmisorFactura: __seller.NIF,
  NombreRazonEmisor: __seller.NombreRazon,
  FechaExpedicionFactura: __issuedAt,
  TipoFactura: "F2" as const,
  DescripcionOperacion: "Coffee and lunch",
  Desglose: [{ ClaveRegimen: "01", CalificacionOperacion: "S1", TipoImpositivo: "21", BaseImponibleOimporteNoSujeto: "10.00", CuotaRepercutida: "2.10" }],
  CuotaTotal: "2.10",
  ImporteTotal: "12.10",
  SistemaInformatico: __software,
  generadoEn: __issuedAt,
  offsetMinutes: 120,
};
const __record = __vf.buildAltaRecord({ ...__sale, NumSerieFactura: "T01/000123", Encadenamiento: { PrimerRegistro: "S" } });
const __aeat = __testing.createFakeAeat({ serverNow: new Date() });
const __client = __aeat.client();
const __savedRecords: unknown[] = [];
const __savedReplies: unknown[] = [];
async function __loadPreviousRecord(): Promise<__vf.RegistroAnterior | null> { return null; }
async function __saveRecord(record: unknown) { __savedRecords.push(record); }
async function __saveReply(reply: unknown) { __savedReplies.push(reply); }
const __outputs: string[] = [];
const console = {
  log: (...items: unknown[]) => { __outputs.push(items.map(String).join(" ")); },
  warn: (..._items: unknown[]) => {},
};
`;

const IMPORT_STATEMENT = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+"([^"]+)";[ \t]*\n?/gm;

// Blocks on one page repeat imports of the same module; TypeScript rejects a name imported twice,
// so the imports are hoisted and merged per module.
function mergeImports(sources) {
  const modules = new Map();
  const entry = (from) => {
    if (!modules.has(from))
      modules.set(from, { defaults: new Set(), stars: new Set(), named: new Set() });
    return modules.get(from);
  };
  const bodies = sources.map((source) =>
    source.replace(IMPORT_STATEMENT, (_, typeOnly, clause, from) => {
      const target = entry(from);
      let rest = clause.trim();
      if (rest.startsWith("* as ")) {
        target.stars.add(rest.slice(5).trim());
        return "";
      }
      const brace = rest.indexOf("{");
      const head = (brace === -1 ? rest : rest.slice(0, brace)).replace(/,\s*$/, "").trim();
      if (head) target.defaults.add(head);
      if (brace !== -1) {
        for (const name of rest.slice(brace + 1, rest.lastIndexOf("}")).split(",")) {
          const trimmed = name.trim();
          if (trimmed)
            target.named.add(
              typeOnly && !trimmed.startsWith("type ") ? `type ${trimmed}` : trimmed,
            );
        }
      }
      return "";
    }),
  );
  const imports = [];
  for (const [from, { defaults, stars, named }] of modules) {
    for (const name of defaults) imports.push(`import ${name} from "${from}";`);
    for (const name of stars) imports.push(`import * as ${name} from "${from}";`);
    if (named.size) imports.push(`import { ${[...named].join(", ")} } from "${from}";`);
  }
  return { imports: imports.join("\n"), bodies };
}

function checkSimplePages() {
  const root = join(website, "src/content/docs/en/simple");
  const pages = [];
  (function visit(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.mdx?$/.test(entry.name) && /^```ts$/m.test(readFileSync(path, "utf8"))) {
        pages.push(relative(root, path));
      }
    }
  })(root);
  assert.deepEqual(pages.sort(), SIMPLE_PAGES, "simple/ pages with TypeScript examples");

  for (const page of SIMPLE_PAGES) {
    const { imports, bodies } = mergeImports(tsBlocks(readFileSync(join(root, page), "utf8")));
    let code = bodies.join("\n");
    if (page === "getting-started.md") {
      // The fake's clock is created before this example runs; crossing a second boundary
      // can make a real-time generated record look future-dated to that fixed clock.
      assert.ok(code.includes("const issuedAt = new Date();"));
      code = code.replace("const issuedAt = new Date();", "const issuedAt = __issuedAt;");
    }
    const fixtures = SIMPLE_FIXTURES.flatMap(([name, value]) => {
      if (new RegExp(`\\bdeclare\\s+(?:const|function)\\s+${name}\\b`).test(code)) {
        return [`(globalThis as any).${name} = ${value};`];
      }
      if (new RegExp(`\\b(?:const|let|function|class)\\s+${name}\\b`).test(code)) return [];
      return [`const ${name} = ${value};`];
    });
    const expected = [...code.matchAll(/^\s*console\.log\(.*\);\s*\/\/\s*(.+)$/gm)].map((match) =>
      match[1].replace(/\s+\(.*\)$/, "").trim(),
    );
    const extras = SIMPLE_EXTRAS[page] ?? {};
    save(
      `en-simple-${page.replace(/[/.]/g, "-")}`,
      `${imports}
${SIMPLE_PRELUDE}
${fixtures.join("\n")}
${extras.before ?? ""}
${code}
__assert.deepEqual(__outputs, ${JSON.stringify(expected)}, ${JSON.stringify(`simple/${page} printed output`)});
${extras.after ?? ""}
`,
    );
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
assert.doesNotThrow(() => assertValid(record));
assert.doesNotThrow(() => assertValid(rectificativa));
`,
  );

  checkSimplePages();

  for (const locale of ["en", "es"]) {
    assert.deepEqual(snippetPages(locale), [
      "guides/alta-record.md",
      "guides/consulta.md",
      "guides/durable-delivery.md",
      "guides/facade.md",
      "guides/huella-chain.md",
      "guides/qr.md",
      "guides/submit.md",
      "guides/testing.md",
      "guides/validation.md",
      "start/getting-started.md",
    ]);
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
    assert.equal(gettingStarted.length, 2, `${locale} getting-started must build and file`);
    for (const [page, snippets] of [
      ["alta-record", alta],
      ["huella-chain", chain],
      ["validation", validation],
      ["consulta", consulta],
      ["facade", facade],
    ]) {
      assert.equal(snippets.length, 1, `${locale} ${page} must have one TypeScript block`);
    }

    const setup = `${submit[0]}\n${submit[1]}`;
    const saleSetup = `${submit[0]}\n${submit[1].split("\nconst first =")[0]}`;
    const facadeSetup = `${submit[0].slice(submit[0].indexOf("const sistema:"))}\n${submit[1].split("\nconst first =")[0]}`;
    save(
      `${locale}-facade`,
      `import assert from "node:assert/strict";
import { createFakeAeat } from "../../dist/testing/fake-aeat.js";
${facade[0]}
${facadeSetup}
const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
const saved: RegistroAlta[] = [];
const responses: RespuestaSuministro[] = [];
const waits: number[] = [];
const store: InvoiceStore = {
  reserveAndLoad: async () => ({ serial: "T01/000123", previous: null }),
  saveRecord: async (record) => { saved.push(record); },
  saveResponse: async (response) => { responses.push(response); },
  scheduleNext: async (ms) => { waits.push(ms); },
};
const filed = await fileSale(store, sale, cabecera, fake.fetch);
assert.equal(saved[0], filed.record);
assert.equal(responses[0]?.CSV, "CSV-00000001");
assert.equal(filed.response.RespuestaLinea.length, 1);
assert.equal(waits[0], filed.response.TiempoEsperaEnvio! * 1000);
assert.equal(filed.found.ResultadoConsulta, "ConDatos");
assert.equal(filed.found.registros[0]?.DatosRegistroFacturacion.Huella, filed.record.Huella);
assert.equal(new URL(filed.qrUrl).searchParams.get("importe"), "12.10");
`,
    );
    const starterOutputs = [
      ...gettingStarted[0].matchAll(/^console\.log\(.*\);\s*\/\/\s*(.+)$/gm),
    ].map((match) => match[1]);
    assert.equal(starterOutputs.length, 4, `${locale} getting-started output comments`);
    assert.equal(
      expectedLogs(gettingStarted[1]),
      JSON.stringify(["CSV-00000001", "Correcto", "ConDatos", "12.10"]),
      `${locale} getting-started response comments`,
    );
    const recordFixture = gettingStarted[0].split("\nconsole.log(")[0].replace(", validate,", ",");
    save(
      `${locale}-getting-started`,
      `import assert from "node:assert/strict";
const outputs: unknown[][] = [];
const console = { log: (...items: unknown[]) => outputs.push(items) };
${gettingStarted[0]}
${gettingStarted[1]}
assert.equal(outputs[0]?.[0], ${JSON.stringify(starterOutputs[0])});
assert.equal(outputs[1]?.[0], ${JSON.stringify(starterOutputs[1])});
assert.match(String(outputs[2]?.[0]), /^[0-9A-F]{64}$/);
assert.deepEqual(outputs[3]?.[0], []);
assert.deepEqual(outputs.slice(4).map((items) => items[0]), ["CSV-00000001", "Correcto", "ConDatos", "12.10"]);
assert.equal(found.registros[0]?.DatosRegistroFacturacion.Huella, record.Huella);
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
assert.doesNotThrow(() => assertValid(record));
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
assert.equal(outputs[0]?.[1], "Correcto");
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
assert.equal(aeat.stored().find((item) => item.key.includes("T01/000123"))?.estado, "Anulado");
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

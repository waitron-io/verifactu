import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const website = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(website, ".verify-docs-"));
const files = [];

function tsBlocks(markdown) {
  return [...markdown.matchAll(/^```ts\n([\s\S]*?)^```/gm)].map((match) =>
    match[1]
      .replaceAll('from "@waitron/verifactu/testing"', 'from "../../dist/testing/fake-aeat.js"')
      .replaceAll('from "@waitron/verifactu/facade"', 'from "../../dist/facade.js"')
      .replaceAll('from "@waitron/verifactu"', 'from "../../dist/index.js"'),
  );
}

function save(name, source) {
  const path = join(work, `${name}.ts`);
  writeFileSync(path, source);
  files.push(path);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: website, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
}

// Every page is checked the same way, in each locale: its TypeScript blocks run together
// against the offline AEAT, every `console.log(...); // output` comment must match
// what the line prints (text after " (" is explanation), and names the page does not define
// (or only `declare`s, for functions the reader writes) come from the fixtures below.
const PAGES = [
  "getting-started.md",
  "guides/chain.md",
  "guides/checking.md",
  "guides/delivery.md",
  "guides/lookup.md",
  "guides/qr.md",
  "guides/records.md",
  "guides/replies.md",
  "guides/sending.md",
  "guides/tax.md",
  "guides/testing.md",
  "guides/tools.md",
];

const EXTRAS = {
  "getting-started.md": {
    after: `__assert.equal(__savedRecords[0], record);
__assert.equal(__savedReplies[0], reply);
__assert.equal(new URL(qrUrl).searchParams.get("importe"), "12.10");
const __testReply = await testClient.submit({ ObligadoEmision: seller }, [{ RegistroAlta: record }]);
__assert.equal(__testReply.RespuestaLinea[0]?.EstadoRegistro, "Correcto");`,
  },
  "guides/lookup.md": { before: "await client.submit(cabecera, [{ RegistroAlta: record }]);" },
  "guides/delivery.md": {
    before: `const __db = { records: [] as __vf.RegistroAlta[], outbox: [] as __vf.RegistroAlta[], count: 0 };
(globalThis as any).inTransaction = async (work: (tx: unknown) => Promise<unknown>) =>
  work({
    nextInvoiceNumber: async () => \`T01/\${String(++__db.count).padStart(6, "0")}\`,
    latestRecord: async () => {
      const last = __db.records.at(-1);
      return last ? { ...last.IDFactura, Huella: last.Huella } : null;
    },
    saveRecord: async (record: __vf.RegistroAlta) => { __db.records.push(record); },
    addToOutbox: async (record: __vf.RegistroAlta) => { __db.outbox.push(record); },
  });
(globalThis as any).setJobState = async (job: { state: string }, state: string) => { job.state = state; };`,
    after: `__assert.equal(__db.records.length, 2);
__assert.equal(__db.outbox.length, 2);
__assert.deepEqual(__vf.checkChain(__db.records), { scope: "complete", issues: [] });`,
  },
  "guides/sending.md": {
    after: `__assert.equal(typeof createCertificateFetch(Buffer.from("test-only"), "test-only"), "function");`,
  },
};

const FIXTURES = [
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

const PRELUDE = `import __assert from "node:assert/strict";
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

function checkPages(locale) {
  const root = join(website, "src/content/docs", locale);
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
  assert.deepEqual(pages.sort(), PAGES, `${locale} pages with TypeScript examples`);

  for (const page of PAGES) {
    const { imports, bodies } = mergeImports(tsBlocks(readFileSync(join(root, page), "utf8")));
    let code = bodies.join("\n");
    if (page === "getting-started.md") {
      // The fake's clock is created before this example runs; crossing a second boundary
      // can make a real-time generated record look future-dated to that fixed clock.
      assert.ok(code.includes("const issuedAt = new Date();"));
      code = code.replace("const issuedAt = new Date();", "const issuedAt = __issuedAt;");
    }
    const fixtures = FIXTURES.flatMap(([name, value]) => {
      if (new RegExp(`\\bdeclare\\s+(?:const|function)\\s+${name}\\b`).test(code)) {
        return [`(globalThis as any).${name} = ${value};`];
      }
      if (new RegExp(`\\b(?:const|let|function|class)\\s+${name}\\b`).test(code)) return [];
      return [`const ${name} = ${value};`];
    });
    const expected = [...code.matchAll(/^\s*console\.log\(.*\);\s*\/\/\s*(.+)$/gm)].map((match) =>
      match[1].replace(/\s+\(.*\)$/, "").trim(),
    );
    const extras = EXTRAS[page] ?? {};
    save(
      `${locale}-${page.replace(/[/.]/g, "-")}`,
      `${imports}
${PRELUDE}
${fixtures.join("\n")}
${extras.before ?? ""}
${code}
__assert.deepEqual(__outputs, ${JSON.stringify(expected)}, ${JSON.stringify(`${locale}/${page} printed output`)});
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

  for (const locale of ["en", "es"]) checkPages(locale);

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

  for (const file of files) {
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

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "parse5";

const root = new URL("../", import.meta.url);
const baselineUrl = new URL("sources/watch-baseline.json", root);
const legacyCaFile = fileURLToPath(new URL("sources/fnmt-ac-componentes-informaticos.pem", root));
const aeat = "https://sede.agenciatributaria.gob.es";
const faq = `${aeat}/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes`;
const docs = `${aeat}/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU`;
const docsLegacy =
  "https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU";
const namespaceSchema =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws";
const preSchema =
  "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws";
const productionSchema =
  "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws";
const execFileAsync = promisify(execFile);

const annexArtifacts = [
  "SistemaFacturacion.wsdl",
  "SuministroInformacion.xsd",
  "SuministroLR.xsd",
  "ConsultaLR.xsd",
  "RespuestaSuministro.xsd",
  "RespuestaConsultaLR.xsd",
];

const faqPages = [
  "cuestiones-generales-conceptos-definiciones",
  "cuestiones-generales-ambitos-aplicacion",
  "cuestiones-generales-cumplimiento-delegacion",
  "caracteristicas-requisitos-sistemas-informaticos-facturacion-multiple",
  "caracteristicas-requisitos-sif-capacidad-remision-etc_",
  "caracteristicas-requisitos-sif-integridad-inalterabilidad",
  "caracteristicas-requisitos-sif-trazabilidad",
  "caracteristicas-requisitos-sif-conservacion-accesibilidad-legibilidad",
  "caracteristicas-requisitos-sif-registro-eventos_",
  "registros-facturacion-alta",
  "registros-facturacion-anulacion",
  "huella-hash",
  "firma",
  "certificacion-sistemas-informaticos-declaracion-responsable",
  "sistemas-verifactu",
  "posibilidad-remision-informacion-factura-parte-receptor",
  "procedimientos-facturacion",
  "colaboracion-social",
];

export const sources = [
  {
    id: "aeat-technical-index",
    kind: "html",
    url: `${aeat}/Sede/iva/sistemas-informaticos-facturacion-verifactu/informacion-tecnica.html`,
  },
  { id: "aeat-faq-index", kind: "html", url: `${faq}.html` },
  ...faqPages.map((name) => ({ id: `aeat-faq-${name}`, kind: "html", url: `${faq}/${name}.html` })),
  { id: "aeat-developer-faq", kind: "pdf", url: `${docs}/FAQs-Desarrolladores.pdf` },
  { id: "aeat-service-spec", kind: "pdf", url: `${docs}/Veri-Factu_Descripcion_SWeb.pdf` },
  {
    id: "aeat-hash-spec",
    kind: "pdf",
    url: `${docsLegacy}/Veri-Factu_especificaciones_huella_hash_registros.pdf`,
  },
  {
    id: "aeat-qr-spec",
    kind: "pdf",
    url: `${docsLegacy}/DetalleEspecificacTecnCodigoQRfactura.pdf`,
  },
  {
    id: "aeat-validation-rules",
    kind: "pdf",
    url: `${docsLegacy}/Validaciones_Errores_Veri-Factu.pdf`,
  },
  { id: "aeat-error-codes", kind: "binary", url: `${preSchema}/errores.properties` },
  ...["SuministroInformacion.xsd", "SuministroLR.xsd", "ConsultaLR.xsd"].map((name) => ({
    id: `aeat-namespace-${name}`,
    kind: "binary",
    url: `${namespaceSchema}/${name}`,
  })),
  ...[
    ["preproduction", preSchema],
    ["production", productionSchema],
  ].flatMap(([environment, base]) =>
    annexArtifacts.map((name) => ({
      id: `aeat-annex-${environment}-${name}`,
      kind: "binary",
      url: `${base}/${name}`,
    })),
  ),
  {
    id: "conformance-fixtures",
    kind: "github-head",
    url: "https://api.github.com/repos/borjamrd/verifactu-conformance/commits/main",
  },
  {
    id: "inoguerols-code",
    kind: "github-head",
    url: "https://api.github.com/repos/inoguerols/verifactu/commits/main",
  },
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function meaningfulHtml(html) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  function findMain(node) {
    if (node.tagName === "main") return node;
    for (const child of node.childNodes ?? []) {
      const main = findMain(child);
      if (main) return main;
    }
    return undefined;
  }

  const textParts = [];
  const links = [];
  function collect(node) {
    if (node.tagName === "script" || node.tagName === "style" || node.nodeName === "#comment")
      return;
    if (node.nodeName === "#text") {
      const location = node.sourceCodeLocation;
      // Keep source spelling of entities so existing fingerprints stay comparable.
      textParts.push(location ? html.slice(location.startOffset, location.endOffset) : node.value);
    }
    if (node.tagName === "a") {
      const attribute = node.attrs.find(({ name }) => name === "href");
      const location = node.sourceCodeLocation?.attrs?.href;
      let href = attribute?.value;
      if (location) {
        const raw = html.slice(location.startOffset, location.endOffset);
        const equals = raw.indexOf("=");
        if (equals >= 0) {
          const value = raw.slice(equals + 1).trim();
          const quote = value[0];
          href = quote === '"' || quote === "'" ? value.slice(1, -1) : value;
        }
      }
      if (href) links.push(href);
    }
    for (const child of node.childNodes ?? []) collect(child);
  }

  collect(findMain(document) ?? document);
  const text = textParts.join(" ").replace(/\s+/g, " ").trim();
  return `${text}\n${links.join("\n")}`;
}

// www.agenciatributaria.es chains through an FNMT intermediate signed with SHA-1, which
// OpenSSL 3 and Node's fetch refused. Curl accepted the chain once that intermediate was
// passed with --cacert; sources/README.md has what was measured.
export function legacyCurlArgs(url) {
  return ["-fsSL", "--retry", "2", "--cacert", legacyCaFile, url];
}

export async function fingerprintSource(source, fetcher = fetch) {
  let content;
  if (fetcher === fetch && source.url.startsWith(docsLegacy)) {
    const { stdout } = await execFileAsync("curl", legacyCurlArgs(source.url), {
      encoding: "buffer",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    });
    content = stdout;
  } else {
    const response = await fetcher(source.url, {
      headers: { "User-Agent": "waitron-verifactu-source-watch", Accept: "*/*" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    content = Buffer.from(await response.arrayBuffer());
  }
  if (source.kind === "github-head") {
    const { sha } = JSON.parse(content.toString("utf8"));
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("GitHub did not return a commit SHA");
    return sha;
  }
  if (source.kind === "pdf" && !content.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Expected PDF content");
  }
  if (
    source.kind === "binary" &&
    /^\s*<!doctype html|^\s*<html/i.test(content.toString("utf8", 0, 200))
  ) {
    throw new Error("Expected schema content, received HTML");
  }
  return sha256(source.kind === "html" ? meaningfulHtml(content.toString("utf8")) : content);
}

export async function inspectSources(entries, baseline, fetcher = fetch) {
  const results = await Promise.all(
    entries.map(async (source) => {
      try {
        const current = await fingerprintSource(source, fetcher);
        const previous = baseline[source.id];
        return {
          ...source,
          current,
          previous,
          status: !previous ? "new" : previous === current ? "same" : "changed",
        };
      } catch (error) {
        return { ...source, status: "error", error: String(error) };
      }
    }),
  );
  return results;
}

export function formatReport(results) {
  const changed = results.filter(({ status }) => status !== "same");
  if (changed.length === 0)
    return "All watched Veri*Factu sources match the pinned fingerprints.\n";
  const lines = ["# Veri*Factu source changes", ""];
  for (const item of changed) {
    lines.push(`- **${item.id}** (${item.status}): ${item.url}`);
    if (item.status === "error") lines.push(`  - ${item.error}`);
    else lines.push(`  - Pinned: \`${item.previous ?? "none"}\`; current: \`${item.current}\``);
  }
  lines.push(
    "",
    "Review the AEAT source or upstream commit before changing the pinned baseline.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const reportIndex = args.indexOf("--report");
  const reportPath = reportIndex >= 0 ? args[reportIndex + 1] : undefined;
  if (reportIndex >= 0 && !reportPath) throw new Error("--report needs a path");
  const baseline = refresh ? {} : JSON.parse(await readFile(baselineUrl, "utf8")).fingerprints;
  const results = await inspectSources(sources, baseline);
  const report = formatReport(results);
  process.stdout.write(report);
  if (reportPath) await writeFile(reportPath, report);
  if (results.some(({ status }) => status === "error")) process.exitCode = 1;
  else if (refresh) {
    const fingerprints = Object.fromEntries(results.map(({ id, current }) => [id, current]));
    await writeFile(
      baselineUrl,
      `${JSON.stringify({ checked: new Date().toISOString().slice(0, 10), fingerprints }, null, 2)}\n`,
    );
  } else if (results.some(({ status }) => status !== "same")) process.exitCode = 2;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(process.argv[1], `file://${process.cwd()}/`))
) {
  await main();
}

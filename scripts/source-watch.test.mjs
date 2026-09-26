import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  fingerprintSource,
  formatReport,
  inspectSources,
  meaningfulHtml,
  sources,
} from "./source-watch.mjs";

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async arrayBuffer() {
    return Buffer.from(body);
  },
});

test("HTML fingerprints ignore page chrome but include FAQ text and links", () => {
  const first = '<header>time 1</header><main><p>Rule A</p><a href="/rule-a">A</a></main>';
  const second = '<header>time 2</header><main>  <p>Rule A</p> <a href="/rule-a">A</a></main>';
  assert.equal(meaningfulHtml(first), meaningfulHtml(second));
  assert.notEqual(meaningfulHtml(first), meaningfulHtml(first.replace("/rule-a", "/rule-b")));
  assert.notEqual(meaningfulHtml(first), meaningfulHtml(first.replace("Rule A", "Rule B")));
});

test("source inspection distinguishes unchanged, changed, new, and unreachable sources", async () => {
  const entries = [
    { id: "same", kind: "binary", url: "https://example.test/same" },
    { id: "changed", kind: "binary", url: "https://example.test/changed" },
    { id: "new", kind: "binary", url: "https://example.test/new" },
    { id: "error", kind: "binary", url: "https://example.test/error" },
  ];
  const fetcher = async (url) => response(url, url.endsWith("error") ? 404 : 200);
  const sameHash = await fingerprintSource(entries[0], fetcher);
  const results = await inspectSources(entries, { same: sameHash, changed: "old" }, fetcher);
  assert.deepEqual(
    results.map(({ status }) => status),
    ["same", "changed", "new", "error"],
  );
  assert.match(formatReport(results), /changed/);
  assert.match(formatReport(results), /HTTP 404/);
});

test("source inspection watches every test and production artifact linked by annexes 7 and 8", async () => {
  const annexSources = sources.filter(({ id }) => id.startsWith("aeat-annex-"));
  const requestedUrls = [];
  const fetcher = async (url) => {
    requestedUrls.push(url);
    return response("<schema />");
  };

  const results = await inspectSources(annexSources, {}, fetcher);

  assert.deepEqual(requestedUrls.sort(), [
    "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/ConsultaLR.xsd",
    "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaConsultaLR.xsd",
    "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaSuministro.xsd",
    "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl",
    "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd",
    "https://prewww2.aeat.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroLR.xsd",
    "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/ConsultaLR.xsd",
    "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaConsultaLR.xsd",
    "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/RespuestaSuministro.xsd",
    "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SistemaFacturacion.wsdl",
    "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroInformacion.xsd",
    "https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tikeV1.0/cont/ws/SuministroLR.xsd",
  ]);
  assert.equal(results.length, 12);
});

test("the baseline has exactly one fingerprint for every watched source", async () => {
  const baseline = JSON.parse(
    await readFile(new URL("../sources/watch-baseline.json", import.meta.url), "utf8"),
  ).fingerprints;

  assert.deepEqual(Object.keys(baseline).sort(), sources.map(({ id }) => id).sort());
});

test("rejects an HTML error page served instead of a PDF or schema", async () => {
  await assert.rejects(
    fingerprintSource({ id: "pdf", kind: "pdf", url: "https://example.test/pdf" }, async () =>
      response("<html>error</html>"),
    ),
    /Expected PDF content/,
  );
  await assert.rejects(
    fingerprintSource(
      { id: "schema", kind: "binary", url: "https://example.test/schema" },
      async () => response("<html>error</html>"),
    ),
    /Expected schema content/,
  );
});

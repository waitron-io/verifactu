import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

test("HTML fingerprints exclude raw script and style content with whitespace in closing tags", () => {
  const page =
    '<main><p>Published rule</p><script>const example = \'<a href="/script-noise">noise</a>\';</script ><style>.x::after { content: "<a href=\\"/style-noise\\">" }</style ><a href="/published">Source</a></main>';
  assert.equal(meaningfulHtml(page), "Published rule Source\n/published");
});

test("HTML fingerprints exclude malformed comments and their nested tag-like text", () => {
  const page =
    '<main><p>Published rule</p><a href="/published">Source</a><!-- <a href="/comment-noise">noise</a> -- ></main>';
  assert.equal(meaningfulHtml(page), "Published rule Source\n/published");
});

test("HTML fingerprints ignore nested tag-like text in script data but keep following content", () => {
  const page =
    '<main><script>const value = "<a href=\'/noise\'>"; /* <script> */</script><p>Published rule</p><a href="/published">Source</a></main>';
  assert.equal(meaningfulHtml(page), "Published rule Source\n/published");
  assert.notEqual(meaningfulHtml(page), meaningfulHtml(page.replace("/published", "/updated")));
  assert.notEqual(
    meaningfulHtml(page),
    meaningfulHtml(page.replace("Published rule", "Updated rule")),
  );
});

test("HTML fingerprints retain the pinned spelling of text and link entities", () => {
  assert.equal(
    meaningfulHtml('<main><p>&iquest;Qu&eacute;?</p><a href="/rules?x=1&amp;y=2">Rules</a></main>'),
    "&iquest;Qu&eacute;? Rules\n/rules?x=1&amp;y=2",
  );
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

test("passes curl the bundled FNMT intermediate and no insecure flag", async () => {
  const source = sources.find(({ id }) => id === "aeat-hash-spec");
  const stubDir = await mkdtemp(join(tmpdir(), "source-watch-curl-"));
  const argsFile = join(stubDir, "args");
  await writeFile(
    join(stubDir, "curl"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "$CURL_ARGS_FILE"\nprintf '%%PDF-stub'\n`,
    { mode: 0o755 },
  );
  const path = process.env.PATH;
  process.env.PATH = `${stubDir}${delimiter}${path}`;
  process.env.CURL_ARGS_FILE = argsFile;
  let args;
  try {
    await fingerprintSource(source);
    args = (await readFile(argsFile, "utf8")).trimEnd().split("\n");
  } finally {
    process.env.PATH = path;
    delete process.env.CURL_ARGS_FILE;
    await rm(stubDir, { recursive: true, force: true });
  }

  assert.equal(args.at(-1), source.url);
  assert.equal(
    args[args.indexOf("--cacert") + 1],
    fileURLToPath(new URL("../sources/fnmt-ac-componentes-informaticos.pem", import.meta.url)),
  );
  for (const insecure of ["-k", "--insecure", "--proxy-insecure"]) {
    assert.ok(!args.includes(insecure), `curl was given ${insecure}`);
  }

  const certificate = new X509Certificate(await readFile(args[args.indexOf("--cacert") + 1]));
  assert.equal(
    certificate.fingerprint256,
    "DB:0D:A1:60:32:F1:64:3A:24:96:FD:E7:42:E2:BB:E8:1D:AC:A5:8C:D7:61:20:61:42:0E:15:4C:E1:BC:E2:BD",
  );
  assert.match(certificate.subject, /OU=AC Componentes Inform\u00e1ticos/);
  assert.equal(certificate.ca, true);
});

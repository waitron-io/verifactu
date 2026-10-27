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

// Removing archive writes must lose the actual text/bytes, not merely a metadata flag.
test("refresh archives normalized HTML, PDF and schema bytes with their fingerprints", async (t) => {
  const watch = await import("./source-watch.mjs");
  assert.equal(typeof watch.refreshSources, "function", "refresh must retain source contents");
  const directory = await mkdtemp(join(tmpdir(), "source-watch-refresh-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "watch-baseline.json");
  const entries = [
    { id: "faq", kind: "html", url: "https://example.test/faq" },
    { id: "pdf", kind: "pdf", url: "https://example.test/rules.pdf" },
    { id: "schema", kind: "binary", url: "https://example.test/rules.xsd" },
  ];
  const bodies = [
    '<header>noise</header><main><p>Rule A</p><a href="/rule">Read</a></main>',
    "%PDF-unchanged\u0000bytes",
    '<schema name="original"/>',
  ];
  await watch.refreshSources(entries, baselinePath, async (url) =>
    response(bodies[entries.findIndex((entry) => entry.url === url)]),
  );
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const expected = ["Rule A Read\n/rule", bodies[1], bodies[2]];
  for (const [index, entry] of entries.entries()) {
    const archived = baseline.archives[entry.id];
    const bytes = await readFile(join(directory, archived.path));
    assert.equal(bytes.toString(), expected[index]);
    const { createHash } = await import("node:crypto");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), baseline.fingerprints[entry.id]);
    assert.equal(archived.sha256, baseline.fingerprints[entry.id]);
    assert.equal(archived.url, entry.url);
  }
});

test("refresh retains the previous version and a date-only FAQ change still alerts", async (t) => {
  const watch = await import("./source-watch.mjs");
  assert.equal(typeof watch.refreshSources, "function", "refresh must retain source contents");
  const directory = await mkdtemp(join(tmpdir(), "source-watch-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "watch-baseline.json");
  const entries = [{ id: "faq", kind: "html", url: "https://example.test/faq" }];
  const oldPage = "<main>Actualizadas a 21 de julio de 2026</main>";
  const newPage = oldPage.replace("julio", "octubre");
  await watch.refreshSources(entries, baselinePath, async () => response(oldPage));
  const oldBaseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const results = await inspectSources(entries, oldBaseline.fingerprints, async () =>
    response(newPage),
  );
  assert.equal(results[0].status, "changed");
  await watch.refreshSources(entries, baselinePath, async () => response(newPage));
  const newBaseline = JSON.parse(await readFile(baselinePath, "utf8"));
  assert.notEqual(oldBaseline.archives.faq.path, newBaseline.archives.faq.path);
  assert.equal(
    await readFile(join(directory, oldBaseline.archives.faq.path), "utf8"),
    "Actualizadas a 21 de julio de 2026\n",
  );
  assert.equal(
    await readFile(join(directory, newBaseline.archives.faq.path), "utf8"),
    "Actualizadas a 21 de octubre de 2026\n",
  );
});

test("a failed refresh leaves the published baseline and its archive unchanged", async (t) => {
  const watch = await import("./source-watch.mjs");
  assert.equal(typeof watch.refreshSources, "function", "refresh must retain source contents");
  const directory = await mkdtemp(join(tmpdir(), "source-watch-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "watch-baseline.json");
  const entries = [{ id: "pdf", kind: "pdf", url: "https://example.test/rules.pdf" }];
  await watch.refreshSources(entries, baselinePath, async () => response("%PDF-original"));
  const before = await readFile(baselinePath, "utf8");
  const archive = JSON.parse(before).archives.pdf;
  for (const body of ["<html>not a PDF</html>", null]) {
    await assert.rejects(
      watch.refreshSources(entries, baselinePath, async () =>
        response(body ?? "missing", body === null ? 503 : 200),
      ),
      /Expected PDF content|HTTP 503/,
    );
    assert.equal(await readFile(baselinePath, "utf8"), before);
    assert.equal(await readFile(join(directory, archive.path), "utf8"), "%PDF-original");
  }
});

test("refresh archives a GitHub repository at the watched commit, never its moving branch", async (t) => {
  const watch = await import("./source-watch.mjs");
  assert.equal(typeof watch.refreshSources, "function", "refresh must retain source contents");
  const directory = await mkdtemp(join(tmpdir(), "source-watch-github-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "watch-baseline.json");
  const sha = "a".repeat(40);
  const metadata = JSON.stringify({ sha, message: "watched commit" });
  const { gzipSync } = await import("node:zlib");
  const tarball = gzipSync(Buffer.alloc(1024));
  const entry = {
    id: "upstream",
    kind: "github-head",
    url: "https://api.github.com/repos/example/rules/commits/main",
  };
  const urls = [];
  await watch.refreshSources([entry], baselinePath, async (url) => {
    urls.push(url);
    return response(url === entry.url ? metadata : tarball);
  });
  assert.deepEqual(urls, [entry.url, `https://api.github.com/repos/example/rules/tarball/${sha}`]);
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  assert.equal(baseline.fingerprints.upstream, sha);
  assert.equal(await readFile(join(directory, baseline.archives.upstream.path), "utf8"), metadata);
  assert.deepEqual(
    await readFile(join(directory, baseline.archives.upstream.repository.path)),
    tarball,
  );
  await assert.rejects(
    watch.refreshSources([entry], baselinePath, async (url) =>
      response(url === entry.url ? metadata : "<html>not a tarball</html>"),
    ),
    /Expected gzip/,
  );
  assert.equal(JSON.parse(await readFile(baselinePath, "utf8")).fingerprints.upstream, sha);
});

test("a change report points at the previous archived source for comparison", () => {
  const result = {
    id: "faq",
    status: "changed",
    url: "https://example.test/faq",
    previous: "old",
    current: "new",
  };
  assert.match(
    formatReport([result], { faq: { path: "archive/faq/old.txt" } }),
    /sources\/archive\/faq\/old\.txt/,
  );
});

test("an archive write refusal never publishes a replacement baseline", async (t) => {
  const watch = await import("./source-watch.mjs");
  const directory = await mkdtemp(join(tmpdir(), "source-watch-write-refusal-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const baselinePath = join(directory, "watch-baseline.json");
  const original = '{"fingerprints":{"faq":"original"}}\n';
  await writeFile(baselinePath, original);
  await writeFile(join(directory, "archive"), "a file prevents archive directory creation");
  await assert.rejects(
    watch.refreshSources(
      [{ id: "faq", kind: "html", url: "https://example.test/faq" }],
      baselinePath,
      async () => response("<main>new</main>"),
    ),
    /ENOTDIR|EEXIST/,
  );
  assert.equal(await readFile(baselinePath, "utf8"), original);
});

test("every pinned source has a readable archive with matching bytes and provenance", async () => {
  const { createHash } = await import("node:crypto");
  const { gunzipSync } = await import("node:zlib");
  const baseline = JSON.parse(
    await readFile(new URL("../sources/watch-baseline.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(Object.keys(baseline.archives).sort(), sources.map(({ id }) => id).sort());
  for (const source of sources) {
    const archive = baseline.archives[source.id];
    const bytes = await readFile(new URL(`../sources/${archive.path}`, import.meta.url));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.equal(archive.url, source.url, source.id);
    assert.equal(hash, archive.sha256, source.id);
    if (source.kind === "github-head") {
      assert.equal(JSON.parse(bytes).sha, baseline.fingerprints[source.id]);
      assert.ok(archive.repository.url.endsWith(`/tarball/${baseline.fingerprints[source.id]}`));
      const tarball = await readFile(
        new URL(`../sources/${archive.repository.path}`, import.meta.url),
      );
      assert.equal(createHash("sha256").update(tarball).digest("hex"), archive.repository.sha256);
      assert.ok(gunzipSync(tarball).length > 1024);
    } else assert.equal(hash, baseline.fingerprints[source.id], source.id);
  }
});

test("the seeded historical FAQ index reconstructs the original pinned fingerprint", async () => {
  const { createHash } = await import("node:crypto");
  const seed = JSON.parse(
    await readFile(new URL("../sources/archive/seed-2026-10-27.json", import.meta.url), "utf8"),
  );
  assert.equal(seed.sources.length, 43);
  for (const archive of [...seed.sources, seed.historicalFaqIndex]) {
    const bytes = await readFile(new URL(`../sources/${archive.path}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), archive.sha256);
    if (archive.repository) {
      const tarball = await readFile(
        new URL(`../sources/${archive.repository.path}`, import.meta.url),
      );
      assert.equal(createHash("sha256").update(tarball).digest("hex"), archive.repository.sha256);
    }
  }
  assert.equal(
    seed.historicalFaqIndex.sha256,
    "8524695568ddb9b2bb6891f802a0f69544de12f8e3270551dd277917e27069fe",
  );
});

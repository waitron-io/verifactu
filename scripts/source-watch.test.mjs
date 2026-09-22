import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fingerprintSource,
  formatReport,
  inspectSources,
  meaningfulHtml,
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

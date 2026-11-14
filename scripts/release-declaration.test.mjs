import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./release-declaration.sh", import.meta.url));
const FILE = "DECLARACION-RESPONSABLE.md";
const DECLARATION = "Declaración v0.3.0\n";

// A stand-in for gh. GH_STUB_RELEASE is none, error, published or draft; GH_STUB_ASSET, when set,
// is the file the Release already holds. `release view` prints the JSON gh would and, like gh,
// applies --jq to it.
const GH_STUB = `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$GH_STUB_DIR/calls"
[ "$1" = release ] || exit 2
command=$2
shift 2
jq_expr="" dir="" notes=""
while [ $# -gt 0 ]; do
  case "$1" in
    --jq) jq_expr=$2; shift ;;
    --dir) dir=$2; shift ;;
    --notes-file) notes=$2; shift ;;
  esac
  shift
done
case "$command" in
  view)
    case "$GH_STUB_RELEASE" in
      none) echo "release not found" >&2; exit 1 ;;
      error) echo "HTTP 502: Bad Gateway" >&2; exit 1 ;;
      published) draft=false ;;
      draft) draft=true ;;
    esac
    assets="[]"
    if [ -n "\${GH_STUB_ASSET:-}" ]; then assets='[{"name":"${FILE}"}]'; fi
    json="{\\"isDraft\\":$draft,\\"assets\\":$assets,\\"tagName\\":\\"v0.3.0\\"}"
    if [ -n "$jq_expr" ]; then printf '%s' "$json" | jq -r "$jq_expr"; else printf '%s\\n' "$json"; fi
    ;;
  download)
    mkdir -p "$dir"
    cp "$GH_STUB_ASSET" "$dir/${FILE}"
    ;;
  create)
    cp "$notes" "$GH_STUB_DIR/notes"
    ;;
  upload) ;;
  *) exit 2 ;;
esac
`;

const createdDirs = [];
after(() => Promise.all(createdDirs.map((d) => rm(d, { recursive: true, force: true }))));

/** Runs the script for `tag` in a fresh checkout stand-in whose path holds a space. */
async function release({ state, asset, tag = "v0.3.0" }) {
  const dir = await mkdtemp(join(tmpdir(), "release declaration "));
  createdDirs.push(dir);
  const checkout = join(dir, "checkout");
  const stub = join(dir, "stub");
  const runnerTemp = join(dir, "runner temp");
  await Promise.all([
    mkdir(checkout),
    mkdir(join(stub, "bin"), { recursive: true }),
    mkdir(runnerTemp),
  ]);
  await writeFile(join(stub, "bin", "gh"), GH_STUB);
  await chmod(join(stub, "bin", "gh"), 0o755);
  await writeFile(join(checkout, FILE), DECLARATION);
  await writeFile(
    join(checkout, "CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n- Next.\n\n## 0.3.0 — 2026-03-05\n\n- First.\n",
  );
  const env = {
    PATH: `${join(stub, "bin")}:${process.env.PATH}`,
    HOME: process.env.HOME,
    GITHUB_REF_NAME: tag,
    RUNNER_TEMP: runnerTemp,
    GH_STUB_DIR: stub,
    GH_STUB_RELEASE: state,
  };
  if (asset !== undefined) {
    env.GH_STUB_ASSET = join(stub, "asset");
    await writeFile(env.GH_STUB_ASSET, asset);
  }
  const result = spawnSync("bash", [SCRIPT], { cwd: checkout, encoding: "utf8", env });
  const callsFile = join(stub, "calls");
  const calls = existsSync(callsFile) ? (await readFile(callsFile, "utf8")).trim().split("\n") : [];
  const notesFile = join(stub, "notes");
  const notes = existsSync(notesFile) ? await readFile(notesFile, "utf8") : undefined;
  return { ...result, calls, notes };
}

/** The gh subcommands the script ran, after `release`. */
const verbs = (calls) => calls.map((call) => call.split(" ")[1]);

test("with no Release, creates one holding the file, with the version's CHANGELOG notes", async () => {
  const result = await release({ state: "none" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(verbs(result.calls), ["view", "create"]);
  assert.match(
    result.calls[1],
    /^release create v0\.3\.0 DECLARACION-RESPONSABLE\.md --verify-tag /,
  );
  assert.equal(result.notes, "- First.\n");
});

test("with no Release and no CHANGELOG section for the version, fails and creates nothing", async () => {
  const result = await release({ state: "none", tag: "v0.4.0" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CHANGELOG\.md has no "## 0\.4\.0" section/);
  assert.deepEqual(verbs(result.calls), ["view"]);
});

test("with a published Release lacking the file, uploads it", async () => {
  const result = await release({ state: "published" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(verbs(result.calls), ["view", "upload"]);
  assert.equal(result.calls[1], `release upload v0.3.0 ${FILE}`);
});

test("with a published Release holding the same file, carries on without uploading", async () => {
  const result = await release({ state: "published", asset: DECLARATION });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(verbs(result.calls), ["view", "download"]);
});

test("with a published Release holding a different file, refuses", async () => {
  const result = await release({ state: "published", asset: "Otra declaración\n" });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /::error::The Release for v0\.3\.0 already holds a different/);
  assert.deepEqual(verbs(result.calls), ["view", "download"]);
});

test("an unexpected gh error is printed and fails the step", async () => {
  const result = await release({ state: "error" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTTP 502: Bad Gateway/);
  assert.deepEqual(verbs(result.calls), ["view"]);
});

for (const [label, asset] of [
  ["without the file", undefined],
  ["already holding the same file", DECLARATION],
]) {
  test(`refuses a draft Release ${label}, since a draft is not public`, async () => {
    const result = await release({ state: "draft", asset });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /::error::The Release for v0\.3\.0 is a draft/);
    assert.deepEqual(verbs(result.calls), ["view"]);
  });
}

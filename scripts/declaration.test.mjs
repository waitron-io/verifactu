import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SCRIPT = new URL("./declaration.mjs", import.meta.url).pathname;
const REAL_TEMPLATE = new URL("../declarations/template.md", import.meta.url).pathname;
const OUTPUT = "DECLARACION-RESPONSABLE.md";

const PRODUCER = {
  WAITRON_PRODUCER_NAME: "Nombre-Secreto Apellido",
  WAITRON_PRODUCER_TAX_ID: "NIF-SECRETO-99",
  WAITRON_PRODUCER_ADDRESS: "Calle Secreta 7, 07000 Palma",
  DECLARATION_PLACE: "Lugar-Secreto",
};
const SECRETS = Object.values(PRODUCER);

// Typed by hand from Waitron's packages/fiscal-verifactu/src/declaration/headings.test.ts.
const HEADINGS = [
  "DECLARACIÓN RESPONSABLE DEL SISTEMA INFORMÁTICO DE FACTURACIÓN",
  "1.a) Nombre del sistema informático a que se refiere esta declaración responsable:",
  "1.b) Código identificador del sistema informático a que se refiere el apartado a) de esta declaración responsable:",
  "1.c) Identificador completo de la versión concreta del sistema informático a que se refiere esta declaración responsable:",
  "1.d) Componentes, hardware y software, de que consta el sistema informático a que se refiere esta declaración responsable, junto con una breve descripción de lo que hace dicho sistema informático y de sus principales funcionalidades:",
  "1.e) Indicación de si el sistema informático a que se refiere esta declaración responsable se ha producido de tal manera que, a los efectos de cumplir con el Reglamento, solo pueda funcionar exclusivamente como «VERI*FACTU»:",
  "1.f) Indicación de si el sistema informático a que se refiere la declaración responsable permite ser usado por varios obligados tributarios o por un mismo usuario para dar soporte a la facturación de varios obligados tributarios:",
  "1.g) Tipos de firma utilizados para firmar los registros de facturación y de evento en el caso de que el sistema informático a que se refiere esta declaración responsable no sea utilizado como «VERI*FACTU».",
  "1.h) Nombre y apellidos de la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "1.i) Número de identificación fiscal (NIF) español de la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "1.j) Dirección postal completa de contacto de la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "1.k)",
  "1.l)",
  "ANEXO",
  "2.a) Otras formas de contacto con la persona productora del sistema informático a que se refiere esta declaración responsable:",
  "2.b) Direcciones de internet de la persona productora del sistema informático a que se refiere esta declaración responsable:",
];

/** An environment with no GIT_* variables, so git hooks running these tests do not leak in. */
function cleanEnv(extra = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME };
  return { ...env, ...extra };
}

function git(dir, args, extraEnv = {}) {
  const result = spawnSync("git", args, {
    cwd: dir,
    encoding: "utf8",
    env: cleanEnv({
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      ...extraEnv,
    }),
  });
  assert.equal(result.status, 0, result.stderr);
}

async function realBody() {
  const source = await readFile(REAL_TEMPLATE, "utf8");
  const lines = source.split("\n");
  assert.match(lines[0], /^<!-- release-blocker: .* -->$/);
  return lines.slice(1).join("\n");
}

/** A git repo holding package.json at `version`, an annotated v0.3.0 tag and a lightweight v0.3.1. */
async function repo(template, version = "0.3.0") {
  const dir = await mkdtemp(join(tmpdir(), "declaration-"));
  git(dir, ["init", "-q"]);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "x", version }));
  await writeFile(join(dir, "template.md"), template);
  await writeFile(
    join(dir, "CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n- Next.\n\n## 0.3.0 — 2026-03-05\n\n- First.\n- Second.\n\n## 0.2.1 — 2026-10-03\n\n- Old.\n",
  );
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  git(dir, ["tag", "-a", "v0.3.0", "-m", "v0.3.0"], {
    GIT_COMMITTER_DATE: "2026-03-05T12:00:00+01:00",
  });
  git(dir, ["tag", "v0.3.1"]);
  return dir;
}

function run(dir, args = [], env = PRODUCER, input) {
  return spawnSync(
    process.execPath,
    [SCRIPT, ...args, "--root", dir, "--template", join(dir, "template.md")],
    { encoding: "utf8", env: cleanEnv(env), input },
  );
}

function assertRefused(result, pattern) {
  assert.notEqual(result.status, 0, "expected a refusal");
  assert.match(result.stderr, pattern);
  for (const secret of SECRETS) {
    assert.ok(!result.stderr.includes(secret), `refusal printed a producer value: ${secret}`);
    assert.ok(!result.stdout.includes(secret), `refusal printed a producer value: ${secret}`);
  }
}

test("the real template carries every heading, in order, word for word", async () => {
  const body = await realBody();
  const headings = [...body.matchAll(/\*\*([\s\S]*?)\*\*/g)].map((match) =>
    match[1].replace(/\s+/g, " ").trim(),
  );
  assert.deepEqual(headings, HEADINGS);
});

test("fills every slot of the real template from the tag, package.json and the environment", async () => {
  const dir = await repo(await realBody());
  const result = run(dir);
  assert.equal(result.status, 0, result.stderr);
  const text = await readFile(join(dir, OUTPUT), "utf8");
  assert.doesNotMatch(text, /[‹›]/);
  assert.match(text, /esta declaración responsable:\*\* 0\.3\.0\n/);
  assert.match(text, /esta declaración responsable:\*\* Nombre-Secreto Apellido\n/);
  assert.match(text, /esta declaración responsable:\*\* NIF-SECRETO-99\n/);
  assert.match(text, /esta declaración responsable:\*\* Calle Secreta 7, 07000 Palma\n/);
  assert.match(text, /responsable del mismo: 5 de marzo de 2026\./);
  assert.match(text, /responsable del mismo: Lugar-Secreto – España\./);
  assert.doesNotMatch(text, /release-blocker/);
});

test("a re-run for the same tag writes byte-identical output", async () => {
  const dir = await repo(await realBody());
  assert.equal(run(dir).status, 0);
  const first = await readFile(join(dir, OUTPUT));
  assert.equal(run(dir, [], { ...PRODUCER, GITHUB_REF_NAME: "v0.3.0" }).status, 0);
  assert.ok(first.equals(await readFile(join(dir, OUTPUT))));
});

test("refuses the real template while it carries a release-blocker line", async () => {
  const dir = await repo(await readFile(REAL_TEMPLATE, "utf8"));
  assertRefused(run(dir), /release-blocker/);
  assert.equal(existsSync(join(dir, OUTPUT)), false);
});

for (const name of Object.keys(PRODUCER)) {
  for (const [label, value] of [
    ["missing", undefined],
    ["empty", ""],
    ["whitespace-only", "  \t "],
    ["multi-line", "first line\nsecond line"],
  ]) {
    test(`refuses a ${label} ${name}, naming the variable and no producer value`, async () => {
      const dir = await repo(await realBody());
      const env = { ...PRODUCER };
      if (value === undefined) delete env[name];
      else env[name] = value;
      const result = run(dir, [], env);
      assertRefused(result, new RegExp(name));
      assert.equal(existsSync(join(dir, OUTPUT)), false);
    });
  }
}

test("refuses when GITHUB_REF_NAME is not v<package.json version>", async () => {
  const dir = await repo(await realBody());
  assertRefused(run(dir, [], { ...PRODUCER, GITHUB_REF_NAME: "v9.9.9" }), /GITHUB_REF_NAME/);
});

test("refuses a lightweight tag", async () => {
  const dir = await repo(await realBody(), "0.3.1");
  assertRefused(run(dir, [], { ...PRODUCER, GITHUB_REF_NAME: "v0.3.1" }), /v0\.3\.1.*annotated/);
});

test("refuses a missing tag", async () => {
  const dir = await repo(await realBody(), "0.4.0");
  assertRefused(run(dir), /v0\.4\.0.*does not exist/);
});

test("refuses a slot it cannot fill", async () => {
  const dir = await repo(`${await realBody()}\nExtra: ‹otro›\n`);
  assertRefused(run(dir), /‹otro›/);
  assert.equal(existsSync(join(dir, OUTPUT)), false);
});

test("--preview prints the text with today's date, needing no tag, and writes nothing", async () => {
  const dir = await repo(await realBody(), "0.9.0");
  const result = run(dir, ["--preview"], { ...PRODUCER, GITHUB_REF_NAME: "v1.2.3" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /esta declaración responsable:\*\* 0\.9\.0\n/);
  assert.doesNotMatch(result.stdout, /[‹›]/);
  const today = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(new Date());
  assert.ok(result.stdout.includes(`responsable del mismo: ${today}.`));
  assert.match(result.stderr, /stand-in for the tag's date/);
  assert.equal(existsSync(join(dir, OUTPUT)), false);
});

test("--preview still refuses a release-blocker line and a missing value", async () => {
  const blocked = await repo(await readFile(REAL_TEMPLATE, "utf8"));
  assertRefused(run(blocked, ["--preview"]), /release-blocker/);
  const dir = await repo(await realBody());
  const env = { ...PRODUCER };
  delete env.DECLARATION_PLACE;
  assertRefused(run(dir, ["--preview"], env), /DECLARATION_PLACE/);
});

test("changelog prints the version's section", async () => {
  const dir = await repo(await realBody());
  const result = run(dir, ["changelog", "0.3.0"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "- First.\n- Second.\n");
});

test("changelog refuses a version with no section", async () => {
  const dir = await repo(await realBody());
  assertRefused(run(dir, ["changelog", "0.3"]), /CHANGELOG\.md has no "## 0\.3" section/);
});

test("check-pack accepts npm's listing when it holds the declaration", async () => {
  const listing = JSON.stringify([{ files: [{ path: "README.md" }, { path: OUTPUT }] }]);
  const result = run(await repo(""), ["check-pack"], PRODUCER, listing);
  assert.equal(result.status, 0, result.stderr);
});

test("check-pack refuses npm's listing when the declaration is missing", async () => {
  const listing = JSON.stringify([{ files: [{ path: "README.md" }] }]);
  assertRefused(run(await repo(""), ["check-pack"], PRODUCER, listing), /DECLARACION-RESPONSABLE/);
});

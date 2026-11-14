// scripts/declaration.mjs — fills declarations/template.md into DECLARACION-RESPONSABLE.md.
//
//   node scripts/declaration.mjs [--preview]     render (or, with --preview, print) the declaration
//   node scripts/declaration.mjs changelog <v>   print CHANGELOG.md's "## <v>" section
//   node scripts/declaration.mjs check-pack      read `npm pack --dry-run --json` on stdin and
//                                                refuse unless it lists the declaration
//
// --root <dir> and --template <path> default to this repository and its template.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUTPUT = "DECLARACION-RESPONSABLE.md";
const PRODUCER_VARIABLES = {
  "‹nombre y apellidos›": "WAITRON_PRODUCER_NAME",
  "‹NIF›": "WAITRON_PRODUCER_TAX_ID",
  "‹dirección›": "WAITRON_PRODUCER_ADDRESS",
  "‹lugar›": "DECLARATION_PLACE",
};

function refuse(message) {
  console.error(`declaration: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { root: new URL("..", import.meta.url).pathname, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--preview") options.preview = true;
    else if (arg === "--root" || arg === "--template") options[arg.slice(2)] = argv[++i];
    else options.positional.push(arg);
  }
  options.template ??= join(options.root, "declarations", "template.md");
  return options;
}

// Never echoes the value: these are the producer's personal details.
function setting(name) {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") refuse(`${name} is missing or empty.`);
  if (/[\r\n]/.test(value)) refuse(`${name} must be a single line.`);
  return value.trim();
}

const SPANISH_DATE = { day: "numeric", month: "long", year: "numeric" };

function tagDate(root, tag) {
  const ref = `refs/tags/${tag}`;
  try {
    execFileSync("git", ["rev-parse", "--quiet", "--verify", ref], { cwd: root, stdio: "ignore" });
  } catch {
    refuse(`tag ${tag} does not exist.`);
  }
  const isoDate = execFileSync("git", ["for-each-ref", "--format=%(taggerdate:short)", ref], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (isoDate === "") refuse(`tag ${tag} has no date: it must be an annotated tag (git tag -a).`);
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat("es-ES", { ...SPANISH_DATE, timeZone: "UTC" }).format(date);
}

function render({ root, template, preview }) {
  const source = readFileSync(template, "utf8");
  if (/release-blocker/.test(source)) {
    refuse(`${template} still has a release-blocker line; resolve it and delete the line first.`);
  }
  const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const values = { "‹versión›": version };
  for (const [slot, name] of Object.entries(PRODUCER_VARIABLES)) values[slot] = setting(name);
  if (preview) {
    values["‹fecha›"] = new Intl.DateTimeFormat("es-ES", {
      ...SPANISH_DATE,
      timeZone: "Europe/Madrid",
    }).format(new Date());
  } else {
    const tag = `v${version}`;
    const refName = process.env.GITHUB_REF_NAME;
    if (refName !== undefined && refName !== tag) {
      refuse(`GITHUB_REF_NAME is ${refName}, but package.json's version ${version} needs ${tag}.`);
    }
    values["‹fecha›"] = tagDate(root, tag);
  }
  // One pass, so a filled value is never read again as a slot.
  const text = source.replace(/‹[^›\n]*›/g, (slot) => {
    if (!(slot in values)) refuse(`${template} has a slot nothing fills: ${slot}`);
    return values[slot];
  });
  if (preview) {
    console.error("declaration: the date shown is today's, a stand-in for the tag's date.");
    process.stdout.write(text);
  } else {
    writeFileSync(join(root, OUTPUT), text);
    console.error(`declaration: wrote ${OUTPUT} for v${version}.`);
  }
}

function changelog({ root, positional: [, version] }) {
  if (!version) refuse("usage: declaration.mjs changelog <version>");
  const lines = readFileSync(join(root, "CHANGELOG.md"), "utf8").split("\n");
  const start = lines.findIndex(
    (line) => line === `## ${version}` || line.startsWith(`## ${version} `),
  );
  if (start === -1) refuse(`CHANGELOG.md has no "## ${version}" section.`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
  if (body === "") refuse(`CHANGELOG.md's "## ${version}" section is empty.`);
  process.stdout.write(`${body}\n`);
}

function checkPack() {
  const listing = JSON.parse(readFileSync(0, "utf8"));
  const paths = listing.flatMap((pack) => pack.files.map((file) => file.path));
  if (!paths.includes(OUTPUT)) refuse(`the npm package would not contain ${OUTPUT}.`);
  console.error(`declaration: the npm package contains ${OUTPUT}.`);
}

const options = parseArgs(process.argv.slice(2));
const command = options.positional[0];
if (command === "changelog") changelog(options);
else if (command === "check-pack") checkPack();
else if (command === undefined) render(options);
else refuse(`unknown command ${command}`);

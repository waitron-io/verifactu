import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const broken = [];

function inspect(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) {
      inspect(file);
      continue;
    }
    if (!file.endsWith(".html")) continue;

    const html = readFileSync(file, "utf8");
    const page = file.slice(dist.length + 1).replace(/index\.html$/, "");
    const base = new URL(`/verifactu/${page}`, "https://docs.example.invalid");
    for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const resolved = new URL(url, base);
      if (resolved.origin !== base.origin || !resolved.pathname.startsWith("/verifactu/")) {
        continue;
      }
      const relative = decodeURIComponent(resolved.pathname.slice("/verifactu/".length));
      const target = join(dist, relative);
      if (!existsSync(target) && !existsSync(join(target, "index.html"))) {
        broken.push(`${file}: ${url}`);
      }
    }
  }
}

inspect(dist);
if (broken.length > 0) {
  throw new Error(`Broken local site links:\n${broken.join("\n")}`);
}
console.log("All local site links resolve");

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
    for (const [, url] of html.matchAll(/(?:href|src)="(\/verifactu\/[^"#?]*)/g)) {
      const relative = decodeURIComponent(url.slice("/verifactu/".length));
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
console.log("All local absolute site links resolve");

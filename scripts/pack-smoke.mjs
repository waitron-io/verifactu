// scripts/pack-smoke.mjs — packs the built package, installs it into a temp
// project, and asserts the root and ./testing exports resolve from dist.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
const tarball = execFileSync("npm", ["pack", "--silent"], { cwd: root, encoding: "utf8" }).trim();

const dir = mkdtempSync(join(tmpdir(), "verifactu-smoke-"));
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({ name: "smoke", type: "module", private: true }),
);
execFileSync("npm", ["install", join(root, tarball)], { cwd: dir, stdio: "inherit" });
writeFileSync(
  join(dir, "smoke.mjs"),
  [
    'import * as v from "@waitron/verifactu";',
    'import { createFakeAeat } from "@waitron/verifactu/testing";',
    'if (typeof v.computeHuella !== "function") throw new Error("root export missing computeHuella");',
    'if (typeof v.buildQrPayload !== "function") throw new Error("root export missing buildQrPayload");',
    'if (typeof createFakeAeat !== "function") throw new Error("./testing export missing createFakeAeat");',
    'console.log("pack-smoke OK");',
  ].join("\n"),
);
execFileSync("node", ["smoke.mjs"], { cwd: dir, stdio: "inherit" });

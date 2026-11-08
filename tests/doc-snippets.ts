// Every ts fence in the guides must compile the way run.ts runs it (#1604): imports rewritten, helpers as
// parameters, inside an async function. Catches static imports and names that clash with a helper.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as helpers from "../helpers";
import * as admin from "../admin";
import { hoistImports } from "../run";
const DIR = resolve(import.meta.dir, "..");
const names = Object.keys({ ...helpers, ...admin }).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
const tr = new Bun.Transpiler({ loader: "ts" });
const AF = Object.getPrototypeOf(async function () {}).constructor;
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  if (f.startsWith("_pre-livestream")) return [];
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") ? [p] : [];
});
const files = [...walk(join(DIR, "domain-skills")), ...walk(join(DIR, "interaction-skills")), join(DIR, "SKILL.md"), ...process.argv.slice(2)];
let n = 0, bad = 0;
for (const f of files) {
  for (const m of readFileSync(f, "utf8").matchAll(/^```(?:ts|typescript)\n([\s\S]*?)^```/gm)) {
    n++;
    try { new AF(...names, "require", tr.transformSync(hoistImports(m[1]))); }
    catch (e: any) { bad++; console.log(`FAIL ${f.replace(DIR + "/", "")}: ${String(e.message).split("\n")[0]}`); }
  }
}
console.log(`${bad ? "FAIL" : "PASS"} doc snippets: ${n - bad}/${n} compile as run.ts runs them`);
process.exit(bad ? 1 : 0);

// TypeScript runner (#1600): reads TS from stdin with every helper pre-imported, top-level await OK.
//   bun run.ts <<'TS'
//   await ensure_real_tab()
//   console.log(await page_info())
//   TS
import * as helpers from "./helpers";
import * as admin from "./admin";
import { detect } from "./lang";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";

const HELP = `Browser Harness (TypeScript)

Read SKILL.md for the default workflow and examples.

Typical usage:
  bun run.ts <<'TS'
  await ensure_real_tab()
  console.log(await page_info())
  TS

Helpers are pre-imported and async (await them). The daemon auto-starts and connects to the running browser.
`;

// The snippet runs inside an async function, where a static import is a SyntaxError. Rewrite top-level
// imports to require() so `import { writeFileSync } from "node:fs"` works as it would in a file.
export function hoistImports(code: string): string {
  return code.replace(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+(["'][^"']+["']);?[ \t]*$/gm, (_m, type, what, mod) => {
    if (type) return "";
    what = what.trim();
    const ns = what.match(/^\*\s+as\s+(\w+)$/);
    if (ns) return `const ${ns[1]} = require(${mod});`;
    const parts: string[] = [];
    const named = what.match(/\{([\s\S]*)\}/);
    const def = what.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
    if (def) parts.push(`const ${def} = require(${mod}).default ?? require(${mod});`);
    if (named) parts.push(`const { ${named[1].replace(/\s+as\s+/g, ": ").trim()} } = require(${mod});`);
    return parts.join(" ");
  }).replace(/^import\s+(["'][^"']+["']);?[ \t]*$/gm, "require($1);");
}

async function main() {
  const a = process.argv[2];
  if (a === "-h" || a === "--help") {
    console.log(HELP);
    return;
  }
  if (process.stdin.isTTY) {
    console.error("browser-harness reads TypeScript from stdin. Use:\n  bun run.ts <<'TS'\n  console.log(await page_info())\n  TS");
    process.exit(1);
  }
  const code = await Bun.stdin.text();
  // Transitional (#1604): a Python snippet goes to the Python runner unchanged, same stdout, stderr and exit code.
  if (detect(code) === "py") {
    const r = spawnSync(join(dirname(import.meta.path), "venv/bin/browser-harness"), process.argv.slice(2), { input: code, stdio: ["pipe", "inherit", "inherit"] });
    process.exit(r.status ?? 1);
  }
  await admin.ensure_daemon();
  const scope = { ...helpers, ...admin };
  const names = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(hoistImports(code));
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(...names, "require", js);
  await fn(...names.map((k) => (scope as any)[k]), require);
}

if (import.meta.main) main().then(
  () => process.exit(0),
  (e) => {
    console.error(e?.stack ?? String(e));
    process.exit(1);
  },
);

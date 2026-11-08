// TypeScript runner (#1600): reads TS from stdin with every helper pre-imported, top-level await OK.
//   bun run.ts <<'TS'
//   await ensure_real_tab()
//   console.log(await page_info())
//   TS
import * as helpers from "./helpers";
import * as admin from "./admin";

const HELP = `Browser Harness (TypeScript)

Read SKILL.md for the default workflow and examples.

Typical usage:
  bun run.ts <<'TS'
  await ensure_real_tab()
  console.log(await page_info())
  TS

Helpers are pre-imported and async (await them). The daemon auto-starts and connects to the running browser.
`;

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
  await admin.ensure_daemon();
  const scope = { ...helpers, ...admin };
  const names = Object.keys(scope).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(code);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction(...names, "require", js);
  await fn(...names.map((k) => (scope as any)[k]), require);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e?.stack ?? String(e));
    process.exit(1);
  },
);

// Runner (#1604): TS snippets print what the Python runner printed for the same work (tests/golden/runner.json,
// recorded from the Python harness before it was removed). Python snippets get the TS redirect and exit 2,
// with nothing sent to the browser. Mock browser only.
import { startMockBrowser } from "./mock-browser";
import { startDaemon, stopDaemon } from "./parity";
import { resolve } from "node:path";
const DIR = resolve(import.meta.dir, "..");
const NAME = "t1604-runner";

async function run(cmd: string[], input: string, env: Record<string, string>) {
  const p = Bun.spawn(cmd, { cwd: DIR, env: { ...process.env, ...env }, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  const kill = setTimeout(() => p.kill(), 60_000);
  const r = { out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text(), code: await p.exited };
  clearTimeout(kill);
  return r;
}

const GOLDEN = JSON.parse(await Bun.file(import.meta.dir + "/golden/runner.json").text()) as Record<string, string>;
const TS_CASES: Record<string, string> = {
  "page info": "const i = await page_info()\nconsole.log(JSON.stringify(Object.fromEntries(Object.entries(i).sort())).replace(/,/g, ', ').replace(/\":/g, '\": '))",
  "tabs + js": "const tid = await new_tab('https://example.com/a')\nawait wait_for_load()\nconsole.log(await js('1+1'))\nconsole.log(typeof tid === 'string' ? 'str' : typeof tid)",
  "with block": "await temp_tab('https://example.com/b', async (tid) => {\n  console.log(await js('document.title'))\n})\nconsole.log('after')",
  "one-liner": "console.log((await page_info()).url)",
};
const PY_SNIPPETS = [
  "print(page_info())",
  "import time\nwith temp_tab('https://example.com/b') as tid:\n    time.sleep(1)\n    print(js('document.title'))",
  "t=js('document.body.innerText'); print(t[-800:])",
];

const M = startMockBrowser();
const env = { BU_NAME: NAME, BU_CDP_WS: `http://127.0.0.1:${M.port}` };
const d = await startDaemon(NAME, env.BU_CDP_WS);
let fails = 0;
try {
  for (const [label, code] of Object.entries(TS_CASES)) {
    const r = await run(["bun", "run.ts"], code, env);
    if (r.code !== 0 || r.out !== GOLDEN[label]) { fails++; console.log(`FAIL ts vs Python golden: ${label}\n  python: ${JSON.stringify(GOLDEN[label])}\n  ts: ${JSON.stringify(r)}`); }
    else console.log(`PASS ts vs Python golden: ${label}`);
  }
  for (const code of PY_SNIPPETS) {
    const before = M.log.length;
    const r = await run(["bun", "run.ts"], code, env);
    const ok = r.code === 2 && r.out === "" && r.err.includes("runs TypeScript now") && M.log.length === before;
    if (!ok) { fails++; console.log(`FAIL python redirect: ${JSON.stringify(code)} -> ${JSON.stringify(r)}`); }
    else console.log(`PASS python redirect: exit 2, TS shape on stderr, browser untouched (${code.split("\n")[0].slice(0, 40)})`);
  }
  const im = await run(["bun", "run.ts"], 'import { existsSync } from "node:fs"\nimport * as path from "node:path"\nconsole.log(existsSync("/tmp"), path.basename("/a/b"), (await page_info()).url)', env);
  if (im.code === 0 && /^true b \S+\n$/.test(im.out)) console.log("PASS ts static imports work at top level");
  else { fails++; console.log(`FAIL ts static imports: ${JSON.stringify(im)}`); }
  const e = await run(["bun", "run.ts"], "console.log('before')\nthrow new Error('boom')", env);
  if (e.code === 1 && e.out === "before\n" && e.err.includes("boom")) console.log("PASS ts error: exit 1, stdout kept, error on stderr");
  else { fails++; console.log(`FAIL ts error: ${JSON.stringify(e)}`); }
} finally {
  await stopDaemon(NAME, d);
  M.server.stop(true);
}
console.log(fails ? `${fails} FAILED` : "runner: all pass");
process.exit(fails ? 1 : 0);

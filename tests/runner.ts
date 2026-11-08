// Runner language detection (#1604): the same Python snippet run through `bun run.ts` must give the same
// stdout, stderr and exit code as the Python runner, and a TS snippet must run as TS. Mock browser only.
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

const PY_CASES: Record<string, string> = {
  "page info": "import json\nprint(json.dumps(page_info(), sort_keys=True))",
  "tabs + js": "tid = new_tab('https://example.com/a')\nwait_for_load()\nprint(js('1+1'))\nprint(type(tid).__name__)",
  "with block": "with temp_tab('https://example.com/b') as tid:\n    print(js('document.title'))\nprint('after')",
  "loop": "for i in range(3):\n    print(i)",
  "one-liner": "print(page_info()['url'])",
  "raises": "print('before')\nraise ValueError('boom')",
  "sys.exit": "import sys\nprint('x')\nsys.exit(3)",
};
// TS twins print the same text as the Python version.
const TS_CASES: Record<string, [string, string]> = {
  "page info": ["const i = await page_info()\nconsole.log(JSON.stringify(Object.fromEntries(Object.entries(i).sort())).replace(/,/g, ', ').replace(/\":/g, '\": '))", "page info"],
  "tabs + js": ["const tid = await new_tab('https://example.com/a')\nawait wait_for_load()\nconsole.log(await js('1+1'))\nconsole.log(typeof tid === 'string' ? 'str' : typeof tid)", "tabs + js"],
  "with block": ["await temp_tab('https://example.com/b', async (tid) => {\n  console.log(await js('document.title'))\n})\nconsole.log('after')", "with block"],
  "one-liner": ["console.log((await page_info()).url)", "one-liner"],
};

const M = startMockBrowser();
const env = { BU_NAME: NAME, BU_CDP_WS: `http://127.0.0.1:${M.port}` };
const d = await startDaemon("ts", NAME, env.BU_CDP_WS);
let fails = 0;
try {
  for (const [label, code] of Object.entries(PY_CASES)) {
    const a = await run([`${DIR}/venv/bin/browser-harness`], code, env);
    const b = await run(["bun", "run.ts"], code, env);
    const same = a.out === b.out && a.err === b.err && a.code === b.code;
    if (!same) { fails++; console.log(`FAIL py via run.ts: ${label}\n  python: ${JSON.stringify(a)}\n  run.ts: ${JSON.stringify(b)}`); }
    else console.log(`PASS py via run.ts: ${label} (exit ${a.code}, ${a.out.length}B out, ${a.err.length}B err)`);
  }
  for (const [label, [code, twin]] of Object.entries(TS_CASES)) {
    const a = await run([`${DIR}/venv/bin/browser-harness`], PY_CASES[twin], env);
    const b = await run(["bun", "run.ts"], code, env);
    if (b.code !== 0 || a.out !== b.out) { fails++; console.log(`FAIL ts via run.ts: ${label}\n  python out: ${JSON.stringify(a.out)}\n  ts: ${JSON.stringify(b)}`); }
    else console.log(`PASS ts via run.ts: ${label} matches Python output`);
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

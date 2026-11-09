// Live gate on real Helium via the 9222 tunnel (#1600). Test BU_NAMEs only; never BU_NAME=default.
// Runs the TS live scenario on the TS daemon twice and checks the runs agree and hold no errors. The Python
// baseline it once compared against (38/38 identical, #1600) went with the Python harness in #1604.
import { startDaemon, stopDaemon } from "./parity";
const DIR = import.meta.dir + "/..";
const CDP = process.env.LIVE_CDP || "http://127.0.0.1:9222";
async function run(name: string) {
  const d = await startDaemon(name, CDP);
  const p = Bun.spawn(["bun", "tests/live_scenario.ts"], { cwd: DIR, env: { ...process.env, BU_NAME: name, BU_CDP_WS: CDP }, stdout: "pipe", stderr: "pipe" });
  const k = setTimeout(() => p.kill(), 120_000);
  const so = await new Response(p.stdout).text(), se = await new Response(p.stderr).text(), st = await p.exited;
  clearTimeout(k);
  await stopDaemon(name, d);
  if (st !== 0) throw new Error(`live scenario failed: ${se}`);
  return JSON.parse(so) as any[];
}
const a = await run("lt1600"), b = await run("lt1604");
// Steps that exist to check error paths: their error text must match across runs, like everything else.
const EXPECTED_ERR = new Set(["cdp error", "upload missing"]);
let fails = 0;
for (let i = 0; i < a.length; i++) {
  const x = JSON.stringify(a[i]), y = JSON.stringify(b[i]);
  const err = !EXPECTED_ERR.has(a[i][0]) && (/"ERR:/.test(x) || /"ERR:/.test(y));
  if (x !== y || err) { fails++; console.log(`FAIL live: ${a[i][0]}\n  1: ${x}\n  2: ${y}`); }
}
console.log(`${fails ? "FAIL" : "PASS"} live TS scenario: ${a.length - fails}/${a.length} steps agree, no unexpected errors`);
process.exit(fails ? 1 : 0);

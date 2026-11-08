// Live gate on real Helium via the 9222 tunnel (#1600). Test BU_NAMEs only; never BU_NAME=default.
// 1) Python helpers+daemon vs TS helpers+daemon, same live scenario  2) Python helpers on TS daemon
import { startDaemon, stopDaemon } from "./parity";
const DIR = import.meta.dir + "/..";
const CDP = process.env.LIVE_CDP || "http://127.0.0.1:9222";
async function run(kind: "py" | "ts", daemon: "py" | "ts", name: string) {
  const d = await startDaemon(daemon, name, CDP);
  const cmd = kind === "py" ? [`${DIR}/venv/bin/python`, "tests/live_scenario.py"] : ["bun", "tests/live_scenario.ts"];
  const p = Bun.spawn(cmd, { cwd: DIR, env: { ...process.env, BU_NAME: name, BU_CDP_WS: CDP }, stdout: "pipe", stderr: "pipe" });
  const k = setTimeout(() => p.kill(), 120_000);
  const so = await new Response(p.stdout).text(), se = await new Response(p.stderr).text(), st = await p.exited;
  clearTimeout(k);
  await stopDaemon(name, d);
  if (st !== 0) throw new Error(`${kind}/${daemon} failed: ${se}`);
  return JSON.parse(so) as any[];
}
const base = await run("py", "py", "lp1600");
let fails = 0;
for (const [label, other] of [["TS helpers+TS daemon", await run("ts", "ts", "lt1600")], ["Python helpers on TS daemon", await run("py", "ts", "lx1600")]] as const) {
  let f = 0;
  for (let i = 0; i < base.length; i++) {
    const a = JSON.stringify(base[i]), b = JSON.stringify(other[i]);
    if (a !== b) { f++; console.log(`FAIL live ${label}: ${base[i][0]}\n  py: ${a}\n  ts: ${b}`); }
  }
  console.log(`${f ? "FAIL" : "PASS"} live ${label}: ${base.length - f}/${base.length} identical to Python`);
  fails += f;
}
console.log("python baseline:", JSON.stringify(base));
process.exit(fails ? 1 : 0);

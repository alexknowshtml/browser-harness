// Runs scenario.py (Python helpers -> Python daemon) and scenario.ts (TS helpers -> TS daemon)
// against two identical mock browsers; compares outputs and the CDP traffic each browser saw.
// Also runs scenario.py against the TS daemon: today's Python callers on the new daemon (gate 3 offline).
import { startMockBrowser } from "./mock-browser";
import { startDaemon, stopDaemon } from "./parity";
const DIR = import.meta.dir + "/..";

async function run(kind: "py" | "ts", daemon: "py" | "ts", name: string) {
  const M = startMockBrowser();
  const ws = `http://127.0.0.1:${M.port}`;
  const d = await startDaemon(daemon, name, ws);
  const cmd = kind === "py" ? [`${DIR}/venv/bin/python`, "tests/scenario.py"] : ["bun", "tests/scenario.ts"];
  // Async spawn: spawnSync would block this process, and the mock browser lives in it.
  const p = Bun.spawn(cmd, { cwd: DIR, env: { ...process.env, BU_NAME: name, BU_CDP_WS: ws }, stdout: "pipe", stderr: "pipe" });
  const kill = setTimeout(() => p.kill(), 60_000);
  const r = { stdout: await new Response(p.stdout).text(), stderr: await new Response(p.stderr).text(), status: await p.exited };
  clearTimeout(kill);
  await stopDaemon(name, d);
  M.server.stop(true);
  if (r.status !== 0) throw new Error(`${kind} scenario failed: ${r.stderr}`);
  // Target/session ids are minted in order by each mock, so they line up across runs.
  return { out: JSON.parse(r.stdout) as any[], log: M.log.map(({ id, ...x }) => JSON.stringify(x)) };
}

function compare(label: string, a: { out: any[]; log: string[] }, b: { out: any[]; log: string[] }) {
  let fails = 0;
  for (let i = 0; i < Math.max(a.out.length, b.out.length); i++) {
    const x = JSON.stringify(a.out[i]), y = JSON.stringify(b.out[i]);
    if (x !== y) { fails++; console.log(`FAIL ${label}: ${a.out[i]?.[0] ?? b.out[i]?.[0]}\n  a: ${x?.slice(0, 300)}\n  b: ${y?.slice(0, 300)}`); }
  }
  console.log(`${fails ? "FAIL" : "PASS"} ${label}: ${a.out.length - fails}/${a.out.length} helper results identical`);
  const sameLog = JSON.stringify(a.log) === JSON.stringify(b.log);
  if (!sameLog) {
    fails++;
    for (let i = 0; i < Math.max(a.log.length, b.log.length); i++) if (a.log[i] !== b.log[i]) { console.log(`  browser traffic differs at #${i}\n  a: ${a.log[i]}\n  b: ${b.log[i]}`); break; }
  }
  console.log(`${sameLog ? "PASS" : "FAIL"} ${label}: browser saw identical CDP traffic (${a.log.length} vs ${b.log.length})`);
  return fails;
}

const pyPy = await run("py", "py", "hp1600");
const tsTs = await run("ts", "ts", "ht1600");
const pyTs = await run("py", "ts", "hx1600");
let f = compare("TS helpers+TS daemon vs Python", pyPy, tsTs);
f += compare("Python helpers on TS daemon vs Python", pyPy, pyTs);
process.exit(f ? 1 : 0);

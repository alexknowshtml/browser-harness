// Gate 3 live: real callers, unchanged, read-only (dry-run modes), against a test Python daemon
// and a test TS daemon (#1600). Callers go through scripts/browser-harness with BU_NAME set.
import { startDaemon, stopDaemon } from "./parity";
const CDP = "http://127.0.0.1:9222";
const A = "/home/alexhillman/andy";
const CALLERS: Array<[string, string[]]> = [
  ["social-instagram-web (dry run)", ["bun", `${A}/scripts/social-instagram-web.ts`]],
  ["social-instagram-activity (dry run)", ["bun", `${A}/scripts/social-instagram-activity.ts`]],
  ["social-instagram-feed (dry run)", ["bun", `${A}/scripts/social-instagram-feed.ts`, "--scrolls", "1"]],
];
// Live pages change between runs, so compare shape: exit code, line count, line prefixes with digits masked.
const shape = (s: string) => s.trim().split("\n").map((l) => l.replace(/\d+/g, "#").slice(0, 40));
async function run(kind: "py" | "ts", name: string) {
  const d = await startDaemon(kind, name, CDP);
  const out: any[] = [];
  for (const [label, cmd] of CALLERS) {
    const p = Bun.spawn(cmd, { cwd: A, env: { ...process.env, BU_NAME: name }, stdout: "pipe", stderr: "pipe" });
    const k = setTimeout(() => p.kill(), 240_000);
    const so = await new Response(p.stdout).text(), se = await new Response(p.stderr).text(), st = await p.exited;
    clearTimeout(k);
    out.push({ label, status: st, stdout: so.trim(), stderr: se.trim().split("\n").slice(-3).join(" | ") });
  }
  await stopDaemon(name, d);
  return out;
}
const py = await run("py", "cp1600"), ts = await run("ts", "ct1600");
let fails = 0;
for (let i = 0; i < CALLERS.length; i++) {
  const a = py[i], b = ts[i];
  const ok = a.status === 0 && b.status === 0 && JSON.stringify(shape(a.stdout)) === JSON.stringify(shape(b.stdout));
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} caller ${a.label}: py exit ${a.status}, ts exit ${b.status}`);
  console.log(`  py: ${a.stdout.split("\n").slice(0, 3).join(" / ").slice(0, 300)}${a.status ? "  ERR " + a.stderr : ""}`);
  console.log(`  ts: ${b.stdout.split("\n").slice(0, 3).join(" / ").slice(0, 300)}${b.status ? "  ERR " + b.stderr : ""}`);
}
process.exit(fails ? 1 : 0);

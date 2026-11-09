// TS daemon vs the Python daemon's recorded answers (#1600 gate 1, golden since #1604 removed daemon.py).
// tests/golden/protocol.json holds what daemon.py answered and sent to the browser for this exact script.
// Never touches Helium or the live daemon: only BU_NAME=ts1600 and a mock port.
import { startMockBrowser } from "./mock-browser";
import { connect } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";

const DIR = import.meta.dir + "/..";

export function raw(name: string, req: any, rawLine?: string): Promise<string> {
  return new Promise((res, rej) => {
    const c = connect({ path: `/tmp/bu-${name}.sock` });
    let buf = "";
    c.on("connect", () => c.write(rawLine ?? JSON.stringify(req) + "\n"));
    c.on("data", (d) => (buf += d));
    c.on("end", () => res(buf));
    c.on("error", rej);
  });
}

export async function startDaemon(name: string, cdpWs: string, extraEnv: Record<string, string> = {}) {
  for (const f of [`/tmp/bu-${name}.sock`, `/tmp/bu-${name}.pid`]) if (existsSync(f)) unlinkSync(f);
  const p = spawn("bun", ["daemon.ts"], { cwd: DIR, env: { ...process.env, BU_NAME: name, BU_CDP_WS: cdpWs, ...extraEnv }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    if (existsSync(`/tmp/bu-${name}.sock`)) { try { await raw(name, { meta: "session" }); return p; } catch {} }
    await Bun.sleep(100);
  }
  throw new Error(`daemon ${name} didn't start: ${await Bun.file(`/tmp/bu-${name}.log`).text().catch(() => "")}`);
}

export async function stopDaemon(name: string, p: any) {
  try { await raw(name, { meta: "shutdown" }); } catch {}
  for (let i = 0; i < 50 && p.exitCode === null; i++) await Bun.sleep(100);
  if (p.exitCode === null) p.kill();
}

// Requests covering every meta and the CDP paths: no-session Target.*, explicit session,
// CDP error, stale session, dialog events, numbers that JS would rewrite, unicode, bad input.
export const SCRIPT: Array<{ req?: any; line?: string; label: string }> = [
  { label: "session", req: { meta: "session" } },
  { label: "drain after attach", req: { meta: "drain_events" } },
  { label: "getTargets", req: { method: "Target.getTargets", params: {} } },
  { label: "getTargets no params key", req: { method: "Target.getTargets" } },
  { label: "page eval", req: { method: "Runtime.evaluate", params: { expression: "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})", returnByValue: true } } },
  { label: "float survives", req: { method: "Runtime.evaluate", params: { expression: "1.0+0", returnByValue: true } } },
  { label: "big int survives", req: { method: "Runtime.evaluate", params: { expression: "big" } } },
  { label: "unicode", req: { method: "Runtime.evaluate", params: { expression: "é🟢 " } } },
  { label: "createTarget", req: { method: "Target.createTarget", params: { url: "about:blank" } } },
  { label: "unknown method error", req: { method: "Nope.nothing", params: { a: 1.5 } } },
  { label: "target call ignores session", req: { method: "Target.getTargetInfo", params: {}, session_id: "BOGUS" } },
  { label: "explicit bogus session error", req: { method: "Runtime.evaluate", params: { expression: "1" }, session_id: "BOGUS" } },
  { label: "navigate", req: { method: "Page.navigate", params: { url: "https://example.org/x?é" } } },
  { label: "drain after navigate", req: { meta: "drain_events" } },
  { label: "dialog opens", req: { method: "Test.dialog", params: {} } },
  { label: "pending dialog", req: { meta: "pending_dialog" } },
  { label: "handle dialog", req: { method: "Page.handleJavaScriptDialog", params: { accept: true } } },
  { label: "pending dialog cleared", req: { meta: "pending_dialog" } },
  { label: "screenshot", req: { method: "Page.captureScreenshot", params: { format: "png" } } },
  { label: "null params", req: { method: "Target.getTargets", params: null } },
  { label: "set_session null", req: { meta: "set_session", session_id: null } },
  { label: "call with no session", req: { method: "Runtime.evaluate", params: { expression: "1" } } },
  { label: "missing method", req: { foo: 1 } },
  { label: "bad json", line: "{not json\n" },
  { label: "drain end", req: { meta: "drain_events" } },
];

function normalize(s: string) {
  // Python json.dumps uses ", " and ": " and escapes non-ASCII; compare parsed values, not bytes.
  try { return JSON.stringify(JSON.parse(s)); } catch { return `UNPARSEABLE:${s}`; }
}

export async function runProtocolParity() {
  const G = JSON.parse(await Bun.file(import.meta.dir + "/golden/protocol.json").text()) as { answers: string[]; log: string[] };
  const B = startMockBrowser();
  const ts = await startDaemon("ts1600", `http://127.0.0.1:${B.port}`);
  const diffs: string[] = [];
  // Stale-session step: close the attached tab underneath the daemon mid-script.
  const steps = [...SCRIPT];
  steps.splice(21, 0, { label: "stale session (tab closed) re-attaches", req: { method: "Runtime.evaluate", params: { expression: "document.readyState" } } });
  for (const [i, s] of steps.entries()) {
    if (s.label.startsWith("stale session")) { const sess = [...B.sessions.keys()].pop()!; B.sessions.delete(sess); }
    const a = G.answers[i]!, b = await raw("ts1600", s.req, s.line);
    // Malformed JSON: both must answer with an error; the parser's wording differs by language.
    const ok = s.line ? "error" in JSON.parse(a) && "error" in JSON.parse(b) : normalize(a) === normalize(b);
    if (!ok) diffs.push(`#${i} ${s.label}\n  py: ${normalize(a)}\n  ts: ${normalize(b)}`);
    console.log(`${ok ? "PASS" : "FAIL"} protocol: ${s.label}`);
  }
  // What reached the browser must match too (message ids aside).
  const lb = B.log.map(({ id, ...r }: any) => JSON.stringify(r));
  const sameLog = JSON.stringify(G.log) === JSON.stringify(lb);
  if (!sameLog) for (let i = 0; i < Math.max(G.log.length, lb.length); i++) if (G.log[i] !== lb[i]) { diffs.push(`browser log differs at #${i}\n  py: ${G.log[i]}\n  ts: ${lb[i]}`); break; }
  console.log(`${sameLog ? "PASS" : "FAIL"} protocol: browser saw identical CDP traffic (${G.log.length} vs ${lb.length} msgs)`);
  await stopDaemon("ts1600", ts);
  B.server.stop(true);
  return diffs;
}

if (import.meta.main) {
  const diffs = await runProtocolParity();
  if (diffs.length) { console.log("\nDIFFS:\n" + diffs.join("\n")); process.exit(1); }
  console.log("\nprotocol parity: all identical");
  process.exit(0);
}

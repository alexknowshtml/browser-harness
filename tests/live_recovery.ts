// Gate 4 live (#1600): TS daemon behind a local TCP relay to Helium's 9222. Cut the relay mid-session,
// expect the next call to reconnect to the same tab; then idle IDLE_MIN minutes with real keepalive (30s/120s).
import { startDaemon, stopDaemon, raw } from "./parity";
const IDLE_MIN = Number(process.env.IDLE_MIN || 11);
const conns = new Set<any>();
const relay = Bun.listen({
  hostname: "127.0.0.1", port: 29222,
  socket: {
    async open(c) {
      conns.add(c);
      const up = await Bun.connect({ hostname: "127.0.0.1", port: 9222, socket: {
        data(_u, d) { c.write(d); }, close() { c.end(); }, error() { c.end(); },
      } });
      (c as any).data = { up, q: [] };
    },
    data(c, d) { const s = (c as any).data; if (s?.up) s.up.write(d); else setTimeout(() => (c as any).data?.up?.write(d), 50); },
    close(c) { conns.delete(c); (c as any).data?.up?.end(); },
  },
});
const call = async (req: any) => JSON.parse(await raw("lr1600", req));
const title = () => call({ method: "Runtime.evaluate", params: { expression: "document.title", returnByValue: true } });
const d = await startDaemon("ts", "lr1600", "http://127.0.0.1:29222");
const tid = (await call({ method: "Target.createTarget", params: { url: "data:text/html,<title>lr1600</title>" } })).result.targetId;
const sid = (await call({ method: "Target.attachToTarget", params: { targetId: tid, flatten: true } })).result.sessionId;
await call({ meta: "set_session", session_id: sid });
await Bun.sleep(800);
const before = (await title()).result?.result?.value;
for (const c of conns) { (c as any).data?.up?.end(); c.end(); }
await Bun.sleep(500);
const r = await title();
const after = r.result?.result?.value;
const log1 = await Bun.file("/tmp/bu-lr1600.log").text();
console.log(`${r.result && after === before ? "PASS" : "FAIL"} live relay cut: next call reconnected to the same tab (${before} -> ${after ?? JSON.stringify(r)})`);
console.log(`  reconnects in log: ${(log1.match(/^reconnected/gm) || []).length}`);
const t0 = Date.now();
await Bun.sleep(IDLE_MIN * 60_000);
const r2 = await title();
const log2 = await Bun.file("/tmp/bu-lr1600.log").text();
const drops = (log2.match(/browser socket lost/gm) || []).length;
console.log(`${r2.result && drops === 1 ? "PASS" : "FAIL"} live idle ${IDLE_MIN} min: socket stayed up (drops after cut: ${drops - 1}), call ok: ${!!r2.result}`);
await fetch(`http://127.0.0.1:9222/json/close/${tid}`).catch(() => {});
await stopDaemon("lr1600", d);
relay.stop(true);
console.log(log2.split("\n").filter((l) => /lost|reconnect|keepalive/.test(l)).join("\n"));
process.exit(0);

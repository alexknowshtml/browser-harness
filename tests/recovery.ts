// Gate 4 on a mock browser: dropped socket, keepalive, browser relaunch, in-flight safety (#1600).
import { startMockBrowser } from "./mock-browser";
import { raw, startDaemon, stopDaemon } from "./parity";

const results: Array<[boolean, string, string?]> = [];
const check = (ok: boolean, label: string, detail?: any) => {
  results.push([ok, label, detail === undefined ? undefined : JSON.stringify(detail)]);
  console.log(`${ok ? "PASS" : "FAIL"} recovery: ${label}${!ok && detail !== undefined ? "  " + JSON.stringify(detail) : ""}`);
};
const call = async (name: string, req: any) => JSON.parse(await raw(name, req));
const ctl = (port: number, p: string) => fetch(`http://127.0.0.1:${port}/ctl/${p}`).then((r) => r.text());
const evalTitle = { method: "Runtime.evaluate", params: { expression: "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})", returnByValue: true } };

// 1. Dropped socket (1011), then the next call: reconnects, same tab, succeeds.
{
  const M = startMockBrowser();
  const p = await startDaemon("ts", "rc1600", `http://127.0.0.1:${M.port}`, { BU_PING_INTERVAL: "1", BU_PING_TIMEOUT: "3" });
  const work = M.add("https://booking.example/checkout", "page", "Checkout");
  const sid = (await call("rc1600", { method: "Target.attachToTarget", params: { targetId: work.targetId, flatten: true } })).result.sessionId;
  await call("rc1600", { meta: "set_session", session_id: sid });
  const before = JSON.parse((await call("rc1600", evalTitle)).result.result.value).url;
  await ctl(M.port, "drop");
  await Bun.sleep(200);
  const r = await call("rc1600", evalTitle);
  const after = r.result ? JSON.parse(r.result.result.value).url : r;
  check(!!r.result, "call after 1011 drop succeeds without restart", r);
  check(after === before, "reconnected to the same tab", { before, after });
  check(M.connections === 2, "exactly one reconnect", M.connections);
  // Old session id the caller still holds keeps working (remapped).
  const r2 = await call("rc1600", { ...evalTitle, session_id: sid });
  check(!!r2.result && JSON.parse(r2.result.result.value).url === before, "caller's old session id still works", r2);

  // 2. In-flight call when the socket dies: error, NOT retried; next call works.
  const slowCount = () => M.log.filter((m) => m.method === "Test.slow").length;
  const inflight = call("rc1600", { method: "Test.slow", params: { ms: 1500 } });
  await Bun.sleep(300);
  await ctl(M.port, "drop");
  const ir = await inflight;
  check(ir.error === "WebSocket connection closed", "in-flight call returns an error", ir);
  await Bun.sleep(500);
  check(slowCount() === 1, "in-flight call was not repeated", slowCount());
  const r3 = await call("rc1600", evalTitle);
  check(!!r3.result && JSON.parse(r3.result.result.value).url === before, "next call after in-flight drop works, same tab", r3);

  // 3. Keepalive: pongs answered -> idle 8s (8 pings at 1s) and no drop.
  const c0 = M.connections;
  const pings0 = (await Bun.file("/tmp/bu-rc1600.log").text()).split("keepalive ping timeout (").length;
  await Bun.sleep(8000);
  check(M.connections === c0 && (await Bun.file("/tmp/bu-rc1600.log").text()).split("keepalive ping timeout (").length === pings0, "idle with pongs: no keepalive drop", M.connections);

  // 4. Pongs stop -> daemon drops after timeout, next call reconnects.
  await ctl(M.port, "mute-pongs");
  await Bun.sleep(5500);
  const logTxt = await Bun.file("/tmp/bu-rc1600.log").text();
  check(logTxt.includes("keepalive ping timeout"), "no pongs: socket dropped after timeout", logTxt.split("\n").slice(-4));
  const r4 = await call("rc1600", evalTitle);
  check(!!r4.result, "call after keepalive drop reconnects", r4);

  // 5. Browser relaunch: new browser id; the old ws URL is dead. Daemon must re-resolve.
  const newId = await ctl(M.port, "relaunch");
  await Bun.sleep(200);
  const r5 = await call("rc1600", evalTitle);
  check(!!r5.result, "call after browser relaunch succeeds", r5);
  check((await Bun.file("/tmp/bu-rc1600.log").text()).includes(newId), "connected to the relaunched browser", newId);

  // 6. Tab gone after reconnect -> falls back to first real page, still answers.
  M.targets.delete(work.targetId);
  await ctl(M.port, "drop");
  await Bun.sleep(200);
  const r6 = await call("rc1600", evalTitle);
  check(!!r6.result, "tab closed while disconnected: falls back to a real page", r6);

  await stopDaemon("rc1600", p);
  M.server.stop(true);
}

// 7. Browser down entirely: clear error, no crash; recovers when it's back.
{
  const M = startMockBrowser();
  const port = M.port;
  const p = await startDaemon("ts", "rd1600", `http://127.0.0.1:${port}`);
  M.server.stop(true);
  await Bun.sleep(300);
  const r = await call("rd1600", evalTitle);
  check(typeof r.error === "string" && r.error.includes("reconnect failed"), "browser down: clean error, daemon stays up", r);
  const M2 = startMockBrowser(port);
  const r2 = await call("rd1600", evalTitle);
  check(!!r2.result, "browser back: next call recovers", r2);
  await stopDaemon("rd1600", p);
  M2.server.stop(true);
}

// 8. Frozen first tab (Memory Saver) -> reuses an open about:blank, never makes a new one (#1376).
{
  const M = startMockBrowser();
  const blank = M.add("about:blank");
  const first = [...M.targets.values()][0];
  M.frozen.add(first.targetId);
  const p = await startDaemon("ts", "rf1600", `http://127.0.0.1:${M.port}`);
  const created = M.log.filter((m) => m.method === "Target.createTarget").length;
  const log = await Bun.file("/tmp/bu-rf1600.log").text();
  check(log.includes(`reused about:blank (${blank.targetId})`) && created === 0, "frozen tab: reuses existing blank, creates none", log.split("\n"));
  await stopDaemon("rf1600", p);
  M.server.stop(true);
}

const failed = results.filter((r) => !r[0]);
console.log(`\nrecovery: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

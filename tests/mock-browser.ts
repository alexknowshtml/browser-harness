// Fake Chrome DevTools endpoint for offline daemon tests (#1600). Never touches a real browser.
// Serves /json/version, /json/close/<id>, and a CDP WebSocket with scripted behavior.
// Control endpoints: POST /ctl/drop (close all sockets 1011), /ctl/freeze/<tid>, /ctl/mute-pongs, /ctl/reset
type Target = { targetId: string; type: string; title: string; url: string; attached: boolean };

export function startMockBrowser(port = 0) {
  let n = 0;
  const id = (p: string) => `${p}${(++n).toString(16).padStart(8, "0").toUpperCase()}`;
  const targets = new Map<string, Target>();
  const sessions = new Map<string, string>(); // sessionId -> targetId
  const frozen = new Set<string>();
  const log: any[] = []; // every CDP request received, for assertions
  let mutePongs = false;
  let connections = 0;
  let wsId = "browser-" + Math.random().toString(16).slice(2, 10);
  const sockets = new Set<any>();

  const add = (url: string, type = "page", title = "") => {
    const t = { targetId: id("T"), type, title: title || url, url, attached: false };
    targets.set(t.targetId, t);
    return t;
  };
  const reset = () => {
    targets.clear(); sessions.clear(); frozen.clear(); log.length = 0; mutePongs = false;
    add("https://example.com/", "page", "Example Domain");
    add("chrome://newtab/", "page", "New Tab");
  };
  reset();

  const evalExpr = (t: Target, expr: string) => {
    if (expr.startsWith("JSON.stringify({url:location.href")) {
      return { type: "string", value: JSON.stringify({ url: t.url, title: t.title, w: 1280, h: 720, sx: 0, sy: 0, pw: 1280, ph: 2000 }) };
    }
    if (expr === "document.readyState") return { type: "string", value: "complete" };
    if (expr.includes("document.title='\u{1F7E2} '")) { if (!t.title.startsWith("\u{1F7E2}")) t.title = "\u{1F7E2} " + t.title; return { type: "undefined" }; }
    if (expr.includes("document.title.slice(2)")) { if (t.title.startsWith("\u{1F7E2} ")) t.title = t.title.slice(2); return { type: "undefined" }; }
    if (expr === "1.0+0") return { type: "number", value: 1, description: "1" };
    if (expr === "big") return { type: "number", value: 12345678901234567890 };
    if (expr === "throw") return { type: "object", subtype: "error", description: "Error: boom" };
    return { type: "string", value: `eval:${expr}` };
  };

  function handle(ws: any, msg: any) {
    log.push(msg);
    const reply = (result: any) => ws.send(JSON.stringify({ id: msg.id, result, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) }));
    const error = (code: number, message: string) => ws.send(JSON.stringify({ id: msg.id, error: { code, message } }));
    const p = msg.params || {};
    const sid = msg.sessionId;
    if (sid) {
      const tid = sessions.get(sid);
      if (!tid || !targets.has(tid)) return error(-32001, `Session with given id not found.`);
      if (frozen.has(tid)) return; // never answers (Memory Saver)
      const t = targets.get(tid)!;
      switch (msg.method) {
        case "Page.enable": case "DOM.enable": case "Runtime.enable": case "Network.enable": return reply({});
        case "Runtime.evaluate": return reply({ result: evalExpr(t, p.expression) });
        case "Page.navigate":
          t.url = p.url; t.title = p.url;
          reply({ frameId: "F1", loaderId: "L1" });
          ws.send(JSON.stringify({ method: "Page.loadEventFired", params: { timestamp: 123.0 }, sessionId: sid }));
          return;
        case "Target.getTargetInfo": return reply({ targetInfo: { ...t, attached: true, canAccessOpener: false } });
        case "Page.captureScreenshot": return reply({ data: PNG_1x1 });
        case "Input.dispatchMouseEvent": case "Input.dispatchKeyEvent": case "Input.insertText": return reply({});
        case "DOM.getDocument": return reply({ root: { nodeId: 1, backendNodeId: 1, nodeName: "#document" } });
        case "DOM.querySelector": return reply({ nodeId: p.selector === "#missing" ? 0 : 42 });
        case "DOM.setFileInputFiles": return reply({});
        case "Test.dialog":
          reply({});
          ws.send(JSON.stringify({ method: "Page.javascriptDialogOpening", params: { url: t.url, message: "Sure?", type: "confirm", hasBrowserHandler: false, defaultPrompt: "" }, sessionId: sid }));
          return;
        case "Page.handleJavaScriptDialog":
          reply({});
          ws.send(JSON.stringify({ method: "Page.javascriptDialogClosed", params: { result: !!p.accept, userInput: "" }, sessionId: sid }));
          return;
        case "Test.slow": setTimeout(() => reply({ ok: true }), p.ms ?? 500); return;
        default: return error(-32601, `'${msg.method}' wasn't found`);
      }
    }
    switch (msg.method) {
      case "Target.getTargets": return reply({ targetInfos: [...targets.values()].map((t) => ({ ...t, attached: t.attached, canAccessOpener: false, browserContextId: "C1" })) });
      case "Target.createTarget": { const t = add(p.url || "about:blank"); return reply({ targetId: t.targetId }); }
      case "Target.attachToTarget": {
        const t = targets.get(p.targetId);
        if (!t) return error(-32602, "No target with given id found");
        const s = id("S"); sessions.set(s, t.targetId); t.attached = true;
        return reply({ sessionId: s });
      }
      case "Target.activateTarget": return targets.has(p.targetId) ? reply({}) : error(-32602, "No target with given id found");
      case "Target.closeTarget": { const ok = targets.delete(p.targetId); return reply({ success: ok }); }
      case "Target.getTargetInfo": return reply({ targetInfo: { targetId: "browser", type: "browser", title: "", url: "", attached: true } });
      case "Browser.getVersion": return reply({ protocolVersion: "1.3", product: "Mock/1.0", revision: "1", userAgent: "Mock", jsVersion: "1" });
      default: return error(-32601, `'${msg.method}' wasn't found`);
    }
  }

  const server = Bun.serve({
    port,
    fetch(req, srv) {
      const u = new URL(req.url);
      if (u.pathname === "/json/version") return Response.json({ Browser: "Mock/1.0", webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/${wsId}` });
      if (u.pathname.startsWith("/json/close/")) { const tid = u.pathname.slice(12); return new Response(targets.delete(tid) ? "Target is closing" : "No such target id: " + tid, { status: 200 }); }
      if (u.pathname === "/ctl/drop") { for (const s of sockets) s.close(1011, "keepalive ping timeout"); return new Response("ok"); }
      if (u.pathname === "/ctl/relaunch") { for (const s of sockets) s.close(1006); wsId = "browser-" + Math.random().toString(16).slice(2, 10); sessions.clear(); return new Response(wsId); }
      if (u.pathname.startsWith("/ctl/freeze/")) { frozen.add(u.pathname.slice(12)); return new Response("ok"); }
      if (u.pathname === "/ctl/mute-pongs") { mutePongs = true; return new Response("ok"); }
      if (u.pathname === "/ctl/reset") { reset(); return new Response("ok"); }
      if (u.pathname.startsWith("/devtools/browser/")) {
        if (u.pathname.slice(18) !== wsId) return new Response("stale browser id", { status: 404 });
        if (srv.upgrade(req)) return undefined;
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      maxPayloadLength: 256 * 1024 * 1024,
      sendPings: false,
      open(ws) { sockets.add(ws); connections++; },
      close(ws) { sockets.delete(ws); },
      message(ws, m) { handle(ws, JSON.parse(String(m))); },
      ping(ws, data) { if (!mutePongs) ws.pong(data); },
    } as any,
  });
  return {
    server, port: server.port, targets, sessions, log, frozen,
    get connections() { return connections; },
    get wsUrl() { return `ws://127.0.0.1:${server.port}/devtools/browser/${wsId}`; },
    add, reset,
  };
}

const PNG_1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

if (import.meta.main) {
  const m = startMockBrowser(Number(process.env.PORT || 0));
  console.log(m.port);
}

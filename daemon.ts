// CDP WS holder + Unix socket relay. One daemon per BU_NAME. TypeScript since #1600; the Python original was removed in #1604.
//
// Same socket (/tmp/bu-<name>.sock), same one-line JSON protocol, same log/pid files, so the
// Python helpers and the TS helpers both work against it unchanged. What it adds:
// - Reconnect: when the browser WebSocket is found closed (dropped tunnel, keepalive timeout,
//   Helium relaunch), the next call reconnects, re-attaches to the same tab, and retries once.
//   A call that was already in flight when the socket died is NOT retried (it may have run,
//   e.g. a click on "Book"); it returns an error and the daemon is reconnected for the next call.
// - Keepalive: ping every 30s, drop only after 120s without a pong (python websockets used 20s/20s,
//   which killed the socket while Helium sat busy or idle behind the SSH tunnel).
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { connect as netConnect } from "node:net";

function loadEnv() {
  const p = join(dirname(import.meta.path), ".env");
  if (!existsSync(p)) return;
  for (let line of readFileSync(p, "utf8").split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim().replace(/^["']+|["']+$/g, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnv();

export const NAME = process.env.BU_NAME || "default";
export const SOCK = `/tmp/bu-${NAME}.sock`;
const LOG = `/tmp/bu-${NAME}.log`;
const PID = `/tmp/bu-${NAME}.pid`;
const BUF = 500;
const PING_INTERVAL = Number(process.env.BU_PING_INTERVAL || 30) * 1000;
const PING_TIMEOUT = Number(process.env.BU_PING_TIMEOUT || 120) * 1000;
const H = homedir();
const PROFILES = [
  "Library/Application Support/Google/Chrome",
  "Library/Application Support/Microsoft Edge",
  "Library/Application Support/Microsoft Edge Beta",
  "Library/Application Support/Microsoft Edge Dev",
  "Library/Application Support/Microsoft Edge Canary",
  ".config/google-chrome",
  ".config/chromium",
  ".config/chromium-browser",
  ".config/microsoft-edge",
  ".config/microsoft-edge-beta",
  ".config/microsoft-edge-dev",
  "AppData/Local/Google/Chrome/User Data",
  "AppData/Local/Chromium/User Data",
  "AppData/Local/Microsoft/Edge/User Data",
  "AppData/Local/Microsoft/Edge Beta/User Data",
  "AppData/Local/Microsoft/Edge Dev/User Data",
  "AppData/Local/Microsoft/Edge SxS/User Data",
].map((p) => join(H, p));
const INTERNAL = ["chrome://", "chrome-untrusted://", "devtools://", "chrome-extension://", "about:"];
const BU_API = "https://api.browser-use.com/api/v3";
const REMOTE_ID = process.env.BU_BROWSER_ID;
const API_KEY = process.env.BROWSER_USE_API_KEY;
const MARK_JS = "if(!document.title.startsWith('\u{1F7E2}'))document.title='\u{1F7E2} '+document.title";

function log(msg: string) {
  appendFileSync(LOG, `${msg}\n`);
}

// Keep numbers byte-exact when JS would change them (1.0, 1e3, ints past 2^53), so what reaches
// the browser and the caller is what was sent. Small ints stay plain numbers (ids, nodeIds).
export function parseExact(text: string): any {
  return JSON.parse(text, function (_k, v, ctx?: { source?: string }) {
    if (typeof v === "number" && ctx?.source !== undefined && String(v) !== ctx.source) {
      return (JSON as any).rawJSON(ctx.source);
    }
    return v;
  });
}

// str() of a Python value, for error strings that must read exactly like daemon.py's
// (cdp_use raised RuntimeError(error_dict), so callers saw the dict's repr).
export function pyRepr(v: any): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if ((JSON as any).isRawJSON?.(v)) return pyNum(JSON.stringify(v));
  if (typeof v === "number") return pyNum(String(v));
  if (typeof v === "string") return pyStr(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(", ")}]`;
  return `{${Object.entries(v).map(([k, x]) => `${pyStr(k)}: ${pyRepr(x)}`).join(", ")}}`;
}
function pyNum(src: string): string {
  if (/^-?\d+$/.test(src)) return BigInt(src).toString();
  const n = Number(src);
  if (!Number.isFinite(n)) return n > 0 ? "inf" : n < 0 ? "-inf" : "nan";
  if (Object.is(n, -0)) return "-0.0";
  const [mant, expS] = n.toExponential().split("e");
  const exp = Number(expS);
  if (exp < -4 || exp >= 16) {
    return `${mant}e${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  const digits = mant.replace("-", "").replace(".", "");
  const neg = n < 0 ? "-" : "";
  let s: string;
  if (exp >= 0) {
    s = digits.length > exp + 1 ? `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}` : `${digits.padEnd(exp + 1, "0")}.0`;
  } else {
    s = `0.${"0".repeat(-exp - 1)}${digits}`;
  }
  return neg + s;
}
function pyStr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += "\\" + q;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (c < 0x20 || c === 0x7f) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + q;
}

async function getWsUrl(): Promise<string> {
  const url = process.env.BU_CDP_WS;
  if (url) {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const base = url.replace(/\/+$/, "");
      const r = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(5000) });
      return (await r.json()).webSocketDebuggerUrl;
    }
    return url;
  }
  for (const base of PROFILES) {
    let txt: string;
    try {
      txt = readFileSync(join(base, "DevToolsActivePort"), "utf8");
    } catch {
      continue;
    }
    const [portRaw, ...rest] = txt.trim().split("\n");
    const port = portRaw.trim();
    const path = rest.join("\n").trim();
    const deadline = Date.now() + 30_000;
    while (!(await tcpProbe(Number(port)))) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Chrome's remote-debugging page is open, but DevTools is not live yet on 127.0.0.1:${port} — if Chrome opened a profile picker, choose your normal profile first, then tick the checkbox and click Allow if shown`,
        );
      }
      await Bun.sleep(1000);
    }
    return `ws://127.0.0.1:${port}${path}`;
  }
  throw new Error(
    `DevToolsActivePort not found in ${pyRepr(PROFILES)} — enable chrome://inspect/#remote-debugging, or set BU_CDP_WS for a remote browser`,
  );
}

function tcpProbe(port: number): Promise<boolean> {
  return new Promise((res) => {
    const s = netConnect({ host: "127.0.0.1", port });
    const t = setTimeout(() => (s.destroy(), res(false)), 1000);
    s.once("connect", () => (clearTimeout(t), s.destroy(), res(true)));
    s.once("error", () => (clearTimeout(t), res(false)));
  });
}

async function stopRemote() {
  if (!REMOTE_ID || !API_KEY) return;
  try {
    await fetch(`${BU_API}/browsers/${REMOTE_ID}`, {
      method: "PATCH",
      body: JSON.stringify({ action: "stop" }),
      headers: { "X-Browser-Use-API-Key": API_KEY, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    log(`stopped remote browser ${REMOTE_ID}`);
  } catch (e: any) {
    log(`stop_remote failed (${REMOTE_ID}): ${e?.message ?? e}`);
  }
}

const isRealPage = (t: any) => t.type === "page" && !INTERNAL.some((p) => (t.url || "").startsWith(p));

/** Thrown when the request never reached the browser: safe to reconnect and retry. */
class NotSent extends Error {}
/** Thrown when the socket died while the request was in flight: it may have run. */
class InFlightClosed extends Error {}

class CDP {
  ws: WebSocket | null = null;
  private id = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private awaitingPongSince: number | null = null;
  onEvent: (method: string, params: any, sessionId: string | null) => void = () => {};
  onClose: (why: string) => void = () => {};

  async start(url: string) {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.onopen = () => res();
      ws.onerror = (e: any) => rej(new Error(e?.message || "WebSocket error"));
      ws.onclose = (e) => rej(new Error(`closed during handshake (${e.code} ${e.reason})`));
    });
    this.ws = ws;
    ws.onerror = () => {};
    ws.onclose = (e) => this.closed(`WebSocket closed (${e.code} ${e.reason || "no reason"})`);
    ws.onmessage = (m) => this.message(typeof m.data === "string" ? m.data : Buffer.from(m.data as ArrayBuffer).toString("utf8"));
    ws.addEventListener("pong", () => (this.awaitingPongSince = null));
    this.pingTimer = setInterval(() => this.keepalive(), PING_INTERVAL);
  }

  get alive() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  private keepalive() {
    if (!this.alive) return;
    if (this.awaitingPongSince !== null) {
      if (Date.now() - this.awaitingPongSince >= PING_TIMEOUT) {
        log(`keepalive ping timeout (${PING_TIMEOUT / 1000}s without pong), dropping socket`);
        const ws = this.ws!;
        this.closed("keepalive ping timeout");
        try { ws.close(1011, "keepalive ping timeout"); } catch {}
      }
      return;
    }
    this.awaitingPongSince = Date.now();
    try { (this.ws as any).ping(); } catch {}
  }

  private closed(why: string) {
    if (!this.ws) return;
    this.ws = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.awaitingPongSince = null;
    for (const p of this.pending.values()) p.rej(new InFlightClosed("WebSocket connection closed"));
    this.pending.clear();
    this.onClose(why);
  }

  stop() {
    const ws = this.ws;
    this.closed("stopped");
    try { ws?.close(); } catch {}
  }

  private message(raw: string) {
    let data: any;
    try { data = parseExact(raw); } catch (e: any) { log(`bad CDP message: ${e?.message}`); return; }
    if (typeof data.id === "number" && this.pending.has(data.id)) {
      const p = this.pending.get(data.id)!;
      this.pending.delete(data.id);
      if ("error" in data) p.rej(new Error(pyRepr(data.error)));
      else p.res(data.result);
    } else if ("method" in data) {
      this.onEvent(data.method, data.params ?? {}, data.sessionId ?? null);
    }
  }

  send(method: string, params?: any, sessionId?: string | null): Promise<any> {
    if (!this.alive) return Promise.reject(new NotSent("WebSocket connection closed"));
    const id = ++this.id;
    const msg: any = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      try {
        this.ws!.send(JSON.stringify(msg));
      } catch (e: any) {
        this.pending.delete(id);
        rej(new NotSent(e?.message || "send failed"));
      }
    });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout")), ms);
    p.then((v) => (clearTimeout(t), res(v)), (e) => (clearTimeout(t), rej(e)));
  });
}

export class Daemon {
  cdp: CDP | null = null;
  session: string | null = null;
  target: string | null = null; // targetId behind this.session, so a reconnect lands on the same tab
  events: any[] = [];
  dialog: any = null;
  created = new Set<string>(); // blank tabs this daemon made; closed on shutdown if still blank (#1376)
  private sessionTargets = new Map<string, string>(); // sessionId -> targetId, from attachToTarget
  private remap = new Map<string, string>(); // pre-reconnect sessionId -> new sessionId
  private reconnecting: Promise<void> | null = null;
  stopped!: Promise<void>;
  private stopNow!: () => void;
  wsUrl = "";

  private pushEvent(e: any) {
    this.events.push(e);
    if (this.events.length > BUF) this.events.splice(0, this.events.length - BUF);
  }

  private async connect() {
    const url = await getWsUrl();
    this.wsUrl = url;
    log(`connecting to ${url}`);
    const cdp = new CDP();
    try {
      await cdp.start(url);
    } catch (e: any) {
      throw new Error(`CDP WS handshake failed: ${e?.message ?? e} -- click Allow in Chrome if prompted, then retry`);
    }
    cdp.onEvent = (method, params, sessionId) => {
      this.pushEvent({ method, params, session_id: sessionId });
      if (method === "Page.javascriptDialogOpening") this.dialog = params;
      else if (method === "Page.javascriptDialogClosed") this.dialog = null;
      else if (method === "Page.loadEventFired" || method === "Page.domContentEventFired") {
        withTimeout(cdp.send("Runtime.evaluate", { expression: MARK_JS }, this.session), 2000).catch(() => {});
      }
    };
    cdp.onClose = (why) => log(`browser socket lost: ${why}; will reconnect on next call`);
    this.cdp = cdp;
  }

  async start() {
    this.stopped = new Promise((r) => (this.stopNow = r));
    await this.connect();
    await this.attachFirstPage();
  }

  /** Attach to a real page (or any page). Sets this.session. Returns attached target or null. */
  async attachFirstPage(): Promise<any> {
    const cdp = this.cdp!;
    const targets = (await cdp.send("Target.getTargets")).targetInfos;
    let pages = targets.filter(isRealPage);
    if (!pages.length) {
      const tid = (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;
      log(`no real pages found, created about:blank (${tid})`);
      this.created.add(tid);
      pages = [{ targetId: tid, url: "about:blank", type: "page" }];
    }
    let page = pages[0];
    if (!(await this.attach(page))) {
      // Memory Saver (Helium) freezes background tabs; domains on a frozen tab never answer.
      // Fall back to a blank tab instead of hanging every later call. Reuse one that's already
      // open first: a fresh one per attach left 14 blank tabs behind on Oct 27 (#1376).
      const blanks = targets.filter((t: any) => t.type === "page" && t.url === "about:blank" && t.targetId !== page.targetId);
      for (const b of blanks) {
        if (await this.attach(b)) {
          log(`first page unresponsive, reused about:blank (${b.targetId})`);
          return b;
        }
      }
      const tid = (await cdp.send("Target.createTarget", { url: "about:blank" })).targetId;
      log(`first page unresponsive, created about:blank (${tid})`);
      this.created.add(tid);
      page = { targetId: tid, url: "about:blank", type: "page" };
      await this.attach(page);
    }
    return page;
  }

  async closeCreated() {
    if (!this.created.size || !this.cdp?.alive) return;
    try {
      const infos = (await this.cdp.send("Target.getTargets")).targetInfos;
      for (const t of infos) {
        if (this.created.has(t.targetId) && t.url === "about:blank") {
          await withTimeout(this.cdp.send("Target.closeTarget", { targetId: t.targetId }), 3000);
          log(`closed own blank tab ${t.targetId}`);
        }
      }
    } catch (e: any) {
      log(`close_created failed: ${e?.message ?? e}`);
    }
  }

  /** Attach to page and enable domains. Returns false if the tab never answered. */
  async attach(page: any): Promise<boolean> {
    const cdp = this.cdp!;
    this.session = (await cdp.send("Target.attachToTarget", { targetId: page.targetId, flatten: true })).sessionId;
    this.target = page.targetId;
    this.sessionTargets.set(this.session!, page.targetId);
    log(`attached ${page.targetId} (${(page.url || "").slice(0, 80)}) session=${this.session}`);
    for (const d of ["Page", "DOM", "Runtime", "Network"]) {
      try {
        await withTimeout(cdp.send(`${d}.enable`, {}, this.session), 5000);
      } catch (e: any) {
        if (e?.message === "timeout") {
          log(`enable ${d}: timed out`);
          return false;
        }
        log(`enable ${d}: ${e?.message ?? e}`);
      }
    }
    return true;
  }

  /** New browser socket, back on the same tab. One reconnect at a time. */
  reconnect(): Promise<void> {
    if (!this.reconnecting) {
      this.reconnecting = (async () => {
        const oldSession = this.session;
        const oldTarget = this.target;
        const oldSessions = new Map(this.sessionTargets);
        try { this.cdp?.stop(); } catch {}
        this.cdp = null;
        log(`reconnecting (session=${oldSession}, target=${oldTarget})`);
        await this.connect();
        this.sessionTargets.clear();
        this.remap.clear();
        const infos = (await this.cdp!.send("Target.getTargets")).targetInfos;
        const same = oldTarget && infos.find((t: any) => t.targetId === oldTarget);
        if (!(same && (await this.attach(same)))) {
          log(`tab ${oldTarget} ${same ? "unresponsive" : "gone"} after reconnect, attaching first page`);
          await this.attachFirstPage();
        }
        if (oldSession && this.session) this.remap.set(oldSession, this.session);
        // Sessions a caller attached itself (iframes, other tabs) come back on first use.
        for (const [sid, tid] of oldSessions) if (sid !== oldSession) this.remap.set(sid, `pending:${tid}`);
        log(`reconnected: session=${this.session} target=${this.target}`);
      })().finally(() => (this.reconnecting = null));
    }
    return this.reconnecting;
  }

  private async resolveSid(sid: string | null): Promise<string | null> {
    if (!sid) return sid;
    const m = this.remap.get(sid);
    if (!m) return sid;
    if (!m.startsWith("pending:")) return m;
    const tid = m.slice(8);
    try {
      const ns = (await this.cdp!.send("Target.attachToTarget", { targetId: tid, flatten: true })).sessionId;
      this.sessionTargets.set(ns, tid);
      this.remap.set(sid, ns);
      log(`re-attached caller session ${sid} -> ${ns} (${tid})`);
      return ns;
    } catch {
      return sid;
    }
  }

  private async sendCdp(method: string, params: any, sid: string | null) {
    const r = await this.cdp!.send(method, params, await this.resolveSid(sid));
    if (method === "Target.attachToTarget" && r?.sessionId && params?.targetId) this.sessionTargets.set(r.sessionId, params.targetId);
    return r;
  }

  async handle(req: any): Promise<any> {
    const meta = req.meta;
    if (meta === "drain_events") {
      const out = this.events;
      this.events = [];
      return { events: out };
    }
    if (meta === "session") return { session_id: this.session };
    if (meta === "set_session") {
      this.session = req.session_id ?? null;
      this.target = (this.session && this.sessionTargets.get(this.session)) || this.target;
      try {
        await withTimeout(this.cdp!.send("Page.enable", {}, this.session), 3000);
        await withTimeout(this.cdp!.send("Runtime.evaluate", { expression: MARK_JS }, this.session), 2000);
      } catch {}
      return { session_id: this.session };
    }
    if (meta === "pending_dialog") return { dialog: this.dialog };
    if (meta === "shutdown") {
      this.stopNow();
      return { ok: true };
    }
    if (!("method" in req)) throw new Error("'method'");

    const method: string = req.method;
    const params = req.params || {};
    // Browser-level Target.* calls must not use a session (stale or otherwise).
    // For everything else, explicit session in req wins; else default.
    const sidOf = () => (method.startsWith("Target.") ? null : req.session_id || this.session);
    let sid = sidOf();
    if (this.reconnecting) await this.reconnecting.catch(() => {});
    try {
      if (!this.cdp?.alive) throw new NotSent("WebSocket connection closed");
      return { result: await this.sendCdp(method, params, sid) };
    } catch (e: any) {
      if (e instanceof NotSent) {
        // The call never left: reconnect and run it once.
        try {
          await this.reconnect();
        } catch (re: any) {
          log(`reconnect failed: ${re?.message ?? re}`);
          return { error: `WebSocket connection closed; reconnect failed: ${re?.message ?? re}` };
        }
        sid = sidOf();
        try {
          return { result: await this.sendCdp(method, params, sid) };
        } catch (e2: any) {
          return { error: e2?.message ?? String(e2) };
        }
      }
      if (e instanceof InFlightClosed) {
        // It may have run in the browser, so never repeat it. Reconnect now for the next call.
        this.reconnect().catch((re) => log(`reconnect failed: ${re?.message ?? re}`));
        return { error: e.message };
      }
      const msg = e?.message ?? String(e);
      if (msg.includes("Session with given id not found") && sid === this.session && sid) {
        log(`stale session ${sid}, re-attaching`);
        if (await this.attachFirstPage()) return { result: await this.sendCdp(method, params, this.session) };
      }
      return { error: msg };
    }
  }
}

export async function serve(d: Daemon) {
  if (existsSync(SOCK)) unlinkSync(SOCK);
  const server = Bun.listen<{ buf: string; done: boolean; drain?: () => void }>({
    unix: SOCK,
    socket: {
      open(s) {
        s.data = { buf: "", done: false };
      },
      drain(s) {
        s.data.drain?.();
      },
      async data(s, chunk) {
        if (s.data.done) return;
        s.data.buf += Buffer.from(chunk).toString("utf8");
        const nl = s.data.buf.indexOf("\n");
        if (nl < 0) return;
        s.data.done = true;
        const line = s.data.buf.slice(0, nl);
        let resp: any;
        try {
          resp = await d.handle(parseExact(line));
        } catch (e: any) {
          log(`conn: ${e?.message ?? e}`);
          resp = { error: e?.message ?? String(e) };
        }
        writeAll(s, JSON.stringify(resp) + "\n");
      },
    },
  });
  chmodSync(SOCK, 0o600);
  log(`listening on ${SOCK} (name=${NAME}, remote=${REMOTE_ID || "local"})`);
  await d.stopped;
  server.stop(true);
  try { unlinkSync(SOCK); } catch {}
}

// Bun socket writes can be partial; keep writing on drain, then close.
function writeAll(s: any, text: string) {
  let buf = Buffer.from(text, "utf8");
  const flush = () => {
    while (buf.length) {
      const n = s.write(buf);
      if (n <= 0) return false;
      buf = buf.subarray(n);
    }
    return true;
  };
  if (flush()) s.end();
  else s.data.drain = () => flush() && s.end();
}

function alreadyRunning(): Promise<boolean> {
  return new Promise((res) => {
    const c = netConnect({ path: SOCK });
    const t = setTimeout(() => (c.destroy(), res(false)), 1000);
    c.once("connect", () => (clearTimeout(t), c.destroy(), res(true)));
    c.once("error", () => (clearTimeout(t), res(false)));
  });
}

async function main() {
  if (await alreadyRunning()) {
    console.error(`daemon already running on ${SOCK}`);
    process.exit(0);
  }
  writeFileSync(LOG, "");
  writeFileSync(PID, String(process.pid));
  let code = 0;
  const d = new Daemon();
  try {
    await d.start();
    try {
      await serve(d);
    } finally {
      await d.closeCreated();
    }
  } catch (e: any) {
    log(`fatal: ${e?.message ?? e}`);
    code = 1;
  } finally {
    await stopRemote();
    try { unlinkSync(PID); } catch {}
  }
  d.cdp?.stop();
  process.exit(code);
}

if (import.meta.main) {
  process.on("SIGINT", () => process.exit(0));
  main();
}

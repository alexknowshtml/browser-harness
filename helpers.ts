// Browser control via CDP. TypeScript since #1600; the Python original was removed in #1604. Read, edit, extend -- this file is yours.
// Same names as the Python helpers (snake_case kept so snippets translate 1:1); every call is async.
import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const HERE = dirname(import.meta.path);
function loadEnv() {
  const p = join(HERE, ".env");
  if (!existsSync(p)) return;
  for (let line of readFileSync(p, "utf8").split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (process.env[k] === undefined) process.env[k] = line.slice(i + 1).trim().replace(/^["']+|["']+$/g, "");
  }
}
loadEnv();

export const NAME = process.env.BU_NAME || "default";
export const SOCK = `/tmp/bu-${NAME}.sock`;
export const INTERNAL = ["chrome://", "chrome-untrusted://", "devtools://", "chrome-extension://", "about:"];
const isInternal = (u: string) => INTERNAL.some((p) => u.startsWith(p));

export function _send(req: any): Promise<any> {
  return new Promise((res, rej) => {
    const s = connect({ path: SOCK });
    const chunks: Buffer[] = [];
    s.on("connect", () => s.write(JSON.stringify(req) + "\n"));
    s.on("data", (d: Buffer) => chunks.push(d));
    s.on("error", rej);
    s.on("end", () => {
      let r: any;
      try {
        r = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch (e) {
        return rej(e);
      }
      if ("error" in r) return rej(new Error(r.error));
      res(r);
    });
  });
}

/** Raw CDP. cdp('Page.navigate', {url}), cdp('DOM.getDocument', {depth: -1}). */
export async function cdp(method: string, params: Record<string, any> = {}, session_id: string | null = null): Promise<any> {
  return (await _send({ method, params, session_id })).result ?? {};
}

export async function drain_events(): Promise<any[]> {
  return (await _send({ meta: "drain_events" })).events;
}

// --- navigation / page ---
export async function goto(url: string): Promise<any> {
  const r = await cdp("Page.navigate", { url });
  let host = "";
  try { host = new URL(url).hostname; } catch {}
  const d = join(HERE, "domain-skills", host.replace(/^www\./, "").split(".")[0]);
  if (existsSync(d) && statSync(d).isDirectory()) {
    const names = mdFiles(d).map((p) => p.split("/").pop()!).sort().slice(0, 10);
    return { ...r, domain_skills: names };
  }
  return r;
}
function mdFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...mdFiles(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** {url, title, w, h, sx, sy, pw, ph}. If a native dialog is open, returns {dialog} instead. */
export async function page_info(): Promise<any> {
  const dialog = (await _send({ meta: "pending_dialog" })).dialog;
  if (dialog) return { dialog };
  const r = await cdp("Runtime.evaluate", {
    expression:
      "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})",
    returnByValue: true,
  });
  return JSON.parse(r.result.value);
}

// --- input ---
export async function click(x: number, y: number, button = "left", clicks = 1) {
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: clicks });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: clicks });
}

export async function type_text(text: string) {
  await cdp("Input.insertText", { text });
}

const _KEYS: Record<string, [number, string, string]> = {
  Enter: [13, "Enter", "\r"], Tab: [9, "Tab", "\t"], Backspace: [8, "Backspace", ""],
  Escape: [27, "Escape", ""], Delete: [46, "Delete", ""], " ": [32, "Space", " "],
  ArrowLeft: [37, "ArrowLeft", ""], ArrowUp: [38, "ArrowUp", ""],
  ArrowRight: [39, "ArrowRight", ""], ArrowDown: [40, "ArrowDown", ""],
  Home: [36, "Home", ""], End: [35, "End", ""],
  PageUp: [33, "PageUp", ""], PageDown: [34, "PageDown", ""],
};
const pyOrd = (s: string) => s.codePointAt(0)!;
const pyLen = (s: string) => [...s].length;

/** Modifiers bitfield: 1=Alt, 2=Ctrl, 4=Meta(Cmd), 8=Shift. */
export async function press_key(key: string, modifiers = 0) {
  const [vk, code, text] = _KEYS[key] ?? [pyLen(key) === 1 ? pyOrd(key) : 0, key, pyLen(key) === 1 ? key : ""];
  const base = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(text ? { text } : {}) });
  if (text && pyLen(text) === 1) await cdp("Input.dispatchKeyEvent", { type: "char", text, ...base });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

export async function scroll(x: number, y: number, dy = -300, dx = 0) {
  await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy });
}

// --- visual ---
export async function screenshot(path = "/tmp/shot.png", full = false, max_dim = 1568): Promise<string> {
  const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  const raw = Buffer.from(r.data, "base64");
  writeFileSync(path, raw);
  try {
    const w = raw.readUInt32BE(16), h = raw.readUInt32BE(20);
    if (Math.max(w, h) > max_dim) {
      const tmp = path + ".resize.png";
      const p = spawnSync("ffmpeg", ["-y", "-i", path, "-vf", `scale=${max_dim}:${max_dim}:force_original_aspect_ratio=decrease`, tmp]);
      if (p.status === 0) renameSync(tmp, path);
    }
  } catch {}
  return path;
}

// --- tabs ---
export async function list_tabs(include_chrome = true) {
  const out: any[] = [];
  for (const t of (await cdp("Target.getTargets")).targetInfos) {
    if (t.type !== "page") continue;
    const url = t.url ?? "";
    if (!include_chrome && isInternal(url)) continue;
    out.push({ targetId: t.targetId, title: t.title ?? "", url });
  }
  return out;
}

export async function current_tab() {
  const t = (await cdp("Target.getTargetInfo")).targetInfo ?? {};
  return { targetId: t.targetId ?? null, url: t.url ?? "", title: t.title ?? "" };
}

/** Prepend 🟢 to tab title so the user can see which tab the agent controls. */
async function _mark_tab() {
  try { await cdp("Runtime.evaluate", { expression: "if(!document.title.startsWith('\u{1F7E2}'))document.title='\u{1F7E2} '+document.title" }); } catch {}
}

export async function switch_tab(target_id: string): Promise<string> {
  try { await cdp("Runtime.evaluate", { expression: "if(document.title.startsWith('\u{1F7E2} '))document.title=document.title.slice(2)" }); } catch {}
  await cdp("Target.activateTarget", { targetId: target_id });
  const sid = (await cdp("Target.attachToTarget", { targetId: target_id, flatten: true })).sessionId;
  await _send({ meta: "set_session", session_id: sid });
  await _mark_tab();
  return sid;
}

export async function new_tab(url = "about:blank"): Promise<string> {
  // Always create blank, then goto: passing url to createTarget races with attach.
  const tid = (await cdp("Target.createTarget", { url: "about:blank" })).targetId;
  await switch_tab(tid);
  if (url !== "about:blank") await goto(url);
  return tid;
}

/** Close a tab by id via CDP's HTTP endpoint (Target.closeTarget can refuse from inside the harness). */
export async function close_tab(target_id: string) {
  const base = (process.env.BU_CDP_WS || "http://127.0.0.1:9222").replace("ws://", "http://").split("/devtools")[0];
  try { await (await fetch(`${base}/json/close/${target_id}`, { signal: AbortSignal.timeout(10_000) })).arrayBuffer(); } catch {}
}

/** Open a tab for one job and close it afterwards, even on errors (#1376).
 *    await temp_tab("https://example.com", async (tid) => { console.log(await page_info()) }) */
export async function temp_tab<T>(url: string, fn: (tid: string) => Promise<T>): Promise<T> {
  const tid = await new_tab(url);
  try {
    return await fn(tid);
  } finally {
    await close_tab(tid);
  }
}

/** Switch to a real user tab if current is chrome:// / internal / stale. */
export async function ensure_real_tab() {
  const tabs = await list_tabs(false);
  if (!tabs.length) return null;
  try {
    const cur = await current_tab();
    if (cur.url && !isInternal(cur.url)) return cur;
  } catch {}
  await switch_tab(tabs[0].targetId);
  return tabs[0];
}

/** First iframe target whose URL contains `url_substr`. Use with js(expr, target_id). */
export async function iframe_target(url_substr: string): Promise<string | null> {
  for (const t of (await cdp("Target.getTargets")).targetInfos) {
    if (t.type === "iframe" && (t.url ?? "").includes(url_substr)) return t.targetId;
  }
  return null;
}

// --- utility ---
export const wait = (seconds = 1.0) => Bun.sleep(seconds * 1000);

/** Poll document.readyState == 'complete' or timeout. */
export async function wait_for_load(timeout = 15.0): Promise<boolean> {
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    if ((await js("document.readyState")) === "complete") return true;
    await Bun.sleep(300);
  }
  return false;
}

/** Run JS in the attached tab (default) or inside an iframe target (via iframe_target()). */
export async function js(expression: string, target_id: string | null = null): Promise<any> {
  const sid = target_id ? (await cdp("Target.attachToTarget", { targetId: target_id, flatten: true })).sessionId : null;
  const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
  return r.result?.value ?? null;
}

const _KC: Record<string, number> = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, " ": 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };

// Python json.dumps (ensure_ascii) so the JS source is byte-identical to helpers.py.
const pyJson = (s: string) => JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

/** Dispatch a DOM KeyboardEvent on the matched element. */
export async function dispatch_key(selector: string, key = "Enter", event = "keypress") {
  const kc = _KC[key] ?? (pyLen(key) === 1 ? pyOrd(key) : 0);
  await js(
    `(()=>{const e=document.querySelector(${pyJson(selector)});if(e){e.focus();e.dispatchEvent(new KeyboardEvent(${pyJson(event)},{key:${pyJson(key)},code:${pyJson(key)},keyCode:${kc},which:${kc},bubbles:true}));}})()`,
  );
}

/** Set files on a file input via CDP DOM.setFileInputFiles. `path` is an absolute filepath (or a list). */
export async function upload_file(selector: string, path: string | string[]) {
  const doc = await cdp("DOM.getDocument", { depth: -1 });
  const nid = (await cdp("DOM.querySelector", { nodeId: doc.root.nodeId, selector })).nodeId;
  if (!nid) throw new Error(`no element for ${selector}`);
  await cdp("DOM.setFileInputFiles", { files: typeof path === "string" ? [path] : [...path], nodeId: nid });
}

/** Pure HTTP — no browser. Use for static pages / APIs. Promise.all for bulk. */
export async function http_get(url: string, headers: Record<string, string> | null = null, timeout = 20.0): Promise<string> {
  const h: Record<string, string> = { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip", ...(headers ?? {}) };
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(timeout * 1000), decompress: false } as any);
  if (!r.ok) throw new Error(`HTTP Error ${r.status}: ${r.statusText}`);
  let data = Buffer.from(await r.arrayBuffer());
  if (r.headers.get("Content-Encoding") === "gzip") data = gunzipSync(data);
  return data.toString("utf8");
}

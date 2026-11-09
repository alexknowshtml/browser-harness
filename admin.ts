// Daemon lifecycle + Browser Use cloud helpers. TypeScript since #1600; the Python original was removed in #1604.
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { connect } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { NAME } from "./helpers";

const HERE = dirname(import.meta.path);
const BU_API = "https://api.browser-use.com/api/v3";

function _paths(name?: string | null): [string, string] {
  const n = name || NAME;
  return [`/tmp/bu-${n}.sock`, `/tmp/bu-${n}.pid`];
}

function _log_tail(name?: string | null): string | null {
  try {
    const lines = readFileSync(`/tmp/bu-${name || NAME}.log`, "utf8").trim().split("\n");
    return lines[lines.length - 1] || null;
  } catch {
    return null;
  }
}

export function daemon_alive(name?: string | null): Promise<boolean> {
  return new Promise((res) => {
    const s = connect({ path: _paths(name)[0] });
    const t = setTimeout(() => (s.destroy(), res(false)), 1000);
    s.once("connect", () => (clearTimeout(t), s.destroy(), res(true)));
    s.once("error", () => (clearTimeout(t), res(false)));
  });
}

/** Idempotent. `env` is merged into the child process env. Starts the TS daemon (daemon.ts). */
export async function ensure_daemon(wait = 60.0, name: string | null = null, env: Record<string, string> | null = null) {
  if (await daemon_alive(name)) return;
  const e = { ...process.env, ...(name ? { BU_NAME: name } : {}), ...(env ?? {}) };
  const p = spawn(process.execPath, [join(HERE, "daemon.ts")], { cwd: HERE, env: e, stdio: "ignore", detached: true });
  p.unref();
  let exited = false;
  p.on("exit", () => (exited = true));
  const deadline = Date.now() + wait * 1000;
  while (Date.now() < deadline) {
    if (await daemon_alive(name)) return;
    if (exited) break;
    await Bun.sleep(200);
  }
  throw new Error(_log_tail(name) || `daemon ${name || NAME} didn't come up -- check /tmp/bu-${name || NAME}.log`);
}

/** Stop a remote daemon and its backing Browser Use cloud browser. */
export async function stop_remote_daemon(name = "remote") {
  await restart_daemon(name);
}

/** Best-effort daemon shutdown + socket/pid cleanup. Name is historical: it only stops. */
export async function restart_daemon(name: string | null = null) {
  const [sock, pidPath] = _paths(name);
  await new Promise<void>((res) => {
    const s = connect({ path: sock });
    const t = setTimeout(() => (s.destroy(), res()), 5000);
    s.once("connect", () => s.write('{"meta":"shutdown"}\n'));
    s.once("data", () => (clearTimeout(t), s.destroy(), res()));
    s.once("error", () => (clearTimeout(t), res()));
    s.once("close", () => (clearTimeout(t), res()));
  });
  let pid: number | null = null;
  try {
    pid = parseInt(readFileSync(pidPath, "utf8"), 10);
    if (Number.isNaN(pid)) pid = null;
  } catch {}
  if (pid) {
    let gone = false;
    for (let i = 0; i < 75; i++) {
      try {
        process.kill(pid, 0);
        await Bun.sleep(200);
      } catch {
        gone = true;
        break;
      }
    }
    if (!gone) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
  }
  for (const f of [sock, pidPath]) {
    try { unlinkSync(f); } catch {}
  }
}

async function _browser_use(path: string, method: string, body?: any): Promise<any> {
  const key = process.env.BROWSER_USE_API_KEY;
  if (!key) throw new Error("BROWSER_USE_API_KEY missing -- see .env.example");
  const r = await fetch(`${BU_API}${path}`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "X-Browser-Use-API-Key": key, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`HTTP Error ${r.status}: ${r.statusText}`);
  const t = await r.text();
  return JSON.parse(t || "{}");
}

async function _cdp_ws_from_url(cdp_url: string): Promise<string> {
  const r = await fetch(`${cdp_url}/json/version`, { signal: AbortSignal.timeout(15_000) });
  return (await r.json()).webSocketDebuggerUrl;
}

function _has_local_gui() {
  if (process.platform === "darwin" || process.platform === "win32") return true;
  if (process.platform === "linux") return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
  return false;
}

function _show_live_url(url?: string) {
  if (!url) return;
  console.log(url);
  if (!_has_local_gui()) {
    console.error("(no local GUI — share the liveUrl with the user)");
    return;
  }
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const r = spawnSync(opener, [url], { stdio: "ignore" });
  if (r.status === 0) console.error("(opened liveUrl in your default browser)");
  else console.error(`(couldn't auto-open: ${r.error?.message ?? r.status} — share the liveUrl with the user)`);
}

/** List cloud profiles under the current API key. Paginates (API caps pageSize at 100). */
export async function list_cloud_profiles() {
  const out: any[] = [];
  let page = 1;
  while (true) {
    const listing = await _browser_use(`/profiles?pageSize=100&pageNumber=${page}`, "GET");
    const items = Array.isArray(listing) ? listing : listing.items;
    if (!items || !items.length) break;
    for (const p of items) {
      const d = await _browser_use(`/profiles/${p.id}`, "GET");
      out.push({ id: d.id, name: d.name ?? null, userId: d.userId ?? null, cookieDomains: d.cookieDomains || [], lastUsedAt: d.lastUsedAt ?? null });
    }
    if (!Array.isArray(listing) && out.length >= (listing.totalItems ?? out.length)) break;
    page++;
  }
  return out;
}

async function _resolve_profile_name(profile_name: string): Promise<string> {
  const m = (await list_cloud_profiles()).filter((p) => p.name === profile_name);
  if (!m.length) throw new Error(`no cloud profile named '${profile_name}' -- call list_cloud_profiles() or sync_local_profile() first`);
  if (m.length > 1) throw new Error(`${m.length} cloud profiles named '${profile_name}' -- pass profileId=<uuid> instead`);
  return m[0].id;
}

/** Provision a Browser Use cloud browser and start a daemon attached to it. */
export async function start_remote_daemon(name = "remote", opts: { profileName?: string; [k: string]: any } = {}) {
  const { profileName, ...create } = opts;
  if (await daemon_alive(name)) throw new Error(`daemon '${name}' already alive -- restart_daemon('${name}') first`);
  if (profileName) {
    if ("profileId" in create) throw new Error("pass profileName OR profileId, not both");
    create.profileId = await _resolve_profile_name(profileName);
  }
  const browser = await _browser_use("/browsers", "POST", create);
  await ensure_daemon(60, name, { BU_CDP_WS: await _cdp_ws_from_url(browser.cdpUrl), BU_BROWSER_ID: browser.id });
  _show_live_url(browser.liveUrl);
  return browser;
}

function which(cmd: string) {
  return spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
}

/** Detected local browser profiles. Shells out to `profile-use list --json`. */
export function list_local_profiles() {
  if (!which("profile-use")) throw new Error("profile-use not installed -- curl -fsSL https://browser-use.com/profile.sh | sh");
  const r = spawnSync("profile-use", ["list", "--json"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`profile-use list failed (exit ${r.status})`);
  return JSON.parse(r.stdout);
}

/** Sync a local profile's cookies to a cloud profile. Returns the cloud UUID. */
export function sync_local_profile(
  profile_name: string,
  o: { browser?: string; cloud_profile_id?: string; include_domains?: string[]; exclude_domains?: string[] } = {},
) {
  if (!which("profile-use")) throw new Error("profile-use not installed -- curl -fsSL https://browser-use.com/profile.sh | sh");
  if (!process.env.BROWSER_USE_API_KEY) throw new Error("BROWSER_USE_API_KEY missing");
  const cmd = ["sync", "--profile", profile_name];
  if (o.browser) cmd.push("--browser", o.browser);
  if (o.cloud_profile_id) cmd.push("--cloud-profile-id", o.cloud_profile_id);
  for (const d of o.include_domains ?? []) cmd.push("--domain", d);
  for (const d of o.exclude_domains ?? []) cmd.push("--exclude-domain", d);
  const r = spawnSync("profile-use", cmd, { encoding: "utf8" });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (r.status !== 0) throw new Error(`profile-use sync failed (exit ${r.status})`);
  if (o.cloud_profile_id) return o.cloud_profile_id;
  const m = /Profile created:\s+([0-9a-f-]{36})/.exec(r.stdout);
  if (!m) throw new Error(`profile-use did not report a profile UUID (exit ${r.status})`);
  return m[1];
}

"""Browser control via CDP. Read, edit, extend -- this file is yours."""
import base64, json, os, socket, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse, quote as urllib_quote
import urllib.parse


def _load_env():
    p = Path(__file__).parent / ".env"
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env()

NAME = os.environ.get("BU_NAME", "default")
SOCK = f"/tmp/bu-{NAME}.sock"
INTERNAL = ("chrome://", "chrome-untrusted://", "devtools://", "chrome-extension://", "about:")


def _send(req):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect(SOCK)
    s.sendall((json.dumps(req) + "\n").encode())
    data = b""
    while not data.endswith(b"\n"):
        chunk = s.recv(1 << 20)
        if not chunk: break
        data += chunk
    s.close()
    r = json.loads(data)
    if "error" in r: raise RuntimeError(r["error"])
    return r


def cdp(method, session_id=None, **params):
    """Raw CDP. cdp('Page.navigate', url='...'), cdp('DOM.getDocument', depth=-1)."""
    return _send({"method": method, "params": params, "session_id": session_id}).get("result", {})


def drain_events():  return _send({"meta": "drain_events"})["events"]


# --- navigation / page ---
def goto(url):
    r = cdp("Page.navigate", url=url)
    d = (Path(__file__).parent / "domain-skills" / (urlparse(url).hostname or "").removeprefix("www.").split(".")[0])
    return {**r, "domain_skills": sorted(p.name for p in d.rglob("*.md"))[:10]} if d.is_dir() else r

def page_info():
    """{url, title, w, h, sx, sy, pw, ph} — viewport + scroll + page size.

    If a native dialog (alert/confirm/prompt/beforeunload) is open, returns
    {dialog: {type, message, ...}} instead — the page's JS thread is frozen
    until the dialog is handled (see interaction-skills/dialogs.md)."""
    dialog = _send({"meta": "pending_dialog"}).get("dialog")
    if dialog:
        return {"dialog": dialog}
    r = cdp("Runtime.evaluate",
            expression="JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})",
            returnByValue=True)
    return json.loads(r["result"]["value"])

# --- input ---
def click(x, y, button="left", clicks=1):
    cdp("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button=button, clickCount=clicks)
    cdp("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button=button, clickCount=clicks)

def type_text(text):
    cdp("Input.insertText", text=text)

_KEYS = {  # key → (windowsVirtualKeyCode, code, text)
    "Enter": (13, "Enter", "\r"), "Tab": (9, "Tab", "\t"), "Backspace": (8, "Backspace", ""),
    "Escape": (27, "Escape", ""), "Delete": (46, "Delete", ""), " ": (32, "Space", " "),
    "ArrowLeft": (37, "ArrowLeft", ""), "ArrowUp": (38, "ArrowUp", ""),
    "ArrowRight": (39, "ArrowRight", ""), "ArrowDown": (40, "ArrowDown", ""),
    "Home": (36, "Home", ""), "End": (35, "End", ""),
    "PageUp": (33, "PageUp", ""), "PageDown": (34, "PageDown", ""),
}
def press_key(key, modifiers=0):
    """Modifiers bitfield: 1=Alt, 2=Ctrl, 4=Meta(Cmd), 8=Shift.
    Special keys (Enter, Tab, Arrow*, Backspace, etc.) carry their virtual key codes
    so listeners checking e.keyCode / e.key all fire."""
    vk, code, text = _KEYS.get(key, (ord(key[0]) if len(key) == 1 else 0, key, key if len(key) == 1 else ""))
    base = {"key": key, "code": code, "modifiers": modifiers, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk}
    cdp("Input.dispatchKeyEvent", type="keyDown", **base, **({"text": text} if text else {}))
    if text and len(text) == 1:
        cdp("Input.dispatchKeyEvent", type="char", text=text, **{k: v for k, v in base.items() if k != "text"})
    cdp("Input.dispatchKeyEvent", type="keyUp", **base)

def scroll(x, y, dy=-300, dx=0):
    cdp("Input.dispatchMouseEvent", type="mouseWheel", x=x, y=y, deltaX=dx, deltaY=dy)


# --- visual ---
def screenshot(path="/tmp/shot.png", full=False):
    r = cdp("Page.captureScreenshot", format="png", captureBeyondViewport=full)
    open(path, "wb").write(base64.b64decode(r["data"]))
    return path


# --- tabs ---
def list_tabs(include_chrome=True):
    out = []
    for t in cdp("Target.getTargets")["targetInfos"]:
        if t["type"] != "page": continue
        url = t.get("url", "")
        if not include_chrome and url.startswith(INTERNAL): continue
        out.append({"targetId": t["targetId"], "title": t.get("title", ""), "url": url})
    return out

def current_tab():
    t = cdp("Target.getTargetInfo").get("targetInfo", {})
    return {"targetId": t.get("targetId"), "url": t.get("url", ""), "title": t.get("title", "")}

def _mark_tab():
    """Prepend 🟢 to tab title so the user can see which tab the agent controls."""
    try: cdp("Runtime.evaluate", expression="if(!document.title.startsWith('\U0001F7E2'))document.title='\U0001F7E2 '+document.title")
    except Exception: pass

def switch_tab(target_id):
    # Unmark old tab
    try: cdp("Runtime.evaluate", expression="if(document.title.startsWith('\U0001F7E2 '))document.title=document.title.slice(2)")
    except Exception: pass
    cdp("Target.activateTarget", targetId=target_id)
    sid = cdp("Target.attachToTarget", targetId=target_id, flatten=True)["sessionId"]
    _send({"meta": "set_session", "session_id": sid})
    _mark_tab()
    return sid

def new_tab(url="about:blank"):
    # Always create blank, then goto: passing url to createTarget races with
    # attach, so the brief about:blank is "complete" by the time the caller
    # polls and wait_for_load() returns before navigation actually starts.
    tid = cdp("Target.createTarget", url="about:blank")["targetId"]
    switch_tab(tid)
    if url != "about:blank":
        goto(url)
    return tid

def ensure_real_tab():
    """Switch to a real user tab if current is chrome:// / internal / stale."""
    tabs = list_tabs(include_chrome=False)
    if not tabs:
        return None
    try:
        cur = current_tab()
        if cur["url"] and not cur["url"].startswith(INTERNAL):
            return cur
    except Exception:
        pass
    switch_tab(tabs[0]["targetId"])
    return tabs[0]

def iframe_target(url_substr):
    """First iframe target whose URL contains `url_substr`. Use with js(..., target_id=...)."""
    for t in cdp("Target.getTargets")["targetInfos"]:
        if t["type"] == "iframe" and url_substr in t.get("url", ""):
            return t["targetId"]
    return None


# --- utility ---
def wait(seconds=1.0):
    time.sleep(seconds)

def wait_for_load(timeout=15.0):
    """Poll document.readyState == 'complete' or timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if js("document.readyState") == "complete": return True
        time.sleep(0.3)
    return False

def js(expression, target_id=None):
    """Run JS in the attached tab (default) or inside an iframe target (via iframe_target())."""
    sid = cdp("Target.attachToTarget", targetId=target_id, flatten=True)["sessionId"] if target_id else None
    r = cdp("Runtime.evaluate", session_id=sid, expression=expression, returnByValue=True, awaitPromise=True)
    return r.get("result", {}).get("value")


_KC = {"Enter": 13, "Tab": 9, "Escape": 27, "Backspace": 8, " ": 32, "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40}


def dispatch_key(selector, key="Enter", event="keypress"):
    """Dispatch a DOM KeyboardEvent on the matched element.

    Use this when a site reacts to synthetic DOM key events on an element more reliably
    than to raw CDP input events.
    """
    kc = _KC.get(key, ord(key) if len(key) == 1 else 0)
    js(
        f"(()=>{{const e=document.querySelector({json.dumps(selector)});if(e){{e.focus();e.dispatchEvent(new KeyboardEvent({json.dumps(event)},{{key:{json.dumps(key)},code:{json.dumps(key)},keyCode:{kc},which:{kc},bubbles:true}}));}}}})()"
    )

def upload_file(selector, path):
    """Set files on a file input via CDP DOM.setFileInputFiles. `path` is an absolute filepath (use tempfile.mkstemp if needed)."""
    doc = cdp("DOM.getDocument", depth=-1)
    nid = cdp("DOM.querySelector", nodeId=doc["root"]["nodeId"], selector=selector)["nodeId"]
    if not nid: raise RuntimeError(f"no element for {selector}")
    cdp("DOM.setFileInputFiles", files=[path] if isinstance(path, str) else list(path), nodeId=nid)

def http_get(url, headers=None, timeout=20.0):
    """Pure HTTP — no browser. Use for static pages / APIs. Wrap in ThreadPoolExecutor for bulk."""
    import urllib.request, gzip
    h = {"User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip"}
    if headers: h.update(headers)
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip": data = gzip.decompress(data)
        return data.decode()

# --- LobsterLink auth handoff ---

ANDY_DISCORD_URL = os.environ.get("ANDY_DISCORD_URL", "http://100.85.122.99:2643")
LOBSTERLINK_DISCORD_THREAD = os.environ.get("LOBSTERLINK_DISCORD_THREAD", "")
LOBSTERLINK_VIEWER_BASE = os.environ.get("LOBSTERLINK_VIEWER_BASE", "https://lobsterl.ink")


def _lobsterlink_start_cdp():
    """Trigger LobsterLink extension to start sharing via CDP service worker eval."""
    targets = cdp("Target.getTargets")["targetInfos"]
    ext = next(
        (t for t in targets
         if t.get("type") == "service_worker" and "lobsterlink" in t.get("url", "").lower()),
        None,
    )
    if not ext:
        raise RuntimeError("LobsterLink extension service worker not found — is the extension installed and enabled?")
    session = cdp("Target.attachToTarget", targetId=ext["targetId"], flatten=True)["sessionId"]
    cdp("Runtime.evaluate", session_id=session,
        expression="self.handleStartHostingCDP && self.handleStartHostingCDP()", returnByValue=False)
    return session


def _lobsterlink_peer_id(session, timeout=15):
    """Poll until LobsterLink has a peerId, return it."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = cdp("Runtime.evaluate", session_id=session,
                expression="JSON.stringify({peerId: self.lobsterlinkHostState?.peerId || null})",
                returnByValue=True)
        val = r.get("result", {}).get("value")
        if val:
            peer_id = json.loads(val).get("peerId")
            if peer_id:
                return peer_id
        time.sleep(0.5)
    raise RuntimeError("Timed out waiting for LobsterLink peerId")


def _notify_discord(viewer_url, auth_url, thread_id):
    """Post viewer URL to Andy Discord thread."""
    if not thread_id:
        return
    payload = json.dumps({
        "channelId": thread_id,
        "content": f"**Auth wall reached** — complete login then return to the tab.\n{viewer_url}\n*(automation resumes automatically)*",
    }).encode()
    req = urllib.request.Request(
        f"{ANDY_DISCORD_URL}/send-message",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # Best-effort — don't block automation on notification failure


def lobsterlink_auth_handoff(auth_url=None, thread_id=None, timeout=300):
    """Pause at auth wall, share session via LobsterLink, resume when auth completes.

    Triggers LobsterLink to share the active Chrome tab, posts the viewer URL to
    Discord, then polls until navigation away from the auth URL (or timeout).

    Args:
        auth_url: Current login URL to poll against. Defaults to current page URL.
        thread_id: Discord thread/channel ID to notify. Falls back to env LOBSTERLINK_DISCORD_THREAD.
        timeout: Max seconds to wait for auth completion (default 300).

    Returns:
        dict with keys: viewer_url, peer_id, elapsed_seconds
    """
    if auth_url is None:
        auth_url = page_info().get("url", "")
    thread_id = thread_id or LOBSTERLINK_DISCORD_THREAD

    session = _lobsterlink_start_cdp()
    peer_id = _lobsterlink_peer_id(session)

    base = LOBSTERLINK_VIEWER_BASE.rstrip("/")
    viewer_url = f"{base}/?host={urllib_quote(peer_id)}"

    _notify_discord(viewer_url, auth_url, thread_id)

    # Poll for navigation away from auth URL
    start = time.time()
    deadline = start + timeout
    while time.time() < deadline:
        time.sleep(2)
        current = page_info().get("url", "")
        parsed_auth = urlparse(auth_url)
        parsed_current = urlparse(current)
        # Treat as complete when host+path no longer look like the auth page
        if parsed_current.hostname != parsed_auth.hostname or (
            parsed_current.path != parsed_auth.path and
            "login" not in parsed_current.path and
            "signin" not in parsed_current.path and
            "auth" not in parsed_current.path
        ):
            return {"viewer_url": viewer_url, "peer_id": peer_id, "elapsed_seconds": round(time.time() - start)}

    raise TimeoutError(f"Auth not completed within {timeout}s — viewer URL was: {viewer_url}")

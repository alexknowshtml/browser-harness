import json
import os
import socket
import time
import urllib.request
from pathlib import Path

from common import load_env

load_env()

NAME = os.environ.get("BU_NAME", "default")
BU_API = "https://api.browser-use.com/api/v3"


def _paths(name):
    n = name or NAME
    return f"/tmp/bu-{n}.sock", f"/tmp/bu-{n}.pid"


def _log_tail(name):
    p = f"/tmp/bu-{name or NAME}.log"
    try:
        return Path(p).read_text().strip().splitlines()[-1]
    except (FileNotFoundError, IndexError):
        return None


def daemon_alive(name=None):
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(1)
        s.connect(_paths(name)[0])
        s.close()
        return True
    except (FileNotFoundError, ConnectionRefusedError, socket.timeout):
        return False


def ensure_daemon(wait=60.0, name=None, env=None):
    """Idempotent. `env` is merged into the child process env."""
    if daemon_alive(name):
        return
    import subprocess

    e = {**os.environ, **({"BU_NAME": name} if name else {}), **(env or {})}
    p = subprocess.Popen(
        ["uv", "run", "daemon.py"],
        cwd=os.path.dirname(os.path.abspath(__file__)),
        env=e,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    deadline = time.time() + wait
    while time.time() < deadline:
        if daemon_alive(name):
            return
        if p.poll() is not None:
            break
        time.sleep(0.2)
    msg = _log_tail(name)
    raise RuntimeError(msg or f"daemon {name or NAME} didn't come up -- check /tmp/bu-{name or NAME}.log")


def restart_daemon(name=None):
    """Best-effort daemon restart for setup/debug flows."""
    import signal

    sock, pid_path = _paths(name)
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect(sock)
        s.sendall(b'{"meta":"shutdown"}\n')
        s.recv(1024)
        s.close()
    except Exception:
        pass
    try:
        pid = int(open(pid_path).read())
    except (FileNotFoundError, ValueError):
        pid = None
    if pid:
        for _ in range(75):
            try:
                os.kill(pid, 0)
                time.sleep(0.2)
            except ProcessLookupError:
                break
        else:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    for f in (sock, pid_path):
        try:
            os.unlink(f)
        except FileNotFoundError:
            pass


def _browser_use(path, method, body=None):
    key = os.environ.get("BROWSER_USE_API_KEY")
    if not key:
        raise RuntimeError("BROWSER_USE_API_KEY missing -- see .env.example")
    req = urllib.request.Request(
        f"{BU_API}{path}",
        method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={"X-Browser-Use-API-Key": key, "Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=60).read() or b"{}")


def _cdp_ws_from_url(cdp_url):
    return json.loads(urllib.request.urlopen(f"{cdp_url}/json/version", timeout=15).read())["webSocketDebuggerUrl"]


def start_remote_daemon(name="remote", **create_kwargs):
    if daemon_alive(name):
        raise RuntimeError(f"daemon {name!r} already alive -- restart_daemon({name!r}) first")
    browser = _browser_use("/browsers", "POST", create_kwargs)
    ensure_daemon(
        name=name,
        env={"BU_CDP_WS": _cdp_ws_from_url(browser["cdpUrl"]), "BU_BROWSER_ID": browser["id"]},
    )
    return browser

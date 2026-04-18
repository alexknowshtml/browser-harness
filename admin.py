import json
import shutil
import subprocess
import sys

from helpers import kill_daemon, start_remote_daemon


def _name(argv):
    return argv[1] if len(argv) > 1 else None


def kill_main():
    try:
        kill_daemon(_name(sys.argv))
    except Exception as e:
        raise SystemExit(str(e))


def remote_main():
    try:
        name = _name(sys.argv) or "remote"
        print(json.dumps(start_remote_daemon(name), indent=2))
    except Exception as e:
        raise SystemExit(str(e))


def open_debugging_main():
    url = "chrome://inspect/#remote-debugging"
    if sys.platform == "darwin":
        subprocess.check_call(["open", "-a", "Google Chrome", url])
        return
    for exe in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser"):
        path = shutil.which(exe)
        if path:
            subprocess.Popen([path, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
    raise SystemExit(f"Open {url} in Chrome, then retry.")


def check_main():
    try:
        import helpers
        helpers.ensure_daemon(wait=5.0)
        print(json.dumps(helpers.page_info(), indent=2))
    except Exception as e:
        raise SystemExit(str(e))

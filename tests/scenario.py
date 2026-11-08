# Helper scenario, Python side. Paired with scenario.ts; outputs must match (#1600 gate 2).
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from helpers import *
out = []
def rec(label, fn):
    try: out.append([label, fn()])
    except Exception as e: out.append([label, "ERR:" + str(e)])
rec("list_tabs", lambda: list_tabs())
rec("list_tabs no chrome", lambda: list_tabs(include_chrome=False))
rec("current_tab", lambda: current_tab())
rec("page_info", lambda: page_info())
rec("new_tab", lambda: new_tab("https://www.example.com/a"))
rec("page_info after new_tab", lambda: page_info())
rec("goto", lambda: goto("https://example.net/b"))
rec("click", lambda: click(10, 20))
rec("click right double", lambda: click(1, 2, button="right", clicks=2))
rec("type_text", lambda: type_text("héllo 🟢"))
for k in ["Enter", "Tab", "a", "Z", "é", "F5", " ", "ArrowDown"]:
    rec(f"press_key {k}", lambda k=k: press_key(k))
rec("press_key mod", lambda: press_key("a", modifiers=10))
rec("scroll", lambda: scroll(5, 6))
rec("scroll dx", lambda: scroll(5, 6, dy=100, dx=-50))
rec("screenshot", lambda: (screenshot("/tmp/t1600-py.png"), open("/tmp/t1600-py.png","rb").read().hex())[1])
rec("js", lambda: js("document.readyState"))
rec("js float", lambda: js("1.0+0"))
rec("wait_for_load", lambda: wait_for_load(timeout=2))
rec("dispatch_key", lambda: dispatch_key("#q\"é", key="Enter"))
rec("dispatch_key a", lambda: dispatch_key("input", key="a", event="keydown"))
rec("upload_file", lambda: upload_file("#f", "/tmp/x.txt"))
rec("upload_file list", lambda: upload_file("#f", ["/tmp/a", "/tmp/b"]))
rec("upload_file missing", lambda: upload_file("#missing", "/tmp/x"))
rec("iframe_target none", lambda: iframe_target("nothing"))
rec("drain_events", lambda: [e["method"] for e in drain_events()])
rec("switch back", lambda: switch_tab(list_tabs()[0]["targetId"]) is not None)
rec("ensure_real_tab", lambda: ensure_real_tab())
tid = None
def tt():
    global tid
    with temp_tab("https://example.com/tmp") as t:
        tid = t
        return page_info()["url"]
rec("temp_tab", tt)
rec("temp_tab closed", lambda: any(t["targetId"] == tid for t in list_tabs()))
rec("cdp error", lambda: cdp("Nope.x"))
rec("tabs end", lambda: [t["url"] for t in list_tabs()])
print(json.dumps(out))

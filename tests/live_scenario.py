# Live Helium scenario, Python side (#1600 gate 1-2 live). Only touches tabs it opens itself.
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from helpers import *
out = []
def rec(label, fn):
    try: out.append([label, fn()])
    except Exception as e: out.append([label, "ERR:" + str(e)])
PAGE = "data:text/html,<title>t1600</title><input id=q><button id=b onclick=\"document.title='clicked'\" style='position:fixed;left:0;top:0;width:200px;height:60px'>b</button><div style='height:3000px'></div>"
tid = new_tab(PAGE)
rec("wait_for_load", lambda: wait_for_load())
rec("page_info", lambda: {k: v for k, v in page_info().items() if k in ("url", "title", "ph")})
rec("tab listed", lambda: any(t["targetId"] == tid for t in list_tabs()))
rec("current_tab is mine", lambda: current_tab()["targetId"] == tid)
rec("js", lambda: js("1+1"))
rec("js float", lambda: js("1.5*2"))
rec("js unicode", lambda: js("'é🟢'"))
rec("click", lambda: (click(100, 30), time.sleep(0.3), js("document.title"))[2])
rec("type", lambda: (js("document.getElementById('q').focus()"), type_text("héllo"), js("document.getElementById('q').value"))[2])
rec("press_key", lambda: (press_key("Backspace"), press_key("Z"), js("document.getElementById('q').value"))[2])
rec("dispatch_key", lambda: (js("window.k='';document.getElementById('q').addEventListener('keydown',e=>window.k=e.key)"), dispatch_key("#q", key="Enter", event="keydown"), js("window.k"))[2])
rec("scroll", lambda: (scroll(100, 300, dy=500), time.sleep(0.5), js("scrollY > 0"))[2])
rec("screenshot", lambda: (lambda p: open(p, "rb").read()[:8].hex())(screenshot("/tmp/t1600-live-py.png")))
rec("dialog", lambda: (js("setTimeout(()=>confirm('sure?'),50)"), time.sleep(0.5), page_info().get("dialog", {}).get("message"))[2])
rec("dialog closed", lambda: (cdp("Page.handleJavaScriptDialog", accept=True), time.sleep(0.3), "dialog" in page_info())[2])
rec("goto", lambda: (goto("data:text/html,<title>two</title>"), wait_for_load(), js("document.title"))[2])
rec("cdp error", lambda: cdp("Nope.x"))
rec("upload missing", lambda: upload_file("#missing", "/tmp/x"))
rec("events", lambda: "Page.loadEventFired" in [e["method"] for e in drain_events()])
close_tab(tid); time.sleep(0.5)
rec("closed", lambda: any(t["targetId"] == tid for t in list_tabs()))
def tt():
    with temp_tab("data:text/html,<title>tmp</title>") as t:
        wait_for_load(); return js("document.title")
rec("temp_tab", tt)
print(json.dumps(out))

# Connection & Tab Visibility

## The omnibox popup problem

When Chrome opens fresh, the only CDP `type: "page"` targets are `chrome://inspect` and `chrome://omnibox-popup.top-chrome/` (a 1px invisible viewport). If the daemon attaches to the omnibox popup, all subsequent work — including `new_tab()` and `goto()` — happens on tabs that exist in CDP but may not be visible in the Chrome UI.

The daemon's `attach_first_page()` handles this by creating an `about:blank` tab when no real pages exist. If you still end up on an invisible tab, use `switch_tab()` which calls `Target.activateTarget` to bring the tab to front.

## Startup sequence

1. Check if a daemon is already running with `daemon_alive()`
2. If stale sockets exist but daemon is dead, clean them up
3. List open tabs with `list_tabs()` to see what's available
4. `ensure_real_tab()` attaches to a real page
5. `switch_tab(target_id)` both attaches AND activates (brings to front)

```ts
import { existsSync, unlinkSync } from "node:fs"
if (!(await daemon_alive())) {
  for (const f of ["/tmp/bu-default.sock", "/tmp/bu-default.pid"]) {
    if (existsSync(f)) unlinkSync(f)
  }
  await ensure_daemon()
}

const tabs = await list_tabs()
for (const t of tabs) {
  console.log(t.url.slice(0, 60))
}

const tab = await ensure_real_tab()
```

## Bringing Chrome to front

If Chrome is behind other windows or on another desktop:

```ts
Bun.spawnSync(["osascript", "-e", 'tell application "Google Chrome" to activate'])
```

## Navigating

Prefer navigating an existing tab over `new_tab()`. Tabs created via CDP's `Target.createTarget` are visible but may open behind the active tab.

```ts
const tab = await ensure_real_tab()
await goto("https://example.com")
```

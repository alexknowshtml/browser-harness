# TikTok Studio — Upload Video

URL: `https://www.tiktok.com/tiktokstudio/upload?from=upload&lang=en` (always append `&lang=en`)

## Prerequisites

- Logged into TikTok in the Chrome profile browser-harness is attached to
- Video file on local disk (mp4, <50MB)

## Stale draft banner

TikTok shows "A video you were editing wasn't saved" if a previous upload was abandoned. Dismiss it:

1. Find the banner Discard button (y < 300 in the page)
2. CDP `click(x, y)` on it
3. A confirmation modal appears — find the red Discard button (y > 300) and CDP `click(x, y)`
4. Repeat if multiple stale drafts are stacked

## Upload flow

### 1. Attach file

```ts
await upload_file('input[type="file"]', "/path/to/video.mp4")
await wait(12)  // processing takes ~10s for 5-10MB
```

### 2. Caption

TikTok pre-fills caption with the filename. Clear it first:

```ts
await js("document.querySelector('div[contenteditable=\"true\"][role=\"combobox\"]').focus()")
await press_key("End")
for (let i = 0; i < 25; i++) await press_key("Backspace")  // clear filename
await type_text("your caption here #hashtag1 #hashtag2")
await press_key("Escape")  // dismiss hashtag suggestions
await click(700, 50)        // click away to deselect
```

Verify: `await js('document.querySelector(\'div[contenteditable="true"][role="combobox"]\').innerText')`

### 3. Schedule

Click the Schedule radio label:
```ts
await js("(()=>{var l=document.querySelectorAll('label');for(var i=0;i<l.length;i++){if(l[i].textContent.trim()==='Schedule'){l[i].click();break}}})()")
```

**Time picker** — uses a scroll-wheel list, NOT a native select. Each `scroll(x, y, 32)` steps +1 unit, `dy = -32` steps -1 unit.

```ts
// time_input_x/y and dropdown_y come from getBoundingClientRect() reads
// 1. ScrollIntoView and open the time picker
await js("...scrollIntoView the time input...")
await click(time_input_x, time_input_y)

// 2. Read default time, calculate difference
const [default_hour, default_min] = [13, 5]  // from input value
const [target_hour, target_min] = [20, 25]

// 3. Scroll hour column (left, x ≈ 349)
for (let i = 0; i < target_hour - default_hour; i++) {
  await scroll(349, dropdown_y, 32)  // +1 hour per step
}

// 4. Scroll minute column (right, x ≈ 437)
for (let i = 0; i < Math.floor((target_min - default_min) / 5); i++) {
  await scroll(437, dropdown_y, 32)  // +5 min per step
}

// 5. Close and verify
await press_key("Escape")
```

**Date picker** — click the date input, then click the target day number span.

### 4. AI-generated content disclosure

Under "Show more" section. Toggle is `[aria-checked]` inside the "AI-generated content" parent.

```ts
// Expand settings
await js("...click 'Show more' span...")
// ScrollIntoView the toggle
await js("...scrollIntoView 'ai-generated content' span...")
// Read state and click if false
// A "Turn on" confirmation dialog may appear — click it
```

### 5. Submit

Scroll the Schedule button into view, then CDP `click(x, y)`. After success, page redirects to `/tiktokstudio/content`.

```ts
await js("...scrollIntoView Schedule button (offsetWidth > 100)...")
await click(button_x, button_y)
await wait(6)
if (!(await page_info()).url.includes("content")) throw new Error("schedule did not redirect to /content")
```

## Gotchas

- **JS `.click()` doesn't work on TikTok's time picker items** — must use CDP `click(x, y)`
- **Time picker uses virtual scroll** — `scroll(x, y, 32)` changes value, NOT regular DOM scroll
- **Caption contenteditable appends on type** — always clear with End + Backspace first, never set innerHTML (breaks React state)
- **beforeunload dialog** blocks navigation if upload is in progress — use `await cdp("Page.handleJavaScriptDialog", {accept: true})` to dismiss (see `interaction-skills/dialogs.md`)
- **Schedule button text** is "Schedule" only after the Schedule radio is selected (otherwise "Post")
- **"Show more" section** expands the page and pushes the time picker off-viewport — collapse it before adjusting time, expand after
- **Unicode narrow no-break space** (char 8239) appears between time and AM/PM in scheduled post listings — use `.indexOf('12:30')` not exact string match

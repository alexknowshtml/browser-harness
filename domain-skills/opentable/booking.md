# OpenTable Booking — Philadelphia

## Search URL
```
https://www.opentable.com/s?term=philadelphia&covers={party_size}&dateTime={YYYY-MM-DD}T{HH:MM:00}
```
Loads Philadelphia County results. `term=philadelphia` triggers location search, returns 450-564 results depending on date.

## Page structure
- Restaurant name: `<a href="/r/{slug}-philadelphia">` links
- Time slot buttons: `<a>` elements with empty `href=""` immediately following the restaurant link
- Time slot text format: `"7:00 PM"` or `"7:00 PM*"` (asterisk = different seating area)
- Results fully render within ~4s after `wait_for_load()`

## Finding a specific restaurant's time slot
```python
links = js('JSON.stringify([...document.querySelectorAll("a")].map(a => ({href: a.href, text: a.innerText.trim()})))')
# Find restaurant anchor, then scan forward for matching time text
```

## Getting clickable coordinates (critical)
- DOM coords from `getBoundingClientRect()` are NOT the same as screenshot pixel coords
- Always use runtime coords for clicks: `el.getBoundingClientRect()` → `{x+width/2, y+height/2}`
- Viewport is 1775px wide; screenshots render at ~886px — factor of ~2x difference

## Seating selection step
- URL: `opentable.com/booking/seating-options?...`
- Two "Select" buttons: Dining Room (first) and Other (second)
- Button coords found via: `[...document.querySelectorAll('button')]` with `getBoundingClientRect()`
- Dining Room Select button is always first

## Booking details step
- URL: `opentable.com/booking/details?...`
- Table held for ~5 minutes
- "Complete reservation" and "Not Alex?" buttons present
- `document.querySelectorAll('button')` finds them by text — EXCEPT when inside React shadow
- Use `getBoundingClientRect()` coords reliably; do NOT use screenshot coords

## Cancel flow
- Confirmation page has "Cancel" button (text: "Cancel")
- Clicking opens a modal dialog with "Nevermind" and "Confirm cancellation" buttons
- Both found via `querySelectorAll('button')` + text filter after dialog opens
- Must wait ~2s after clicking Cancel before querying for dialog buttons

## Traps
- `js('return ...')` is INVALID — `js()` takes an expression, not a function body
- Screenshot pixel coords ≠ DOM coords. Never hardcode from screenshot measurements
- Page renders restaurant cards but `querySelectorAll('h2, article')` returns empty — use `<a href*="/r/">` pattern instead
- `wait_for_load()` is not enough — add `time.sleep(4)` after for React hydration

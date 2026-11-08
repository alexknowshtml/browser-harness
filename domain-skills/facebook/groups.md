# Facebook Groups — mining feeds for posts + external URLs

Field-tested against a logged-in Jay account on 2026-04-18.
**Requires:** Browser Harness driving a real Chrome that is (a) signed into
Facebook and (b) already a member of the target group. Non-member or logged-out
views serve a stripped landing page with no post content.

## What this skill is for

1. Pull the N most recent posts from a named FB group
2. Harvest every external URL that members have shared
3. Hand that URL list to Firecrawl (or `http_get`) for structured scraping at scale
4. Cache post text + author + timestamp for downstream keyword matching

It is NOT for: replying in groups, DMing members, or any write action.

## URL patterns

| What | URL |
|------|-----|
| Group main feed | `https://www.facebook.com/groups/{id_or_slug}` |
| Group "Discussion" tab (canonical feed) | `https://www.facebook.com/groups/{id_or_slug}/?sorting_setting=CHRONOLOGICAL` |
| Single post (permalink) | `https://www.facebook.com/groups/{id_or_slug}/posts/{post_id}/` |
| User's joined-groups feed | `https://www.facebook.com/groups/feed/` |
| List of YOUR groups | `https://www.facebook.com/groups/joins/` |

The `?sorting_setting=CHRONOLOGICAL` flag matters — without it, FB inserts an
algorithmic ranking that hides older posts and shows the same handful of "popular"
items every visit, which kills monitoring use cases.

## DOM anchors (verified 2026-04-18)

FB rewrites class names every few weeks but ARIA roles and stable URL patterns
hold up well. Anchor on those, not on hashed CSS classes.

| Anchor | Selector | Notes |
|--------|----------|-------|
| Each post container | `div[role="article"]` | Stable. One per visible post. |
| Post permalink | `a[href*="/groups/"][href*="/posts/"], a[href*="/groups/"][href*="/permalink/"]` | First match per article = the post link |
| Post body text | `div[data-ad-preview="message"], div[data-ad-comet-preview="message"]` | One of these is the visible body |
| Post author | `h3 a, h4 a` (first inside the article) | Falls back to `strong a` |
| Post timestamp | `a[href*="/posts/"] abbr, a[role="link"] > span > span` (relative time text) | Hover gets the absolute time but the relative string is fine for sorting |
| External link (FB redirector) | `a[href^="https://l.facebook.com/l.php?u="]` | Decode the `u=` param to get the real URL |
| "See more" button on long posts | `div[role="button"]:has(span:contains("See more"))` (use XPath fallback if `:has` is unsupported) | Click before reading body or posts get truncated |

If selectors stop returning results, run the self-inspection block at the bottom
of this file and update this table — that's the workflow, not a fallback.


## Scrolling the feed (lazy load)

FB virtualizes the feed: scrolled-past posts get unmounted from the DOM. So
"scroll then collect" misses old posts. Pattern that works: **collect-as-you-go.**

```ts
const seen: Record<string, any> = {}  // post_url -> object
const TARGET = 50  // how many posts to collect
const MAX_SCROLLS = 30

for (let i = 0; i < MAX_SCROLLS; i++) {
  const new_posts = (await js(`
      Array.from(document.querySelectorAll('div[role="article"]')).map(el => {
        const link = el.querySelector('a[href*="/groups/"][href*="/posts/"], a[href*="/groups/"][href*="/permalink/"]');
        const body = el.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
        const author = el.querySelector('h3 a, h4 a, strong a');
        const time = el.querySelector('abbr, a[role="link"] > span > span');
        const externals = Array.from(el.querySelectorAll('a[href^="https://l.facebook.com/l.php?u="]'))
          .map(a => a.href);
        return {
          url: link?.href || null,
          author: author?.innerText || null,
          time: time?.innerText || null,
          body: body?.innerText?.slice(0, 4000) || null,
          externals: externals,
        };
      }).filter(p => p.url)
    `)) || []
  for (const p of new_posts) seen[p.url] ??= p
  if (Object.keys(seen).length >= TARGET) break
  await scroll(640, 400, 900)  // scroll near middle of viewport (dy=900)
  await wait(2.5)  // FB needs ~2s to render new batch + a little buffer
}
```

`wait(2.5)` is the floor. Faster than that and you'll see empty post containers
because React hasn't hydrated them yet.


## Decoding the external-URL redirector

Every external link gets wrapped in `https://l.facebook.com/l.php?u={URL-encoded real URL}&h=...`.
You want the real URL, not the redirector.

```ts
function decode_fb_link(href: string): string {
  if (!href.startsWith("https://l.facebook.com/l.php")) return href
  const u = new URL(href).searchParams.get("u")  // searchParams already URL-decodes
  return u ?? href
}
```

## Handoff to Firecrawl (for the public outbound URLs)

Once you have the harvested external list, those URLs are outside FB's walled
garden — public, scrapable by anything. Firecrawl's schema-native extraction
shines here because you want typed results across heterogeneous sources.

```ts
// After the scroll loop:
const external_urls = [...new Set(
  Object.values(seen).flatMap((p: any) => p.externals.map(decode_fb_link)),
)].sort()
console.log(`harvested ${external_urls.length} unique external URLs`)

// Hand off to Firecrawl MCP in the calling conversation:
//   firecrawl_extract(
//       urls=external_urls,
//       prompt="Extract product/listing name, price, location, year, and key features.",
//       schema={...}
//   )
```

When Firecrawl isn't available or the pages are simple, `http_get(url)` from
Harness itself is fine — it does a plain HTTP fetch without a browser, works
for static pages, and is the fastest option for bulk.


## Rate-limit discipline

FB notices automation patterns at the account level, not the IP level. Driving
a real logged-in session means Jay's account is the one getting rate-limited if
you get greedy. Keep these floors:

- **≥2 seconds between scrolls** in the collect loop (the `wait(2.5)` above)
- **≥3 seconds between groups** if you're sweeping multiple
- **No more than ~6 groups per hour** for sustained monitoring
- **Don't open the same group more than every 15 minutes** — repeated visits
  within a short window is a heuristic that triggers checkpoints

Symptoms of over-pacing: article containers start rendering with empty bodies,
`/groups/{id}/` redirects to `/checkpoint/`, or the account briefly gets asked
to re-verify a phone or confirm a login from a new device. If that happens,
**stop immediately** and let Jay deal with the UI — don't try to auto-resolve.

## Self-inspection block (run this when selectors stop working)

Paste this into a Harness stdin block to see what anchors currently exist in the
visible feed. Run it on a group you're a member of.

```ts
console.log(await js(`
  ({
    articles: document.querySelectorAll('div[role="article"]').length,
    body_preview_a: document.querySelectorAll('div[data-ad-preview="message"]').length,
    body_preview_b: document.querySelectorAll('div[data-ad-comet-preview="message"]').length,
    external_redirectors: document.querySelectorAll('a[href^="https://l.facebook.com/l.php?u="]').length,
    permalink_posts: document.querySelectorAll('a[href*="/groups/"][href*="/posts/"]').length,
    permalink_permalinks: document.querySelectorAll('a[href*="/groups/"][href*="/permalink/"]').length,
  })
`))
// If any count is 0, the selector drifted. Open DevTools, right-click a visible
// post, inspect, find the new stable attribute (aria-*, data-*), and update the
// DOM anchors table above.
```


## Full example — mine one group, emit JSON for downstream tools

```bash
cd ~/Developer/browser-harness && browser-harness <<'TS'
const GROUP = "riceLakeBoating"          // slug or numeric id
const TARGET = 50                         // how many posts to collect
const MAX_SCROLLS = 30

await goto(`https://www.facebook.com/groups/${GROUP}/?sorting_setting=CHRONOLOGICAL`)
await wait_for_load()
await wait(2)

// Abort if FB bounced us
const info = await page_info()
if (info.url.includes("/checkpoint/") || info.url.includes("/login")) {
  console.error("AUTH_WALL — stop and have Jay re-verify the account.")
  process.exit(1)
}

const seen: Record<string, any> = {}
for (let i = 0; i < MAX_SCROLLS; i++) {
  const batch = (await js(`
      Array.from(document.querySelectorAll('div[role="article"]')).map(el => {
        const link = el.querySelector('a[href*="/groups/"][href*="/posts/"], a[href*="/groups/"][href*="/permalink/"]');
        const body = el.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
        const author = el.querySelector('h3 a, h4 a, strong a');
        const time = el.querySelector('abbr, a[role="link"] > span > span');
        const externals = Array.from(el.querySelectorAll('a[href^="https://l.facebook.com/l.php?u="]')).map(a => a.href);
        return { url: link?.href, author: author?.innerText, time: time?.innerText,
                 body: body?.innerText?.slice(0, 4000), externals };
      }).filter(p => p.url)
    `)) || []
  for (const p of batch) seen[p.url] ??= p
  if (Object.keys(seen).length >= TARGET) break
  await scroll(640, 400, 900)
  await wait(2.5)
}

function decode(u: string): string {
  if (!u.startsWith("https://l.facebook.com/l.php")) return u
  return new URL(u).searchParams.get("u") ?? u
}

const posts = Object.values(seen)
const all_externals = [...new Set(posts.flatMap((p: any) => p.externals.map(decode)))].sort()
await screenshot(`/tmp/fb-group-${GROUP}.png`, true)
console.log(JSON.stringify({
  group: GROUP,
  post_count: posts.length,
  posts,
  external_urls: all_externals,
}))
TS
```

The JSON on stdout is the handoff payload — parse it in the calling agent and
route `external_urls` into `firecrawl_extract` with whatever schema matches the
downstream task (competitor inventory, pricing intel, boat listings, etc).

## Gotchas log (append when you hit something new)

- **2026-04-18:** Fresh install verified. People-search URL requires login;
  page search `/search/pages/?q=` works the same way. Groups feed defaults to
  algorithmic sort — always append `?sorting_setting=CHRONOLOGICAL`.

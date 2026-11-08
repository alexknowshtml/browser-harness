# Wayback Machine — CDX API & Snapshot Retrieval

`https://web.archive.org` — all public data, no auth or API key required. Everything here is pure `http_get` — no browser needed.

> **NOTE:** A comprehensive Internet Archive skill (covering CDX, item metadata, and search) already exists at `domain-skills/archive-org/scraping.md`. This file is a focused, CDX-first quick-reference for Wayback Machine snapshot work specifically.

## Start here: CDX API

The CDX (Capture/Crawl Index) API is the single fastest way to query the Wayback Machine. It returns structured JSON and supports filtering, collapsing, pagination, and nearest-date lookups.

```ts
// Find all snapshots of a URL — the minimal starting query
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com&output=json&limit=10" +
  "&fl=timestamp,original,statuscode,mimetype,length",
  null,
  40.0,   // CDX is slow — never use less than 40s
);
const rows: string[][] = JSON.parse(r);
// rows[0] is ALWAYS the header row — slice rows.slice(1) for data
for (const [ts, orig, status, mime, length] of rows.slice(1)) {
  console.log(`https://web.archive.org/web/${ts}/${orig}  [${status}]`);
}
```

**All CDX values are strings**, even numeric ones (`status='200'`, `length='4821'`). Cast explicitly with `Number()` / `parseInt()`.

---

## Core CDX patterns

### Nearest snapshot to a target date

```ts
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com&output=json&limit=1" +
  "&fl=timestamp,original,statuscode" +
  "&closest=20230601120000&sort=closest",
  null,
  60.0,
);
const rows: string[][] = JSON.parse(r);
const [ts, orig, status] = rows[1];   // rows[0] is header
const snap_url = `https://web.archive.org/web/${ts}/${orig}`;
// Timestamp format: 14-digit YYYYMMDDHHMMSS
// Prefix shorthand: '20230601' (day), '202306' (month), '2023' (year)
```

### One snapshot per month (collapsed)

```ts
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com&output=json" +
  "&collapse=timestamp:6" +   // :6 = one per YYYYMM
  "&from=20220101&to=20230101" +
  "&fl=timestamp,original,statuscode",
  null,
  60.0,
);
const rows: string[][] = JSON.parse(r);
for (const [ts, orig, status] of rows.slice(1)) {
  console.log(`${ts.slice(0, 4)}-${ts.slice(4, 6)}  https://web.archive.org/web/${ts}/${orig}`);
}

// collapse=timestamp:N — collapse by first N timestamp digits:
//   :4 = one per year
//   :6 = one per month   (most common)
//   :8 = one per day
//   :10 = one per hour
// Keeps the FIRST capture of each period — not the last.
```

### All pages under a domain or path

```ts
// matchType=prefix — all URLs starting with the given path
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com/blog/&matchType=prefix&output=json" +
  "&limit=20&fl=timestamp,original,statuscode" +
  "&filter=statuscode:200",   // only successful captures
  null,
  60.0,
);
const rows: string[][] = JSON.parse(r);
for (const row of rows.slice(1)) {
  console.log(JSON.stringify(row));
}

// matchType options:
//   exact   (default) — this URL only
//   prefix  — URL + all subpaths
//   host    — all subdomains of the host
//   domain  — host + all subdomains (broadest)
```

### Filter by status code or MIME type

```ts
// Only successful HTML captures — combine multiple filters
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com&output=json" +
  "&filter=statuscode:200" +
  "&filter=mimetype:text/html" +
  "&fl=timestamp,original,length" +
  "&limit=10",
  null,
  40.0,
);
const rows: string[][] = JSON.parse(r);

// filter= uses regex. Examples:
//   &filter=statuscode:200          exact match
//   &filter=!statuscode:200         negation (all non-200)
//   &filter=statuscode:[23]..       2xx and 3xx only
//   &filter=mimetype:text/html      HTML only
//   &filter=original:.*\\.pdf       URLs ending in .pdf
// Multiple &filter= params are ANDed together.
```

### CDX field reference

| Field | Description | Example value |
|---|---|---|
| `urlkey` | SURT-format URL (reversed domain) | `com,example)/` |
| `timestamp` | Capture time, 14-digit `YYYYMMDDHHMMSS` | `20230601114925` |
| `original` | Original crawled URL (includes port if non-standard) | `https://example.com/` |
| `mimetype` | Content-Type at crawl time | `text/html` |
| `statuscode` | HTTP status at crawl time (string) | `200` |
| `digest` | SHA-1 of body, base32-encoded | `I4YBMQ6PHPWE2TD6TIXNWHZB6MXRNTSR` |
| `length` | Content-length in bytes (string) | `4821` |

Default `fl=` when omitted: all 7 fields above in that order.

---

## Availability API (DO NOT USE as primary)

```ts
// WARNING: This API is BROKEN — returns empty archived_snapshots
// for URLs that ARE in the archive. Confirmed broken 2026-04-18.
// Use CDX with ?sort=closest&limit=1 instead (see above).

// Left here for reference only — do not rely on it:
let r = await http_get(
  "https://archive.org/wayback/available" +
  "?url=example.com&timestamp=20240101",
  null,
  20.0,
);
const data = JSON.parse(r);
// Returns: {"url": "example.com", "archived_snapshots": {}}
// Even for well-archived URLs. Do not trust empty results.

// CORRECT replacement:
r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com&output=json&limit=1" +
  "&fl=timestamp,original,statuscode" +
  "&closest=20240101000000&sort=closest",
  null,
  60.0,
);
const rows: string[][] = JSON.parse(r);
if (rows.length > 1) {
  const [ts, orig, status] = rows[1];
  const snap_url = `https://web.archive.org/web/${ts}/${orig}`;
}
```

---

## Paginate large result sets

```ts
/** Yield all CDX rows for a URL, page by page. */
async function* cdx_all_snapshots(url: string, fl = "timestamp,original,statuscode", page_size = 500) {
  const base =
    "https://web.archive.org/cdx/search/cdx" +
    `?url=${encodeURIComponent(url)}&output=json` +
    `&fl=${fl}&limit=${page_size}&showResumeKey=true`;
  let resume_key: string | null = null;
  while (true) {
    const endpoint = resume_key === null ? base : `${base}&resumeKey=${encodeURIComponent(resume_key)}`;
    const rows: string[][] = JSON.parse(await http_get(endpoint, null, 60.0));
    // With showResumeKey=true, last two rows are [] and ['<key>']
    const has_resume = rows.length >= 2 && rows.at(-2)!.length === 0 && rows.at(-1)!.length > 0;
    const data_rows = has_resume ? rows.slice(1, -2) : rows.slice(1);
    for (const row of data_rows) yield row;
    if (!has_resume) break;
    resume_key = rows.at(-1)![0];
  }
}

for await (const [ts, orig, status] of cdx_all_snapshots("example.com")) {
  const snap_url = `https://web.archive.org/web/${ts}/${orig}`;
  // process...
}
```

---

## Retrieve the archived page

```ts
// Direct snapshot URL: /web/{14-digit-timestamp}/{original-url}
const snap_url = "https://web.archive.org/web/20230601114925/https://example.com/";
const content = await http_get(snap_url, null, 30.0);
// Returns archived HTML with Wayback toolbar injected inside:
// <!-- BEGIN WAYBACK TOOLBAR INSERT --> ... <!-- END WAYBACK TOOLBAR INSERT -->
// Strip those comments + their contents if you want the original HTML.

// Canonical form for "get latest available" — use 14 zeros:
const latest = "https://web.archive.org/web/20240101000000*/example.com";
// The * suffix returns a calendar page (HTML), not the archived page itself.
// Use CDX to find the real timestamp, then fetch the direct URL.
```

---

## Advanced CDX: deduplicate by content digest

```ts
// Find only snapshots where the content CHANGED — dedup by SHA-1 digest
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com&output=json" +
  "&collapse=digest" +           // one capture per unique body hash
  "&fl=timestamp,original,digest,length" +
  "&filter=statuscode:200",
  null,
  60.0,
);
const rows: string[][] = JSON.parse(r);
// rows.slice(1) are unique content versions across all time
// Useful for detecting when a page actually changed, vs. being re-crawled identically
```

---

## CDX summary/count query

```ts
// showNumPages=true returns total page count, not records
// Use for estimating result size before a full fetch
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
  "?url=example.com&matchType=prefix" +
  "&showNumPages=true",
  null,
  30.0,
);
const page_count = parseInt(r.trim(), 10);   // returns plain integer, not JSON
// 1 page ~ 150,000 records by default
// Combine with &page=N for manual page-based pagination:
// ?url=...&output=json&page=0, ?url=...&output=json&page=1, etc.
```

---

## Rate limits & timeouts

| API | Typical latency | Safe timeout | Notes |
|---|---|---|---|
| CDX search | 5–40s | 60s | Intermittently slow; retry on timeout |
| Snapshot fetch (`/web/`) | 2–10s | 30s | Reliable |
| Metadata (`/metadata/`) | <1s | 20s | Fast, stable |
| Advanced search | <1s | 20s | Fast, stable |

No API key required. No documented rate limit. Be respectful: add `await wait(1)` between CDX calls in loops. 3 rapid sequential CDX calls (~10s) complete fine; 10+ rapid calls produce timeouts.

---

## Gotchas

- **CDX is slow — always pass a 60s timeout (`http_get(url, null, 60.0)`) for CDX calls.** 40s minimum, 60s recommended. Metadata and search APIs are fine at 20s. CDX slowness is server-side and unpredictable.

- **Availability API (`/wayback/available`) is broken.** Returns `{"archived_snapshots": {}}` even for URLs with thousands of captures. Tested 2026-04-18 — do not use. Replacement: CDX with `?sort=closest&limit=1`.

- **`rows[0]` is always the header when `output=json`.** Always slice `rows.slice(1)` for data. Forgetting this causes silent type errors because you're destructuring column names, not values.

- **`output=json` must be explicit.** Omitting it returns space-separated text. There is no default JSON mode.

- **All CDX values are strings.** `statuscode='200'` not `200`, `length='4821'` not `4821`. Cast: `Number(row[4])`, `Number(row[6])`.

- **`original` preserves non-standard ports.** Old crawls captured `http://www.example.com:80/` — the `:80` is part of the `original` field. Build playback URLs verbatim: `` `https://web.archive.org/web/${ts}/${orig}` `` works correctly with the port.

- **`from=` / `to=` timestamps are exclusive at the boundary.** `to=20231231` means `to=20231231000000` — it excludes captures from Dec 31 itself. Use `to=20240101` to include all of 2023.

- **`collapse=timestamp:6` keeps the FIRST capture of each period.** Not the most recent. Reverse the result set or filter client-side if you need the last.

- **CDX `matchType=domain` can return millions of rows for popular sites.** Always add `&limit=` or `&showNumPages=true` first to estimate size.

- **`showResumeKey=true` appends two sentinel rows.** The second-to-last row is `[]` (empty separator), the last row is `['<resume_key_string>']`. Slice `rows.slice(1, -2)` for data rows when a resume key is present.

- **Wayback toolbar is injected into every archived HTML page.** The injection is wrapped in `<!-- BEGIN WAYBACK TOOLBAR INSERT -->` / `<!-- END WAYBACK TOOLBAR INSERT -->` comments. Strip them if you need original HTML fidelity.

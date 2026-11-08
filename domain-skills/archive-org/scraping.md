# Internet Archive / Wayback Machine — Scraping & Data Extraction

`https://archive.org` / `https://web.archive.org` — all public data, no auth required. Every workflow here is pure `http_get` — no browser needed.

## Do this first

**Use the CDX API for anything Wayback-related — it is the reliable workhorse. The Wayback Availability API (`/wayback/available`) is known to return empty `archived_snapshots` even for well-archived URLs and should not be used as a primary mechanism.**

```ts
// Find snapshots of any URL — primary entry point for Wayback data
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
    "?url=iana.org&output=json&limit=5" +
    "&fl=timestamp,original,statuscode,mimetype,length",
  null, 40.0,
);
const rows = JSON.parse(r);
const headers = rows[0]; // ['timestamp', 'original', 'statuscode', 'mimetype', 'length']
for (const row of rows.slice(1)) {
  const [ts, orig, status, mime, length] = row;
  const snap_url = `https://web.archive.org/web/${ts}/${orig}`;
  console.log(`${ts}  ${status}  ${snap_url}`);
}
```

For item metadata (books, video, audio, software), go straight to:

```ts
const data = JSON.parse(await http_get(`https://archive.org/metadata/${identifier}`, null, 30.0));
```

## Common workflows

### Find the nearest archived snapshot to a target date

```ts
// CDX sort=closest returns the single snapshot nearest to the given timestamp
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
    "?url=iana.org&output=json&limit=1" +
    "&fl=timestamp,original,statuscode" +
    "&closest=20230601120000&sort=closest",
  null, 60.0, // CDX can be slow — always use timeout >= 40s
);
const rows = JSON.parse(r);
// rows[0] = header, rows[1] = closest snapshot
const [ts, orig, status] = rows[1];
const snap_url = `https://web.archive.org/web/${ts}/${orig}`;
// Result: ts='20230601114925', orig='https://www.iana.org/', status='200'
// snap_url: https://web.archive.org/web/20230601114925/https://www.iana.org/
```

Timestamp format is always 14-digit `YYYYMMDDHHMMSS`. Pass any prefix — `20230601` (day), `202306` (month), `2023` (year) — and CDX will match.

### List all monthly snapshots for a URL (collapsed)

```ts
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
    "?url=iana.org&output=json" +
    "&collapse=timestamp:6" + // :6 = dedupe by YYYYMM (one per month)
    "&from=20230101&to=20231231" +
    "&fl=timestamp,original",
  null, 60.0,
);
const rows = JSON.parse(r);
// rows[0] = header ['timestamp', 'original']
// rows[1:] = one row per month:
// ['20230101103807', 'https://www.iana.org/']
// ['20230201144829', 'https://www.iana.org/']
// ...12 rows for 2023

for (const [ts, orig] of rows.slice(1)) {
  console.log(`${ts.slice(0, 4)}-${ts.slice(4, 6)}  https://web.archive.org/web/${ts}/${orig}`);
}
```

`collapse=timestamp:N` deduplicates by the first N digits of the timestamp:
- `:4` = one per year, `:6` = one per month, `:8` = one per day

### List snapshots for an entire domain (all pages)

```ts
// matchType=domain captures all URLs under that domain
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
    "?url=iana.org&matchType=domain&output=json" +
    "&limit=10&fl=timestamp,original,statuscode" +
    "&collapse=timestamp:8", // one capture per URL per day
  null, 60.0,
);
const rows = JSON.parse(r);
for (const row of rows.slice(1)) console.log(row);
// ['19971210061738', 'http://www.iana.org:80/', '200']
// ['19980211065537', 'http://www.iana.org:80/', '200']
// ...
```

`matchType` options: `exact` (default), `prefix` (URL + subpaths), `host` (all subdomains), `domain` (host + all subdomains).

### Filter snapshots by prefix path

```ts
// All archived pages under /domains/ path
const r = await http_get(
  "https://web.archive.org/cdx/search/cdx" +
    "?url=iana.org/domains/&matchType=prefix&output=json" +
    "&limit=5&fl=timestamp,original,statuscode",
  null, 40.0,
);
const rows = JSON.parse(r);
for (const row of rows.slice(1)) console.log(row);
// ['20080509121811', 'http://www.iana.org/domains/', '200']
// ['20080704174537', 'http://iana.org/domains/', '200']
```

### Paginate CDX results with resumeKey

```ts
/** Iterate all CDX records for a URL, yielding rows (excluding header). */
async function* cdx_all_snapshots(url: string, fl = "timestamp,original,statuscode", page_size = 500) {
  const base =
    `https://web.archive.org/cdx/search/cdx` +
    `?url=${encodeURIComponent(url)}&output=json` +
    `&fl=${fl}&limit=${page_size}&showResumeKey=true`;
  let resume_key: string | null = null;
  while (true) {
    const endpoint = resume_key === null ? base : `${base}&resumeKey=${encodeURIComponent(resume_key)}`;
    const rows = JSON.parse(await http_get(endpoint, null, 60.0));
    // rows structure with showResumeKey=true:
    // [header, row1, row2, ..., [], [resume_key_string]]
    // The second-to-last row is [] (separator), last row is [resume_key]
    const has_resume = rows.length >= 2 && rows.at(-1).length > 0 && rows.at(-2).length === 0;
    const data_rows = has_resume ? rows.slice(1, -2) : rows.slice(1);
    yield* data_rows;
    if (!has_resume) break;
    resume_key = rows.at(-1)[0];
  }
}

for await (const row of cdx_all_snapshots("iana.org", "timestamp,original")) {
  const [ts, orig] = row;
  // process...
}
```

### Retrieve the actual archived page

```ts
// Direct snapshot URL: /web/{14-digit-timestamp}/{original-url}
const snap_url = "https://web.archive.org/web/19971210061738/http://www.iana.org:80/";
const content = await http_get(snap_url, null, 30.0);
// Returns the archived HTML with Wayback toolbar injected at top
// The toolbar is inside <!-- BEGIN WAYBACK TOOLBAR INSERT --> comments

// The calendar view URL pattern (for browser navigation, not http_get):
// https://web.archive.org/web/20230101000000*/python.org
// The * tells Wayback to show the calendar — returns HTML, not raw page
```

### Item metadata (books, video, audio, software, collections)

```ts
const identifier = "HardWonWisdomTrailer";
const data = JSON.parse(await http_get(`https://archive.org/metadata/${identifier}`, null, 30.0));

// Top-level keys:
// alternate_locations, created, d1, d2, dir, files, files_count,
// is_collection, item_last_updated, item_size, metadata, server, uniq, workable_servers

const meta = data.metadata;
// Common metadata fields (not all present on every item):
console.log(meta.identifier);   // 'HardWonWisdomTrailer'
console.log(meta.title);        // 'Hard Won Wisdom Trailer'
console.log(meta.mediatype);    // 'movies' | 'texts' | 'audio' | 'software' | 'collection'
console.log(meta.creator);      // 'jakemauz'
console.log(meta.date);         // '2017-02-18'
console.log(meta.description);  // HTML string — strip tags if needed
console.log(meta.subject);      // str OR list of str depending on item
console.log(meta.publicdate);   // '2017-02-18 11:51:16'
console.log(meta.collection);   // parent collection identifier

const files = data.files;
// Each file entry:
// name, source ('original'|'derivative'|'metadata'), format, size (bytes as str),
// md5, sha1, crc32, mtime
// For video/audio: length (seconds as str), height, width
// For derivative: original (name of source file)

// Find the primary original file
const orig_files = files.filter((f: any) => f.source === "original");
// orig_files[0]: {'name': 'Hard-won wisdom trailer.mp4', 'source': 'original',
//  'format': 'MPEG4', 'size': '7532153', 'length': '94.13',
//  'height': '360', 'width': '640', 'md5': 'aaeebe0481...', ...}

// Build download URL — two equivalent forms:
const server = data.server;     // 'ia601405.us.archive.org'
const dir_path = data.dir;      // '/2/items/HardWonWisdomTrailer'
const fname = orig_files[0].name;
// Form 1: direct storage server (fastest)
const url1 = `https://${server}${dir_path}/${encodeURIComponent(fname)}`;
// Form 2: standard redirect URL (always works, resolved by CDN)
const url2 = `https://archive.org/download/${identifier}/${encodeURIComponent(fname)}`;
// Both confirmed status 200, Content-Type: video/mp4
```

### Search items (books, audio, video, software)

```ts
// advancedsearch.php is the correct API — /search returns HTML
const r = await http_get(
  "https://archive.org/advancedsearch.php" +
    "?q=artificial+intelligence+AND+mediatype:texts" +
    "&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=downloads" +
    "&rows=5&sort[]=downloads+desc&output=json",
  null, 30.0,
);
const data = JSON.parse(r);
// data.responseHeader.status = 0 (success)
// data.responseHeader.QTime = query time ms
// data.response.numFound = 25911 (total matches)
// data.response.start = 0 (offset)
// data.response.docs = list of item objects

const resp = data.response;
console.log(`Total: ${resp.numFound}, showing: ${resp.docs.length}`);
for (const doc of resp.docs) {
  console.log(`  ${doc.identifier}  ${(doc.title ?? "").slice(0, 50)}`);
  // doc fields are only present if they have values — always use ?? defaults
}
```

Pagination: use `start=` offset (not `page=`). Max `rows=` is not documented but 100 works reliably.

### Search with all supported parameters

```ts
const r = await http_get(
  "https://archive.org/advancedsearch.php" +
    "?q=machine+learning+AND+mediatype:texts" + // Lucene query syntax
    "&fl[]=identifier&fl[]=title&fl[]=date&fl[]=year" +
    "&fl[]=creator&fl[]=subject&fl[]=description&fl[]=downloads" +
    "&rows=3" +
    "&start=0" +          // pagination offset
    "&sort[]=date+desc" + // sort field + direction
    "&output=json",
  null, 30.0,
);
const data = JSON.parse(r);
// Confirmed fields in fl[]:
// identifier, title, date, year, creator, subject, description,
// downloads, mediatype, collection, language, avg_rating, num_reviews

// mediatype values: texts, audio, movies, software, image, etree, data, collection, account
// Sort fields: date, downloads, avg_rating, num_reviews, publicdate, addeddate
```

## API reference

| Endpoint | What it returns | Auth |
|---|---|---|
| `web.archive.org/cdx/search/cdx?url=...&output=json` | Snapshot index: all captures of a URL | None |
| `archive.org/wayback/available?url=...` | Nearest snapshot (DEGRADED — see gotchas) | None |
| `archive.org/metadata/{identifier}` | Item metadata + files list | None |
| `archive.org/advancedsearch.php?q=...&output=json` | Full-text + metadata search | None |
| `archive.org/download/{identifier}/{filename}` | Direct file download | None |
| `web.archive.org/web/{timestamp}/{url}` | Archived page HTML | None |

## CDX field reference

The CDX API returns a JSON array of arrays. The first row is always the header when `output=json`.

| Field | Description | Example |
|---|---|---|
| `urlkey` | SURT-format URL (reversed domain, path in parens) | `org,iana)/` |
| `timestamp` | Capture time, 14-digit `YYYYMMDDHHMMSS` | `19971210061738` |
| `original` | Original crawled URL (exact, including port) | `http://www.iana.org:80/` |
| `mimetype` | Content-Type of the archived response | `text/html` |
| `statuscode` | HTTP status at crawl time | `200` |
| `digest` | SHA-1 of response body, base32-encoded | `I4YBMQ6PHPWE2TD6TIXNWHZB6MXRNTSR` |
| `length` | Content length in bytes (as string) | `1418` |

Default `fl=` when omitted: `urlkey,timestamp,original,mimetype,statuscode,digest,length` (all 7 fields in that order).

## Rate limits

No auth, no API key. In practice:
- CDX API: **intermittently slow** — individual queries time out at 20s and succeed at 40–60s. Always pass a 40-second timeout minimum (`http_get(url, null, 40.0)`). 3 rapid sequential CDX calls in ~10s completed; 10 rapid calls produced 3 timeouts.
- Metadata API: Fast and reliable — 5 sequential calls completed in 3.0s with no errors.
- Search API: Fast — typically responds in 30–65ms (`QTime` in response header).
- No documented per-second or per-day limits. Archive.org's policy is to be respectful: add `await wait(1)` between CDX calls in loops.

## Gotchas

- **CDX times out — always pass a timeout of 40.0 or higher (`http_get(url, null, 40.0)`).** The default 20s is often too short for CDX. Metadata and search APIs are fine at 20–30s. CDX slowness is backend-side and unpredictable; add retry logic for production use.

- **Wayback Availability API is unreliable.** `GET /wayback/available?url=iana.org` returns `{"url": "iana.org", "archived_snapshots": {}}` even for URLs confirmed archived via CDX. Tested 2026-04-18 across many URLs and timestamp combinations — consistently empty. Use `CDX ?sort=closest&limit=1` instead (confirmed working).

- **CDX first row is always the header when `output=json`.** `rows[0]` is `['timestamp', 'original', ...]`, not a data row. Always use `rows.slice(1)` for data. When `showResumeKey=true`, the last two rows are `[]` (separator) and `['<resume_key_string>']`.

- **CDX `fl=` must match exactly what you iterate.** If you request `&fl=timestamp,original` you get 2-element rows; forgetting a field breaks destructuring. When in doubt, omit `fl=` entirely and get all 7 fields.

- **`output=json` is required — there is no default JSON mode.** Omitting `output=json` returns space-separated text. `output=text` also works and is slightly faster for simple queries.

- **`timestamp` is a string, not an integer.** Even in JSON, CDX returns all fields as strings: `'1418'` not `1418`, `'200'` not `200`. Cast explicitly: `Number(row[4])`, `Number(row[6])`.

- **The `original` field preserves port numbers.** Old crawls captured `http://www.iana.org:80/` — the `:80` is part of the URL. When building a playback URL, use `original` verbatim: `` `https://web.archive.org/web/${ts}/${orig}` `` works correctly with the port included.

- **Metadata `{}` means the item doesn't exist or is private.** `http_get("https://archive.org/metadata/nonexistent")` returns `'{}'` (2-byte response) with HTTP 200. Always check `if (!data.metadata)` before accessing fields.

- **Metadata `subject` can be a string or a list.** When a single subject tag is set, the API returns `"subject": "short film"`. When multiple, it returns `"subject": ["short film", "spoken word"]`. Normalize with: `const subjects = typeof meta.subject === "string" ? [meta.subject] : meta.subject ?? []`.

- **File `size` and `length` are strings, not numbers.** `files[0].size` is `'7532153'` (bytes). `files[0].length` is `'94.13'` (seconds for video/audio). Cast with `parseInt()` and `parseFloat()` respectively.

- **Use `archive.org/download/` not the raw storage server URL for reliability.** The raw URL (`ia601405.us.archive.org/2/items/...`) is faster but server-specific. `archive.org/download/{id}/{file}` redirects to the correct storage node and remains stable as items migrate.

- **`/search?output=json` returns HTML, not JSON.** The `/search` endpoint is a React SPA — it ignores `output=json`. Always use `advancedsearch.php` for programmatic access.

- **`collapse=timestamp:6` gives one row per month, but it keeps the FIRST capture of that month.** If you want the last, you'd need to reverse and re-collapse, or fetch all and filter client-side. The `collapse` parameter de-duplicates by truncating the timestamp to N digits and keeping the first matching row.

- **CDX `from=` / `to=` accept partial timestamps.** `from=20230101` means `20230101000000`. `to=20231231` means `20231231000000` (exclusive). To include all of 2023, use `to=20240101`.

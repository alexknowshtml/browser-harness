# ArXiv — Scraping & Data Extraction

`https://arxiv.org` — open-access preprint server. **Never use the browser for ArXiv.** All data is reachable via `http_get` using the Atom API or HTML meta tags. No API key required.

## Do this first

**Use the Atom API for any paper search or metadata fetch — one call, XML response, no auth.**

```ts
// No XML parser in the runner: small regex helpers cover arXiv's flat Atom feed.
const tag = (x: string, n: string) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? null;
const entriesOf = (x: string) => [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);

const xml = await http_get("http://export.arxiv.org/api/query?search_query=ti:transformer+AND+cat:cs.LG&max_results=5&sortBy=submittedDate&sortOrder=descending");
const entries = entriesOf(xml);
```

Use `id_list` for known paper IDs — supports comma-separated batch fetch in a single call.

Use `http_get` on `https://arxiv.org/abs/{id}` + regex for `citation_*` meta tags when you need the full abstract from an HTML page.

## Common workflows

### Search papers (API)

```ts
const tag = (x: string, n: string) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? null;
const entriesOf = (x: string) => [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
// Self-closing elements (<category term=.../>, <link .../>) -> list of attribute objects
const elems = (x: string, n: string) =>
  [...x.matchAll(new RegExp(`<${n}\\s([^>]*?)/?>`, "g"))].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));

const xml = await http_get(
  "http://export.arxiv.org/api/query" +
    "?search_query=ti:transformer+AND+cat:cs.LG" +
    "&max_results=5&sortBy=submittedDate&sortOrder=descending",
);
for (const e of entriesOf(xml)) {
  const title = tag(e, "title")!.trim().replace(/\n/g, " ");
  const arxiv_id = tag(e, "id")!.split("/").at(-1)!; // e.g. '2604.15259v1'
  const published = tag(e, "published")!.slice(0, 10); // '2026-04-16'
  const updated = tag(e, "updated")!.slice(0, 10);
  const abstract = tag(e, "summary")!.trim();
  const authors = [...e.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g)].map((m) => m[1]);
  const cats = elems(e, "category").map((c) => c.term);
  const primary = elems(e, "arxiv:primary_category")[0]?.term;
  const comment = tag(e, "arxiv:comment");
  const pdf_link = elems(e, "link").find((l) => l.title === "pdf")?.href ?? null;
  const abs_link = elems(e, "link").find((l) => l.rel === "alternate")?.href ?? null;
  console.log(arxiv_id, published, title.slice(0, 60));
  console.log("  Authors:", authors.slice(0, 2));
  console.log("  PDF:", pdf_link);
}
// Confirmed output (2026-04-18):
// 2604.15259v1 2026-04-16 Stability and Generalization in Looped Transformers
//   Authors: ['Asher Labovich']
//   PDF: https://arxiv.org/pdf/2604.15259v1
```

### Fetch single paper by ID (API)

```ts
const tag = (x: string, n: string) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? null;
const elems = (x: string, n: string) =>
  [...x.matchAll(new RegExp(`<${n}\\s([^>]*?)/?>`, "g"))].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])));

const xml = await http_get("http://export.arxiv.org/api/query?id_list=1706.03762");
const e = tag(xml, "entry")!;
const title = tag(e, "title")!.trim();
const abstract = tag(e, "summary")!.trim();
const categories = elems(e, "category").map((c) => c.term);
const pdf_link = elems(e, "link").find((l) => l.title === "pdf")?.href ?? null;
console.log("Title:", title);
console.log("Categories:", categories);
console.log("PDF:", pdf_link);
console.log("Abstract:", abstract.slice(0, 200));
// Confirmed output:
// Title: Attention Is All You Need
// Categories: ['cs.CL', 'cs.LG']
// PDF: https://arxiv.org/pdf/1706.03762v7
// Abstract: The dominant sequence transduction models are based on complex recurrent...
```

### Batch fetch by comma-separated IDs (single call — fast)

Fetching 10 IDs in one call takes ~2s. Prefer this over parallel single-ID fetches.

```ts
const tag = (x: string, n: string) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? null;
const entriesOf = (x: string) => [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);

const ids = ["1706.03762", "1810.04805", "2005.14165"]; // Transformer, BERT, GPT-3
const xml = await http_get(`http://export.arxiv.org/api/query?id_list=${ids.join(",")}&max_results=${ids.length}`);
for (const e of entriesOf(xml)) {
  const arxiv_id = tag(e, "id")!.split("/").at(-1);
  const title = tag(e, "title")!.trim();
  const published = tag(e, "published")!.slice(0, 10);
  console.log(arxiv_id, published, title.slice(0, 60));
}
// Confirmed output:
// 1512.03385v1 2015-12-10 Deep Residual Learning for Image Recognition
// 1706.03762v7 2017-06-12 Attention Is All You Need
// 2005.14165v4 2020-05-28 Language Models are Few-Shot Learners
// 1810.04805v2 2018-10-11 BERT: Pre-training of Deep Bidirectional Transformers...
// Note: order returned may differ from order requested
```

### Parallel fetch (Promise.all for independent IDs)

Use only when IDs are not known upfront or when mixing with other work. For pure batch, single comma-separated `id_list` call is faster.

```ts
const tag = (x: string, n: string) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? null;

async function fetch_paper(arxiv_id: string) {
  const xml = await http_get(`http://export.arxiv.org/api/query?id_list=${arxiv_id}`);
  const e = tag(xml, "entry");
  if (e === null) return null;
  return {
    id: arxiv_id,
    title: tag(e, "title")!.trim(),
    published: tag(e, "published")!.slice(0, 10),
  };
}

const ids = ["1706.03762", "1810.04805", "2005.14165"];
const papers = await Promise.all(ids.map(fetch_paper));
for (const p of papers) if (p) console.log(p.id, p.published, p.title.slice(0, 60));
// Confirmed working — 3 in flight is safe; don't exceed 5 for continuous crawling
```

### HTML abstract page — citation_* meta tags

Use this when you want the full abstract or the versionless PDF URL without parsing Atom XML.

```ts
const html = await http_get("https://arxiv.org/abs/1706.03762", { "User-Agent": "Mozilla/5.0" });
// HTML page is ~48 KB, fully static, no JS required

const title = html.match(/<meta name="citation_title" content="([^"]+)"/);
const pdf_url = html.match(/<meta name="citation_pdf_url" content="([^"]+)"/);
const authors = [...html.matchAll(/<meta name="citation_author" content="([^"]+)"/g)].map((m) => m[1]);
const date = html.match(/<meta name="citation_date" content="([^"]+)"/);
const arxiv_id = html.match(/<meta name="citation_arxiv_id" content="([^"]+)"/);
const abstract = html.match(/<meta name="citation_abstract" content="([^"]+)"/);

console.log("Title:", title ? title[1] : null);
console.log("PDF:", pdf_url ? pdf_url[1] : null);
console.log("Authors:", authors.slice(0, 3));
console.log("Date:", date ? date[1] : null);
console.log("ID:", arxiv_id ? arxiv_id[1] : null);
// Confirmed output for 1706.03762:
// Title: Attention Is All You Need
// PDF: https://arxiv.org/pdf/1706.03762   (no version suffix — always latest)
// Authors: ['Vaswani, Ashish', 'Shazeer, Noam', 'Parmar, Niki']
// Date: 2017/06/12
// ID: 1706.03762
```

All `citation_*` meta tags present on the abs page:
- `citation_title` — paper title
- `citation_author` — one tag per author, format `"Last, First"`
- `citation_date` — submission date `YYYY/MM/DD`
- `citation_online_date` — latest version date `YYYY/MM/DD`
- `citation_pdf_url` — versionless PDF URL (redirects to latest)
- `citation_arxiv_id` — bare ID without version suffix
- `citation_abstract` — full abstract text

### Category search with pagination

```ts
const tag = (x: string, n: string) => x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? null;
const entriesOf = (x: string) => [...x.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);

// Page 1
const xml = await http_get(
  "http://export.arxiv.org/api/query" +
    "?search_query=cat:cs.AI" +
    "&max_results=10&start=0&sortBy=lastUpdatedDate&sortOrder=descending",
);
const total = tag(xml, "opensearch:totalResults"); // e.g. '172726'
const start_i = tag(xml, "opensearch:startIndex");
const per_pg = tag(xml, "opensearch:itemsPerPage");
console.log(`Total cs.AI papers: ${total}`); // Confirmed: 172726 (2026-04-18)

const entries = entriesOf(xml);

// Page 2: increment start
const xml2 = await http_get(
  "http://export.arxiv.org/api/query" +
    "?search_query=cat:cs.AI" +
    "&max_results=10&start=10&sortBy=lastUpdatedDate&sortOrder=descending",
);
```

## URL and ID reference

### API base URL

```
http://export.arxiv.org/api/query
```

HTTPS also works: `https://export.arxiv.org/api/query`

### Query parameters

| Parameter | Values | Notes |
|---|---|---|
| `search_query` | `ti:word`, `au:name`, `abs:phrase`, `cat:cs.LG`, combine with `AND`/`OR`/`ANDNOT` | URL-encode spaces as `+` |
| `id_list` | `1706.03762` or `1706.03762,1810.04805` | Comma-separated; version suffix optional |
| `max_results` | integer (default 10, max 2000) | |
| `start` | integer (default 0) | Offset for pagination |
| `sortBy` | `relevance`, `lastUpdatedDate`, `submittedDate` | |
| `sortOrder` | `ascending`, `descending` | |

### Search field prefixes

| Prefix | Searches |
|---|---|
| `ti:` | Title |
| `au:` | Author name |
| `abs:` | Abstract |
| `co:` | Comment |
| `jr:` | Journal reference |
| `cat:` | Category (e.g. `cat:cs.LG`) |
| `all:` | All fields |

### PDF and abstract URL construction

```ts
const arxiv_id = "1706.03762v7";             // from API atom:id field
const bare_id = arxiv_id.replace(/v\d+$/, ""); // strip version: '1706.03762'

const pdf_versioned = `https://arxiv.org/pdf/${arxiv_id}`; // specific version
const pdf_latest = `https://arxiv.org/pdf/${bare_id}`;     // always redirects to latest
const abs_versioned = `https://arxiv.org/abs/${arxiv_id}`;
const abs_latest = `https://arxiv.org/abs/${bare_id}`;
```

The API's `atom:link[@title='pdf']` href includes the version suffix. The HTML `citation_pdf_url` meta tag does not — it always resolves to the latest.

### Category codes (confirmed paper counts, 2026-04-18)

| Code | Area | Papers |
|---|---|---|
| `cs.LG` | Machine Learning | 261,782 |
| `cs.CV` | Computer Vision | 189,049 |
| `cs.AI` | Artificial Intelligence | 172,726 |
| `cs.CL` | Computation and Language (NLP) | 106,724 |
| `stat.ML` | Statistics - Machine Learning | 76,902 |
| `math.OC` | Optimization and Control | 60,669 |
| `eess.AS` | Audio and Speech Processing | 21,288 |
| `cs.NE` | Neural and Evolutionary Computing | 17,475 |
| `q-bio.NC` | Neurons and Cognition | 11,903 |

Full category taxonomy: https://arxiv.org/category_taxonomy

## Gotchas

- **Never use the browser for ArXiv.** The abstract page (`/abs/`) and search results are fully server-side rendered static HTML. `http_get` is sufficient for everything including full abstracts, author lists, and PDF URLs.

- **Match ArXiv-specific fields with their `arxiv:` prefix.** Standard Atom elements are unprefixed in the feed (`<entry>`, `<title>`); ArXiv-specific fields (`comment`, `primary_category`, `journal_ref`, `doi`) appear as `<arxiv:comment>` etc., and paging counts as `<opensearch:totalResults>`. The regex helpers above match the literal tag name, so include the prefix. Values are raw XML text: decode entities like `&amp;` if you need them.

- **Batch single `id_list` call is faster than parallel single fetches.** A comma-separated `id_list` with 10 IDs resolved in one call (1.91s) vs. 10 separate parallel calls (6.34s). Use the batch form when you already have the IDs.

- **`atom:id` contains a URL, not a bare ID.** The element text is `http://arxiv.org/abs/1706.03762v7` — always split on `/` and take `.at(-1)` to get the bare ID with version. Strip version with `id.replace(/v\d+$/, "")` if needed.

- **Batch `id_list` returns entries in unpredictable order.** When fetching `1706.03762,1810.04805,2005.14165`, entries came back ordered by publication date, not by the order given in the request. Index by ID, not position.

- **`max_results` must be set explicitly when using `id_list` batches.** If you request 10 IDs but omit `max_results`, the API defaults to 10, which happens to work — but set it explicitly to `len(ids)` to be safe.

- **Nonexistent IDs return zero entries, not an error.** `id_list=9999.99999` gives `totalResults=0` and an empty `atom:entry` list. Always check `entries.length > 0` before accessing `entries[0]`.

- **`arxiv:comment` and `arxiv:journal_ref` / `arxiv:doi` may be absent.** Not all papers have these fields. Use `tag(e, "arxiv:comment")` and check for `null` or empty.

- **Rate limit: 3 seconds between requests recommended for bulk crawling.** In practice, rapid bursts of 10 individual requests complete in ~6s (avg 0.63s/req) without being blocked. For sustained crawls over hundreds of papers, insert `await wait(3)` between requests. The API does not return rate limit headers — it just starts slowing responses or returns HTTP 503 silently.

- **`citation_author` tags are in `"Last, First"` format**, not `"First Last"` like the Atom API. The Atom `atom:author/atom:name` field gives `"First Last"` order. Pick the format that matches your downstream use.

- **The `arxiv:affiliation` sub-element of `atom:author` is rarely populated.** Most institutional affiliations are absent from the API response even when listed on the paper. The HTML abs page doesn't expose them in meta tags either.

- **`sortBy=relevance` applies only with `search_query`.** Using `sortBy=relevance` with `id_list` has no effect — results still come back in date order.

- **`max_results` cap is 2000 per call.** For bulk harvesting of a category, use `start` offset pagination and add 3s sleep between pages. `opensearch:totalResults` tells you the total so you can compute how many pages are needed.

- **HTML `citation_abstract` meta tag contains the full abstract.** Unlike the Atom `atom:summary` which can have trailing whitespace and embedded newlines, the meta tag version is a single clean string — no `.trim()` needed.

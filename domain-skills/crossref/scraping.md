# CrossRef — Scraping & Data Extraction

`https://api.crossref.org` — scholarly DOI and citation metadata. **Never use the browser for CrossRef.** Completely free, no auth required. All workflows use `http_get`.

## Do this first

**Always add `mailto=your@email.com` to every request** — it moves you into the polite pool, which doubles the rate limit and concurrency allowance. The difference is measurable and the cost is zero.

```ts
const MAILTO = "mailto=your@email.com"  // set once, append to every URL

// Single DOI lookup — fastest way to get metadata for a known paper
const data = JSON.parse(await http_get(`https://api.crossref.org/works/10.1038/s41586-021-03819-2?${MAILTO}`))
const msg = data.message
// msg keys: DOI, title, author, published, type, container-title, volume, issue,
//           page, is-referenced-by-count, references-count, abstract (optional), ...
```

## Common workflows

### DOI lookup — single paper

```ts
const MAILTO = "mailto=your@email.com"

async function fetch_work(doi: string) {
  const data = JSON.parse(await http_get(`https://api.crossref.org/works/${doi}?${MAILTO}`))
  return data.message
}

function parse_date(d: any) {
  // [[2021, 7, 15]] -> '2021-7-15'. Handles partial dates like [[2021]].
  if (!d) return null
  const parts = (d["date-parts"] ?? [[]])[0]
  return parts.filter((p: any) => p !== null).join("-")
}

function clean_abstract(raw: string) {
  // Strip JATS XML tags. Abstract field contains tags like <jats:p>, <jats:italic>.
  return raw ? raw.replace(/<[^>]+>/g, " ").trim() : null
}

const w = await fetch_work("10.1038/s41586-021-03819-2")  // AlphaFold2

console.log("DOI:", w.DOI)                                       // 10.1038/s41586-021-03819-2
console.log("Title:", w.title[0])                                // Highly accurate protein structure...
console.log("Type:", w.type)                                     // journal-article
console.log("Publisher:", w.publisher)                           // Springer Science and Business Media LLC
console.log("Journal:", (w["container-title"] ?? [""])[0])       // Nature
console.log("Volume:", w.volume)                                 // 596
console.log("Issue:", w.issue)                                   // 7873
console.log("Page:", w.page)                                     // 583-589
console.log("published:", parse_date(w.published))              // 2021-7-15  (online date)
console.log("published-online:", parse_date(w["published-online"]))  // 2021-7-15
console.log("published-print:", parse_date(w["published-print"]))    // 2021-8-26
console.log("Citations:", w["is-referenced-by-count"])           // 40260
console.log("References:", w["references-count"])                // 84
console.log("Abstract:", w.abstract ? clean_abstract(w.abstract)!.slice(0, 100) : null)
// Confirmed output (2026-04-18):
// DOI: 10.1038/s41586-021-03819-2
// Title: Highly accurate protein structure prediction with AlphaFold
// Type: journal-article
// Journal: Nature
// Volume: 596 | Issue: 7873 | Page: 583-589
// published: 2021-7-15 | published-print: 2021-8-26
// Citations: 40260
```

### DOI lookup — extract authors with ORCID

```ts
const MAILTO = "mailto=your@email.com"
const data = JSON.parse(await http_get(`https://api.crossref.org/works/10.1038/s41586-021-03819-2?${MAILTO}`))
const authors = data.message.author ?? []

for (const a of authors.slice(0, 3)) {
  const name = `${a.given ?? ""} ${a.family ?? ""}`.trim()
  // ORCID is a full URL, not a bare ID — strip the prefix
  const orcid_url = a.ORCID  // e.g. 'https://orcid.org/0000-0001-6169-6580'
  const orcid_id = orcid_url ? orcid_url.replace("https://orcid.org/", "") : null
  const authenticated = a["authenticated-orcid"] ?? false  // false = self-reported, true = verified
  const affiliations = (a.affiliation ?? []).map((aff: any) => aff.name ?? "")
  console.log(`${name} | ORCID: ${orcid_id} | auth=${authenticated} | seq=${a.sequence}`)
}
// Confirmed output:
// John Jumper | ORCID: 0000-0001-6169-6580 | auth=false | seq=first
// Richard Evans | ORCID: null | auth=false | seq=additional
// Alexander Pritzel | ORCID: null | auth=false | seq=additional
```

### Batch DOI lookup (parallel — 5 calls in ~0.3s)

```ts
const MAILTO = "mailto=your@email.com"

async function fetch_work(doi: string) {
  try {
    const data = JSON.parse(await http_get(`https://api.crossref.org/works/${doi}?${MAILTO}`))
    const msg = data.message
    return {
      doi,
      title: (msg.title ?? [""])[0],
      year: (msg.published?.["date-parts"] || [[null]])[0][0],
      citations: msg["is-referenced-by-count"],
      type: msg.type,
    }
  } catch (e) {
    return { doi, error: String(e) }
  }
}

const dois = [
  "10.1038/nature12345",
  "10.1038/s41586-021-03819-2",
  "10.1056/NEJMoa2034577",
  "10.1126/science.1260419",
  "10.1038/s41586-024-07487-w",
]

// 5 at once is safe; polite pool: 10 req/s, concurrency=3 (see Rate limits)
const results: any[] = await Promise.all(dois.map(fetch_work))

for (const r of results) {
  console.log(r.year, `cites=${r.citations}`, r.title.slice(0, 50))
}
// Confirmed output (2026-04-18, ~0.296s total):
// 2013 cites=465 LRG1 promotes angiogenesis by modulating endotheli
// 2021 cites=40260 Highly accurate protein structure prediction with
// 2020 cites=13752 Safety and Efficacy of the BNT162b2 mRNA Covid-19
// 2015 cites=13553 Tissue-based map of the human proteome
// 2024 cites=12037 Accurate structure prediction of biomolecular inte
```

### Search works by keyword

```ts
const MAILTO = "mailto=your@email.com"

// Broad keyword search
const data = JSON.parse(await http_get(
  `https://api.crossref.org/works?query=machine+learning&rows=5&${MAILTO}`
))
const msg = data.message
console.log("Total results:", msg["total-results"])   // 2,805,391
for (const item of msg.items) {
  const title = (item.title ?? ["(no title)"])[0].slice(0, 60)
  const doi   = item.DOI ?? ""
  const year  = (item.published?.["date-parts"] || [[null]])[0][0]
  const type_ = item.type ?? ""
  console.log(`  [${type_}] ${year} ${title}`)
  console.log(`    DOI: ${doi}`)
}
```

### Search by author + title (targeted)

```ts
const MAILTO = "mailto=your@email.com"

const data = JSON.parse(await http_get(
  `https://api.crossref.org/works?query.author=Lecun&query.title=deep+learning&rows=5&${MAILTO}`
))
const msg = data.message
console.log("Total results:", msg["total-results"])   // 62
for (const item of msg.items.slice(0, 3)) {
  const title   = (item.title ?? [""])[0].slice(0, 60)
  const authors = (item.author ?? []).slice(0, 2).map((a: any) => a.family ?? "").join(", ")
  const year    = (item.published?.["date-parts"] || [[null]])[0][0]
  console.log(`  ${year} ${title}`)
  console.log(`    Authors: ${authors}  DOI: ${item.DOI}`)
}
// Confirmed output:
// 2015 Deep learning & convolutional networks
//   Authors: LeCun  DOI: 10.1109/hotchips.2015.7477328
```

### Filter by date, type, and sort by citations

```ts
const MAILTO = "mailto=your@email.com"

const data = JSON.parse(await http_get(
  "https://api.crossref.org/works"
  + "?filter=from-pub-date:2024-01-01,type:journal-article"
  + `&rows=5&sort=is-referenced-by-count&order=desc&${MAILTO}`
))
const msg = data.message
console.log("Total 2024+ journal articles:", msg["total-results"])   // 14,565,456
for (const item of msg.items.slice(0, 3)) {
  const title = (item.title ?? [""])[0].slice(0, 60)
  const cites = item["is-referenced-by-count"] ?? 0
  const year  = (item.published?.["date-parts"] || [[null]])[0][0]
  console.log(`  ${year} cites=${cites} ${title}`)
}
// Confirmed output:
// 2024 cites=17371 Global cancer statistics 2022: GLOBOCAN estimates...
// 2024 cites=12037 Accurate structure prediction of biomolecular int...
```

### Filter with `has-abstract:true`

```ts
const MAILTO = "mailto=your@email.com"

// Only return works that have an abstract (useful since ~30-70% do not)
const data = JSON.parse(await http_get(
  "https://api.crossref.org/works"
  + "?filter=from-pub-date:2023-01-01,until-pub-date:2023-12-31"
  + ",type:journal-article,has-abstract:true"
  + `&rows=3&sort=is-referenced-by-count&order=desc&${MAILTO}`
))
const msg = data.message
console.log("2023 journal articles with abstract:", msg["total-results"])   // 3,041,841
for (const item of msg.items) {
  console.log((item.title ?? [""])[0].slice(0, 60), "| cites:", item["is-referenced-by-count"])
}
// Confirmed output:
// Cancer statistics, 2023 | cites: 12919
// Evolutionary-scale prediction of atomic-level protein struct | cites: 4352
```

### Cursor pagination (large result sets)

Standard offset pagination (`start=`) caps at a few thousand results. Use cursor for full sweeps.

```ts
const MAILTO = "mailto=your@email.com"

// First page: cursor=*
let data = JSON.parse(await http_get(
  `https://api.crossref.org/works?query=covid&rows=100&cursor=*&${MAILTO}`
))
let msg = data.message
console.log("Total results:", msg["total-results"])   // 897,660
let items = msg.items
let next_cursor = msg["next-cursor"]   // base64 string like "DnF1ZXJ5VGhlbkZldGNoJA..."

// Next pages: pass URL-encoded cursor
while (next_cursor && items.length) {
  data = JSON.parse(await http_get(
    "https://api.crossref.org/works?query=covid&rows=100"
    + `&cursor=${encodeURIComponent(next_cursor)}&${MAILTO}`
  ))
  msg = data.message
  items = msg.items ?? []
  next_cursor = msg["next-cursor"]
  // process items...
  break  // remove for full sweep
}
```

### Fetch specific fields only (`select=`)

Reduces response size significantly for bulk operations:

```ts
const MAILTO = "mailto=your@email.com"

const data = JSON.parse(await http_get(
  "https://api.crossref.org/works?query=cancer&rows=5"
  + `&select=DOI,title,author&${MAILTO}`
))
// Warning: if a field is absent for a record, it simply won't appear in that item
for (const item of data.message.items) {
  console.log(Object.keys(item))   // only ['DOI', 'title'] or ['DOI', 'title', 'author']
  // Note: select= does NOT guarantee the field appears — absent fields are just omitted
}
```

### Count by type using facets

```ts
const MAILTO = "mailto=your@email.com"

const data = JSON.parse(await http_get(
  "https://api.crossref.org/works?query=machine+learning&rows=0"
  + `&facet=type-name:*&${MAILTO}`
))
const msg = data.message
const type_facet = msg.facets["type-name"]
for (const [k, v] of Object.entries<number>(type_facet.values).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v.toLocaleString("en-US")}`)
}
// Confirmed output (all CrossRef, 2026-04-18):
// Journal Article: 1,628,997 (for query=machine+learning scope)
// Conference Paper: 501,433
// Chapter: 455,907
// Posted Content: 87,937
// ...
```

### Journal info by ISSN

```ts
const MAILTO = "mailto=your@email.com"

// Nature (ISSN 0028-0836)
const data = JSON.parse(await http_get(`https://api.crossref.org/journals/0028-0836?${MAILTO}`))
const msg = data.message
console.log("Title:", msg.title)                          // Nature
console.log("Publisher:", msg.publisher)                  // Springer Science and Business Media LLC
console.log("ISSN:", msg.ISSN)                            // ['0028-0836', '1476-4687']
console.log("Total DOIs:", msg.counts["total-dois"])      // 445,417
console.log("Subjects:", msg.subjects ?? [])              // [] (not always populated)

// Search journals by name
const data2 = JSON.parse(await http_get(`https://api.crossref.org/journals?query=nature&rows=3&${MAILTO}`))
for (const j of data2.message.items) {
  console.log(`${j.title} | ISSN: ${JSON.stringify(j.ISSN)} | DOIs: ${j.counts?.["total-dois"]}`)
}
// Confirmed output:
// NatureJobs | ISSN: [] | DOIs: 0
// Naturen | ISSN: ["0028-0887","1504-3118"] | DOIs: 1055
```

### Funder search

```ts
const MAILTO = "mailto=your@email.com"

const data = JSON.parse(await http_get(
  `https://api.crossref.org/funders?query=national+science+foundation&rows=3&${MAILTO}`
))
const msg = data.message
console.log("Total funders:", msg["total-results"])   // 108
for (const f of msg.items) {
  console.log(`  ID: ${f.id} | ${f.name}`)
  console.log(`    Alt names: ${JSON.stringify((f["alt-names"] ?? []).slice(0, 2))}`)
  console.log(`    URI: ${f.uri}`)
}
// Confirmed output:
// ID: 501100001711 | Schweizerischer Nationalfonds zur Förderung...
// ID: 100000143 | Division of Computing and Communication Foundations
```

### DOI content negotiation (alternative, no CrossRef API needed)

The `doi.org` resolver can return formatted metadata directly via `Accept` header:

```ts
async function doi_to_csl(doi: string) {
  // Fetch CSL-JSON via DOI content negotiation. Same data as CrossRef API.
  return JSON.parse(await http_get(`https://doi.org/${doi}`, {
    Accept: "application/vnd.citationstyles.csl+json",
  }))
}

async function doi_to_bibtex(doi: string) {
  // Fetch BibTeX via DOI content negotiation.
  return http_get(`https://doi.org/${doi}`, { Accept: "application/x-bibtex" })
}

const csl = await doi_to_csl("10.1038/nature12345")
console.log("Title:", csl.title)   // LRG1 promotes angiogenesis...
console.log("Type:", csl.type)     // journal-article

const bib = await doi_to_bibtex("10.1038/nature12345")
console.log(bib.slice(0, 200))
// @article{Wang_2013, title={LRG1 promotes angiogenesis...
```

## Field reference

### Work object — complete field list

All fields are potentially absent unless marked required. Fields marked (R) are always present.

| Field | Type | Notes |
|---|---|---|
| `DOI` (R) | string | e.g. `"10.1038/s41586-021-03819-2"` |
| `URL` (R) | string | `"https://doi.org/10.1038/s41586-021-03819-2"` |
| `title` (R) | list[str] | Always a list; access `title[0]` |
| `type` (R) | string | e.g. `"journal-article"` — see type table below |
| `publisher` | string | |
| `container-title` | list[str] | Journal name; access `[0]` |
| `short-container-title` | list[str] | Abbreviated journal name |
| `ISSN` | list[str] | May contain print and online ISSN |
| `volume` | string | Note: string not int (`"596"`) |
| `issue` | string | |
| `page` | string | e.g. `"583-589"` |
| `author` | list[object] | See author fields below |
| `published` | date-object | Best single date — use this |
| `published-online` | date-object | Online-first date |
| `published-print` | date-object | Print edition date |
| `issued` | date-object | Usually same as `published` |
| `is-referenced-by-count` | int | Inbound citations to this work |
| `references-count` | int | Outbound references from this work |
| `reference` | list[object] | Full reference list (when deposited) |
| `abstract` | string | JATS XML markup; ~30-70% of works; strip tags before use |
| `subject` | list[str] | Subject classification (often empty) |
| `language` | string | e.g. `"en"` |
| `license` | list[object] | Each: `{URL, start, delay-in-days, content-version}` |
| `funder` | list[object] | Each: `{name, DOI, award}` |
| `link` | list[object] | Full-text links |
| `relation` | object | Related DOIs (e.g. preprint → article) |
| `assertion` | list[object] | Publisher-specific metadata |
| `alternative-id` | list[str] | Publisher's internal IDs |
| `member` | string | CrossRef member ID |
| `prefix` | string | DOI prefix |
| `score` | float | Relevance score (search results only) |
| `source` | string | e.g. `"Crossref"` |
| `indexed` | date-object | When CrossRef indexed this record |
| `deposited` | date-object | When publisher last deposited metadata |
| `created` | date-object | When CrossRef record was first created |

### Author object fields

| Field | Notes |
|---|---|
| `given` | Given/first name |
| `family` | Family/last name |
| `sequence` | `"first"` or `"additional"` |
| `affiliation` | list of `{name, place}` — usually `[]` |
| `ORCID` | Full URL `"https://orcid.org/0000-0001-..."` — strip prefix to get bare ID |
| `authenticated-orcid` | `true` = verified via ORCID OAuth; `false` = self-reported |
| `name` | Used instead of given/family for organizations |

### Date object structure

```ts
// All date fields share this structure:
const date_obj = {
  "date-parts": [[2021, 7, 15]],          // [[year, month, day]] — month/day may be absent
  "date-time": "2021-07-15T00:00:00Z",    // not always present
  "timestamp": 1626307200000,             // not always present
}

// Safe extraction (handles [[2021]] or [[2021, 7]] partial dates):
function parse_date(d: any) {
  if (!d) return null
  const parts = (d["date-parts"] || [[]])[0]
  return parts.filter((p: any) => p !== null).join("-")
}
```

### Type identifiers (filter param values vs facet display names)

Use these exact strings in `filter=type:...`. The facet `type-name` values are display names only.

| filter `type:` value | Facet display name | Count (all CrossRef) |
|---|---|---|
| `journal-article` | Journal Article | 121,030,194 |
| `book-chapter` | Chapter | 24,359,059 |
| `proceedings-article` | Conference Paper | 9,744,754 |
| `dataset` | Dataset | 3,424,142 |
| `posted-content` | Posted Content (preprints) | 3,203,320 |
| `dissertation` | Dissertation | 1,044,461 |
| `peer-review` | Peer Review | 1,028,287 |
| `report` | Report | 906,301 |
| `book` | Book | 870,949 |
| `monograph` | Monograph | 788,401 |

### Query parameters reference

| Parameter | Notes |
|---|---|
| `query` | Full-text keyword search across title, abstract, author |
| `query.author` | Author name search only |
| `query.title` | Title search only |
| `query.bibliographic` | Combined title + author + journal search |
| `rows` | Results per page (default 20, max 1000) |
| `offset` | Offset for pagination (max ~10,000 effective) |
| `cursor` | Use `cursor=*` for first page, then URL-encode `next-cursor` value |
| `sort` | `relevance`, `is-referenced-by-count`, `published`, `indexed` |
| `order` | `asc` or `desc` |
| `filter` | Comma-separated `key:value` pairs (see filters below) |
| `select` | Comma-separated field names to return |
| `facet` | `type-name:*` for type counts; `publisher-name:10` for top publishers |
| `mailto` | Your email — enables polite pool (higher limits) |

### Filter keys reference

| Filter key | Example | Notes |
|---|---|---|
| `doi` | `doi:10.1038/nature12345` | Exact DOI match |
| `type` | `type:journal-article` | See type table above for valid values |
| `from-pub-date` | `from-pub-date:2024-01-01` | ISO date or `YYYY` |
| `until-pub-date` | `until-pub-date:2024-12-31` | |
| `from-index-date` | `from-index-date:2024-01-01` | When CrossRef indexed it |
| `has-abstract` | `has-abstract:true` | Only works with deposited abstract |
| `has-orcid` | `has-orcid:true` | At least one author has ORCID |
| `has-full-text` | `has-full-text:true` | Has full-text link |
| `has-references` | `has-references:true` | Has deposited reference list |
| `is-update` | `is-update:true` | Corrections, retractions |
| `issn` | `issn:0028-0836` | Filter by journal ISSN |
| `publisher-name` | `publisher-name:elsevier` | Partial match |
| `funder` | `funder:100000001` | Funder DOI or CrossRef funder ID |

## Rate limits

CrossRef has two pools based on whether `mailto=` is present:

| Pool | Triggered by | Rate limit | Concurrency |
|---|---|---|---|
| **polite** | `mailto=` param present | 10 req/s | 3 concurrent |
| **public** | no `mailto=` | 5 req/s | 1 concurrent |

Headers returned: `x-rate-limit-limit`, `x-rate-limit-interval`, `x-concurrency-limit`, `x-api-pool`.

In practice with polite pool: 10 rapid sequential calls complete in ~2.7s (avg 0.27s/req) with no throttling. 5 parallel calls complete in ~0.3s. Keep `Promise.all` batches to 5 requests to respect the concurrency limit.

No per-day or per-hour cap. If you exceed limits, responses slow or return HTTP 429. No ban. Add `await wait(0.1)` between calls for sustained bulk crawls.

## Gotchas

- **`mailto=` doubles your rate limit and concurrency.** Public pool: 5 req/s, concurrency=1. Polite pool: 10 req/s, concurrency=3. Always add `?mailto=your@email.com` to every request — confirmed by reading `x-api-pool` response header.

- **`title`, `container-title`, `ISSN` are always lists, not strings.** Access with `title[0]`, `container-title[0]` etc. Do not rely on there being only one entry — `container-title` can have multiple values.

- **Abstract contains JATS XML markup.** The `abstract` field is not plain text — it contains tags like `<jats:p>`, `<jats:italic>`, `<jats:sup>`. Strip with `abstract.replace(/<[^>]+>/g, ' ')`. About 30-70% of works have an abstract at all; journal articles 2023 with `has-abstract:true` filter: 3,041,841 / ~5.5M total = ~55%.

- **ORCID is a full URL, not just the ID.** `a['ORCID']` = `"https://orcid.org/0000-0001-6169-6580"`. Strip with `.replace('https://orcid.org/', '')` to get the bare ID. `authenticated-orcid: false` means self-asserted (not verified via OAuth).

- **`published` vs `published-print` vs `published-online`.** Online-first is common in journals — a paper may be online months before its print issue. `published` is CrossRef's best single date and equals `published-online` when both exist. For preprints (`posted-content` type), look for `posted` instead of `published-print` — it may only have `posted` and `published`. Partial dates like `[[2023]]` (year only) are valid — always use `parse_date()` to handle missing month/day.

- **404 throws, not a JSON error response.** An invalid DOI (e.g. `10.9999/doesnotexist`) makes `http_get` throw `Error: HTTP Error 404: Not Found`. Wrap `fetch_work()` in try/catch for any untrusted DOI list.

- **`volume` and `issue` are strings, not integers.** CrossRef stores them as strings — `"596"`, not `596`. Don't compare with `==` to an int.

- **Filter type values are hyphenated lowercase, not the facet display names.** `filter=type:journal-article` works. `filter=type:journal article`, `filter=type:Journal Article`, and `filter=type:conference-paper` all return HTTP 400. Conference papers are `proceedings-article`.

- **`select=` does not guarantee field presence.** When you `select=DOI,title,author`, a record that has no author still omits the `author` key — it doesn't return `author: []`. Always use `.get()`.

- **Cursor pagination required for >10,000 results.** Offset pagination (`offset=`) is limited to around 10,000 results. For bulk sweeps, use `cursor=*` for the first page, then URL-encode the returned `next-cursor` value with `encodeURIComponent()`. The cursor expires if unused for too long.

- **`rows` max is 1000 per call.** Requesting more silently returns 1000. For cursor-based sweeps of large result sets (millions of records), `rows=1000` with cursor is the most efficient approach.

- **HTML entities in titles.** Titles may contain HTML entities like `&amp;` — `"Deep learning &amp; convolutional networks"`. Decode with `html.unescape()` if needed.

- **`funder` search `works-count` field is `null`.** The funder search result object has a `works-count` key that is always `null` in the search response. To get actual work counts for a funder, fetch the funder directly: `GET /funders/{id}`.

- **`subject` is often an empty list.** The `subject` field in works is populated inconsistently — many journal articles have `subject: []` even for well-indexed journals like Nature.

- **Affiliation is usually empty.** `author[i]['affiliation']` is `[]` for the majority of records, even for papers published in 2024. CrossRef has been working on affiliation deposit, but coverage is inconsistent.

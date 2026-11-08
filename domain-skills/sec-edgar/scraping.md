# SEC EDGAR — Scraping & Data Extraction

`https://www.sec.gov` / `https://data.sec.gov` / `https://efts.sec.gov` — all public data, no auth required. Every workflow here is pure `http_get` — no browser needed.

## Do this first

**SEC.gov requires a custom User-Agent on `www.sec.gov` and `data.sec.gov`. Always pass `UA` as the headers argument or you get 403.**

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }
// Format required: "CompanyName contact@email.com"
// "Mozilla/5.0" (http_get default) works on efts.sec.gov and data.sec.gov
// but FAILS on www.sec.gov (company_tickers.json, Archives/, etc.)
```

Start with `company_tickers.json` to resolve any ticker → CIK in one call, then branch to whichever endpoint you need.

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }
const tickers = JSON.parse(await http_get("https://www.sec.gov/files/company_tickers.json", UA))
// 10,391 public companies, ~50KB, always fresh
// Entry format: {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}

// Look up by ticker (exact, case-sensitive in the data)
const aapl = Object.values<any>(tickers).find((v) => v.ticker === "AAPL")
// {cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.'}

// CIK is a number here; pad to 10 digits for API URLs
const cik = String(aapl.cik_str).padStart(10, "0")  // "0000320193"
```

## Common workflows

### Ticker / name → CIK lookup

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }
const tickers = JSON.parse(await http_get("https://www.sec.gov/files/company_tickers.json", UA))

// By ticker
const tsla = Object.values<any>(tickers).find((v) => v.ticker === "TSLA") ?? null
// {cik_str: 1318605, ticker: 'TSLA', title: 'Tesla, Inc.'}

// By partial name match
const apples = Object.values<any>(tickers).filter((v) => v.title.toUpperCase().includes("APPLE"))
// [{cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.'}, ...]
```

### Company submissions (metadata + recent filings list)

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }
const cik = "0000320193"  // Apple - always zero-pad to 10 digits
const data = JSON.parse(await http_get(`https://data.sec.gov/submissions/CIK${cik}.json`, UA))

console.log(data.name)             // "Apple Inc."
console.log(data.cik)              // "0000320193"
console.log(data.sic)              // "3571"
console.log(data.sicDescription)   // "Electronic Computers"
console.log(data.tickers)          // ["AAPL"]
console.log(data.exchanges)        // ["Nasdaq"]

// Most recent ~1,000 filings are in data.filings.recent
const recent = data.filings.recent
// Fields per filing (parallel arrays, same index):
// accessionNumber, filingDate, reportDate, form, primaryDocument,
// primaryDocDescription, size, isXBRL, items, fileNumber

// Filter for 10-K and 10-Q only
const filings_10k = recent.form
  .map((f: string, i: number) => [f, recent.filingDate[i], recent.accessionNumber[i], recent.primaryDocument[i]])
  .filter(([f]: string[]) => f === "10-K" || f === "10-Q")
// Result: [['10-Q', '2026-01-30', '0000320193-26-000006', 'aapl-20251227.htm'], ...]
```

### Build direct filing document URL

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }
// Given accessionNumber and primaryDocument from submissions JSON:
const accn = "0000320193-25-000079"
const doc  = "aapl-20250927.htm"
const cik  = "320193"  // int part only (no leading zeros) for Archives path

const accn_nodash = accn.replaceAll("-", "")
const url = `https://www.sec.gov/Archives/edgar/data/${cik}/${accn_nodash}/${doc}`
// https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm

// Full 10-K is 1.5MB of XBRL-tagged HTML — use http_get for text extraction
const content = await http_get(url, UA)  // UA required on www.sec.gov
```

### XBRL financial data — single company, one concept over time

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }
const cik_padded = "0000320193"

// companyconcept: one metric, all reported values (quarterly + annual)
const data = JSON.parse(await http_get(
  `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik_padded}/us-gaap/Assets.json`,
  UA
))
// data keys: cik, taxonomy, tag, label, description, entityName, units
// data.units.USD -> array of {end, val, accn, fy, fp, form, filed}

const entries = data.units.USD

// Deduplicate: same period re-reported across multiple filings — keep latest
function annual_series(entries: any[]) {
  const seen: Record<string, any> = {}
  for (const e of entries) {
    if (e.form === "10-K" && e.fp === "FY") {
      const end = e.end
      if (!(end in seen) || e.filed > seen[end].filed) seen[end] = e
    }
  }
  return Object.keys(seen).sort().map((k) => seen[k])
}

const assets = annual_series(entries)
for (const e of assets.slice(-5)) {
  console.log(`${e.end}  $${(e.val / 1e9).toFixed(1)}B`)
}
// 2021-09-25  $351.0B
// 2022-09-24  $352.8B
// 2023-09-30  $352.6B
// 2024-09-28  $365.0B
// 2025-09-27  $359.2B
```

### XBRL financial data — all US-GAAP metrics for a company

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }

// companyfacts: all reported XBRL concepts in one ~5MB call
const data = JSON.parse(await http_get(
  "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
  UA
))
// data.entityName = "Apple Inc."
// data.facts = {'us-gaap': {...503 concepts...}, dei: {...}}

const usgaap = data.facts["us-gaap"]
console.log(Object.keys(usgaap).length)   // 503 concepts for Apple

// Common concept names (companies vary — check what's available):
// Revenue:     RevenueFromContractWithCustomerExcludingAssessedTax  (post-2018 standard)
//              SalesRevenueNet                                       (older filings)
//              Revenues                                              (some companies still use)
// Net income:  NetIncomeLoss
// Assets:      Assets
// Cash:        CashAndCashEquivalentsAtCarryingValue
// EPS:         EarningsPerShareBasic, EarningsPerShareDiluted

// Find all revenue-related concepts this company reported:
const revenue_keys = Object.keys(usgaap).filter((k) => k.includes("Revenue"))

// Extract annual revenue — handle company-specific concept name
for (const concept of ["RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "Revenues"]) {
  if (concept in usgaap) {
    const entries = usgaap[concept].units.USD ?? []
    const annual: Record<string, any> = {}
    for (const e of entries) {
      if (e.form === "10-K" && e.fp === "FY") {
        const end = e.end
        if (!(end in annual) || e.filed > annual[end].filed) annual[end] = e
      }
    }
    if (Object.keys(annual).length) {
      console.log(`Using: ${concept}`)
      for (const end of Object.keys(annual).sort().slice(-3)) {
        console.log(`  ${end}  $${(annual[end].val / 1e9).toFixed(1)}B`)
      }
      break
    }
  }
}
// Apple output:
// Using: RevenueFromContractWithCustomerExcludingAssessedTax
//   2023-09-30  $383.3B
//   2024-09-28  $391.0B
//   2025-09-27  $416.2B
```

### Cross-company financial comparison (XBRL frames)

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }

// frames: one concept, one period, all companies that reported it
// Period formats:
//   CY2024           = calendar year 2024 (annual)
//   CY2024Q4I        = Q4 2024 instantaneous (balance sheet items)
//   CY2024Q4         = Q4 2024 duration (income statement items)

// Top companies by annual revenue (2024)
const data = JSON.parse(await http_get(
  "https://data.sec.gov/api/xbrl/frames/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax/USD/CY2024.json",
  UA
))
const companies = [...data.data].sort((a: any, b: any) => b.val - a.val)
// data.data entries: {accn, cik, entityName, loc, start, end, val}
for (const c of companies.slice(0, 5)) {
  console.log(`${c.entityName.padEnd(40)}  $${(c.val / 1e9).toFixed(0)}B`)
}
// Walmart Inc.                              $675B
// AMAZON.COM, INC.                          $638B
// Apple Inc.                                $391B
// McKESSON CORPORATION                      $359B
// Alphabet Inc.                             $350B

// Total assets snapshot end of 2024 (balance sheet = instantaneous)
const data2 = JSON.parse(await http_get(
  "https://data.sec.gov/api/xbrl/frames/us-gaap/Assets/USD/CY2024Q4I.json",
  UA
))
// 6,229 companies for this frame
```

### Full-text search across all filings

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }

// Search for any phrase across filing documents
// Params: q (quoted phrase), forms (comma-separated), dateRange=custom,
//         startdt, enddt, size (max 100), from (offset for pagination)
const url =
  "https://efts.sec.gov/LATEST/search-index" +
  "?q=%22climate+risk%22" +
  "&forms=10-K" +
  "&dateRange=custom&startdt=2024-01-01" +
  "&size=10&from=0"
const data = JSON.parse(await http_get(url, UA))
// Note: default http_get UA (Mozilla/5.0) works fine on efts.sec.gov

console.log(data.hits.total.value)   // e.g. 1438 matching documents
const hits = data.hits.hits          // up to 100 per call

for (const h of hits) {
  const src = h._source
  // Key fields: display_names, ciks, form, file_date, adsh (accession), period_ending
  const name = src.display_names?.length ? src.display_names[0] : "?"
  const cik  = src.ciks?.length ? src.ciks[0] : "?"
  console.log(`${name}  form=${src.form}  filed=${src.file_date}  accn=${src.adsh}`)
}

// Pagination: max 100 per page, use from= to walk through results
// Page 2: from=100, Page 3: from=200, etc.
for (let page = 0; page < 300; page += 100) {
  const page_url = url + `&from=${page}`
  const page_data = JSON.parse(await http_get(page_url, UA))
  if (!page_data.hits.hits.length) break
  // process...
}

// Aggregations — group hits by entity, SIC, state
const aggs = data.aggregations
const top_entities = aggs.entity_filter.buckets   // [{key: "Name (CIK...)", doc_count: N}, ...]
const top_sics     = aggs.sic_filter.buckets
const top_states   = aggs.biz_states_filter.buckets
```

### Find a company's CIK by name search (via search aggregations)

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }

// Best method: company_tickers.json (fastest, all tickers)
const tickers = JSON.parse(await http_get("https://www.sec.gov/files/company_tickers.json", UA))
const msft = Object.values<any>(tickers).find((v) => v.ticker === "MSFT")
// CIK = msft.cik_str  → 789019

// Alternative: full-text search aggregations (finds CIK from company name)
const data = JSON.parse(await http_get(
  "https://efts.sec.gov/LATEST/search-index?q=%22microsoft+corporation%22&forms=10-K",
  UA
))
const buckets = data.aggregations.entity_filter.buckets
// [{key: 'MICROSOFT CORP  (MSFT)  (CIK 0000789019)', doc_count: 11}, ...]
for (const b of buckets.slice(0, 3)) {
  const m = b.key.match(/\(CIK (\d+)\)/)
  if (m) console.log(`${b.key.slice(0, 50)}  →  CIK ${m[1]}`)
}
```

### Parallel fetching (multiple companies)

```ts
const UA = { "User-Agent": "browser-harness research@example.com" }

async function get_company_meta([ticker, cik]: [string, string]) {
  const subs = JSON.parse(await http_get(`https://data.sec.gov/submissions/CIK${cik}.json`, UA))
  return { ticker, name: subs.name, sic: subs.sic }
}

const companies: [string, string][] = [["AAPL", "0000320193"], ["TSLA", "0001318605"], ["MSFT", "0000789019"]]
const results = await Promise.all(companies.map(get_company_meta))
// Confirmed: 3 requests complete in ~0.28s
// SEC rate limit: 10 req/sec — keep concurrency ≤ 8 to be safe
```

## API reference

| Endpoint | What it returns | UA required |
|---|---|---|
| `www.sec.gov/files/company_tickers.json` | All 10,391 tickers → CIK mapping | YES |
| `data.sec.gov/submissions/CIK{10-digit}.json` | Company meta + ~1000 recent filings | YES |
| `data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json` | All XBRL facts (~5MB) | YES |
| `data.sec.gov/api/xbrl/companyconcept/CIK{10-digit}/{taxonomy}/{concept}.json` | One concept, all values | YES |
| `data.sec.gov/api/xbrl/frames/{taxonomy}/{concept}/{unit}/{period}.json` | All companies for one period | YES |
| `efts.sec.gov/LATEST/search-index?q=...` | Full-text search across filings | NO (Mozilla/5.0 works) |
| `www.sec.gov/Archives/edgar/data/{cik}/{accn-nodash}/{doc}` | Actual filing document | YES |

`data.sec.gov` accepts `Mozilla/5.0` (the http_get default). `www.sec.gov` (Archives, company_tickers) requires the `"CompanyName email@example.com"` format.

## Rate limits

SEC documents a **10 requests/second** limit. In practice:
- 12 rapid sequential calls to `data.sec.gov` completed in 2.4s (5 req/s) with no throttling.
- 3 parallel calls completed in 0.28s without issue.
- Keep `Promise.all` concurrency ≤ 8 to respect the 10 req/s ceiling.
- No per-day or per-hour cap documented; the 10/s limit is the only stated constraint.

## Gotchas

- **`www.sec.gov` returns 403 with `Mozilla/5.0` UA** — The http_get default (`"Mozilla/5.0"`) works on `data.sec.gov` and `efts.sec.gov` but is blocked on `www.sec.gov`. Always pass `UA` as the headers argument, where UA includes your company name and email. Confirmed: `"python-requests/2.28"` → 403.

- **`data.sec.gov` is more permissive** — `Mozilla/5.0` works on `data.sec.gov` (submissions, xbrl). But always use the proper UA anyway — SEC's policy page explicitly requires it and they can add stricter checks at any time.

- **XBRL contains duplicate entries per period** — The same fiscal year end date appears multiple times when a company restates or re-files. Each entry has a `filed` date and `accn` (accession). To get the canonical value, deduplicate by `end` keeping the entry with the latest `filed` date.

- **Revenue concept name varies by company and era** — There is no single canonical "revenue" concept. Apple uses `RevenueFromContractWithCustomerExcludingAssessedTax`. Microsoft uses the same for recent years, but older filings used `SalesRevenueNet`. Always check which concepts are actually present: `Object.keys(usgaap).filter((k) => k.includes("Revenue"))`.

- **`fp` field for annual filings is `'FY'`, but quarterly values also appear in 10-K** — A 10-K re-reports each quarter (fp=Q1, Q2, Q3) plus the full year (fp=FY). Filter on both `form === '10-K'` AND `fp === 'FY'` to get only annual totals.

- **`companyfacts` is ~5MB per company** — For a single metric, use `companyconcept` instead (much smaller). Only use `companyfacts` when you need multiple concepts from the same company.

- **`submissions` recent filings cap at ~1,000** — Very old filings don't appear. If you need historical data before that window, use the `filings.files` array in submissions JSON to find older filing JSON pages (`data.sec.gov/submissions/CIK{cik}-submissions-001.json`, etc.).

- **`adsh` in search results is the accession number** — The search index returns `adsh` (no dashes). To build the document URL, insert dashes: `` `${adsh.slice(0, 10)}-${adsh.slice(10, 12)}-${adsh.slice(12)}` ``, or use the `accessionNumber` field from submissions JSON (which already has dashes).

- **`size` param is capped at 100** — Requesting `size=200` silently returns 100 hits. Walk results with `from=0`, `from=100`, etc. Maximum reachable index is 10,000 (Elasticsearch default).

- **Search total `'gte'` relation means >10,000 hits** — When `total.relation === 'gte'`, there are more than 10,000 results (only first 10,000 accessible). Narrow with `dateRange` or `forms` filters.

- **`company_tickers.json` covers only exchange-listed companies** — ~10,391 entries. Many SEC filers (private companies, bond issuers, FHLBs) have CIKs but no ticker. Find them via the full-text search aggregations or `submissions` lookup if you have the CIK.

- **Filing document is XBRL-tagged HTML, 1–2MB** — Retrieving the actual 10-K HTML works but is large. For financial data extraction, always prefer the XBRL API endpoints over parsing the document.

- **CIK format gotcha** — `company_tickers.json` returns `cik_str` as an int (`320193`). The submissions and xbrl APIs require a 10-digit zero-padded string in the filename (`CIK0000320193`). Always use `String(cik).padStart(10, "0")` when building URLs.

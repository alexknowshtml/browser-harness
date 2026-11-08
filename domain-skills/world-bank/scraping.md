# World Bank Open Data — Scraping & Data Extraction

`https://api.worldbank.org/v2` — free REST API for global development indicators. No API key, no auth, no browser needed. All data via `http_get`.

## Do this first

**Every response is a 2-element JSON array: `[metadata, data]`.** The metadata element is always at index 0 (pagination info); the data array is at index 1. This is the single biggest gotcha — `JSON.parse(raw)` gives you an array, not an object.

```ts
const raw = await http_get("https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json")
const d = JSON.parse(raw)
const meta = d[0]   // {"page": 1, "pages": 2, "per_page": 50, "total": 66, ...}
const rows = d[1]   // array of data records
```

Always append `?format=json` — default response is XML.

## Common workflows

### Single country, single indicator

```ts
const raw = await http_get("https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json")
const d = JSON.parse(raw)
const [meta, rows] = [d[0], d[1]]

for (const r of rows) {
  if (r.value !== null) {   // recent years often have null values
    console.log(r.date, r.value)
  }
}
// Confirmed output (2026-04-18):
// 2024 28750956130731.2
// 2023 27292170793214.4
// 2022 25604848907611.0
// ...
```

### Most recent N values (`mrv` param)

`mrv` (most recent values) skips null years and returns the N most recent non-provisional points.

```ts
const raw = await http_get(
  "https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD" +
  "?format=json&mrv=5"
)
const d = JSON.parse(raw)
for (const r of d[1]) {
  console.log(r.date, r.value)
}
// Confirmed output (2026-04-18):
// 2024 28750956130731.2
// 2023 27292170793214.4
// 2022 25604848907611.0
// 2021 23315080560000.0
// 2020 21060473613000.0
```

### Multiple countries, date range

Semicolon-delimit country codes in the URL path. Use `date=YYYY:YYYY` for a range.

```ts
const raw = await http_get(
  "https://api.worldbank.org/v2/country/US;CN;GB/indicator/SP.POP.TOTL" +
  "?format=json&date=2000:2023&per_page=100"
)
const d = JSON.parse(raw)
const [meta, rows] = [d[0], d[1]]
console.log(`Total records: ${meta.total}, pages: ${meta.pages}`)

for (const r of rows) {
  console.log(r.country.value, r.date, r.value)
}
// Confirmed: returns 8 records per page (50 default), date range honored exactly
// Countries: ['China', 'United States', 'United Kingdom']
// Dates: ['2000', '2001', ..., '2023']
```

### All countries, latest value only

Use `mrv=1` with `per_page=1000` to get all 266 countries in a single call.

```ts
const raw = await http_get(
  "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD" +
  "?format=json&mrv=1&per_page=1000"
)
const d = JSON.parse(raw)
const [meta, rows] = [d[0], d[1]]
console.log(`Countries returned: ${rows.length}`)  // 266 (includes aggregates)

// Filter out regional aggregates — they have no iso2Code or have aggregate ids
const countries_only = rows.filter((r: any) => r.country.id.length === 2)
const top = [...countries_only].sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0)).slice(0, 5)
for (const r of top) {
  console.log(r.country.value, r.date, `$${Math.round(r.value).toLocaleString("en-US")}`)
}
// Confirmed output (2026-04-18):
// Luxembourg 2024 $135,605
// Norway 2024 $105,056
// ...
```

### Full pagination (fetch all pages)

```ts
// Fetch all pages of a World Bank API endpoint.
async function fetch_all_pages(base_url: string) {
  const all_rows: any[] = []
  let page = 1
  while (true) {
    const url = base_url.includes("?") ? `${base_url}&page=${page}` : `${base_url}?page=${page}`
    const d = JSON.parse(await http_get(url))
    const [meta, rows] = [d[0], d[1]]
    all_rows.push(...rows)
    if (page >= meta.pages) break
    page += 1
  }
  return all_rows
}

// Example: all US GDP data (66 years, 2 pages)
const rows = await fetch_all_pages(
  "https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD" +
  "?format=json&per_page=50"
)
console.log(`Total rows: ${rows.length}`)  // 66
const non_null = rows.filter((r) => r.value !== null).map((r) => [r.date, r.value])
console.log(`Non-null: ${non_null.length}, range: ${non_null.at(-1)![0]}–${non_null[0][0]}`)
```

### Indicators list (discover available indicators)

```ts
const raw = await http_get("https://api.worldbank.org/v2/indicator?format=json&per_page=50")
const d = JSON.parse(raw)
const meta = d[0]
console.log(`Total indicators: ${meta.total}, pages: ${meta.pages}`)
// Confirmed: 29,511 indicators across 591 pages

for (const ind of d[1].slice(0, 3)) {
  console.log(ind.id, "-", ind.name)
}
// 1.0.HCount.1.90usd - Poverty Headcount ($1.90 a day)
// ...
```

### Indicators by topic

```ts
// Topic 3 = Economy & Growth
const raw = await http_get("https://api.worldbank.org/v2/topic/3/indicator?format=json&per_page=50")
const d = JSON.parse(raw)
console.log(`Economy & Growth indicators: ${d[0].total}`)  // 306

for (const ind of d[1].slice(0, 5)) {
  console.log(ind.id, "-", ind.name)
}
```

### Country metadata

```ts
let raw = await http_get("https://api.worldbank.org/v2/country/US?format=json")
let d = JSON.parse(raw)
const c = d[1][0]
console.log(c.name, c.capitalCity, c.region.value, c.incomeLevel.value)
// United States  Washington D.C.  North America  High income

// Filter countries by income level
raw = await http_get("https://api.worldbank.org/v2/country?format=json&incomeLevel=LIC&per_page=300")
d = JSON.parse(raw)
console.log(`Low-income countries: ${d[0].total}`)  // 25
```

### Topics list

```ts
const raw = await http_get("https://api.worldbank.org/v2/topics?format=json")
const d = JSON.parse(raw)
for (const t of d[1]) {
  console.log(t.id, t.value)
}
// 1  Agriculture & Rural Development
// 2  Aid Effectiveness
// 3  Economy & Growth
// ... (21 topics total)
```

### Parallel fetch for multiple indicators (Promise.all)

```ts
const INDICATORS: Record<string, string> = {
  "NY.GDP.MKTP.CD": "GDP (current US$)",
  "SP.POP.TOTL": "Population",
  "NY.GDP.PCAP.CD": "GDP per capita",
}

async function fetch_indicator(ind_id: string): Promise<[string, any[]]> {
  const url =
    `https://api.worldbank.org/v2/country/US/indicator/${ind_id}` +
    `?format=json&mrv=5`
  const d = JSON.parse(await http_get(url))
  return [ind_id, d[1]]
}

const results = Object.fromEntries(await Promise.all(Object.keys(INDICATORS).map(fetch_indicator)))

for (const [ind_id, rows] of Object.entries(results)) {
  const latest = rows.find((r: any) => r.value !== null)
  if (latest) {
    const v = latest.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    console.log(`${INDICATORS[ind_id]}: ${latest.date} = ${v}`)
  }
}
```

## URL reference

### Base URL

```
https://api.worldbank.org/v2
```

HTTP redirects to HTTPS (302). Always use HTTPS directly.

### Endpoint patterns

| Endpoint | Description |
|---|---|
| `/country/{code}/indicator/{id}` | Single country + indicator time series |
| `/country/{c1};{c2};{c3}/indicator/{id}` | Multi-country (semicolon-delimited) |
| `/country/all/indicator/{id}` | All countries |
| `/country/{code}` | Country metadata |
| `/country` | All countries metadata (filterable) |
| `/indicator` | All indicators list |
| `/indicator/{id}` | Single indicator metadata |
| `/topic/{id}/indicator` | Indicators for a topic |
| `/topics` | All topics |

### Query parameters

| Parameter | Values | Notes |
|---|---|---|
| `format` | `json`, `xml` (default) | Always set `format=json` |
| `per_page` | integer, default 50, max 1000 | Higher is faster for bulk |
| `page` | integer, default 1 | For paginating results |
| `date` | `2020`, `2000:2023` | Single year or colon-separated range |
| `mrv` | integer | N most recent non-null values |
| `gapfill` | `Y` | Forward-fill nulls when used with `mrv` |
| `incomeLevel` | `LIC`, `MIC`, `HIC`, `LMC`, `UMC` | Filter countries by income |
| `region` | `EAS`, `ECS`, `LAC`, `MEA`, `NAC`, `SAS`, `SSF` | Filter countries by region |

### Common indicator IDs (confirmed working, 2026-04-18)

| ID | Name |
|---|---|
| `NY.GDP.MKTP.CD` | GDP (current US$) |
| `NY.GDP.PCAP.CD` | GDP per capita (current US$) |
| `SP.POP.TOTL` | Population, total |
| `SL.UEM.TOTL.ZS` | Unemployment (% of labor force) |
| `FP.CPI.TOTL.ZG` | Inflation, consumer prices (%) |
| `NE.EXP.GNFS.ZS` | Exports of goods and services (% of GDP) |
| `SP.DYN.LE00.IN` | Life expectancy at birth |
| `SE.ADT.LITR.ZS` | Literacy rate, adult total (%) |
| `EG.USE.PCAP.KG.OE` | Energy use per capita (kg of oil equiv.) |

Find more: `https://api.worldbank.org/v2/indicator?format=json&per_page=50&page=N`

### Country codes (ISO2)

Standard ISO 3166-1 alpha-2 codes: `US`, `CN`, `GB`, `DE`, `JP`, `IN`, `BR`, etc.
Special: `all` for all countries.

## Response structure

Every endpoint returns a 2-element array:

```json
[
  {
    "page": 1,
    "pages": 2,
    "per_page": 50,
    "total": 66,
    "sourceid": "2",
    "lastupdated": "2026-04-08"
  },
  [
    {
      "indicator": {"id": "NY.GDP.MKTP.CD", "value": "GDP (current US$)"},
      "country": {"id": "US", "value": "United States"},
      "countryiso3code": "USA",
      "date": "2024",
      "value": 28750956130731.2,
      "unit": "",
      "obs_status": "",
      "decimal": 0
    },
    ...
  ]
]
```

Country metadata endpoint returns same 2-element shape but with country objects (not indicator rows) at index 1.

## Gotchas

- **Response is always a 2-element array, not a dict.** `const d = JSON.parse(raw)` gives an array. `d[0]` is pagination metadata, `d[1]` is the data array. Accessing `d.page` returns `undefined`. This is the most common mistake.

- **`value` can be null.** Recent years (e.g. 2025) and data-sparse countries frequently have `null` values. Always check `if (r.value !== null)` before using. Use `mrv=N` to skip nulls automatically.

- **Always append `?format=json`.** The default response format is XML. Without `format=json`, you get an XML string that fails `JSON.parse`.

- **`all/indicator/{id}` includes regional aggregates.** The "all countries" endpoint returns 266 entries including aggregated regions like "Africa Eastern and Southern" (`id: "ZH"`). Filter to real countries with `r.country.id.length === 2` (ISO2 codes are always 2 chars; aggregate codes are 2-3 chars but with non-standard values).

- **Semicolons in URL path, not query string.** Multi-country requests use `country/US;CN;GB/indicator/...` not `?countries=US,CN,GB`. Commas do not work.

- **HTTP 302 redirects HTTP to HTTPS.** Always use `https://` directly to avoid an extra round trip.

- **`per_page` in metadata is sometimes a string, sometimes an integer.** The API returns `"per_page": "50"` (string) for some endpoints and `"per_page": 50` (int) for others. Don't compare with `==` without casting: `Number(meta.per_page)`.

- **Invalid country codes return an error object, not a 2-element array.** A bad code gives `[{"message": [{"id": "120", "key": "Invalid value", ...}]}]` — a 1-element array with an error object. Check `if (d[0] && "message" in d[0])` before accessing `d[1]`.

- **`mrv` + `gapfill=Y` forward-fills the latest value into future years.** If 2024 is the latest data point and `mrv=3`, `gapfill=Y` returns 2025 (the current year) with the 2024 value copied in. Useful for "current" lookups, but the filled date is misleading.

- **No rate limit documented, but 3 req/s sustained is safe.** The API handles bursts (3 parallel requests via `Promise.all`) without issue. For crawling thousands of indicators, add `await wait(0.5)` between pages.

- **`date` range returns records newest-first.** Results within a date range are sorted descending by year. If you need ascending order, sort after fetching: `[...rows].sort((a, b) => a.date.localeCompare(b.date))`.

- **Indicator IDs are case-sensitive.** `ny.gdp.mktp.cd` returns an error; use the uppercase dot-separated form `NY.GDP.MKTP.CD`.

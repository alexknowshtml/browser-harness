# FRED — Federal Reserve Economic Data

`https://fred.stlouisfed.org` / `https://api.stlouisfed.org` — the canonical source for US macroeconomic time series (800,000+ series). The REST API at `api.stlouisfed.org` requires a free registered key. The web endpoints at `fred.stlouisfed.org` (CSV, JSON, HTML) are all blocked to headless HTTP — they consistently timeout with no response. For zero-key access use the BLS API (unemployment, CPI, payrolls) or World Bank API (GDP, growth rates, annual data).

## Do this first

**Decision tree: pick one approach.**

```
Need GDP, CPI, UNRATE, payrolls only? → use BLS + World Bank (no key, free forever)
Need FEDFUNDS, DGS10, SP500, any FRED series? → get a free FRED API key (5 min)
Need browser-visible chart data? → use CDP to intercept network requests
```

**The web CSV/JSON/TXT URLs all timeout — do NOT attempt them:**
```ts
// ALL OF THESE TIMEOUT — confirmed dead from headless HTTP:
// https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP      ← timeout
// https://fred.stlouisfed.org/graph/fredgraph.json?id=GDP     ← timeout
// https://fred.stlouisfed.org/data/GDP.txt                    ← timeout
// https://fred.stlouisfed.org/series/GDP                      ← timeout
```

## Getting a free FRED API key

1. Go to `https://fred.stlouisfed.org/docs/api/api_key.html`
2. Click "Request or view your API Keys"
3. Sign in / register (free St. Louis Fed account)
4. Key appears immediately — it's a 32-character lowercase alphanumeric string

The key is free, instant, and unlimited for reasonable use (120 req/min cap).

---

## Option A: FRED REST API (requires free key, 800K+ series)

The only way to get FRED data programmatically. Set `FRED_KEY` in your `.env` file.

```ts
const FRED_KEY = process.env.FRED_KEY!;   // 32-char lowercase alphanumeric
const BASE = "https://api.stlouisfed.org/fred";
```

### Series metadata

```ts
const FRED_KEY = process.env.FRED_KEY!;
const BASE = "https://api.stlouisfed.org/fred";

const meta = JSON.parse(await http_get(`${BASE}/series?series_id=GDP&api_key=${FRED_KEY}&file_type=json`));
const s = meta.seriess[0];
console.log(s.title);                // "Gross Domestic Product"
console.log(s.observation_start);    // "1947-01-01"
console.log(s.observation_end);      // "2025-10-01"
console.log(s.frequency);            // "Quarterly"
console.log(s.frequency_short);      // "Q"
console.log(s.units);                // "Billions of Dollars"
console.log(s.units_short);          // "Bil. of $"
console.log(s.seasonal_adjustment);  // "Seasonally Adjusted Annual Rate"
console.log(s.popularity);           // 81  (0-100)
console.log(s.last_updated);         // "2025-12-19 08:00:06-06"
```

### Observations (the actual data)

```ts
const FRED_KEY = process.env.FRED_KEY!;
const BASE = "https://api.stlouisfed.org/fred";

// Latest 10 values, most recent first
const obs = JSON.parse(await http_get(
  `${BASE}/series/observations`
  + `?series_id=GDP`
  + `&api_key=${FRED_KEY}`
  + `&file_type=json`
  + `&limit=10`
  + `&sort_order=desc`      // "desc" = newest first, "asc" = oldest first (default)
));
console.log(obs.count);              // 314  (total observations)
console.log(obs.observation_start);  // "1947-01-01"  (what's in the full series)

for (const o of obs.observations) {
  const date  = o.date;    // "2025-10-01"
  const value = o.value;   // "29726.4"  — always a STRING, may be "." for missing
  if (value !== ".") {
    const fmt = parseFloat(value).toLocaleString("en-US", {minimumFractionDigits: 1, maximumFractionDigits: 1});
    console.log(`${date}: $${fmt}B`);
  }
}
// 2025-10-01: $29,726.4B
// 2025-07-01: $29,339.1B
// 2025-04-01: $29,119.3B
```

### Date-range filtering

```ts
const FRED_KEY = process.env.FRED_KEY!;
const BASE = "https://api.stlouisfed.org/fred";

const obs = JSON.parse(await http_get(
  `${BASE}/series/observations`
  + `?series_id=UNRATE`
  + `&api_key=${FRED_KEY}`
  + `&file_type=json`
  + `&observation_start=2020-01-01`
  + `&observation_end=2024-12-31`
  + `&sort_order=desc`
));
for (const o of obs.observations.slice(0, 5)) {
  console.log(`${o.date}: ${o.value}%`);
}
// 2024-12-01: 4.1%
// 2024-11-01: 4.2%
// 2024-10-01: 4.1%
```

### Key series IDs

| FRED ID | Description | Frequency | Unit |
|---------|-------------|-----------|------|
| `GDP` | Gross Domestic Product | Quarterly | Billions of $, SAAR |
| `GDPC1` | Real GDP (chained 2017 $) | Quarterly | Billions of chained 2017 $ |
| `UNRATE` | Unemployment Rate | Monthly | Percent, SA |
| `CPIAUCSL` | CPI: All Urban Consumers, SA | Monthly | Index 1982-84=100 |
| `CPIAUCNS` | CPI: All Urban Consumers, not SA | Monthly | Index 1982-84=100 |
| `FEDFUNDS` | Federal Funds Effective Rate | Monthly | Percent |
| `DFF` | Federal Funds Rate (daily) | Daily | Percent |
| `DGS10` | 10-Year Treasury Constant Maturity | Daily | Percent |
| `DGS2` | 2-Year Treasury | Daily | Percent |
| `SP500` | S&P 500 | Daily | Index |
| `NASDAQCOM` | NASDAQ Composite | Daily | Index |
| `PAYEMS` | Total Nonfarm Payrolls | Monthly | Thousands of persons, SA |
| `PCEPI` | PCE Price Index | Monthly | Index 2017=100, SA |
| `PCEPILFE` | Core PCE Price Index | Monthly | Index 2017=100, SA |
| `DCOILBRENTEU` | Brent Crude Oil | Daily | $ per Barrel |
| `DEXUSEU` | USD/EUR Exchange Rate | Daily | USD per EUR |
| `M2SL` | M2 Money Stock | Monthly | Billions of $, SA |
| `MORTGAGE30US` | 30-Year Fixed Mortgage Rate | Weekly | Percent |

### Series search

```ts
const FRED_KEY = process.env.FRED_KEY!;
const BASE = "https://api.stlouisfed.org/fred";

const results = JSON.parse(await http_get(
  `${BASE}/series/search`
  + `?search_text=unemployment+rate`
  + `&api_key=${FRED_KEY}`
  + `&file_type=json`
  + `&limit=5`
  + `&order_by=popularity`    // "popularity" | "search_rank" | "series_id" | "title" | "units" | "frequency" | "seasonal_adjustment" | "realtime_start" | "realtime_end" | "last_updated" | "observation_start" | "observation_end"
  + `&sort_order=desc`        // most popular first
));
for (const s of results.seriess) {
  console.log(`${s.id}: ${s.title} (${s.frequency_short}, ${s.units_short})`);
}
// UNRATE: Unemployment Rate (M, %)
// UNEMPLOY: Unemployment Level (M, Thous. of Persons)
```

### Multiple series — parallel fetch

```ts
const FRED_KEY = process.env.FRED_KEY!;
const BASE = "https://api.stlouisfed.org/fred";

async function fetch_latest(series_id: string) {
  const obs = JSON.parse(await http_get(
    `${BASE}/series/observations?series_id=${series_id}`
    + `&api_key=${FRED_KEY}&file_type=json&limit=1&sort_order=desc`
  ));
  const o = obs.observations[0];
  return [series_id, o.date, o.value];
}

const series_ids = ["GDP", "UNRATE", "CPIAUCSL", "FEDFUNDS", "DGS10", "SP500"];
const results = await Promise.all(series_ids.map(fetch_latest));

for (const [sid, date, val] of results) {
  console.log(`${sid.padEnd(15)} ${date}: ${val}`);
}
// GDP             2025-10-01: 29726.4
// UNRATE          2026-03-01: 4.3
// CPIAUCSL        2026-02-01: 321.457
// FEDFUNDS        2026-03-01: 4.33
// DGS10           2026-04-17: 4.34
// SP500           2026-04-17: 5282.70
// Confirmed: 6 parallel requests complete in ~0.4s
```

### Parse observations into a list of (date, float) tuples

```ts
const FRED_KEY = process.env.FRED_KEY!;
const BASE = "https://api.stlouisfed.org/fred";

const obs = JSON.parse(await http_get(
  `${BASE}/series/observations?series_id=DGS10&api_key=${FRED_KEY}&file_type=json`
  + `&observation_start=2024-01-01&sort_order=asc`
));

const data = obs.observations
  .filter((o: any) => o.value !== ".")   // '.' = missing value, skip it
  .map((o: any) => [o.date, parseFloat(o.value)]);
console.log(`${data.length} observations`);
console.log(`First: ${JSON.stringify(data[0])}`);              // ["2024-01-02",3.91]
console.log(`Last:  ${JSON.stringify(data[data.length - 1])}`);  // ["2026-04-17",4.34]
```

### Handle errors

```ts
// http_get throws on non-2xx and drops the body; use fetch to read FRED's JSON error.
const r = await fetch(`https://api.stlouisfed.org/fred/series?series_id=BADID&api_key=${FRED_KEY}&file_type=json`);
if (r.ok) {
  console.log(await r.json());
} else {
  const err = await r.json();
  // err.error_code     → 400
  // err.error_message  → "Bad Request.  The series does not exist."
  console.log(`FRED error ${err.error_code}: ${err.error_message}`);
}
```

---

## Option B: BLS API (no key required, confirmed live)

Bureau of Labor Statistics. Covers unemployment, CPI, payrolls — the most-queried FRED series. **Without a key: 10 requests/day limit.** Free key registration at `https://www.bls.gov/developers/` gives 500 req/day and 10 years of data per call (vs 3 years without key).

```ts
// Single series GET — no auth needed
const r = await http_get("https://api.bls.gov/publicAPI/v2/timeseries/data/LNS14000000?startyear=2024&endyear=2024");
const data = JSON.parse(r);
// data.status === 'REQUEST_SUCCEEDED'
const series = data.Results.series[0];
for (const point of series.data.slice(0, 3)) {
  console.log(`${point.year}-${point.period} (${point.periodName}): ${point.value}`);
}
// 2024-M12 (December): 4.1
// 2024-M11 (November): 4.2
// 2024-M10 (October): 4.1
```

### Multi-series POST (single call, multiple series)

```ts
const payload = JSON.stringify({
  seriesid: ["LNS14000000", "CUSR0000SA0", "CES0000000001"],
  startyear: "2023",
  endyear: "2024",
  // registrationkey: "YOUR_BLS_KEY"  // optional: lifts to 500/day, 10yr range
});

const resp = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
  method: "POST",
  body: payload,
  headers: {"Content-Type": "application/json"},
  signal: AbortSignal.timeout(20_000),
});
const data = await resp.json();

for (const s of data.Results.series) {
  const pts = s.data;
  console.log(`${s.seriesID}: ${pts.length} points, latest=${pts[0].value}`);
}
// LNS14000000: 24 points, latest=4.1   (unemployment %)
// CUSR0000SA0: 24 points, latest=317.604  (CPI index)
// CES0000000001: 24 points, latest=158316  (nonfarm payrolls, thousands)
```

### Key BLS series (FRED equivalents)

| BLS Series ID | FRED Equivalent | Description |
|---------------|-----------------|-------------|
| `LNS14000000` | `UNRATE` | Unemployment rate, SA (%) |
| `CUSR0000SA0` | `CPIAUCSL` | CPI-U All Urban, SA |
| `CUUR0000SA0` | `CPIAUCNS` | CPI-U All Urban, not SA |
| `CUSR0000SA0L1E` | `CPILFESL` | CPI less food and energy, SA |
| `CES0000000001` | `PAYEMS` | Total nonfarm payrolls (thousands) |
| `LNS11000000` | `CLF16OV` | Civilian labor force (thousands) |
| `LNS12000000` | `CE16OV` | Civilian employment (thousands) |

### BLS rate limits

| | Without key | With free key |
|--|--|--|
| Requests/day | **10** (confirmed: call 11 returns `REQUEST_NOT_PROCESSED`) | 500 |
| Series per request | 25 | 50 |
| Years per request | 3 | 10 |
| Daily or seasonal adjustment | No | Yes |

---

## Option C: World Bank API (no key, unlimited, annual data)

Free, no registration, no rate limit observed (10 rapid calls completed in 2.0s). Annual data only — no monthly or quarterly frequency.

```ts
// Single country, single indicator
const r = await http_get("https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.CD?format=json&per_page=5&mrv=5");
const data = JSON.parse(r);
const paging = data[0];   // {page: 1, pages: 1, per_page: 5, total: 5, lastupdated: '2026-04-08'}
const items  = data[1];   // list of observations

for (const item of items) {
  if (item.value) console.log(`${item.date}: $${(item.value / 1e12).toFixed(2)}T`);
}
// 2024: $28.75T
// 2023: $27.29T
// 2022: $25.60T
```

### Date range filter and multi-country

```ts
// Historical range: date=YYYY:YYYY
let r = await http_get("https://api.worldbank.org/v2/country/US/indicator/FP.CPI.TOTL.ZG?format=json&date=2015:2024&per_page=15");
let data = JSON.parse(r);
let items = data[1].filter((i: any) => i.value !== null);
for (const item of items) {
  console.log(`${item.date}: ${item.value.toFixed(2)}%`);
}
// 2024: 2.95%
// 2023: 4.12%
// 2022: 8.00%
// ...

// Multi-country: semicolon-separated ISO codes
r = await http_get("https://api.worldbank.org/v2/country/US;CN;DE;JP;GB/indicator/NY.GDP.MKTP.CD?format=json&date=2023&per_page=10");
data = JSON.parse(r);
items = data[1].filter((i: any) => i.value).sort((x: any, y: any) => y.value - x.value);
for (const item of items) {
  console.log(`${item.country.value}: $${(item.value / 1e12).toFixed(2)}T`);
}
// United States: $27.29T
// China: $18.27T
// Germany: $4.56T
```

### Key World Bank indicators (FRED equivalents)

| WB Indicator Code | FRED Equivalent | Description |
|-------------------|-----------------|-------------|
| `NY.GDP.MKTP.CD` | `GDP` | GDP, current USD |
| `NY.GDP.MKTP.KD.ZG` | `A191RL1Q225SBEA` | GDP growth rate (%) |
| `NY.GDP.PCAP.CD` | `A939RX0Q048SBEA` | GDP per capita (USD) |
| `FP.CPI.TOTL.ZG` | `FPCPITOTLZGUSA` | CPI inflation, annual % |
| `FP.CPI.TOTL` | `CPIAUCSL` (annual) | CPI level, 2010=100 |
| `SL.UEM.TOTL.ZS` | `UNRATE` (annual) | Unemployment rate, ILO model |
| `CM.MKT.LCAP.GD.ZS` | — | Stock market cap / GDP ratio |

---

## Option D: Alpha Vantage (free registered key, select indicators)

Some economic indicators work with the `demo` key (no registration); most require a free registered key (25 requests/day, instant signup at `https://www.alphavantage.co/support/#api-key`).

```ts
const AV_KEY = "demo";  // or your registered key

// Unemployment rate (works with demo key — confirmed)
const r = await http_get(`https://www.alphavantage.co/query?function=UNEMPLOYMENT&apikey=${AV_KEY}`);
const data = JSON.parse(r);
// data.name     = 'Unemployment Rate'
// data.interval = 'monthly'
// data.unit     = 'percent'
// data.data     → list of {date, value}, newest first

console.log(data.data[0]);   // {date: '2026-03-01', value: '4.3'}
console.log(`Total: ${data.data.length} months since ${data.data[data.data.length - 1].date}`);
// Total: 939 months since 1948-01-01
```

### Which indicators work with demo vs registered key

| Function | demo key | Registered key |
|----------|----------|----------------|
| `UNEMPLOYMENT` | YES | YES |
| `INFLATION` | YES (annual) | YES |
| `RETAIL_SALES` | YES | YES |
| `DURABLES` | YES | YES |
| `NONFARM_PAYROLL` | YES | YES |
| `REAL_GDP_PER_CAPITA` | YES | YES |
| `REAL_GDP` | NO (rate-limited) | YES |
| `CPI` | NO (rate-limited) | YES |
| `FEDERAL_FUNDS_RATE` | NO (rate-limited) | YES |
| `TREASURY_YIELD` | NO (rate-limited) | YES |
| `CONSUMER_SENTIMENT` | NO (rate-limited) | YES |

```ts
const AV_KEY = "YOUR_FREE_KEY";  // from alphavantage.co/support/#api-key

// Federal Funds Rate — monthly (requires registered key)
let r = await http_get(`https://www.alphavantage.co/query?function=FEDERAL_FUNDS_RATE&interval=monthly&apikey=${AV_KEY}`);
let data = JSON.parse(r);
for (const item of data.data.slice(0, 3)) {
  console.log(`${item.date}: ${item.value}%`);
}
// 2026-03-01: 4.33%
// 2026-02-01: 4.33%
// 2026-01-01: 4.33%

// 10-Year Treasury Yield
r = await http_get(`https://www.alphavantage.co/query?function=TREASURY_YIELD&maturity=10year&interval=monthly&apikey=${AV_KEY}`);
data = JSON.parse(r);
console.log(data.data[0]);   // {date: '2026-04-17', value: '4.34'}
```

---

## Option E: Browser + CDP (for interactive FRED charts)

When you need data from `fred.stlouisfed.org` that has no API equivalent (custom chart combos, release dates visible on page) — or when you have no API key — use the browser.

```ts
// Navigate to a series page
await goto("https://fred.stlouisfed.org/series/GDP");
await wait_for_load();

// Option 1: Intercept the fredgraph XHR that the chart fires
// The page's chart JS calls fredgraph.csv internally — intercept it
const events = await drain_events();
// Look for network events with fredgraph.csv in URL

// Option 2: Extract the latest value from the page text
const latest_val = await js(`
    // The last observation appears in the meta section
    const el = document.querySelector('.series-meta-observation-end');
    el ? el.textContent.trim() : null
`);

// Option 3: Read the data table if present
const table_data = await js(`
    const rows = Array.from(document.querySelectorAll('table.series-observations tr'));
    rows.map(r => {
        const cells = r.querySelectorAll('td');
        return cells.length >= 2 ? [cells[0].textContent.trim(), cells[1].textContent.trim()] : null;
    }).filter(Boolean);
`);
```

---

## Rate limits

| API | Limit | Notes |
|-----|-------|-------|
| FRED REST API | 120 req/min | With registered key (free) |
| FRED REST API | blocked | Without key — HTTP 400 |
| BLS (no key) | 10 req/day | Confirmed: call 11 → `REQUEST_NOT_PROCESSED` |
| BLS (with key) | 500 req/day, 50 series/req | Free registration at bls.gov/developers |
| World Bank | No limit observed | 10 rapid calls: 2.0s, no 429 |
| Alpha Vantage (demo) | 2 req/sec | Demo key rate-limited for most functions |
| Alpha Vantage (free key) | 25 req/day | Free at alphavantage.co/support/#api-key |

---

## Gotchas

- **fred.stlouisfed.org web endpoints ALL timeout** — The CSV download (`fredgraph.csv`), JSON graph (`fredgraph.json`), text format (`/data/*.txt`), and HTML series pages all hang indefinitely from headless HTTP. This is not a UA or header issue — the server simply does not respond to non-browser connections. Confirmed with multiple UA strings, TCP connect succeeds but no HTTP response is sent.

- **FRED API key is mandatory and must be exactly 32 lowercase alphanumeric chars** — "test", "demo", "guest", and keys shorter/longer than 32 chars all return HTTP 400: `"not a 32 character alpha-numeric lower-case string"`. An unregistered 32-char key returns: `"not registered"`.

- **Observation values are always strings, not numbers** — The `value` field in FRED observations is always a JSON string: `"4.1"`, not `4.1`. Also `"."` (dot) means missing/not-yet-released. Always check `o.value !== "."` before `parseFloat(o.value)`.

- **BLS 10 req/day without key burns fast** — The limit is per-IP per-day. 10 calls is exhausted in one moderate script run. Either register a free BLS key immediately or use World Bank for the same data annually.

- **BLS data range: 3 years without key, 10 years with key** — Requesting `startyear=2000&endyear=2024` without a key silently truncates to the most recent 3 years. With a key it returns up to 10 years and includes a `message` field if the range was truncated: `['Year range has been reduced to the system-allowed limit of 10 years.']`.

- **World Bank is annual only** — No monthly or quarterly data. For monthly UNRATE or CPI, use BLS. For quarterly GDP, use FRED API or Alpha Vantage `REAL_GDP`.

- **World Bank response is a 2-element array** — `data[0]` is pagination metadata, `data[1]` is the observations list. Missing years have `value: null` (not `"."`). Filter with `item.value !== null`.

- **Alpha Vantage demo key: 2 req/sec, covers only 6 economic functions** — The other 6 economic functions (`REAL_GDP`, `CPI`, `TREASURY_YIELD`, etc.) return `{"Information": "The demo API key is for demo purposes only..."}`. No error code — just check for the `Information` key in the response.

- **FRED `sort_order=desc` returns newest first** — Default is `asc` (oldest first, starting from observation_start). For "get the latest value" use `limit=1&sort_order=desc`.

- **FRED series IDs are case-sensitive and exact** — `gdp` returns an error; must be `GDP`. Check `fred.stlouisfed.org/series/{ID}` to verify a series exists before scripting.

- **Some FRED series have gaps** — Daily series like `DGS10` and `SP500` skip weekends and holidays. Those dates simply don't appear in the observations array (not represented as `"."`). Weekly and monthly series use the first day of the period as the date (e.g., `2024-01-01` = January 2024).

- **FRED `realtime_start`/`realtime_end` in observations** — Every observation has these fields reflecting vintage data. For current data, ignore them. They matter only for "real-time" research (what was the published value on a specific past date).

# Macrotrends — Data Extraction

`https://www.macrotrends.net` — long-term historical financial and economic charts. Three access patterns depending on page type; all work with plain `http_get`, no browser required.

All results validated against live site on 2026-04-18.

## Do this first: pick your access pattern

| Goal | Pattern | Latency | Variable |
|------|---------|---------|----------|
| Stock OHLCV price history | Direct iframe PHP | ~190ms | `dataDaily` |
| Stock market cap (daily) | Direct iframe PHP | ~200ms | `chartData` |
| Stock fundamentals (PE, revenue, margins) | Direct iframe PHP | ~140ms | `chartData` |
| S&P 500 / composite index charts | `chart_iframe_comp.php` | ~90ms | `originalData` |
| Economic indicators (rates, yields, CPI) | `/economic-data/` JSON API | ~150ms | `data[]` array |
| Gold, commodity prices | Either path (both work) | ~150ms | `data[]` or `originalData` |

**Never use the browser for Macrotrends read-only tasks.** All endpoints are accessible via `http_get` with the default `Mozilla/5.0` UA. For pages that occasionally 403, switch to a Chrome UA (see gotchas).

---

## Pattern 1: Stock price history (OHLCV)

Construct the iframe URL directly — no need to fetch the main page first.

```ts
/**
 * Returns daily OHLCV records for any US stock.
 *
 * ticker:     uppercase ticker symbol, e.g. 'AAPL', 'MSFT', 'TSLA', 'NVDA'
 * years_back: number of years of history (1=~250 records, 15=~3772 records).
 *             Omit (null) to get ALL available history (AAPL goes back to 1980).
 */
async function get_stock_ohlcv(ticker: string, years_back: number | null = null): Promise<any[]> {
  let url = `https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/stock_price_history.php?t=${ticker}`;
  if (years_back) url += `&yb=${years_back}`;

  const html = await http_get(url);
  const m = html.match(/var\s+dataDaily\s*=\s*\[/);
  if (!m) throw new Error(`No dataDaily found for ticker ${JSON.stringify(ticker)}`);

  const si = html.indexOf("[", m.index);
  let bc = 0, ei = -1;
  for (let j = si; j < html.length; j++) {
    const ch = html[j];
    if (ch === "[") bc += 1;
    else if (ch === "]") {
      bc -= 1;
      if (bc === 0) { ei = j; break; }
    }
  }
  return JSON.parse(html.slice(si, ei + 1));
}

// Usage
const records = await get_stock_ohlcv("AAPL", 15);
// [{d: '2011-04-18', o: '9.771', h: '9.9547', l: '9.593', c: '9.9433', v: '18.275'}, ...]

const latest = records.at(-1);
// {d: '2026-04-17', o: '266.96', h: '272.3', l: '266.72', c: '270.23',
//  v: '55.211', ma50: '260.554', ma200: '251.828'}

console.log(`${latest.d}: close=$${latest.c} vol=${latest.v}M shares`);
```

### dataDaily field reference

| Field | Meaning | Type |
|-------|---------|------|
| `d` | Date (YYYY-MM-DD) | str |
| `o` | Open price (adjusted for splits) | str/float |
| `h` | High | str/float |
| `l` | Low | str/float |
| `c` | Close | str/float |
| `v` | Volume in **millions of shares** | str/float |
| `ma50` | 50-day moving average | str/float (appears on recent records only) |
| `ma200` | 200-day moving average | str/float (appears on recent records only) |

**Note:** All price values are strings — cast with `parseFloat()`. Volume is millions: `55.211` = 55.2M shares traded.

### Confirmed tickers (2026-04-18)

All tested with direct iframe URL, no page fetch needed:

```ts
// All work: AAPL, MSFT, TSLA, NVDA, GOOGL, AMZN, META, NFLX, etc.
// 3772 records for yb=15 (goes back to 2011-04-18)
// AAPL full history: 11428 records back to 1980-12-12
```

---

## Pattern 2: Stock fundamentals (PE ratio, revenue, market cap, margins)

Different PHP files depending on metric. Construct directly.

### Market cap (daily, in billions USD)

```ts
async function get_market_cap(ticker: string, years_back = 15): Promise<any[]> {
  const url = `https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/market_cap.php?t=${ticker}&yb=${years_back}`;
  const html = await http_get(url);
  const m = html.match(/var\s+chartData\s*=\s*\[/);
  const si = html.indexOf("[", m!.index);
  let bc = 0, ei = -1;
  for (let j = si; j < html.length; j++) {
    const ch = html[j];
    if (ch === "[") bc += 1;
    else if (ch === "]") {
      bc -= 1;
      if (bc === 0) { ei = j; break; }
    }
  }
  return JSON.parse(html.slice(si, ei + 1));
}

const data = await get_market_cap("AAPL");
// [{date: '2026-04-15', v1: 3929.35}, {date: '2026-04-16', v1: 3884.67}, ...]
// v1 = market cap in billions USD
```

### PE ratio, revenue, current ratio (quarterly/annual fundamentals)

```ts
/** freq: 'Q' = quarterly, 'A' = annual */
async function get_fundamental(ticker: string, metric_type: string, statement: string,
                               freq = "Q", years_back = 15): Promise<any[]> {
  const url =
    `https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/` +
    `fundamental_iframe.php?t=${ticker}&type=${metric_type}&statement=${statement}` +
    `&freq=${freq}&sub=&yb=${years_back}`;
  const html = await http_get(url);
  const m = html.match(/var\s+chartData\s*=\s*\[/);
  const si = html.indexOf("[", m!.index);
  let bc = 0, ei = -1;
  for (let j = si; j < html.length; j++) {
    const ch = html[j];
    if (ch === "[") bc += 1;
    else if (ch === "]") {
      bc -= 1;
      if (bc === 0) { ei = j; break; }
    }
  }
  return JSON.parse(html.slice(si, ei + 1));
}

// PE ratio
const pe = await get_fundamental("AAPL", "pe-ratio", "price-ratios");
// [{date: '2025-09-30', v1: 254.146, v2: 7.46, v3: 34.07}, ...]
// v1 = stock price, v2 = quarterly EPS, v3 = PE ratio

// Revenue
const rev = await get_fundamental("AAPL", "revenue", "income-statement");
// [{date: '2025-12-31', v1: 435.617, v2: 143.756, v3: 15.65}, ...]
// v1 = TTM revenue ($B), v2 = quarterly revenue ($B), v3 = YoY growth %

// Total assets
const assets = await get_fundamental("AAPL", "total-assets", "balance-sheet");

// Current ratio
const ratio = await get_fundamental("AAPL", "current-ratio", "ratios");
```

### Profit margins

```ts
async function get_profit_margins(ticker: string, years_back = 15): Promise<any[]> {
  const url =
    `https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/` +
    `fundamental_metric.php?t=${ticker}&chart=profit-margin&sub=&yb=${years_back}`;
  const html = await http_get(url);
  const m = html.match(/var\s+chartData\s*=\s*\[/);
  const si = html.indexOf("[", m!.index);
  let bc = 0, ei = -1;
  for (let j = si; j < html.length; j++) {
    const ch = html[j];
    if (ch === "[") bc += 1;
    else if (ch === "]") {
      bc -= 1;
      if (bc === 0) { ei = j; break; }
    }
  }
  return JSON.parse(html.slice(si, ei + 1));
}

const margins = await get_profit_margins("AAPL");
// [{date: '2025-12-31', v1: 47.33, v2: 32.38, v3: 27.04}, ...]
// v1 = gross margin %, v2 = operating margin %, v3 = net margin %
```

### Dividend yield

```ts
async function get_dividend_yield(ticker: string, years_back = 15): Promise<any[]> {
  const url = `https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/dividend_yield.php?t=${ticker}&yb=${years_back}`;
  const html = await http_get(url);
  const m = html.match(/var\s+chartData\s*=\s*\[/);
  const si = html.indexOf("[", m!.index);
  let bc = 0, ei = -1;
  for (let j = si; j < html.length; j++) {
    const ch = html[j];
    if (ch === "[") bc += 1;
    else if (ch === "]") {
      bc -= 1;
      if (bc === 0) { ei = j; break; }
    }
  }
  return JSON.parse(html.slice(si, ei + 1));
}

const dy = await get_dividend_yield("AAPL");
// [{date: '2026-04-17', c: 270.23, ttm_d: 1.03848, ttm_dy: 0.3843}, ...]
// c = stock price, ttm_d = TTM dividend ($), ttm_dy = TTM yield (%)
```

### Stock metric URL reference

| Metric | PHP file | Extra params |
|--------|----------|-------------|
| Stock price OHLCV | `stock_price_history.php` | — |
| Market cap (daily) | `market_cap.php` | — |
| Dividend yield | `dividend_yield.php` | — |
| Stock splits (price history) | `stock_splits.php` | — |
| PE ratio | `fundamental_iframe.php` | `type=pe-ratio&statement=price-ratios` |
| Revenue | `fundamental_iframe.php` | `type=revenue&statement=income-statement` |
| Total assets | `fundamental_iframe.php` | `type=total-assets&statement=balance-sheet` |
| Current ratio | `fundamental_iframe.php` | `type=current-ratio&statement=ratios` |
| Profit margins | `fundamental_metric.php` | `chart=profit-margin` |

Base URL prefix: `https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/`

All take `?t={TICKER}&yb={N}` (or `&sub=&yb={N}` for the fundamental ones).

---

## Pattern 3: Index and composite charts (S&P 500, Shiller PE, etc.)

These pages embed chart data via `chart_iframe_comp.php`. The variable is `originalData`.

```ts
/**
 * page_id:  the numeric ID from the page URL, e.g. 2577
 * url_slug: last segment of the page URL, e.g. 'sp500-pe-ratio-price-to-earnings-chart'
 */
async function extract_index_chart(page_id: number, url_slug: string): Promise<any[]> {
  const url = `https://www.macrotrends.net/assets/php/chart_iframe_comp.php?id=${page_id}&url=${url_slug}`;
  const html = await http_get(url);
  const m = html.match(/var\s+originalData\s*=\s*\[/);
  if (!m) throw new Error("originalData not found — this page may use a different pattern");
  const si = html.indexOf("[", m.index);
  let bc = 0, ei = -1;
  for (let j = si; j < html.length; j++) {
    const ch = html[j];
    if (ch === "[") bc += 1;
    else if (ch === "]") {
      bc -= 1;
      if (bc === 0) { ei = j; break; }
    }
  }
  return JSON.parse(html.slice(si, ei + 1));
}

// S&P 500 PE ratio (1180 monthly records, 1927-2026)
const pe_data = await extract_index_chart(2577, "sp500-pe-ratio-price-to-earnings-chart");
// [{date: '1927-12-01', close: '15.9099'}, ..., {date: '2026-03-01', close: '27.8925'}]
// 'close' is the PE ratio value

// Gold prices (1336 monthly records, 1915-2026)
const gold_data = await extract_index_chart(1333, "historical-gold-prices-100-year-chart");
// [{id: 'GOLDAMGBD228NLBM', date: '1915-01-01', close: '629.36', close1: '19.250'}, ...]
// 'close' = inflation-adjusted price, 'close1' = nominal USD price

console.log(`Latest S&P PE: ${JSON.stringify(pe_data.at(-1))}`);   // {"date":"2026-03-01","close":"27.8925"}
console.log(`Latest gold:   ${JSON.stringify(gold_data.at(-1))}`); // {"id":...,"date":"2026-04-01","close":"5177.19","close1":"5177.190"}
```

### Detecting which pattern a page uses

```ts
async function get_page_pattern(page_url: string): Promise<string> {
  const html = await http_get(page_url);
  if (html.includes("chart_iframe_comp.php")) {
    return "index_chart";           // use extract_index_chart()
  } else if (html.includes("generateChart") && html.includes("highchartsURL")) {
    return "economic_api";          // use get_economic_data()
  } else if (html.includes("/production/stocks/desktop/PRODUCTION/")) {
    return "stock_iframe";          // use get_stock_ohlcv() etc.
  }
  return "unknown";
}
```

### To get the ID and slug from a page

```ts
const page_url = "https://www.macrotrends.net/2577/sp500-pe-ratio-price-to-earnings-chart";
const html = await http_get(page_url);

let page_id: number, url_slug: string;

// Option A: parse from the iframe src in the HTML
const m = html.match(/chart_iframe_comp\.php\?id=(\d+)&url=([^"&]+)/);
if (m) {
  [page_id, url_slug] = [parseInt(m[1]), m[2]];
}

// Option B: derive from the page URL (works when slug matches)
const parts = page_url.replace(/\/+$/, "").split("/");
page_id  = parseInt(parts.at(-2)!);   // 2577
url_slug = parts.at(-1)!;             // 'sp500-pe-ratio-price-to-earnings-chart'
```

---

## Pattern 4: Economic indicator API

Pages that use `generateChart()` in their JS load data from `/economic-data/{pageID}/{freq}`.
This endpoint requires a `Referer` header matching the page URL.

```ts
/**
 * page_id:     numeric ID from the page URL (e.g. 2015 for Fed Funds Rate)
 * referer_url: the full page URL — required as Referer header
 * freq:        'D' = daily, 'M' = monthly (not all support both)
 *
 * Returns {data: [[ts_ms, value], ...], metadata: {...}}
 */
async function get_economic_data(page_id: number, referer_url: string, freq = "D"): Promise<any> {
  const url = `https://www.macrotrends.net/economic-data/${page_id}/${freq}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, */*",
    "Referer": referer_url,
  };
  // http_get adds Accept-Encoding: gzip and decompresses
  const result = JSON.parse(await http_get(url, headers));
  if (result === null) throw new Error(`pageID=${page_id} does not support freq=${JSON.stringify(freq)}`);
  return result;
}

// Fed Funds Rate (daily, 25319 records)
const ffr = await get_economic_data(2015, "https://www.macrotrends.net/2015/fed-funds-rate-historical-chart", "D");
console.log(ffr.metadata.name);  // 'Fed Funds Interest Rate'
console.log(ffr.metadata.label); // '%'

// Convert timestamps to dates
for (const [ts_ms, value] of ffr.data.slice(-3)) {
  const dt = new Date(ts_ms);   // UTC
  console.log(`${dt.toISOString().slice(0, 10)}: ${value}%`);
}
// 2026-04-13: 3.64%
// 2026-04-14: 3.64%
// 2026-04-15: 3.64%

// 10-Year Treasury yield (daily, 16074 records)
const t10 = await get_economic_data(2016, "https://www.macrotrends.net/2016/10-year-treasury-bond-rate-yield-chart", "D");
// Last: 2026-04-15: 4.29%

// Gold prices (monthly, 1336 records, 1915-present) — template=5
const gold = await get_economic_data(1333, "https://www.macrotrends.net/1333/historical-gold-prices-100-year-chart", "M");
// metadata: {name: 'Gold Prices', currency: '$', label: ''}

// US Unemployment Rate (monthly, 938 records)
const unemp = await get_economic_data(1316, "https://www.macrotrends.net/1316/us-national-unemployment-rate", "M");
// metadata: {name: 'U.S. Unemployment Rate', label: '%'}

// Debt-to-GDP ratio (monthly, 712 records)
const debt_gdp = await get_economic_data(1381, "https://www.macrotrends.net/1381/debt-to-gdp-ratio-historical-chart", "M");
```

### metadata fields

```ts
({
  name:            "Fed Funds Interest Rate",  // chart title
  tableHeaderName: "Fed Funds Interest Rate",
  currency:        "",            // '$' for dollar-denominated series
  label:           "%",          // units label
  chartType:       "line",
  mobileChartType: "line",
  lineWidth:       2,
  positiveColor:   "#2caffe",
  negativeColor:   "",
  decimals:        "",
  chartScale:      "linear",
  seriesUnits:     "",
})
```

### Available frequency codes

| Code | Meaning | Notes |
|------|---------|-------|
| `D` | Daily | Most series support this |
| `M` | Monthly | Returns `null` if not available |
| `Q` | Quarterly | Usually `null` — use `M` instead |
| `A` | Annual | Usually `null` — use `M` instead |
| `DEFAULT` | Default (usually monthly) | Same data as `M` for most series |
| `INDEXMONTHLY` | Monthly index close | Some commodity/index series |
| `INDEXDAILY` | Daily index | Some series |
| `DAILYEXCHANGERATE` | Daily FX rate | Currency pairs |
| `10YD` | 10-year daily | Specialized series |

Try `D` first, fall back to `M` if you get `null`.

### Known economic page IDs

| ID | URL slug | Description |
|----|----------|-------------|
| 1316 | us-national-unemployment-rate | U.S. Unemployment Rate (monthly, back to 1948) |
| 1333 | historical-gold-prices-100-year-chart | Gold Prices (monthly, back to 1915) |
| 1381 | debt-to-gdp-ratio-historical-chart | U.S. Debt to GDP Ratio |
| 2015 | fed-funds-rate-historical-chart | Fed Funds Interest Rate (daily, back to 1954) |
| 2016 | 10-year-treasury-bond-rate-yield-chart | 10-Year Treasury Yield (daily, back to 1962) |
| 2577 | sp500-pe-ratio-price-to-earnings-chart | S&P 500 PE Ratio (uses `chart_iframe_comp.php`) |

---

## Generic extraction helper

One function that handles all three embedded-JS patterns:

```ts
/** Extract a JS array variable from Macrotrends iframe HTML. */
function extract_chart_var(html: string, var_name: string): any[] {
  const esc = var_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(new RegExp(`var\\s+${esc}\\s*=\\s*\\[`));
  if (!m) return [];
  const si = html.indexOf("[", m.index);
  let bc = 0;
  for (let j = si; j < html.length; j++) {
    const ch = html[j];
    if (ch === "[") bc += 1;
    else if (ch === "]") {
      bc -= 1;
      if (bc === 0) return JSON.parse(html.slice(si, j + 1));
    }
  }
  return [];
}

// Works for dataDaily, chartData, or originalData:
const html = await http_get("https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/stock_price_history.php?t=AAPL&yb=15");
const daily = extract_chart_var(html, "dataDaily");

const html2 = await http_get("https://www.macrotrends.net/assets/php/chart_iframe_comp.php?id=2577&url=sp500-pe-ratio-price-to-earnings-chart");
const pe_data = extract_chart_var(html2, "originalData");
```

---

## URL construction guide

### Stock pages

```ts
const STOCK_BASE = "https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/";

// Price history OHLCV
`${STOCK_BASE}stock_price_history.php?t=${ticker}`;                        // all history
`${STOCK_BASE}stock_price_history.php?t=${ticker}&yb=${years}`;            // last N years

// Market cap
`${STOCK_BASE}market_cap.php?t=${ticker}&yb=${years}`;

// Fundamentals
`${STOCK_BASE}fundamental_iframe.php?t=${ticker}&type=${type}&statement=${stmt}&freq=${freq}&sub=&yb=${years}`;
// type/statement combos: pe-ratio/price-ratios, revenue/income-statement,
//                        total-assets/balance-sheet, current-ratio/ratios

// Metrics
`${STOCK_BASE}fundamental_metric.php?t=${ticker}&chart=${metric}&sub=&yb=${years}`;
// metrics: profit-margin

// Dividend yield
`${STOCK_BASE}dividend_yield.php?t=${ticker}&yb=${years}`;
```

### Economic / index pages

```ts
// From numeric ID + URL slug (read from page source or page URL)
`https://www.macrotrends.net/assets/php/chart_iframe_comp.php?id=${id}&url=${slug}`;

// Economic indicator JSON API (requires Referer header)
`https://www.macrotrends.net/economic-data/${page_id}/${freq}`;
```

---

## Rate limits and anti-bot

- **No rate limiting observed** at any tested volume. 10 rapid requests to the same stock iframe completed in 1.8s with no throttling, CAPTCHA, or 429 errors.
- **Default UA works** (`Mozilla/5.0`) for most endpoints. The iframe PHP files never 403'd.
- **Chrome UA needed** for some main HTML pages (not data endpoints): use when fetching `/stocks/charts/...` or `/2015/...` wrapper pages if you get 403. Switch to:
  ```ts
  const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" };
  ```
- **Referer required** for `/economic-data/{id}/{freq}` — send the page URL as `Referer`. Without it, the request is allowed but you get a 403 on some pages.
- **No cookies, sessions, or auth tokens** needed for any endpoint.

---

## Gotchas

**Main page URL ≠ data page:** Some URLs redirect to different content. `/1316/us-national-debt-by-year` redirects to `/1316/us-national-unemployment-rate`. Always check the final URL (`fetch(...).then(r => r.url)`) if the returned data looks wrong. Use the final URL as the Referer.

**yb parameter controls history depth:**
- `yb=1` → ~250 records (last year)
- `yb=15` → ~3772 records (last 15 years)
- omit → full history (AAPL: 11428 records to 1980; default for most queries)

**Two iframe patterns for economic pages:** Pages at `macrotrends.net/NNNN/slug` use either `chart_iframe_comp.php` (→ `originalData`) or `generateChart` + `/economic-data/` API. Check the main page HTML to detect which:
```ts
if (html.includes("chart_iframe_comp.php")) {   // use extract_index_chart()
} else if (html.includes("highchartsURL")) {      // use get_economic_data()
}
```

**Gold data has two price columns:**
```ts
({ id: "GOLDAMGBD228NLBM", date: "2026-04-01", close: "5177.19", close1: "5177.190" })
// 'close'  = inflation-adjusted price (base year adjusts over time)
// 'close1' = nominal USD price (the raw market price)
```

**Economic API frequency codes:** Only `D` and `M` consistently return data across most series. `A` and `Q` return `null` for most economic indicators. Always try `D` first.

**chartData fields vary by metric:**
- `market_cap.php` → `{date, v1}` (v1 = market cap in $B)
- `fundamental_iframe.php` type=pe-ratio → `{date, v1, v2, v3}` (stock price, EPS, PE)
- `fundamental_iframe.php` type=revenue → `{date, v1, v2, v3}` (TTM revenue, quarterly revenue, YoY%)
- `fundamental_metric.php` chart=profit-margin → `{date, v1, v2, v3}` (gross%, operating%, net%)
- `dividend_yield.php` → `{date, c, ttm_d, ttm_dy}` (price, dividend, yield%)

**Bracket matching required for large arrays:** The `var dataDaily = [...]` in stock iframes is ~450KB with 3772 OHLCV records. A greedy dot-all regex works but is slow; bracket-counting (`bc` pattern above) is O(n) and fast.

**No public API for ticker lookup:** To find the company slug for a URL, check the search endpoint: `https://www.macrotrends.net/production/stocks/desktop/PRODUCTION/ticker_search_list.php?v=YYYYMMDD` — but the stock price iframe only needs the ticker symbol (`?t=AAPL`), not the slug.

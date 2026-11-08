# CoinMarketCap — Data Extraction

`https://coinmarketcap.com` — crypto market data. Three access paths tested: internal JSON API (fastest, no auth required), `__NEXT_DATA__` from HTML pages, and browser DOM. All real-money price data confirmed accurate against displayed UI values.

## Do this first: pick your access path

| Goal | Best approach | Latency |
|------|--------------|---------|
| Top N coins by market cap | Internal listing API | ~200ms |
| Single coin price/stats/ATH | Internal detail API | ~100ms |
| Global market metrics | Internal global-metrics API | ~65ms |
| All coins on homepage (101 items) | `__NEXT_DATA__` main page | ~700ms |
| Coin detail + full stats | `__NEXT_DATA__` currency page | ~700ms |
| Historical OHLCV | Internal historical API | ~160ms |
| Exchange pairs for a coin | Internal market-pairs API | ~200ms |
| News/articles | Internal content API | ~220ms |

**Never use the browser for read-only CMC tasks.** The internal API at `api.coinmarketcap.com` is accessible with no API key, no special headers, no auth — plain `http_get` works.

**Do NOT use `pro-api.coinmarketcap.com`** — that is the paid API requiring a key.

---

## Path 1: Internal listing API (fastest for ranked coins)

Returns CMC-ranked coins with full price data in one call. No auth needed.

```ts
// Number formatting helpers (Python's :,.2f and :+.2f)
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing" +
  "?start=1&limit=100&sortBy=market_cap&sortType=desc&convert=USD"
));

const coins = resp.data.cryptoCurrencyList;    // list of coin objects
const total_available = resp.data.totalCount;  // 8374 as of 2026-04-18

for (const c of coins) {
  const usd = c.quotes.find((q: any) => q.name === "USD");
  console.log(
    `#${c.cmcRank} ${c.symbol}: ` +
    `$${fmt(usd.price)} | ` +
    `MCap $${(usd.marketCap / 1e9).toFixed(1)}B | ` +
    `Vol24h $${(usd.volume24h / 1e9).toFixed(1)}B | ` +
    `24h ${pct(usd.percentChange24h)}% | ` +
    `CS ${fmt(c.circulatingSupply, 0)}`
  );
}
```

### Coin object fields

Top-level (`c` in the loop above):
```
id, name, symbol, slug, cmcRank, marketPairCount,
circulatingSupply, selfReportedCirculatingSupply,
totalSupply, maxSupply, isActive, lastUpdated, dateAdded,
quotes, isAudited, auditInfoList, badges
```

Per-quote fields (inside `c.quotes`, filtered by `name === "USD"`):
```
name, price, volume24h, volumePercentChange, marketCap,
percentChange1h, percentChange24h, percentChange7d,
percentChange30d, percentChange60d, percentChange90d,
percentChange1y, ytdPriceChangePercentage,
fullyDilluttedMarketCap, marketCapByTotalSupply,
dominance, turnover, lastUpdated
```

### Query parameters

```ts
// Pagination
"?start=1&limit=100"        // page 1 of 100
"?start=101&limit=100"      // page 2

// Sort
"sortBy=market_cap"         // default
"sortBy=volume_24h"
"sortBy=percent_change_24h"
"sortBy=price"
"sortBy=circulating_supply"
"sortType=desc"             // or asc

// Currency conversion (affects quote prices returned)
"convert=USD"               // USD prices
"convert=BTC"               // BTC-denominated

// Filter by type
"cryptoType=all"            // default — coins + tokens
"cryptoType=coins"          // layer-1s only (633 results)
"cryptoType=tokens"         // ERC-20 etc.

// Filter by tag (DeFi, NFT, etc.)
"tagSlugs=defi"             // 2698 results
"tagSlugs=nft"
```

---

## Path 2: Internal detail API (single coin, full stats)

Best for fetching one coin's complete data including ATH, ATL, 52-week high/low, volume ranks.

```ts
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

// Look up by CMC coin ID (BTC=1, ETH=1027, XRP=52, SOL=5426, BNB=1839)
const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/detail?id=1"
));
const data = resp.data;
const s = data.statistics;

console.log(`Price:             $${fmt(s.price)}`);
console.log(`Rank:              #${s.rank}`);
console.log(`Market Cap:        $${fmt(s.marketCap, 0)}`);
console.log(`Volume 24h:        $${fmt(s.volume24h, 0)}`);
console.log(`Circulating Supply:${fmt(s.circulatingSupply, 0)}`);
console.log(`Total Supply:      ${fmt(s.totalSupply, 0)}`);
console.log(`Max Supply:        ${fmt(s.maxSupply, 0)}`);
console.log(`24h Change:        ${pct(s.priceChangePercentage24h)}%`);
console.log(`7d Change:         ${pct(s.priceChangePercentage7d)}%`);
console.log(`ATH:               $${fmt(s.highAllTime)} on ${s.highAllTimeTimestamp}`);
console.log(`ATL:               $${fmt(s.lowAllTime, 4)} on ${s.lowAllTimeTimestamp}`);
console.log(`52w High:          $${fmt(s.high52w)}`);
console.log(`52w Low:           $${fmt(s.low52w)}`);
console.log(`MCap Dominance:    ${s.marketCapDominance.toFixed(2)}%`);
```

### All statistics fields

```
price, priceChangePercentage1h, priceChangePercentage24h,
priceChangePercentage7d, priceChangePercentage30d,
priceChangePercentage60d, priceChangePercentage90d,
priceChangePercentage1y, priceChangePercentageAll,
marketCap, marketCapChangePercentage24h,
fullyDilutedMarketCap, mintedMarketCap,
circulatingSupply, totalSupply, maxSupply,
marketCapDominance, rank, roi,
low24h, high24h, low7d, high7d, low30d, high30d,
low52w, high52w, low90d, high90d,
lowAllTime, highAllTime,
lowAllTimeChangePercentage, highAllTimeChangePercentage,
lowAllTimeTimestamp, highAllTimeTimestamp,
lowYesterday, highYesterday, openYesterday, closeYesterday,
priceChangePercentageYesterday, volumeYesterday,
ytdPriceChangePercentage, volumeRank, volumeMcRank,
volume24h, volume24hReported, volume7d, volume7d Reported,
volume30d, volume30dReported, turnover
```

### Top-level data fields (beyond statistics)

```
id, name, symbol, slug, category, description, dateAdded,
volume, volumeChangePercentage24h, cexVolume, dexVolume,
urls (website, explorer, twitter, reddit, etc.),
tags, platforms, relatedCoins, wallets,
holders, watchCount, watchListRanking
```

---

## Path 3: Global market metrics

```ts
const pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);

const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/global-metrics/quotes/latest"
));
const data = resp.data;
const q = data.quotes[0];   // USD quote (cryptoId=2781)

console.log(`Total Market Cap:  $${(q.totalMarketCap / 1e12).toFixed(2)}T`);
console.log(`Total Volume 24h:  $${(q.totalVolume24H / 1e9).toFixed(1)}B`);
console.log(`Altcoin MCap:      $${(q.altcoinMarketCap / 1e12).toFixed(2)}T`);
console.log(`DeFi MCap:         $${(q.defiMarketCap / 1e9).toFixed(1)}B`);
console.log(`DeFi Vol 24h:      $${(q.defiVolume24H / 1e9).toFixed(1)}B`);
console.log(`Stablecoin MCap:   $${(q.stablecoinMarketCap / 1e9).toFixed(1)}B`);
console.log(`Derivatives Vol:   $${(q.derivativesVolume24H / 1e9).toFixed(1)}B`);
console.log(`BTC Dominance:     ${data.btcDominance.toFixed(2)}%`);
console.log(`ETH Dominance:     ${data.ethDominance.toFixed(2)}%`);
console.log(`Active Cryptos:    ${data.activeCryptoCurrencies}`);
console.log(`Total Cryptos:     ${data.totalCryptoCurrencies}`);
console.log(`Active Exchanges:  ${data.activeExchanges}`);
console.log(`Active Pairs:      ${data.activeMarketPairs}`);

// Yesterday comparison
console.log(`\nMCap Yesterday:    $${(q.totalMarketCapYesterday / 1e12).toFixed(2)}T`);
console.log(`MCap Change:       ${pct(q.totalMarketCapYesterdayPercentageChange)}%`);
```

---

## Path 4: Historical OHLCV (candlestick data)

```ts
const fmt0 = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const now = Math.floor(Date.now() / 1000);

// Daily candles for BTC over last 7 days
const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/historical" +
  `?id=1&convertId=2781&timeStart=${now - 7 * 86400}&timeEnd=${now}&interval=daily`
));
const candles = resp.data.quotes;   // list of OHLCV objects

for (const candle of candles) {
  const q = candle.quote;
  console.log(
    `${candle.timeOpen.slice(0, 10)} ` +
    `O=${fmt0(q.open)} H=${fmt0(q.high)} ` +
    `L=${fmt0(q.low)} C=${fmt0(q.close)} ` +
    `V=$${(q.volume / 1e9).toFixed(1)}B MCap=$${(q.marketCap / 1e12).toFixed(2)}T`
  );
}
```

Candle quote fields: `open, high, low, close, volume, marketCap, circulatingSupply, timestamp`

Supported intervals: `daily`, `1h` (hourly). `5m` returns HTTP 500 — not supported.

`convertId=2781` = USD. `timeStart`/`timeEnd` are Unix timestamps.

---

## Path 5: Exchange market pairs for a coin

```ts
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/cryptocurrency/market-pairs/latest" +
  "?id=1&start=1&limit=10&sort=volume"
));
const data = resp.data;
console.log(`Total pairs for ${data.name}: ${data.numMarketPairs}`);

for (const pair of data.marketPairs) {
  console.log(
    `  ${pair.exchangeName.padEnd(20)} ${pair.marketPair.padEnd(12)} ` +
    `$${fmt(pair.price)} Vol=$${(pair.volumeUsd / 1e6).toFixed(1)}M`
  );
}
```

Pair fields: `rank, exchangeId, exchangeName, exchangeSlug, marketId, marketPair, category (spot/futures), baseSymbol, quoteSymbol, baseCurrencyId, quoteCurrencyId, price, volumeUsd, effectiveLiquidity, lastUpdated, volumeBase, volumeQuote, depthUsdNegativeTwo, depthUsdPositiveTwo, feeType, isVerified, type (cex/dex)`

---

## Path 6: Exchange listings

```ts
const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/exchange/listing" +
  "?start=1&limit=20&sortBy=score&sortType=desc"
));
const exchanges = resp.data.exchanges;
for (const ex of exchanges) {
  console.log(`  ${ex.name.padEnd(30)} score=${ex.score ?? null} trafficScore=${ex.trafficScore ?? null}`);
}
```

Exchange fields: `id, name, slug, dexStatus, platformId, status, score, trafficScore, countries, fiats, filteredTotalVol24h`

---

## Path 7: Price conversion (cross-rate)

```ts
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// Convert 1 BTC → USD
const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/tools/price-conversion" +
  "?amount=1&id=1&convert_id=2781"
));
const result = resp.data;
const usd_price = result.quote[0].price;
console.log(`1 ${result.symbol} = $${fmt(usd_price)} USD`);

// Convert ETH → BTC
const resp2 = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/data-api/v3/tools/price-conversion" +
  "?amount=1&id=1027&convert_id=1"
));
const btc_price = resp2.data.quote[0].price;
console.log(`1 ETH = ${btc_price.toFixed(6)} BTC`);
```

`id` = source coin CMC ID, `convert_id` = target currency CMC ID (2781=USD, 1=BTC, 1027=ETH, 825=USDT)

---

## Path 8: News / articles

```ts
// News for a specific coin
const resp = JSON.parse(await http_get(
  "https://api.coinmarketcap.com/content/v3/news?coins=1&limit=10"
));
for (const article of resp.data) {
  const meta = article.meta;
  console.log(`  [${meta.sourceName}] ${meta.title}`);
  console.log(`    ${article.createdAt.slice(0, 10)} — ${meta.sourceUrl}`);
}
```

Article fields: `slug, cover, assets, createdAt` + nested `meta` with `title, subtitle, sourceName, sourceUrl, language, type, status, id, createdAt, updatedAt, releasedAt`

Omit `coins=` param for general crypto news. Supports `limit` up to observed 50+ without errors.

---

## Path 9: __NEXT_DATA__ from HTML pages

Use when you need data that isn't in the API (e.g. Fear & Greed index, CMC100 index, trending categories).

### Main page (`coinmarketcap.com/`)

```ts
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const html = await http_get("https://coinmarketcap.com/");
const m = html.match(/<script id="__NEXT_DATA__"[^>]+>([\s\S]*?)<\/script>/);
const nd = JSON.parse(m![1]);
const props = nd.props;

// Global market metrics (same data as global-metrics API, faster from HTML)
const gm = props.pageProps.globalMetrics;
console.log(`Total cryptos: ${gm.numCryptocurrencies}`);
console.log(`BTC dominance: ${gm.btcDominance.toFixed(2)}%`);
console.log(`Total MCap:    $${(gm.marketCap / 1e12).toFixed(2)}T`);
console.log(`Total Vol 24h: $${(gm.totalVol / 1e9).toFixed(1)}B`);

// Spot prices for BTC/ETH/USD/SATS/BITS (the "ticker bar" data)
// props.quotesLatestData — 5 items with short field names
for (const q of props.quotesLatestData) {
  console.log(`  ${q.symbol}: p=${q.p} p24h=${(q.p24h >= 0 ? "+" : "") + q.p24h.toFixed(3)}%`);
  // fields: id, symbol, p (price), p1h, p24h, p7d, p30d, p60d, p90d, pytd, t
}

// Top 101 coins with full USD quotes — from dehydratedState
const queries = props.dehydratedState.queries;
const homepage_q = queries.find((q: any) => JSON.stringify(q.queryKey) === JSON.stringify(["homepage-data", 1, 100]));
const listing = homepage_q.state.data.data.listing;
const coins = listing.cryptoCurrencyList;   // 101 coins
const total = listing.totalCount;

for (const c of coins) {
  if (c.symbol === "BTC") {
    const usd = c.quotes.find((q: any) => q.name === "USD");
    console.log(`BTC: #${c.cmcRank} $${fmt(usd.price)}`);
    break;
  }
}

// Page-level shared data (Fear & Greed index, CMC20, altcoin index)
const psd = props.pageProps.pageSharedData;
console.log("pageSharedData keys:", Object.keys(psd));
// keys: topCategories, fearGreedIndexData, cmc100, cmc20, faqData, altcoinIndex, halvingInfo, deviceInfo
```

**Gotcha — regex pattern**: Use `[^>]+` to match the `crossorigin="anonymous"` attribute on the script tag. `type="application/json"` alone will miss it:
```ts
// CORRECT
let m = html.match(/<script id="__NEXT_DATA__"[^>]+>([\s\S]*?)<\/script>/);

// WRONG — returns null because of crossorigin attr
m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
```

**`quotesLatestData` has only 5 entries** (SATS, BITS, BTC, ETH, USD) — it's the currency selector bar, not the full market ranking. For the full ranked listing use `dehydratedState`.

**`cmcRank` is at coin top level**, not inside the USD quote object. The `cmcRank` field inside the quote object is `null`.

### Individual coin page (`/currencies/{slug}/`)

```ts
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const html = await http_get("https://coinmarketcap.com/currencies/bitcoin/");
const m = html.match(/<script id="__NEXT_DATA__"[^>]+>([\s\S]*?)<\/script>/);
const nd = JSON.parse(m![1]);

// All stats under props.pageProps.detailRes.detail.statistics
const stats = nd.props.pageProps.detailRes.detail.statistics;

console.log(`Price:     $${fmt(stats.price)}`);
console.log(`Rank:      #${stats.rank}`);
console.log(`MCap:      $${fmt(stats.marketCap, 0)}`);
console.log(`Vol 24h:   $${fmt(stats.volume24h, 0)}`);
console.log(`Circ Sup:  ${fmt(stats.circulatingSupply, 0)}`);
console.log(`24h:       ${(stats.priceChangePercentage24h >= 0 ? "+" : "") + stats.priceChangePercentage24h.toFixed(2)}%`);
console.log(`ATH:       $${fmt(stats.highAllTime)} (${stats.highAllTimeTimestamp})`);
console.log(`ATL:       $${stats.lowAllTime.toFixed(4)}`);
```

`detailRes.detail` also contains: `name, symbol, slug, description, tags, urls (website/explorer/twitter/reddit), platforms, relatedCoins, holders, watchCount`

**Note**: The currency page has no JSON-LD blocks — zero `<script type="application/ld+json">` elements.

---

## Common coin IDs

| ID | Symbol | Name |
|----|--------|------|
| 1 | BTC | Bitcoin |
| 1027 | ETH | Ethereum |
| 52 | XRP | XRP |
| 825 | USDT | Tether |
| 1839 | BNB | BNB |
| 3408 | USDC | USD Coin |
| 5426 | SOL | Solana |
| 74 | DOGE | Dogecoin |
| 2781 | USD | US Dollar (for convert_id) |

Find IDs from the listing API: `c.id` or from the detail API URL by looking up a slug first via the listing API's `c.slug` field.

---

## Anti-bot / rate limits

**Main site (`coinmarketcap.com`):**
- `http_get` works with the default `Mozilla/5.0` UA — no Cloudflare, no bot detection triggered.
- Page loads are ~700ms for 690–710KB of HTML+`__NEXT_DATA__`.

**Internal API (`api.coinmarketcap.com`):**
- No auth headers required. No `X-Request-Id` or `X-Forwarded-For` needed.
- 25 rapid sequential calls with zero rate limiting or errors — no throttle observed at that volume.
- Typical latency: 65–250ms per call.
- `error_code: '0'` and `error_message: 'SUCCESS'` in every response; no `credit_count` consumed.

**v2 API (`api.coinmarketcap.com/v2/`):**
- Returns HTTP 401 Unauthorized — requires API key. Do not use.

**Pro API (`pro-api.coinmarketcap.com`):**
- Paid, requires `X-CMC_PRO_API_KEY` header. Do not test or call.

---

## Gotchas

- **No JSON-LD on any page tested** — coin pages have zero `<script type="application/ld+json">` elements. Don't look for schema.org markup.

- **`__NEXT_DATA__` regex**: Must use `[^>]+` between `__NEXT_DATA__"` and `>` — the tag has `crossorigin="anonymous"` which breaks a naive `type="application/json">` match.

- **`cmcRank` location on homepage listing**: It's `c.cmcRank` (top-level), NOT inside `c.quotes[n].cmcRank` (that field is always `null`).

- **5m/sub-hourly OHLCV not available**: Interval `5m` returns HTTP 500. Use `1h` for sub-daily and `daily` for longer ranges.

- **v2 API is auth-only**: `api.coinmarketcap.com/v2/...` requires API key (401). The equivalent data is available via `data-api/v3/` without auth.

- **`convert` param accepts symbols not just IDs** in the listing API, but `convert_id` in the price-conversion API requires numeric IDs (e.g. `2781` not `USD`).

- **Circulating supply**: `c.circulatingSupply` at the coin top level in the listing response — not inside the quote. The quote has `marketCap` which equals `price * circulatingSupply`.

- **Multiple quotes per coin**: The listing API returns multiple quote objects when you request multiple convert currencies. Always filter by `q.name === "USD"` (or your target currency) before reading price fields.

- **Pagination**: `start` is 1-indexed (not 0-indexed). `start=1&limit=100` returns items 1–100, `start=101&limit=100` returns items 101–200.

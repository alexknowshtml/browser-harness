# Craigslist — Scraping via http_get

Field-tested against sfbay.craigslist.org and multiple city subdomains on 2026-04-18.
`http_get` works without any bot detection — no CAPTCHA, no block, no rate limit observed.
Craigslist serves a full server-rendered HTML fallback (the `<ol class="cl-static-search-results">` block)
intended for no-JS browsers. This fallback contains **all matching results in one response** (300–360
items typical), regardless of the `s=` offset parameter. No browser needed.

## Key discovery: static HTML returns everything at once

When you `http_get` a Craigslist search URL, the server includes a `<ol class="cl-static-search-results">`
block that contains every matching listing (up to ~360) in a single HTML response. The `s=` pagination
parameter is ignored by the static renderer — it is only meaningful for the JS-driven XHR path used by
real browsers. For scraping purposes, this means:

- One `http_get` call per search query returns the full result set (no pagination loop needed).
- For broader searches, narrow via `query=`, `min_price=`, `max_price=`, and category code in the URL.
- If you need more than ~360 results, you must use a headless browser with JS. For most tasks,
  one request is sufficient.

## URL patterns

### City subdomains
```
https://{city}.craigslist.org/search/{category_code}?query=...
```

Confirmed working cities (exact subdomain names):

| City           | Subdomain        |
|----------------|------------------|
| SF Bay Area    | `sfbay`          |
| New York       | `newyork`        |
| Chicago        | `chicago`        |
| Los Angeles    | `losangeles`     |
| Seattle        | `seattle`        |
| Boston         | `boston`         |
| Miami          | `miami`          |
| Denver         | `denver`         |
| Austin         | `austin`         |
| Portland       | `portland`       |
| San Diego      | `sandiego`       |
| Phoenix        | `phoenix`        |

### Category codes (confirmed working)

| Code  | Category                  |
|-------|---------------------------|
| `sss` | For Sale — all            |
| `for` | For Sale — general        |
| `ela` | Electronics (listings)    |
| `ele` | Electronics (search)      |
| `fua` | Furniture                 |
| `clo` | Clothing & accessories    |
| `spo` | Sporting goods            |
| `toy` | Toys & games              |
| `cto` | Cars+trucks — by owner    |
| `cta` | Cars+trucks — by dealer   |
| `hhh` | Housing — all             |
| `apa` | Apartments                |
| `roo` | Rooms & shares            |
| `sub` | Sublets & temporary       |
| `jjj` | Jobs — all                |
| `sof` | Software/QA/DBA jobs      |
| `bbb` | Services — all            |
| `ggg` | Gigs — all                |
| `com` | Community                 |
| `eve` | Events                    |
| `vol` | Volunteers                |

### Query parameters

| Parameter     | Effect                                         |
|---------------|------------------------------------------------|
| `query=`      | Keyword search                                 |
| `sort=rel`    | Sort by relevance (default)                    |
| `sort=date`   | Sort by newest first                           |
| `sort=priceasc`  | Price low to high                           |
| `sort=pricedsc`  | Price high to low                           |
| `min_price=`  | Minimum price filter                           |
| `max_price=`  | Maximum price filter                           |
| `condition=10` | New (for-sale listings)                       |
| `condition=20` | Like new                                      |
| `condition=30` | Excellent                                     |
| `condition=40` | Good                                          |
| `condition=50` | Fair                                          |
| `condition=60` | Salvage                                       |
| `bedrooms=`   | Number of bedrooms (housing only)              |
| `auto_make_model=` | Car make/model filter (cars category)   |
| `s=`          | Pagination offset — **ignored in static HTML** |

### Example URLs
```ts
// For-sale keyword search
"https://sfbay.craigslist.org/search/sss?query=macbook&sort=rel"

// Price-filtered electronics
"https://sfbay.craigslist.org/search/ela?query=iphone&min_price=100&max_price=500"

// Apartments, 2 bedrooms, price range
"https://sfbay.craigslist.org/search/apa?bedrooms=2&min_price=1000&max_price=2500"

// Cars by owner, Toyota
"https://sfbay.craigslist.org/search/cto?auto_make_model=toyota"

// Jobs in another city
"https://chicago.craigslist.org/search/jjj?query=python+developer"
```

## Listing card HTML structure

Each listing is an `<li class="cl-static-search-result">` inside `<ol class="cl-static-search-results">`.

```html
<li class="cl-static-search-result" title="MacBook Air M2 256GB 8GB RAM">
  <a href="https://sfbay.craigslist.org/sby/ele/d/san-jose-macbook-air-m2/7928508295.html">
    <div class="title">MacBook Air M2 256GB 8GB RAM</div>
    <div class="details">
      <div class="price">$900</div>
      <div class="location">San Jose</div>
    </div>
  </a>
</li>
```

Fields available in the listing card:
- **Title**: `title` attribute on `<li>` OR text inside `<div class="title">`
- **URL**: `href` on the `<a>` tag — always a full absolute URL
- **Price**: `<div class="price">` — may be absent on free/contact-for-price listings
- **Location/neighborhood**: `<div class="location">` — neighborhood name or city
- **Post ID**: last segment of the URL before `.html` (e.g. `/7928508295.html` → `7928508295`)

URL pattern: `https://{city}.craigslist.org/{area}/{category_code}/d/{slug}/{post_id}.html`

## Parsing search results (field-tested)

```ts
async function search_craigslist(city: string, category: string, query: string, min_price?: number, max_price?: number) {
  let params = `query=${query.replaceAll(" ", "+")}&sort=rel`;
  if (min_price) params += `&min_price=${min_price}`;
  if (max_price) params += `&max_price=${max_price}`;
  const url = `https://${city}.craigslist.org/search/${category}?${params}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  const html = await http_get(url, headers);

  const listings = html.matchAll(
    new RegExp(
      String.raw`<li class="cl-static-search-result" title="([^"]+)"[^>]*>\s*` +
        String.raw`<a href="([^"]+)"[^>]*>.*?` +
        String.raw`<div class="price">([^<]*)</div>.*?` +
        String.raw`<div class="location">\s*([^<]*?)\s*</div>`,
      "gs",
    ),
  );

  const results = [];
  for (const [, title, url, price, location] of listings) {
    const pid_match = url.match(/\/(\d+)\.html$/);
    results.push({
      post_id: pid_match ? pid_match[1] : null,
      title,
      url,
      price: price.trim() || null,  // null if listing has no price
      location: location.trim(),
    });
  }
  return results;
}

// Usage
const results = await search_craigslist("sfbay", "sss", "macbook pro", undefined, 1000);
for (const r of results.slice(0, 5)) {
  console.log(r.post_id, r.price, r.location, r.title.slice(0, 50));
}
```

### Handling missing price

Listings without a price have no `<div class="price">` element. The regex above returns an empty string
for `price`; the example converts that to `null`. A more robust extraction:

```ts
function parse_listings(html: string) {
  const results = [];
  for (const [, block] of html.matchAll(/<li class="cl-static-search-result"(.*?)<\/li>/gs)) {
    const title = block.match(/title="([^"]+)"/);
    const url   = block.match(/href="([^"]+)"/);
    const price = block.match(/<div class="price">([^<]+)<\/div>/);
    const loc   = block.match(/<div class="location">\s*([^<]*?)\s*<\/div>/);
    if (!url) continue;
    const url_str = url[1];
    const pid = url_str.match(/\/(\d+)\.html$/);
    results.push({
      post_id: pid ? pid[1] : null,
      title: title ? title[1] : null,
      url: url_str,
      price: price ? price[1].trim() : null,
      location: loc ? loc[1].trim() : null,
    });
  }
  return results;
}
```

## Individual listing page extraction

Listing pages are also fully server-rendered. All fields are present in the raw HTML.

```ts
async function get_listing(url: string) {
  const headers = { "User-Agent": "Mozilla/5.0" };
  const html = await http_get(url, headers);

  const title    = html.match(/<span id="titletextonly">([^<]+)<\/span>/);
  const price    = html.match(/<span class="price">(\$[\d,]+)<\/span>/);
  // Location is in parentheses right after the price span
  const location = html.match(/<span class="price">[^<]+<\/span><span>\s*\(([^)]+)\)\s*<\/span>/);
  const posted   = html.match(/class="date timeago"[^>]+datetime="([^"]+)"/);
  const post_id  = html.match(/post id:\s*(\d+)/);

  // Description body
  const body_block = html.match(/section id="postingbody"[^>]*>(.*?)<\/section>/s);
  let body_text = "";
  if (body_block) {
    const raw = body_block[1].replace(/<[^>]+>/g, "").trim();
    // Remove the "QR Code Link to This Post" print-only block
    body_text = raw.replace(/QR Code Link to This Post\s*/g, "").trim();
    body_text = body_text.replace(/\s+/g, " ");
  }

  // Images
  const images = html.match(/https:\/\/images\.craigslist\.org\/[^\s"']+_600x450\.jpg/g) ?? [];

  // Attributes (condition, make, model, etc.)
  const attrs: Record<string, string> = {};
  for (const [, labl, valu] of html.matchAll(
    /<span class="labl">([^<]+)<\/span>.*?<span class="valu">\s*(?:<[^>]+>\s*)*([^<\n]+?)(?:\s*<\/|\s*<a)/gs,
  )) {
    attrs[labl.trim().replace(/:+$/, "")] = valu.trim();
  }

  return {
    post_id:  post_id ? post_id[1] : null,
    title:    title ? title[1] : null,
    price:    price ? price[1] : null,
    location: location ? location[1] : null,
    posted:   posted ? posted[1] : null,  // ISO 8601 with TZ
    body:     body_text,
    images,
    attrs,
  };
}
```

### Sample output — for-sale listing
```ts
({
  post_id:  "7917381408",
  title:    "Brand new iphone 15 case and screen protector",
  price:    "$6",
  location: "cupertino",
  posted:   "2026-02-24T16:08:38-0800",
  body:     "I bought a new phone. These are brand new! Plz lmk if you are interested.",
  images:   ["https://images.craigslist.org/00e0e_xxx_600x450.jpg"],
  attrs:    { "condition": "like new", "make / manufacturer": "Apple", "model name / number": "iPhone 15 Plus" },
})
```

### Housing-specific fields

Housing listings have `<span class="attr important">` blocks for bedrooms/bathrooms and square footage,
separate from the `<div class="attr">` attribute grid:

```ts
// BR/BA
const br_ba = html.match(/(\d+)BR\s*\/\s*(\d+(?:\.\d+)?)Ba/);
// Square footage
const sqft  = html.match(/(\d+)ft<sup>2<\/sup>/);

let bedrooms, bathrooms, sqft_val;
if (br_ba) [, bedrooms, bathrooms] = br_ba;
if (sqft) sqft_val = sqft[1];
```

## JSON-LD structured data (alternative extraction path)

Each search page includes an `ItemList` JSON-LD block with up to 330 items. Useful when you want
structured data (price as float, geo coordinates) without regex parsing of HTML:

```ts
const html = await http_get("https://sfbay.craigslist.org/search/sss?query=laptop", { "User-Agent": "Mozilla/5.0" });
const ld_blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map((m) => m[1]);

for (const raw of ld_blocks) {
  const data = JSON.parse(raw);
  if (data["@type"] === "ItemList") {
    for (const item of data.itemListElement) {
      const listing = item.item;
      console.log(
        listing.name,
        listing.offers?.price,
        listing.offers?.priceCurrency,
        listing.offers?.availableAtOrFrom?.address?.addressLocality,
      );
    }
  }
}
```

JSON-LD item fields available: `name`, `description`, `image` (list of URLs),
`offers.price` (float string e.g. `"900.00"`), `offers.priceCurrency`, `offers.availableAtOrFrom.address`,
`offers.availableAtOrFrom.geo.latitude`, `offers.availableAtOrFrom.geo.longitude`.

Note: JSON-LD items do not include the listing URL or post ID — use the HTML parser for those.
Combine both: use JSON-LD for price/geo, HTML for URL/post ID.

## Pagination behavior

The `s=` offset parameter in the URL is only respected by the JS-driven XHR layer in a real browser.
When accessed via `http_get`, the static HTML fallback renders all results regardless of `s=`:

```
s=0   → same 342 listings
s=120 → same 342 listings  (confirmed identical URL sets)
s=300 → same 342 listings
```

**Recommendation**: Do not attempt pagination via `http_get`. Use search filters to narrow results:

```ts
// Instead of paginating, narrow by price range
const under_500 = await search_craigslist("sfbay", "sss", "macbook", undefined, 500);
const over_500  = await search_craigslist("sfbay", "sss", "macbook", 501);
```

If true pagination is required (e.g. you need more than 350 results), you must use a browser session
with `goto()` + `wait_for_load()`.

## Bot detection

None observed. Craigslist does not block `http_get` requests. During testing:
- All 6+ test cities returned full HTML (HTML size 174K–530K bytes per page)
- No CAPTCHA page, no redirect to `robot-check`, no `403`
- No cookie or session required
- Works with minimal `User-Agent` header: `"Mozilla/5.0"` is sufficient

Defensive check (in case behavior changes):

```ts
function is_blocked(html: string) {
  return (
    html.length < 5000 ||
    html.slice(0, 2000).toLowerCase().includes("blocked") ||
    html.slice(0, 2000).toLowerCase().includes("captcha") ||
    !html.includes("cl-static-search-result")
  );
}
```

## Gotchas

- **`data-pid` does not exist in static HTML**: Old Craigslist used `data-pid` attributes. The current
  static renderer uses `<li class="cl-static-search-result">` with title attribute and embedded `<a href>`.
  Do not search for `data-pid`, `result-row`, or `cl-search-result` — they are absent.

- **Post ID comes from the URL, not an attribute**: Extract it as the numeric segment before `.html`
  in the listing URL: `url.match(/\/(\d+)\.html$/)![1]`.

- **Price may be absent**: Free listings and "contact for price" listings have no `<div class="price">`.
  The regex returns an empty string; convert to `null`.

- **`s=` pagination is a no-op in static HTML**: The fallback renderer always returns the full result set.
  Don't loop over pages — filter instead.

- **HTML entities in titles**: Titles may contain `&amp;`, `&quot;`, etc. Run them through an
  unescape helper (see the last gotcha) if you need clean text.

- **URL structure varies by area**: The area code in the URL (`/sby/`, `/sfc/`, `/eby/`) is the sub-area
  of the city (e.g. South Bay, San Francisco, East Bay). It is part of the listing URL but not needed
  for constructing search URLs (which use the city subdomain only).

- **`<li class="cl-static-hub-links">` is not a listing**: The first `<li>` in the results `<ol>` is
  a "see also" block. The regex patterns above skip it automatically because it has no `title` attribute.

- **JSON-LD count < HTML count**: JSON-LD block may contain ~330 items while the HTML block shows ~350.
  The HTML parser is authoritative; JSON-LD is a secondary data source.

- **Body text contains print-only junk**: The `<section id="postingbody">` starts with a
  "QR Code Link to This Post" print-only element. Strip it with a simple string replacement
  (shown in the extractor above).

- **HTML-escaped body text**: Description bodies may contain `&amp;`, `&lt;`, etc. Unescape if needed:
  ```ts
  const unescape = (s: string) =>
    s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()] ?? m);
  const body_clean = unescape(body_text);
  ```

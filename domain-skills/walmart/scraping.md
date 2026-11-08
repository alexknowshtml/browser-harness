# Walmart — Product Search & Data Extraction

Field-tested against walmart.com on 2026-04-18 using `http_get` (no browser required).
All code blocks were run and outputs verified against live responses.

---

## Fastest Approach: `http_get` with `__NEXT_DATA__`

Walmart's Next.js SSR embeds the full search or product payload as JSON in a
`<script id="__NEXT_DATA__">` tag. **No browser needed for search or product detail pages.**
~2–3 s per page fetch; no CAPTCHA or session cookies required.

### Critical UA rule

| User-Agent | Result |
|---|---|
| `Mozilla/5.0` (bare) | Full HTML + `__NEXT_DATA__` — **use this** |
| `Mozilla/5.0 ... Chrome/120 ...` (full) | PerimeterX "Robot or human?" challenge (200, 15 KB) |
| `Safari/17` full UA | Works (full HTML, ~1.15 MB) |
| `curl/7.x` | PerimeterX challenge |
| `python-requests/2.31` | PerimeterX challenge |

The bare `Mozilla/5.0` string bypasses PerimeterX. Any UA that looks like a headless
client or includes a recognizable browser fingerprint triggers the JS challenge page.

### Base fetch helper

```ts
// Fetch any walmart.com page. Returns decoded HTML string.
// Throws if the PerimeterX bot challenge is returned.
async function fetch_walmart(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip" },
    signal: AbortSignal.timeout(20_000),
  });
  const html = await r.text(); // fetch decompresses gzip automatically
  if (html.includes("Robot or human")) {
    throw new Error(`PerimeterX challenge triggered: ${url}`);
  }
  return html;
}

function parse_next_data(html: string): any {
  const m = html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("__NEXT_DATA__ not found — page structure may have changed");
  return JSON.parse(m[1]);
}
```

---

## Search Results

### URL patterns

```ts
// Keyword search
"https://www.walmart.com/search?q=laptop";

// Pagination — append &page=N
"https://www.walmart.com/search?q=laptop&page=2";

// Sort options (confirmed working)
"https://www.walmart.com/search?q=laptop&sort=best_match";    // default
"https://www.walmart.com/search?q=laptop&sort=best_seller";
"https://www.walmart.com/search?q=laptop&sort=price_low";
"https://www.walmart.com/search?q=laptop&sort=customer_rating";

// Price filter
"https://www.walmart.com/search?q=laptop&min_price=200&max_price=500";

// Browse by category (department ID path)
"https://www.walmart.com/browse/electronics/laptops/3944_1089430_3951";
```

### `__NEXT_DATA__` path to items

```
data
  .props.pageProps.initialData.searchResult
    .aggregatedCount        — int: total matching products (e.g. 18818)
    .paginationV2.maxPage   — int: last page number
    .itemStacks[]           — array of stacks (usually 2: sponsored + organic)
      .items[]              — array of product objects
```

### Full extractor (field-tested)

```ts
// Returns [items, total_count, max_page].
// items is a list of objects with confirmed fields.
function extract_search_results(html: string): [any[], number | null, number | null] {
  const data = parse_next_data(html);
  const sr = data.props.pageProps.initialData.searchResult;

  const items: any[] = [];
  for (const stack of sr.itemStacks ?? []) {
    for (const item of stack.items ?? []) {
      const pi = item.priceInfo || {};
      const img = item.imageInfo || {};
      const rating = item.rating || {};
      const avail = item.availabilityStatusV2 || {};
      items.push({
        usItemId:        item.usItemId ?? null,          // str, Walmart item ID
        name:            item.name ?? null,              // str
        brand:           item.brand ?? null,             // str or null
        price:           item.price ?? null,             // int, current price in USD
        linePrice:       pi.linePrice ?? null,           // str "$429.00"
        wasPrice:        pi.wasPrice || null,            // str "$699.00" or null
        savings:         pi.savings || null,             // str "SAVE $270.00" or null
        averageRating:   rating.averageRating ?? null,   // float e.g. 4.3
        numberOfReviews: rating.numberOfReviews ?? null, // int
        availability:    avail.value ?? null,            // "IN_STOCK" / "OUT_OF_STOCK"
        isSponsored:     Boolean(item.isSponsoredFlag),
        url:             "https://www.walmart.com" + (item.canonicalUrl || "").split("?")[0],
        thumbnailUrl:    img.thumbnailUrl ?? null,
      });
    }
  }

  const total = sr.aggregatedCount ?? null;
  const max_page = (sr.paginationV2 || {}).maxPage ?? null;
  return [items, total, max_page];
}


// Usage
const html = await fetch_walmart("https://www.walmart.com/search?q=laptop");
const [items, total, max_page] = extract_search_results(html);
// items: 66 items on page 1, total=18818, max_page=11

// Filter out sponsored
const organic = items.filter((i) => !i.isSponsored);
```

### Field notes (confirmed)

- **`usItemId`**: string, matches the numeric ID at the end of `/ip/.../ITEMID` URLs.
  Some non-product rows (ad widgets) have `usItemId` null — filter with `if (item.usItemId)`.
- **`price`**: integer cents-less price (e.g. `429` for "$429.00"). Use `priceInfo.linePrice` for
  the formatted string including the dollar sign.
- **`wasPrice` / `savings`**: only present when item is on sale. Always `null` for full-price items.
- **`isSponsoredFlag`**: the first batch of results across both itemStacks are frequently sponsored.
  On a laptop search, ~56 of 66 SSR items carry `isSponsoredFlag: true`.
- **`rating`**: present on ~91% of items (60/66 in test). `averageRating` is a float; `numberOfReviews` is int.
- **`canonicalUrl`**: always includes `?classType=...&athbdg=...` query params — strip with `.split("?")[0]`
  to get a clean URL.
- **Two itemStacks**: Walmart returns two stacks (`itemStacks[0]` and `itemStacks[1]`). Merge them.
  `itemStacks[0]` is the primary grid; `itemStacks[1]` is a secondary sponsored/related block.

### Pagination

```ts
for (let page = 1; page <= max_page; page++) {
  const html = await fetch_walmart(`https://www.walmart.com/search?q=laptop&page=${page}`);
  const [items] = extract_search_results(html);
  // process items...
}
```

Page responses average ~2.5 s each. No rate-limiting was observed across 3 sequential requests.
For bulk scraping, add a 1–2 s delay between requests to be safe.

---

## Product Detail Page

### URL pattern

```
https://www.walmart.com/ip/{slug}/{usItemId}
```

The slug is ignored in routing — only the numeric `usItemId` matters.
These work identically:
```
https://www.walmart.com/ip/anything/19717318352
https://www.walmart.com/ip/Apple-MacBook-Neo/19717318352
```

### `__NEXT_DATA__` path on a product page

```
data.props.pageProps.initialData.data
  .product        — core product object
  .idml           — long description, specs, highlights, warranty
  .reviews        — rating breakdown + first 10 customer reviews (SSR)
```

### Full extractor (field-tested)

```ts
// Returns an object with all confirmed product fields.
// idml.specifications returns all spec rows as a flat object.
// reviews returns the SSR-rendered first 10 customer reviews.
function extract_product_detail(html: string): any {
  const data = parse_next_data(html);
  const d = data.props.pageProps.initialData.data;
  const product = d.product;
  const idml    = d.idml || {};
  const reviews = d.reviews || {};

  const pi = product.priceInfo || {};
  const cp = pi.currentPrice || {};
  const img = product.imageInfo || {};
  const avail = product.availabilityStatusV2 || {};

  const specs = Object.fromEntries(
    (idml.specifications || []).map((spec: any) => [spec.name, spec.value ?? null]),
  );

  const all_images = (img.allImages || [])
    .map((img_item: any) => img_item.url)
    .filter(Boolean);

  const customer_reviews = (reviews.customerReviews || []).map((r: any) => ({
    title:  r.reviewTitle ?? null,
    rating: r.rating ?? null,           // int 1-5 (field is "rating", NOT "overallRating")
    text:   r.reviewText ?? null,
    author: r.userNickname ?? null,
    date:   r.reviewSubmissionTime ?? null,
  }));

  return {
    // identity
    usItemId:            product.usItemId ?? null,
    name:                product.name ?? null,
    brand:               product.brand ?? null,
    model:               product.model ?? null,
    upc:                 product.upc ?? null,
    // price
    price:               cp.price ?? null,            // float, e.g. 599
    priceString:         cp.priceString ?? null,      // "$599.00"
    wasPrice:            (pi.wasPrice || {}).priceString ?? null,
    savings:             (pi.savings || {}).savingsString ?? null,
    // availability
    availability:        avail.value ?? null,         // "IN_STOCK" / "OUT_OF_STOCK"
    availabilityDisplay: avail.display ?? null,       // "In stock"
    // ratings
    averageRating:       product.averageRating ?? null,
    numberOfReviews:     product.numberOfReviews ?? null,
    // text
    shortDescription:    product.shortDescription ?? null,
    longDescription:     idml.longDescription ?? null, // HTML string
    // media
    thumbnailUrl:        img.thumbnailUrl ?? null,
    allImages:           all_images,          // up to 10 image URLs
    // specs
    specifications:      specs,               // {"Brand": "Apple", "Processor": "A18 Pro", ...}
    highlights: (idml.productHighlights || []).map((h: any) => ({ // top highlighted specs with icons
      name: h.name ?? null,
      value: h.value ?? null,
    })),
    // URL
    canonicalUrl:        "https://www.walmart.com" + (product.canonicalUrl || ""),
    // fulfillment
    fulfillmentOptions:  product.fulfillmentOptions || [],
    // reviews (SSR-rendered, first 10)
    reviewSummary: {
      averageOverallRating:  reviews.averageOverallRating ?? null,
      totalReviewCount:      reviews.totalReviewCount ?? null,
      reviewsWithTextCount:  reviews.reviewsWithTextCount ?? null,
      recommendedPercentage: reviews.recommendedPercentage ?? null,
    },
    customerReviews:     customer_reviews,
  };
}


// Usage
const url = "https://www.walmart.com/ip/Apple-MacBook-Neo/19717318352";
const html = await fetch_walmart(url);
const product = extract_product_detail(html);

// Example output (confirmed live):
// product.name         → "Apple MacBook Neo 13-inch Apple A18 Pro chip..."
// product.price        → 599
// product.priceString  → "$599.00"
// product.availability → "IN_STOCK"
// product.model        → "MHFD4LL/A"
// product.upc          → "195950852745"
// Object.keys(product.specifications).length → 29 spec rows
// product.allImages.length                   → 10
// product.specifications["Processor"]        → "A18 Pro"
```

### Field notes (confirmed)

- **`averageRating` / `numberOfReviews`** on the product node: present for items with reviews.
  New/few-review items may return `null` for both.
- **`reviewSummary.averageOverallRating`** in the reviews node often differs slightly from
  `product.averageRating` — the reviews node is more precise (e.g. `4.75` vs `4.8`).
- **`customerReviews`** (SSR): always the first 10 reviews. The per-review rating field is `"rating"`
  (int 1–5), **not** `"overallRating"` (which is always `null`).
- **`longDescription`**: raw HTML string including `<ul>/<li>` tags. Strip tags before display.
- **`specifications`**: flat dict — confirmed 29–31 rows for electronics. Key names use display labels
  (e.g. `"RAM memory"`, `"Screen size"`, `"HD capacity"`).
- **`wasPrice` / `savings`** on detail page: same as search — `null` when item is not discounted.
- **No JSON-LD**: Walmart product pages do **not** include `<script type="application/ld+json">`.
  All structured data lives in `__NEXT_DATA__`.

---

## Anti-Bot: PerimeterX

Walmart uses **PerimeterX** (app ID `PXu6b0qd2S`, confirmed in `runtimeConfig.perimeterX`).

| Signal | Detail |
|---|---|
| Bot detector | PerimeterX |
| Challenge page | "Robot or human?" — 200 OK, 15 KB HTML |
| Triggered by | Full browser UA strings (Chrome, curl, python-requests) |
| Bypassed by | `User-Agent: Mozilla/5.0` (bare prefix only) |
| No JS execution | SSR response is complete — no JS challenge to solve |

Detection in code:
```ts
if (html.includes("Robot or human")) {
  throw new Error("PerimeterX challenge — switch to browser harness");
}
```

If `http_get` starts returning the challenge after a run of successful fetches, switch to the
browser harness (see below).

---

## Browser Harness Fallback

Use the browser harness when:
- PerimeterX starts blocking `http_get` on your IP
- You need to interact with the page (add to cart, filter UI, infinite scroll)
- You need variant switching (color/size selectors)

```ts
// Browser-based search extraction
await new_tab("https://www.walmart.com/search?q=laptop");
await wait_for_load();
await wait(2); // JS renders product cards after readyState=complete

// Extract via __NEXT_DATA__ in-browser (identical structure to http_get)
const nd = await js("document.getElementById('__NEXT_DATA__')?.textContent");
const data = JSON.parse(nd);
const sr = data.props.pageProps.initialData.searchResult;
const items: any[] = [];
for (const stack of sr.itemStacks ?? []) {
  items.push(...(stack.items ?? []));
}
```

### Browser selectors (confirmed working for DOM-based extraction)

```ts
// Product cards on search results page
const results = await js(`
  Array.from(document.querySelectorAll('[data-item-id]')).map(el => ({
    itemId:    el.getAttribute('data-item-id'),
    name:      el.querySelector('[itemprop="name"]')?.innerText?.trim(),
    price:     el.querySelector('[itemprop="price"]')?.getAttribute('content'),
    url:       el.querySelector('a[link-identifier]')?.href,
  })).filter(r => r.itemId)
`);

// If [data-item-id] misses items, use the Next.js data attribute alternative:
const results_alt = await js(`
  Array.from(document.querySelectorAll('[data-testid="list-view"]'))
    .map(el => el.innerText.trim())
`);
```

> **Prefer `__NEXT_DATA__` over DOM selectors** even in-browser — the JSON is complete and
> stable. DOM class names at Walmart are obfuscated and change between deployments.

### Session gotcha

Always open Walmart with `new_tab()` on first visit:
```ts
await new_tab("https://www.walmart.com/search?q=laptop");
await wait_for_load();
await wait(2);
```
After that, `goto()` works normally within the same session.

---

## Public API

Walmart's affiliate/partner API (`developer.api.walmart.com`) requires a registered API key
and returns HTTP 403 without one. No unauthenticated public product API is available.
The `__NEXT_DATA__` SSR approach replaces any need for the official API for read-only data.

---

## Gotchas

- **UA must be `Mozilla/5.0` bare**: Any fuller string (Chrome, Safari, curl, requests) hits
  PerimeterX. This is counterintuitive — the *shorter*, less realistic UA is the one that works.

- **Regex must use `id=` attribute match**: The regex
  `/<script id="__NEXT_DATA__" type="application\/json">.../` fails because the actual tag is
  `<script id="__NEXT_DATA__">` without `type`. Use:
  ```ts
  html.match(/id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  ```

- **`usItemId` can be `null`**: ~5/66 items on a page are non-product ad widgets with no `usItemId`.
  Always filter: `items.filter((i) => i.usItemId)`.

- **Two `itemStacks`**: Walmart returns two stacks. Iterate over all stacks or you'll miss
  ~10 items from the second stack.

- **`canonicalUrl` includes tracking params**: Always strip with `.split("?")[0]`.

- **Review field is `"rating"` not `"overallRating"`**: Each `customerReviews` entry has a `"rating"`
  int field (1–5). The `"overallRating"` field is always `null`. Don't confuse with
  `product.averageRating` (the aggregate float).

- **No JSON-LD on product pages**: Zero `<script type="application/ld+json">` tags were found.
  All structured data is in `__NEXT_DATA__`.

- **`longDescription` is HTML**: Strip tags before text use. May contain promotional/financing copy
  mixed with real product description.

- **Page sizes vary**: Page 1 returned 66 items across 2 stacks; page 2 returned 55.
  Do not assume a fixed items-per-page count.

- **`http_get` default already sends `Mozilla/5.0`**: `http_get()` uses
  `"User-Agent": "Mozilla/5.0"` by default — no override needed when calling it directly.
  Only pass a custom `headers` argument if you need to change something else.

- **`developer.api.walmart.com`** returns HTTP 403 without an API key. Not usable for
  unauthenticated scraping.

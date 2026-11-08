# eBay — Scraping & Data Extraction

Field-tested against ebay.com on 2026-04-18 using the TS harness (`browser-harness <<'TS'`) with `http_get`.
Chrome is NOT required — `http_get` returns full HTML on first access.

## Critical: Bot Detection ("Pardon Our Interruption")

eBay's bot detection fires after roughly **5–10 requests per IP in a short window**.
The block page is ~13 KB, title `"Pardon Our Interruption..."`, and contains no listing data.

**Always check before parsing:**
```ts
function is_blocked(html: string) {
  return html.includes("Pardon Our Interruption") || html.length < 20_000;
}

const html = await http_get("https://www.ebay.com/sch/i.html?_nkw=laptop&LH_BIN=1", HEADERS);
if (is_blocked(html)) {
  throw new Error("eBay bot-detection triggered — back off and retry later");
}
```

**When blocked:** wait at minimum 60–120 seconds before retrying. The block is IP-session-scoped,
not a hard IP ban; it clears after inactivity.

**Headers required (minimal UA gets blocked faster, full browser UA lasts longer):**
```ts
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};
```

A plain `"User-Agent": "Mozilla/5.0"` also works for the first few requests,
but the full Chrome UA lasts slightly longer before triggering the block.

## Search URL Structure

```
https://www.ebay.com/sch/i.html?_nkw={query}&{filters}
```

Confirmed working URL examples:
```ts
// Buy It Now only, sorted by lowest price
"https://www.ebay.com/sch/i.html?_nkw=mechanical+keyboard&LH_BIN=1&_sop=15";

// Auctions only
"https://www.ebay.com/sch/i.html?_nkw=vintage+camera&LH_Auction=1";

// New condition only, page 2
"https://www.ebay.com/sch/i.html?_nkw=laptop&LH_ItemCondition=1000&_pgn=2";
```

### Filter Parameters (all confirmed working)

| Parameter | Value | Effect |
|-----------|-------|--------|
| `LH_BIN` | `1` | Buy It Now only |
| `LH_Auction` | `1` | Auctions only |
| `LH_ItemCondition` | see below | Filter by condition |
| `_sop` | see below | Sort order |
| `_pgn` | `2`, `3`, … | Page number (confirmed: returns ~65–88 items/page) |
| `_ipg` | `25`, `50`, `100`, `200` | Items per page (unconfirmed, standard eBay param) |

### Condition Codes for `LH_ItemCondition`

| Code | Label |
|------|-------|
| `1000` | New |
| `1500` | New Other (open box, no original packaging) |
| `2000` | Manufacturer Refurbished |
| `2500` | Seller Refurbished |
| `2750` | Like New |
| `3000` | Used |
| `4000` | Very Good |
| `5000` | Good |
| `6000` | Acceptable |
| `7000` | For parts or not working |

### Sort Codes for `_sop`

| Code | Sort Order |
|------|-----------|
| `1` | Best Match (default) |
| `10` | Ending Soonest |
| `12` | Newly Listed |
| `15` | Lowest Price + Shipping |
| `16` | Highest Price |

### Item Detail URL

```
https://www.ebay.com/itm/{listing_id}
```

The listing ID is a plain integer (e.g. `167040158614`). Always strip query parameters
from extracted URLs — tracking params bloat the URL and are not needed for navigation.

## Search Results: HTML Structure (No JSON-LD)

**JSON-LD is absent on search results pages.** The listing data is embedded in HTML
with eBay-specific class names. The response is large (~1.5–1.8 MB uncompressed).

### Card Structure

Each result is an `<li>` element with `data-listingid=<id>`. Key elements within each card:

| Data | Pattern |
|------|---------|
| Listing ID | `data-listingid=(\d+)` on the `<li>` |
| Item URL | `href=(https://(?:www\.)?ebay\.com/itm/(\d+))` |
| Title | `s-card__title` > `su-styled-text primary` > text |
| Current price | `class=price">\$([0-9,\.]+)<` |
| Original/list price | `strikethrough[^>]*>\$([0-9,\.]+)` |
| Image | `class=s-card__image[^>]*src=([^\s>]+)` |
| Alt title | `img[alt]` in the card (same as product title) |

### Confirmed Extractor (field-tested, 60 items from a single search)

```ts
function extract_search_results(html: string) {
  /*
  Parse eBay search results HTML into a list of objects.
  Returns [] if blocked or no results.
  */
  if (html.includes("Pardon Our Interruption") || html.length < 20_000) return [];

  const cards = html.split(/(?=<li[^>]+data-listingid=)/);
  const results: any[] = [];
  const seen_ids = new Set<string>();

  for (const card of cards.slice(1)) {  // skip preamble before first card
    // Listing ID (dedup)
    const lid_m = card.match(/data-listingid=(\d+)/);
    if (!lid_m) continue;
    const listing_id = lid_m[1];
    if (seen_ids.has(listing_id)) continue;
    seen_ids.add(listing_id);

    // Item URL (clean, no tracking params)
    const url_m = card.match(/href=(https:\/\/(?:www\.)?ebay\.com\/itm\/(\d+))/);
    const item_url = url_m ? url_m[1].split("?")[0] : null;

    // Title from s-card__title
    const title_m = card.match(/s-card__title[^>]*>[\s\S]*?primary[^>]*>([^<]+)/);
    const title = title_m ? title_m[1].trim() : null;

    // Skip placeholder "Shop on eBay" stub cards
    if (!title || title === "Shop on eBay") continue;

    // Current price
    let price_m = card.match(/class=(?:["'])?[a-z- ]*price["']?>\$([0-9,\.]+)</);
    if (!price_m) price_m = card.match(/price">\$([0-9,\.]+)</);
    const price = price_m ? "$" + price_m[1] : null;

    // Original / list price (strikethrough — present when discounted)
    const orig_m = card.match(/strikethrough[^>]*>\$([0-9,\.]+)/);
    const original_price = orig_m ? "$" + orig_m[1] : null;

    // Thumbnail image URL
    const img_m = card.match(/class=s-card__image[^>]*src=([^\s>]+)/);
    const image = img_m ? img_m[1] : null;

    results.push({
      listing_id,
      url: item_url,
      title,
      price,
      original_price,  // null if not on sale
      image,
    });
  }

  return results;
}
```

**Usage:**
```ts
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const html = await http_get("https://www.ebay.com/sch/i.html?_nkw=mechanical+keyboard&LH_BIN=1&_sop=15", HEADERS);
const items = extract_search_results(html);
console.log(`${items.length} items`);
for (const item of items.slice(0, 5)) {
  console.log(`  ${item.listing_id} | ${item.title.slice(0, 50)} | ${item.price}`);
}
// Output (confirmed): 60 items
// 168219240588 | One Plus Keyboard 81 Pro Winter Bonfire Mecha... | $159.00
// 167461643107 | Logitech 920-012869 G515 TKL Wired Low Profil... | $49.99
// 167040158614 | Logitech - PRO X TKL LIGHTSPEED Wireless Mech... | $74.99
```

## Item Detail Pages: JSON-LD (Reliable)

Item detail pages at `/itm/{id}` serve **two JSON-LD blocks**: `BreadcrumbList` and `Product`.
The `Product` schema is the most useful — it contains price, condition, availability, brand, images, and return policy.

```ts
function extract_item_detail(html: string) {
  /*
  Extract structured data from an eBay item page.
  Returns an object, or null if blocked.
  */
  if (html.includes("Pardon Our Interruption")) return null;

  const ld_blocks = [...html.matchAll(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let product: any = null;
  let breadcrumbs: any[] = [];

  for (const ld_str of ld_blocks) {
    let d: any;
    try {
      d = JSON.parse(ld_str.trim());
    } catch {
      continue;
    }

    if (d["@type"] === "Product") {
      product = d;
    } else if (d["@type"] === "BreadcrumbList") {
      breadcrumbs = (d.itemListElement ?? []).map((i: any) => i.name);
    }
  }

  if (!product) return null;

  let offers = product.offers ?? {};
  if (Array.isArray(offers)) offers = offers[0];

  // Schema.org condition URL -> human label
  const CONDITION_MAP: Record<string, string> = {
    NewCondition:          "New",
    UsedCondition:         "Used",
    RefurbishedCondition:  "Refurbished",
    DamagedCondition:      "For Parts / Not Working",
    LikeNewCondition:      "Like New",
    VeryGoodCondition:     "Very Good",
    GoodCondition:         "Good",
    AcceptableCondition:   "Acceptable",
  };
  const cond_url: string = offers.itemCondition ?? "";
  const cond_key = cond_url.split("/").pop()!;  // e.g. "RefurbishedCondition"
  const condition = CONDITION_MAP[cond_key] ?? cond_key;

  // List price from priceSpecification (only present when there's a "was" price)
  const price_spec = offers.priceSpecification ?? {};
  const list_price = price_spec.name === "List Price" ? price_spec.price : null;

  // Shipping (first destination)
  const shipping_details = offers.shippingDetails ?? [];
  let shipping: string | null;
  if (shipping_details.length) {
    const shipping_val = shipping_details[0].shippingRate?.value ?? "";
    shipping = ["0", "0.0"].includes(String(shipping_val)) ? "Free" : `$${shipping_val}`;
  } else {
    shipping = null;
  }

  // Return policy
  const return_policies = offers.hasMerchantReturnPolicy ?? [];
  const return_days = return_policies.length ? return_policies[0].merchantReturnDays ?? null : null;

  return {
    listing_id: (offers.url ?? "").split("/itm/").pop(),
    name: product.name ?? null,
    brand: product.brand && typeof product.brand === "object" ? product.brand.name ?? null : product.brand ?? null,
    price: offers.price ?? null,
    list_price,     // was-price, null if no discount shown
    currency: offers.priceCurrency ?? null,
    availability: (offers.availability ?? "").split("/").pop(),  // e.g. "InStock"
    condition,
    condition_url: cond_url,
    shipping,
    return_days,
    images: product.image ?? [],
    gtin13: product.gtin13 ?? null,
    mpn: product.mpn ?? null,
    color: product.color ?? null,
    breadcrumbs,
  };
}
```

**Field-tested on item 167040158614:**
```ts
const html = await http_get("https://www.ebay.com/itm/167040158614", HEADERS);
const detail = extract_item_detail(html);
// {
//   listing_id:   '167040158614',
//   name:         'Logitech - PRO X TKL LIGHTSPEED Wireless Mechanical Gaming Keyboard - 920-012118',
//   brand:        'Logitech',
//   price:        74.99,
//   list_price:   '219.99',
//   currency:     'USD',
//   availability: 'InStock',
//   condition:    'Refurbished',
//   shipping:     'Free',
//   return_days:  30,
//   images:       ['https://i.ebayimg.com/images/g/vwsAAeSwEcFpw~hW/s-l1600.jpg', ...],  // 5 images
//   gtin13:       '097855189066',
//   mpn:          '920-012118',
//   color:        'Black',
//   breadcrumbs:  ['eBay', 'Electronics', 'Computers/Tablets & Networking', ...],
// }
```

### Item Specifics from `ux-textspans` (complementary to JSON-LD)

The `ux-textspans` elements in item pages contain additional data not in JSON-LD,
including seller name, feedback %, items sold, detailed condition text, and all item specifics.

```ts
function extract_ux_textspans(html: string) {
  // Return list of all ux-textspans text values from an item page.
  return [...html.matchAll(/ux-textspans[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
}

// From item 167040158614 (confirmed):
// Index [3]  -> item title
// Index [4]  -> subtitle / seller tagline
// Index [5]  -> seller name ("Logitech")
// Index [6]  -> seller feedback count ("(20742)")
// Index [7]  -> seller feedback % ("99.6% positive")
// Index [10] -> current price ("US $74.99")
// Index [12] -> list price ("US $219.99")
// Index [33] -> condition label ("Excellent - Refurbished")
// Index [36] -> quantity sold ("45 sold")
// Pairs from [105] onward: item specifics as label/value pairs
```

## Pagination

Use `_pgn=N` (confirmed working, returns ~65–88 items per page):
```ts
for (let page = 1; page < 4; page++) {
  const url = `https://www.ebay.com/sch/i.html?_nkw=laptop&LH_BIN=1&_sop=15&_pgn=${page}`;
  const html = await http_get(url, HEADERS);
  if (is_blocked(html)) break;
  const items = extract_search_results(html);
  console.log(`Page ${page}: ${items.length} items`);
  // IMPORTANT: add delay between pages to avoid bot detection
  await wait(3);
}
```

**Rate-limit safe pattern**: 3–5 second delay between requests. Beyond ~10 rapid requests
in a session, eBay returns "Pardon Our Interruption" for all subsequent requests from that IP.

## APIs (All Require Auth or Are Dead)

| API | Status | Notes |
|-----|--------|-------|
| Finding API (svcs.ebay.com) | **Dead** — HTTP 500 | Was free/JSONP, no longer works |
| Browse API (api.ebay.com) | **Requires OAuth** — HTTP 400 | Needs eBay developer account + token |
| Shopping API (open.api.ebay.com) | **Requires token** | Returns `"Token not available"` error |
| RSS feed (`_rss=1`) | **Blocked same as HTML** | Returns "Pardon Our Interruption" when rate-limited |

**Bottom line**: There is no public unauthenticated eBay API in 2026. Use HTML scraping.

## Practical Workflow

### Scrape a search and follow top items

```ts
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

function is_blocked(html: string) {
  return html.includes("Pardon Our Interruption") || html.length < 20_000;
}

// Step 1: Search
const html = await http_get(
  "https://www.ebay.com/sch/i.html?_nkw=mechanical+keyboard&LH_BIN=1&_sop=15&LH_ItemCondition=1000",
  HEADERS
);
if (is_blocked(html)) throw new Error("Rate limited — wait 60-120s and retry");

const items = extract_search_results(html);
console.log(`Found ${items.length} items`);

// Step 2: Fetch details for top results (with delay)
const details: any[] = [];
for (const item of items.slice(0, 5)) {
  await wait(3);
  const detail_html = await http_get(item.url, HEADERS);
  if (is_blocked(detail_html)) {
    console.log(`Blocked on item ${item.listing_id}, stopping`);
    break;
  }
  const detail = extract_item_detail(detail_html);
  if (detail) {
    details.push(detail);
    console.log(`  ${detail.name.slice(0, 50)} | ${detail.price} ${detail.currency} | ${detail.condition}`);
  }
}
```

## Gotchas

- **"Pardon Our Interruption" is not a CAPTCHA** — it's eBay's bot-detection interstitial. It doesn't require solving — just wait and back off. `'captcha'` does NOT appear in the blocked page.

- **No JSON-LD on search results** — The `application/ld+json` blocks that Amazon and other sites embed are absent from eBay search pages. Parse the HTML using regex on `s-card` class names.

- **JSON-LD IS on item pages** — Two blocks: `BreadcrumbList` and `Product`. The `Product` block is authoritative. Use the regex `/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g` (note the `[^>]*` before `>` — eBay doesn't use `type="..."` quote style consistently in all contexts).

- **Duplicate listing IDs in the HTML** — Each card's listing ID appears 2–3 times (image link, title link, watch button). Always deduplicate using a `seen_ids` set when splitting on `data-listingid`.

- **Placeholder cards ("Shop on eBay")** — The first card slot may be a promoted/placeholder card with title `"Shop on eBay"` and listing ID `"123456"`. Filter these out.

- **Item URLs have tracking params** — Raw extracted URLs look like `https://www.ebay.com/itm/167040158614?_skw=...&epid=...&hash=...&itmprp=...`. Always strip to `itm/{id}` with `.split("?")[0]`.

- **`www.ebay.com` vs `ebay.com`** — Some item URLs in search results omit `www.`. Normalize with `url.replace("//ebay.com/", "//www.ebay.com/")`.

- **Search response is large** — Uncompressed HTML is 1.5–1.8 MB per page. The `http_get` helper handles gzip transparently, so the actual transfer is much smaller, but parsing a 1.8 MB string is slow. Use `html.split(regex)` on card boundaries rather than an HTML parser for speed.

- **`_sop` sort and `LH_ItemCondition` require full browser-like UA** — Requests with just `"Mozilla/5.0"` (minimal UA) return empty results for these parameters more quickly than full Chrome UA. Always use the full UA string.

- **Condition in JSON-LD is a schema.org URL** — `offers.itemCondition` returns `"https://schema.org/RefurbishedCondition"`, not a human label. Split on `/` and map the last segment using `CONDITION_MAP` (see `extract_item_detail` above).

- **`list_price` only present when discounted** — `offers.priceSpecification` only appears in JSON-LD when eBay shows a "List Price" comparison. Check `price_spec.name === "List Price"` before using.

- **Seller data is NOT in JSON-LD** — `d.seller` is `undefined` on item pages. The seller name, feedback %, and items sold count are only in `ux-textspans` elements in the HTML body.

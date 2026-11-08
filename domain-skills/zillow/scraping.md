# Zillow — Scraping & Data Extraction

Field-tested against `www.zillow.com` on 2026-04-18 using `http_get` (no browser).

## Quick summary

- **Search listing pages (`/homes/`, `/sold/`, `/rentals/`)** — `http_get` works with full Chrome headers. Returns ~973 KB HTML with all listing data embedded in `__NEXT_DATA__` JSON.
- **Individual property detail pages (`/homedetails/`)** — `http_get` returns **HTTP 403** unconditionally. No header combination bypasses this.
- **Internal API endpoints** (`/async-create-search-page-state`, `/graphql/`) — **403** for all server-side requests regardless of headers.
- **Redfin** — `http_get` works; HTML contains both JSON-LD per listing and a stingray JSON API.

---

## What works: search listing pages via `__NEXT_DATA__`

Zillow search pages embed all listing data in `<script id="__NEXT_DATA__">`. This is standard Next.js SSR output — it is the same data Zillow's React app hydrates from.

**Required headers** — The single-word User-Agent (`"Mozilla/5.0"`) used by `http_get` internally gets 403. You must pass a full Chrome UA plus Accept/Accept-Language headers:

```ts
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Parse Zillow __NEXT_DATA__ and return list of listing objects.
function extract_listings(html: string): any[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  const d = JSON.parse(m[1]);
  const sps = d.props.pageProps.searchPageState;
  return sps.cat1.searchResults.listResults;
}

const html = await http_get("https://www.zillow.com/homes/San-Francisco,-CA_rb/", HEADERS);
const listings = extract_listings(html);
console.log(listings.length); // 41 — always 41 per page
```

### Fields available in each listing card

The `listResults` array is the canonical source. Each entry includes:

| Field | Source | Example |
|---|---|---|
| `zpid` | listing | `15081707` |
| `address` | listing | `"212 Spruce St, San Francisco, CA 94118"` |
| `addressStreet`, `addressCity`, `addressState`, `addressZipcode` | listing | split address components |
| `price` | listing | `"$4,395,000"` (formatted string) |
| `unformattedPrice` | listing | `4395000` (int, use for math) |
| `beds` | listing | `4` |
| `baths` | listing | `4` |
| `area` | listing | `4133` (sqft) |
| `latLong` | listing | `{'latitude': 37.78867, 'longitude': -122.45361}` |
| `statusType` | listing | `"FOR_SALE"` / `"FOR_RENT"` / `"RECENTLY_SOLD"` |
| `detailUrl` | listing | full `https://www.zillow.com/homedetails/...` URL |
| `zestimate` | listing | `4857200` (Zillow AI estimate, int) |
| `imgSrc` | listing | thumbnail URL |
| `has3DModel` | listing | `true`/`false` |
| `hasOpenHouse` | listing | `true`/`false` |
| `openHouseStartDate`, `openHouseEndDate` | listing | ISO strings |
| `isFeaturedListing` | listing | sponsored/featured flag |
| `brokerName` | listing | `"Sotheby's International Realty"` |
| `statusText` | listing | `"FOR SALE"` display string |
| `hdpData.homeInfo.price` | nested | raw price int (matches `unformattedPrice`) |
| `hdpData.homeInfo.zestimate` | nested | raw zestimate int |
| `hdpData.homeInfo.rentZestimate` | nested | monthly rent estimate |
| `hdpData.homeInfo.homeType` | nested | `"SINGLE_FAMILY"`, `"CONDO"`, `"TOWNHOUSE"` etc. |
| `hdpData.homeInfo.daysOnZillow` | nested | int |
| `hdpData.homeInfo.taxAssessedValue` | nested | int |
| `hdpData.homeInfo.lotAreaValue` + `lotAreaUnit` | nested | e.g. `2957.724`, `"sqft"` |
| `hdpData.homeInfo.priceForHDP` | nested | reliable sold price for recently-sold listings |

```ts
// Full extraction snippet
const listing = listings[0];
const hi = listing.hdpData?.homeInfo ?? {};

const record = {
  zpid:         listing.zpid,
  address:      listing.address,
  price_raw:    listing.unformattedPrice || hi.price,
  beds:         listing.beds ?? null,
  baths:        listing.baths ?? null,
  sqft:         listing.area ?? null,
  lat:          listing.latLong.latitude,
  lon:          listing.latLong.longitude,
  status:       listing.statusType,
  zestimate:    listing.zestimate ?? null,
  rent_zest:    hi.rentZestimate ?? null,
  home_type:    hi.homeType ?? null,
  days_listed:  hi.daysOnZillow ?? null,
  tax_assessed: hi.taxAssessedValue ?? null,
  url:          listing.detailUrl,
};
```

### Total result count and pagination

```ts
const d = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)![1]);
const sps = d.props.pageProps.searchPageState;

// Total listings in this search
const total = sps.categoryTotals.cat1.totalResultCount;
console.log(total); // 1037

// Each page returns exactly 41 listings. Add /<N>_p/ for subsequent pages:
// Page 2: https://www.zillow.com/homes/San-Francisco,-CA_rb/2_p/
// Page 3: https://www.zillow.com/homes/San-Francisco,-CA_rb/3_p/

const max_pages = Math.floor((total + 40) / 41);
```

### Scrape all pages

```ts
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// city_slug: e.g. 'San-Francisco,-CA', 'Seattle,-WA', 'Austin,-TX'
async function get_listings(city_slug: string, page = 1): Promise<[any[], number]> {
  const url = page === 1
    ? `https://www.zillow.com/homes/${city_slug}_rb/`
    : `https://www.zillow.com/homes/${city_slug}_rb/${page}_p/`;
  const html = await http_get(url, HEADERS);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)!;
  const d = JSON.parse(m[1]);
  const sps = d.props.pageProps.searchPageState;
  const total = sps.categoryTotals.cat1.totalResultCount;
  const listings = sps.cat1.searchResults.listResults;
  return [listings, total];
}

const all_listings: any[] = [];
const [listings, total] = await get_listings("San-Francisco,-CA");
all_listings.push(...listings);

const max_pages = Math.floor((total + 40) / 41);
for (let page = 2; page < Math.min(max_pages + 1, 6); page++) { // cap at 5 pages for demo
  await wait(1.0); // polite delay
  const [page_listings] = await get_listings("San-Francisco,-CA", page);
  all_listings.push(...page_listings);
}

console.log(`Fetched ${all_listings.length} of ${total} listings`);
```

---

## URL patterns that work (all confirmed)

| URL pattern | Status | Notes |
|---|---|---|
| `/homes/{city}_rb/` | **Works** | For-sale listings |
| `/homes/{city}_rb/{N}_p/` | **Works** | Pagination |
| `/homes/for_sale/{city}/0-1800000_price/` | **Works** | Price filter (max) |
| `/homes/3-_beds/{city}/` | **Works** | Bed count filter |
| `/homes/{zip}_rb/` | **Works** | ZIP code search |
| `/san-francisco-ca/rentals/` | **Works** | Rental listings |
| `/san-francisco-ca/sold/` | **Works** | Recently sold |
| `/homedetails/{address}/{zpid}_zpid/` | **403** | Single property detail |
| `/async-create-search-page-state` | **403** | Internal search API |
| `/graphql/` | **400/403** | GraphQL endpoint |

---

## Rental listings

Rental search pages use the same `__NEXT_DATA__` structure. However, rental listing cards have a **different schema** — individual units are nested, not a flat price:

```ts
const html = await http_get("https://www.zillow.com/san-francisco-ca/rentals/", HEADERS);
const listings = extract_listings(html);

const r = listings[0];
// Multi-unit buildings:
// r.units = [{price: '$3,485+', beds: '0', roomForRent: false}, ...]
// r.minBaseRent = 3485
// r.maxBaseRent = 7130
// r.availabilityCount = 23

// Single-unit rentals:
// r.price = '$2,500/mo'
// r.unformattedPrice = 2500

// Check which type:
if (r.isBuilding) {
  const price_range = `$${r.minBaseRent}–$${r.maxBaseRent}/mo`;
  const units = r.units ?? [];
} else {
  const price = r.unformattedPrice || r.hdpData?.homeInfo?.price;
}
```

---

## Sold listings

Sold pages (`/sold/`) work identically. Key difference: `statusType` is `"RECENTLY_SOLD"` and price comes from `hdpData.homeInfo.priceForHDP` (not the `price` field which is `null` in sold cards):

```ts
const html = await http_get("https://www.zillow.com/san-francisco-ca/sold/", HEADERS);
const listings = extract_listings(html);

for (const l of listings) {
  const hi = l.hdpData?.homeInfo ?? {};
  const sold_price = hi.priceForHDP;       // actual sold price
  const zestimate  = hi.zestimate ?? null;
  const tax_value  = hi.taxAssessedValue;
  console.log(l.address, `$${sold_price?.toLocaleString("en-US")}`, `zest=$${zestimate?.toLocaleString("en-US") ?? null}`);
}
// 999 Green St APT 1702, San Francisco, CA 94133 $3,200,000 zest=$3,403,400
// 1041 Vallejo St, San Francisco, CA 94133 $6,250,000 zest=$null
```

Total sold inventory in San Francisco: **18,109** (all time in Zillow's database, paginated 41/page).

---

## Bot detection behavior

- **Zillow detects bot status server-side** and embeds `window.__USER_SESSION_INITIAL_STATE__` and `props.isBot` in the page.
- In field testing, the page returned `isBot: false` with the Chrome User-Agent — **Zillow does not block the search pages**.
- The page does embed `captcha` strings in the HTML (for the CAPTCHA challenge widget code), but the challenge is NOT triggered for search pages.
- **`/homedetails/` pages do trigger blocking** — every property detail URL tested returned HTTP 403. This is enforced before serving HTML, not via JavaScript CAPTCHA.
- Rate limiting: 3 rapid sequential requests to `/homes/` all succeeded. Observed no 429s. Add `await wait(0.5)`–`await wait(1.0)` between pages as a courtesy.

---

## What you do NOT get from `http_get`

Because property detail pages are blocked (403), you lose:

- Full property description text
- All listing photos (you only get `imgSrc` thumbnail from search)
- Detailed home facts (year built, parking, HVAC, school scores)
- Price history
- Nearby comparable sales (comps)
- Agent contact info

**To get these**, you must navigate to the `/homedetails/` URL in a browser session. The browser is not blocked (Zillow relies on JS challenges and fingerprinting that only trigger in browser context).

---

## Alternative: Redfin (field-tested, more accessible)

Redfin allows `http_get` with no blocking for both HTML pages and its internal API.

### Redfin JSON-LD per listing (easiest)

Each Redfin search results page embeds one `<script type="application/ld+json">` per listing with structured property data:

```ts
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const html = await http_get(
  "https://www.redfin.com/city/17151/CA/San-Francisco/filter/property-type=house",
  HEADERS,
);
console.log(html.length); // ~1.6 MB

// Extract all SingleFamilyResidence JSON-LD entries
const properties: any[] = [];
for (const [, s] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
  try {
    const d = JSON.parse(s);
    if (Array.isArray(d)) {
      for (const item of d) {
        if (["SingleFamilyResidence", "House", "Residence", "Apartment"].includes(item?.["@type"])) {
          properties.push(item);
        }
      }
    }
  } catch {}
}

const prop = properties[0];
console.log("Name:", prop.name);               // "662 Hampshire St, San Francisco, CA 94110"
console.log("Address:", JSON.stringify(prop.address));
// {"@type":"PostalAddress","streetAddress":"662 Hampshire St",
//  "addressLocality":"San Francisco","addressRegion":"CA",
//  "postalCode":"94110","addressCountry":"US"}
console.log("Rooms:", prop.numberOfRooms);     // 3
console.log("Floor size:", JSON.stringify(prop.floorSize)); // {"@type":"QuantitativeValue","value":3350,"unitCode":"FTK"}
console.log("URL:", prop.url);
// https://www.redfin.com/CA/San-Francisco/662-Hampshire-St-94110/home/1533754
```

Note: The JSON-LD schema does NOT include price (Redfin omits `offers` from the LD+JSON). Use the stingray API below for price.

### Redfin stingray API (structured JSON with price)

Redfin's internal GIS/search API returns rich structured data including price, MLS ID, beds, baths, sqft, agent info, and remarks. Responses are prefixed with `{}&&` — strip it before parsing:

```ts
// region_type: 6=city, 2=zipcode, 5=county
// uipt: property types (1=house, 2=condo, 3=townhouse, 4=multi-family, 5=land, 6=other)
async function redfin_search(region_id: number, region_type = 6, num_homes = 20, page = 1, uipt = "1,2,3,4,5,6") {
  const url =
    `https://www.redfin.com/stingray/api/gis` +
    `?al=1&num_homes=${num_homes}&ord=redfin-recommended-asc` +
    `&page_number=${page}&region_id=${region_id}&region_type=${region_type}` +
    `&sf=1,2,3,5,6,7&status=9&uipt=${uipt}&v=8`;
  const raw = await http_get(url, {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.redfin.com/",
    "Accept": "*/*",
  });
  // Strip the {}&& CSRF prefix Redfin prepends to all API responses
  if (!raw.startsWith("{}&&")) throw new Error(`Unexpected prefix: ${raw.slice(0, 10)}`);
  return JSON.parse(raw.slice(4));
}

const data = await redfin_search(17151); // 17151 = San Francisco, CA
const homes = data.payload.homes;

const home = homes[0];
console.log("Address:", home.streetLine.value);  // "875 California St #703"
console.log("City/State/Zip:", home.city, home.state, home.zip);
console.log("Price:", home.price.value);          // 3300000
console.log("Beds:", home.beds);                  // 3
console.log("Baths:", home.baths);                // 2.5
console.log("Sqft:", home.sqFt.value);            // 1828
console.log("$/sqft:", home.pricePerSqFt.value);  // 1805
console.log("Lot size:", home.lotSize.value);     // 9448
console.log("Year built:", home.yearBuilt.value); // 2021
console.log("Days on market:", home.dom.value);   // 1
console.log("MLS ID:", home.mlsId.value);         // "426115342"
console.log("MLS Status:", home.mlsStatus);       // "Active"
console.log("Lat/Long:", JSON.stringify(home.latLong.value));
console.log("URL:", home.url);                    // "/CA/San-Francisco/..."
console.log("Remarks:", home.listingRemarks.slice(0, 100));
```

### Redfin region IDs

| City | region_id | region_type |
|---|---|---|
| San Francisco, CA | `17151` | `6` (city) |
| Los Angeles, CA | `17152` | `6` |
| New York, NY | `17834` | `6` |
| Seattle, WA | `16163` | `6` |

To find other region IDs: search on Redfin, look at the URL (e.g. `/city/17151/CA/San-Francisco`) — the number is the region_id.

### Redfin stingray response structure

```
data['payload']['homes'][i]
  .streetLine.value      → street address string
  .city / .state / .zip  → strings
  .price.value           → int (asking price in dollars)
  .sqFt.value            → int (square feet)
  .pricePerSqFt.value    → int
  .beds                  → int
  .baths                 → float (2.5 = 2 full + 1 half)
  .fullBaths / .partialBaths → ints
  .lotSize.value         → int (sq ft)
  .yearBuilt.value       → int
  .dom.value             → days on market (int)
  .mlsId.value           → MLS listing number (string)
  .mlsStatus             → "Active", "Pending", etc.
  .listingId             → Redfin internal int
  .propertyId            → Redfin internal int
  .latLong.value         → {'latitude': float, 'longitude': float}
  .url                   → relative URL "/CA/San-Francisco/..."
  .listingRemarks        → description text (may be truncated)
  .keyFacts              → [{'description': str, 'rank': int}]
  .listingTags           → ['SWEEPING CITY VIEWS', ...]
  .hoa.value             → HOA monthly (int)
  .location.value        → neighborhood name string
  .sashes                → [{'sashTypeName': 'New'/'Price Drop'/...}]
  .photos.value          → photo token string
  .numPictures           → int
```

---

## Alternative APIs (no scraping required)

If you need property data without scraping Zillow or Redfin at scale:

| API | Free tier | Key data |
|---|---|---|
| **ATTOM Data** (attomdata.com) | Trial available | Ownership, AVM, tax, sale history, building characteristics |
| **Rentcast** (rentcastapi.com) | 50 req/mo free | Rental estimates, comps, market data |
| **RapidAPI: Zillow56** | ~100 req/mo free | Wraps Zillow data (unofficial, use at own risk) |
| **HouseCanary** | Paid | AVM, market risk, rental value |
| **Redfin API** (unofficial, above) | Unlimited | MLS listing data |
| **US Census / HUD** | Free, no key | Median home values by geography, affordability |

---

## Gotchas

- **Single User-Agent word triggers 403.** `http_get` passes `"Mozilla/5.0"` as default User-Agent — this gets blocked. Always pass the full Chrome UA via the `headers` argument (`await http_get(url, HEADERS)`).

- **`price` field is `null` for sold and rental multi-unit listings.** Use `unformattedPrice` for for-sale, `hdpData.homeInfo.priceForHDP` for sold, and `minBaseRent`/`maxBaseRent` for rentals.

- **`/homedetails/` is unconditionally blocked.** Tested with full browser headers, Referer, Sec-Fetch-* headers — all return HTTP 403. Only the browser bypasses this.

- **41 listings per page, hardcoded.** Zillow always returns exactly 41 results per page from `listResults`. `mapResults` was empty in all tests (server-side response only).

- **`isBot: false` doesn't mean you're safe.** Zillow correctly identifies server-side requests and blocks `/homedetails/`. The `isBot` flag in `__NEXT_DATA__` is `false` for search pages but the restriction is enforced at route level for detail pages.

- **Captcha strings in HTML do not mean CAPTCHA is active.** The search page includes the captcha widget JavaScript (for lazy loading if needed) but does not serve a challenge — confirmed by successfully parsing listing data from the same HTML.

- **Redfin `{}&&` prefix on all API responses.** Strip with `raw.slice(4)` before `JSON.parse()`. If the prefix changes, the check throws explicitly.

- **Redfin JSON-LD omits price.** The `SingleFamilyResidence` schema objects do not include an `offers` field — use the stingray API for pricing.

- **Redfin stingray API returns all listing fields wrapped in `{'value': X, 'level': N}` dicts.** Always read `.value` for numeric fields (e.g. `home['price']['value']`, not `home['price']`). Level `1` means data is public; `2` means potentially restricted.

- **Zillow total count can exceed 800 but pagination caps at page ~20.** Zillow caps search results at around 800 listings even if `totalResultCount` shows 1037. Narrow by ZIP code, neighborhood, or price range to stay within bounds.

- **URL filter syntax for Zillow:** Beds: `3-_beds` prefix; price: `0-1800000_price` suffix; ZIP: use `{zip}_rb` instead of city slug. Test by building the URL in a browser and copying the pattern.

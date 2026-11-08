# Eventbrite — Scraping & Data Extraction

`https://www.eventbrite.com` — public event listings and detail pages, no auth required for HTML scraping. REST API requires an OAuth token.

## Do this first

**Use the search listing URL to get event lists — parse the `ItemList` JSON-LD block, not the HTML.**

```ts
const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };
const html = await http_get("https://www.eventbrite.com/d/ca--san-francisco/tech/", headers);

const ld_blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
for (const block of ld_blocks) {
  const parsed = JSON.parse(block);
  if (parsed && !Array.isArray(parsed) && parsed["@type"] === "ItemList") {
    for (const item of parsed.itemListElement) {
      const ev = item.item;
      console.log(ev.name, ev.startDate, ev.url);
    }
    break;
  }
}
// Returns 18–40 events per page
```

**For a single event, fetch the detail page and extract the `Event` JSON-LD block.** It contains all fields including `offers` (pricing). There is also a richer `__NEXT_DATA__` block if you need venue coordinates, refund policy, or sales status.

## URL structure

### Search / listing pages

```
https://www.eventbrite.com/d/{location}/{category}/
https://www.eventbrite.com/d/{location}/{category}/?page=2
https://www.eventbrite.com/d/{location}/{category}/?start_date=2026-05-01&end_date=2026-05-31
```

**Location format:** `{state-abbreviation}--{city}` (lowercase, hyphens for spaces)
- `ca--san-francisco`
- `ny--new-york`
- `ca--los-angeles`
- Use `online` for virtual events

**Category slugs (confirmed working):**
- `tech` — Technology events
- `music` — Music
- `food--drink` — Food & Drink
- `health` — Health & Wellness
- `sports--fitness` — Sports & Fitness
- `arts--entertainment` — Arts & Entertainment
- `family--education` — Family & Education
- `business--professional` — Business & Networking
- `science--tech` — Science & Technology
- `community--culture` — Community & Culture
- `networking` — Networking
- `events` — All events (broadest, returns ~40/page)

**Filter slugs (replace category):**
- `free--events` — Free events only
- `events--today` — Today
- `events--tomorrow` — Tomorrow
- `events--this-weekend` — This weekend

**Query params:**
- `?page=N` — Pagination (page 2+ confirmed working, each returns 18–20 events)
- `?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` — Date range filter (confirmed, narrows results)

### Event detail pages

```
https://www.eventbrite.com/e/{slug}-tickets-{event_id}
```

Example: `https://www.eventbrite.com/e/icontact-the-tactile-tech-opera-tickets-1982861003639`

- `event_id` is a numeric string (10–13 digits)
- Extract with: `url.match(/-tickets-(\d+)$/)![1]`
- Extract slug with: `url.match(/\/e\/(.+)-tickets-\d+$/)![1]`

Other TLDs (`.ca`, `.co.uk`, etc.) use the same structure — event IDs are globally unique across TLDs.

## Listing page: JSON-LD `ItemList` schema

The first `<script type="application/ld+json">` block on any `/d/` page is an `ItemList`. Each `itemListElement` contains:

```json
{
  "position": 1,
  "@type": "ListItem",
  "item": {
    "@type": "Event",
    "name": "iContact the tactile tech opera",
    "description": "An immersive performance...",
    "url": "https://www.eventbrite.com/e/icontact-the-tactile-tech-opera-tickets-1982861003639",
    "image": "https://img.evbuc.com/...",
    "startDate": "2026-06-21",
    "endDate": "2026-06-21",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "Place",
      "name": "Little Boxes Theater",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "San Francisco",
        "addressRegion": "CA",
        "addressCountry": "US",
        "streetAddress": "94107 1661 Tennessee Street",
        "postalCode": "94107"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": "37.7508806",
        "longitude": "-122.3881427"
      }
    }
  }
}
```

Note: listing-page items do NOT include `offers` (pricing) or `organizer`. Fetch the detail page for those.

The second JSON-LD block on listing pages is a `BreadcrumbList` (skip it).

## Detail page: JSON-LD `Event` schema

The detail page has 4 JSON-LD blocks. The `Event` (or `BusinessEvent`) block is the second one and contains the full schema:

```ts
const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };
const html = await http_get("https://www.eventbrite.com/e/icontact-the-tactile-tech-opera-tickets-1982861003639", headers);

const ld_blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let event_data: any = null;
for (const block of ld_blocks) {
  const parsed = JSON.parse(block);
  if (parsed && !Array.isArray(parsed) && ["Event", "BusinessEvent", "MusicEvent", "EducationEvent"].includes(parsed["@type"])) {
    event_data = parsed;
    break;
  }
}

console.log(event_data.name);              // "iContact the tactile tech opera"
console.log(event_data.startDate);         // "2026-06-21T17:05:00-07:00"  (ISO 8601 with TZ)
console.log(event_data.endDate);           // "2026-06-21T20:08:00-07:00"
console.log(event_data.eventStatus);       // "https://schema.org/EventScheduled"
console.log(event_data.eventAttendanceMode);  // "https://schema.org/OfflineEventAttendanceMode"
console.log(event_data.location.name);  // "Little Boxes Theater"
console.log(event_data.location.address.streetAddress);   // "94107 1661 Tennessee Street, San Francisco, CA 94107"
console.log(event_data.organizer.name);  // "Beth McNamara"
console.log(event_data.organizer.url);   // "https://www.eventbrite.com/o/beth-mcnamara-120755148166"
```

Full confirmed schema on detail page:
```
name               str     Event title
description        str     Short summary
url                str     Canonical event URL
image              str     Event banner image URL
startDate          str     ISO 8601 with timezone offset
endDate            str     ISO 8601 with timezone offset
eventStatus        str     URI: EventScheduled / EventCancelled / EventPostponed
eventAttendanceMode str    URI: OfflineEventAttendanceMode / OnlineEventAttendanceMode / MixedEventAttendanceMode
location.@type     str     "Place" (in-person) or "VirtualLocation" (online)
location.name      str     Venue name
location.address.streetAddress   str
location.address.addressLocality str    City
location.address.addressRegion   str    State abbreviation
location.address.addressCountry  str    Country code
organizer.name     str     Organizer display name
organizer.url      str     Organizer profile URL
offers             list    AggregateOffer object(s)
```

### Offers / pricing

```ts
const offers = event_data.offers ?? [];
if (offers.length) {
  const offer = offers[0];   // always a list; typically one AggregateOffer
  console.log(offer["@type"]);           // "AggregateOffer"
  console.log(offer.lowPrice);        // "50.0"  (string, not float)
  console.log(offer.highPrice);       // "50.0"
  console.log(offer.priceCurrency);   // "USD"
  console.log(offer.availability);    // "InStock" / "SoldOut"
  console.log(offer.availabilityStarts);   // ISO 8601 UTC
  console.log(offer.availabilityEnds);     // ISO 8601 UTC
}

// Free events: lowPrice="0.0", highPrice="0.0"
// Free check: parseFloat(offer.lowPrice) === 0
```

`@type` on the event itself varies by format (all scrape identically):
- `Event` — general
- `BusinessEvent` — networking, professional
- `MusicEvent` — concerts
- `EducationEvent` — classes, workshops

## Detail page: `__NEXT_DATA__` (richer structured data)

Every event detail page embeds a `<script id="__NEXT_DATA__">` block with additional fields not in JSON-LD:

```ts
const nextjs = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
const nd = JSON.parse(nextjs![1]);
const context = nd.props.pageProps.context;

const bi = context.basicInfo;
console.log(bi.id);               // "1982861003639"  (event ID string)
console.log(bi.name);             // event title
console.log(bi.isFree);           // bool
console.log(bi.isOnline);         // bool
console.log(bi.currency);         // "USD"
console.log(bi.status);           // "live" / "completed" / "canceled"
console.log(bi.organizationId);   // numeric string
console.log(bi.formatId);         // numeric string (event format category)
console.log(bi.isProtected);      // bool — password-protected events
console.log(bi.isSeries);         // bool — recurring series
console.log(bi.created);          // ISO 8601 UTC creation timestamp

// Venue with coordinates
const venue = bi.venue;
console.log(venue.name);                              // "Little Boxes Theater"
console.log(venue.address.city);                   // "San Francisco"
console.log(venue.address.region);                 // "CA"
console.log(venue.address.latitude);               // "37.7508806"
console.log(venue.address.longitude);              // "-122.3881427"
console.log(venue.address.localizedMultiLineAddressDisplay);  // list of strings

// Organizer details
const org = bi.organizer;
console.log(org.name);            // "Beth McNamara"
console.log(org.url);             // organizer profile URL
console.log(org.numEvents);       // int
console.log(org.verified);        // bool

// Sales status
const ss = context.salesStatus;
console.log(ss.salesStatus);      // "on_sale" / "sold_out" / "sales_ended"
console.log(ss.startSalesDate.local);   // local datetime string

// Good to know
const gtk = context.goodToKnow.highlights;
console.log(gtk.ageRestriction);          // "18+" or null
console.log(gtk.durationInMinutes);       // int (e.g. 183)
console.log(gtk.doorTime);                // local datetime string or null
console.log(gtk.locationType);            // "in_person" or "online"

// Refund policy
const refund = context.goodToKnow.refundPolicy;
console.log(refund.policyType);           // "custom" / "no_refunds" / "standard"
console.log(refund.isRefundAllowed);      // bool
console.log(refund.validDays);            // int or null

// Full event description (HTML)
for (const module of context.structuredContent.modules) {
  if (module.type === "text") {
    console.log(module.text);         // raw HTML, strip tags yourself if needed
  }
}
```

## Complete workflow: scrape events from a category

```ts
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" };
const EVENT_TYPES = ["Event", "BusinessEvent", "MusicEvent", "EducationEvent"];
const ldBlocks = (html: string) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);

/** Returns list of event objects with name, url, startDate, endDate, location. */
async function get_events_from_listing(location: string, category: string, page = 1): Promise<any[]> {
  const url = `https://www.eventbrite.com/d/${location}/${category}/?page=${page}`;
  const html = await http_get(url, UA);
  for (const block of ldBlocks(html)) {
    const parsed = JSON.parse(block);
    if (parsed && !Array.isArray(parsed) && parsed["@type"] === "ItemList") {
      return (parsed.itemListElement ?? []).map((item: any) => item.item);
    }
  }
  return [];
}

/** Returns full Event JSON-LD + NEXT_DATA context for a single event. */
async function get_event_detail(event_url: string): Promise<[any, any]> {
  const html = await http_get(event_url, UA);

  // JSON-LD Event block
  let event_ld: any = null;
  for (const block of ldBlocks(html)) {
    const parsed = JSON.parse(block);
    if (parsed && !Array.isArray(parsed) && EVENT_TYPES.includes(parsed["@type"])) {
      event_ld = parsed;
      break;
    }
  }

  // NEXT_DATA context
  const nextjs = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  let context: any = null;
  if (nextjs) {
    const nd = JSON.parse(nextjs[1]);
    context = nd.props.pageProps.context;
  }

  return [event_ld, context];
}

// Usage
const events = await get_events_from_listing("ca--san-francisco", "tech", 1);
console.log(`Found ${events.length} events`);  // 18–20 typical

for (const ev of events.slice(0, 3)) {
  console.log(ev.name, ev.startDate, ev.url);
}

// Deep-fetch one event
const [ld, ctx] = await get_event_detail(events[0].url);
if (ld?.offers?.length) {
  const price = parseFloat(ld.offers[0].lowPrice);
  const currency = ld.offers[0].priceCurrency;
  console.log(`Price: ${price} ${currency}`);   // 0 USD (free) or e.g. 50 USD
}
```

## Public API: requires auth

The Eventbrite REST API (`https://www.eventbriteapi.com/v3/`) requires an OAuth token for all endpoints:

- `GET /v3/events/{id}/` — HTTP 401 without auth
- `GET /v3/events/search/` — HTTP 404 (endpoint changed; auth also required)

**Use HTML scraping instead** — the JSON-LD and `__NEXT_DATA__` data is equivalent to the API response and requires no credentials.

If you have a token (`EVENTBRITE_TOKEN`):
```ts
const token = process.env.EVENTBRITE_TOKEN;
const headers = {
  "User-Agent": "Mozilla/5.0",
  "Authorization": `Bearer ${token}`,
};
const data = JSON.parse(await http_get(`https://www.eventbriteapi.com/v3/events/${event_id}/`, headers));
```

## Gotchas

- **Event URLs in the HTML use relative `/e/` paths, not absolute URLs** — Search listing HTML contains `/e/slug-tickets-id?aff=...` relative paths (with tracking params). Extract event URLs from the JSON-LD `ItemList` instead — they are absolute, clean URLs without tracking params.

- **`html.match(/href="https:\/\/www.eventbrite.com\/e\/.../g)` returns 0 results** — Confirmed: event cards in the HTML do not have `https://www.eventbrite.com/e/` in href attributes. Use JSON-LD extraction only.

- **`__SERVER_DATA__` does not exist** — Both search and detail pages were checked. There is no `window.__SERVER_DATA__` or `window.__redux_state__`. The embedded data is in `<script id="__NEXT_DATA__">` (detail pages only) and JSON-LD (both).

- **Search listing pages have no `__NEXT_DATA__`** — Only event detail pages (`/e/` URLs) have the `__NEXT_DATA__` block. Listing pages (`/d/` URLs) have JSON-LD only.

- **`@type` varies by event format** — Don't filter JSON-LD blocks with `parsed["@type"] === "Event"` alone. Check for any of: `Event`, `BusinessEvent`, `MusicEvent`, `EducationEvent`. They have identical field structure.

- **`startDate` on listing vs. detail pages differs in precision** — Listing page items show date-only (`"2026-06-21"`). Detail page Event block shows full ISO 8601 with timezone offset (`"2026-06-21T17:05:00-07:00"`). Use detail page for scheduling tasks.

- **`offers` is absent on listing page items** — The `ItemList` does not include pricing. Fetch the detail page for `offers.lowPrice` / `offers.highPrice`.

- **Free events have `lowPrice: "0.0"` and `highPrice: "0.0"`** — Not null or missing. Check `parseFloat(offers[0].lowPrice) === 0` or use `basicInfo.isFree` from `__NEXT_DATA__`.

- **`offers` prices are strings, not floats** — `"50.0"` not `50.0`. Cast with `parseFloat(offer.lowPrice)` before arithmetic.

- **Page size is ~18–20 events per page** — Not a fixed 20. Some pages return fewer. Don't assume page N is empty because it returned < 20.

- **Date filter works but can still return events outside range** — The `?start_date=` / `?end_date=` params narrow results but are not strict; always validate `startDate` from the returned data.

- **Eventbrite CA / UK / AU use different TLDs** — Online event listings may surface `eventbrite.ca`, `eventbrite.co.uk` URLs. The `/e/` structure and JSON-LD schema are identical. Fetch them with the same code.

- **No rate limiting observed** — 8 sequential HTTP requests across 4 pages completed without errors or blocks (avg ~1.5s each). No delay needed for light workloads, but be reasonable for bulk scraping.

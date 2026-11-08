# OpenStreetMap — Nominatim Geocoding + Overpass API

Two fully public, no-auth APIs. Everything is a direct HTTP call — never need a browser.

- **Nominatim**: geocoding (place name → lat/lon and reverse). Rate limit: 1 req/s.
- **Overpass API**: spatial query engine over the full OSM dataset. Rate limit: 2 concurrent slots per IP on the public instance.

**Do not use `http_get` without overriding `User-Agent`** — its default `Mozilla/5.0` is blocked by both APIs with HTTP 403. Pass `{"User-Agent": "browser-harness/1.0"}` as the headers argument on every call.

---

## Fastest path: forward geocode a place

```ts
const UA = { "User-Agent": "browser-harness/1.0" };

async function geocode(query: string, limit = 3): Promise<any[]> {
  const q = encodeURIComponent(query);
  const raw = await http_get(
    `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=${limit}&addressdetails=1`,
    UA,
  );
  return JSON.parse(raw);  // [] when nothing found
}

const results = await geocode("Eiffel Tower");
// results[0].display_name  == 'Tour Eiffel, 5, Avenue Anatole France, ..., 75007, France'
// results[0].lat           == '48.8582599'   ← STRING, not number
// results[0].lon           == '2.2945006'    ← STRING, not number
// results[0].type          == 'tower'
// results[0].class         == 'man_made'
// results[0].importance    == 0.6205937724353116
// results[0].osm_type      == 'way'
// results[0].osm_id        == 5013364
// results[0].boundingbox   == ['48.8574753', '48.8590453', '2.2933119', '2.2956897']  ← all strings
// results[0].address.city         == 'Paris'
// results[0].address.postcode     == '75007'
// results[0].address.country      == 'France'
// results[0].address.country_code == 'fr'
```

---

## Nominatim: all three query modes

### 1. Forward geocode (free-text)

```ts
const UA = { "User-Agent": "browser-harness/1.0" };

const raw = await http_get(
  "https://nominatim.openstreetmap.org/search?q=Eiffel+Tower&format=json&limit=3&addressdetails=1",
  UA,
);
const results = JSON.parse(raw);
// Returns [] when nothing found — no exception

// Useful optional params:
// &addressdetails=1   → adds 'address' object to each result (city, postcode, road, etc.)
// &extratags=1        → adds 'extratags' object (website, wikidata, phone, etc.)
// &namedetails=1      → adds 'namedetails' object (name:en, name:fr, etc.)
// &countrycodes=fr,de → restrict to countries (comma-separated ISO 3166-1 alpha-2)
// &viewbox=2.2,48.8,2.4,48.9 &bounded=1  → restrict to bounding box (lon_min,lat_min,lon_max,lat_max)
```

### 2. Reverse geocode (lat/lon → address)

```ts
const UA = { "User-Agent": "browser-harness/1.0" };
const raw = await http_get(
  "https://nominatim.openstreetmap.org/reverse?lat=48.8584&lon=2.2945&format=json",
  UA,
);
const result = JSON.parse(raw);
// result.display_name  == 'Avenue Gustave Eiffel, Quartier du Gros-Caillou, ..., France'
// result.address.road         == 'Avenue Gustave Eiffel'
// result.address.city         == 'Paris'
// result.address.postcode     == '75007'
// result.address.country      == 'France'
// result.address.country_code == 'fr'
// result.address.state        == 'Île-de-France'
// result.lat, result.lon  → strings (not numbers)

// Optional: &zoom=N (0-18) controls granularity of the returned address
// zoom=3 → country, zoom=10 → city, zoom=18 → street/building (default)
```

### 3. Structured search (field-based)

```ts
const UA = { "User-Agent": "browser-harness/1.0" };
const raw = await http_get(
  "https://nominatim.openstreetmap.org/search?city=Paris&country=France&format=json&limit=1",
  UA,
);
const result = JSON.parse(raw)[0];
// result.name          == 'Paris'
// result.lat           == '48.8534951'
// result.lon           == '2.3483915'
// result.type          == 'administrative'
// result.place_rank    == 12  (lower = broader: 4=country, 8=state, 12=city, 30=POI)
// result.addresstype   == 'city'
// result.boundingbox   == ['48.8155755', '48.9021560', '2.2241220', '2.4697602']

// Supported structured params: street, city, county, state, country, postalcode
```

### 4. Lookup by OSM ID

```ts
const UA = { "User-Agent": "browser-harness/1.0" };
// Prefix: N=node, W=way, R=relation
const raw = await http_get(
  "https://nominatim.openstreetmap.org/lookup?osm_ids=W5013364&format=json",
  UA,
);
const result = JSON.parse(raw);
// Returns list. Eiffel Tower way: result[0].name == 'Tour Eiffel'
// Supports up to 50 IDs: osm_ids=W5013364,N123456,R789
```

---

## Nominatim response field reference

| Field | Type | Notes |
|-------|------|-------|
| `place_id` | int | Internal Nominatim ID — do not cache long-term, can change |
| `osm_type` | str | `"node"`, `"way"`, or `"relation"` |
| `osm_id` | int | The OSM element ID |
| `lat` | **str** | Latitude as string — convert with `parseFloat(r.lat)` |
| `lon` | **str** | Longitude as string — convert with `parseFloat(r.lon)` |
| `display_name` | str | Full human-readable address string |
| `name` | str | Short name of the place |
| `type` | str | OSM type tag value: `"tower"`, `"administrative"`, `"restaurant"`, etc. |
| `class` | str | OSM key: `"man_made"`, `"boundary"`, `"amenity"`, `"highway"`, etc. |
| `addresstype` | str | Semantic category: `"city"`, `"road"`, `"man_made"`, etc. |
| `place_rank` | int | Hierarchy rank: 4=country, 8=state, 12=city, 16=suburb, 30=POI |
| `importance` | float | 0–1 relevance score (higher = more notable) |
| `boundingbox` | list[str] | `[south_lat, north_lat, west_lon, east_lon]` — all strings, note unusual order |
| `licence` | str | ODbL attribution string — include in user-facing output |
| `address` | dict | Only present with `&addressdetails=1` or in reverse results |

`address` dict common keys: `road`, `house_number`, `quarter`, `suburb`, `city_district`, `city`, `state`, `postcode`, `country`, `country_code`, `ISO3166-2-lvl4/6`.

---

## Overpass API: query OSM data by tags

Overpass is a read-only query engine over the full OSM planet. It supports finding POIs by tag, radius, bounding box, and combinations.

**Endpoint**: `https://overpass-api.de/api/interpreter`
**Backup instances** (use when main is overloaded, which happens often):
- `https://overpass.openstreetmap.fr/api/interpreter` — requires non-Mozilla User-Agent

**http_get works for GET requests** — pass `{"User-Agent": "browser-harness/1.0"}` as headers. For POST, use `fetch` directly (see example below).

### GET query (simplest for http_get)

```ts
const UA = { "User-Agent": "browser-harness/1.0" };
const OVERPASS = "https://overpass.openstreetmap.fr/api/interpreter";

async function overpass_get(query: string): Promise<any> {
  const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
  const raw = await http_get(url, UA);
  if (!raw.startsWith("{")) {
    throw new Error(`Overpass error (HTML returned): ${raw.slice(0, 200)}`);
  }
  return JSON.parse(raw);
}

// Find cafes in central Paris (bbox: south_lat, west_lon, north_lat, east_lon)
let r = await overpass_get('[out:json][timeout:25];node["amenity"="cafe"](48.855,2.295,48.862,2.308);out 10;');
// r.version    == 0.6
// r.generator  == 'Overpass API 0.7.62.7 375dc00a'
// r.elements   → list of matching OSM elements

for (const cafe of r.elements) {
  console.log(cafe.tags.name, cafe.lat, cafe.lon);
}
// Café de l'Alma 48.8609068 2.3015143
// Le Campanella  48.8585847 2.3032822
// Kozy Bosquet   48.855445  2.3054013

// Find restaurants within 500m radius of a point (around filter)
r = await overpass_get(
  '[out:json][timeout:25];node["amenity"="restaurant"](around:500,37.7749,-122.4194);out 10;',
);
for (const rest of r.elements) {
  console.log(rest.tags.name, rest.tags.cuisine ?? "");
}
// Nepalese Indian Cusine indian;nepali
// Local Diner coffee_shop;italian;burger;seafood
// Moya Cafe
```

### POST query (for complex QL, avoids URL length limits)

```ts
// http_get is GET-only; use fetch for POST
const OVERPASS = "https://overpass.openstreetmap.fr/api/interpreter";

async function overpass_post(query: string): Promise<any> {
  // POST to Overpass — no URL length limits, preferred for multi-statement QL.
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "User-Agent": "browser-harness/1.0",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();  // fetch decompresses gzip itself
  if (!body.startsWith("{")) {
    throw new Error(`Overpass error (HTML): ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

// Example: cafes in Paris bbox
const r = await overpass_post('[out:json][timeout:25];node["amenity"="cafe"](48.855,2.295,48.862,2.308);out 5;');
console.log(r.elements.length);  // 5 (or up to 5)
```

### Overpass element structure

Every element in `r.elements` is an object with at minimum:

```ts
const node = {
  type: "node",          // "node", "way", or "relation"
  id: 308684349,         // number — OSM element ID (stable, use for dedup)
  lat: 48.8609068,       // number — ONLY present for node type
  lon: 2.3015143,        // number — ONLY present for node type
  tags: {                // object — all OSM tags on this element
    "amenity": "cafe",
    "name": "Café de l'Alma",
    "name:fr": "Café de l'Alma",
    "outdoor_seating": "yes",
    "payment:credit_cards": "yes",
    "phone": "+33 1 45 51 56 74",
    "opening_hours": "Mo-Sa 08:00-23:00; Su 09:00-19:00",  // optional
    "website": "https://...",                               // optional
    "wheelchair": "yes",                                    // optional
  },
};
```

For `way` elements, use `out center;` to get a `center` object with lat/lon instead of a node list:

```ts
// way element with out center:
const way = {
  type: "way",
  id: 338411946,
  center: { lat: 48.8660087, lon: 2.3153233 },  // centroid of the polygon
  nodes: [3454913623, 3454913707 /* ... */],     // node IDs forming the boundary
  tags: { amenity: "cafe", name: "Café 1902" /* ... */ },
};

// Query to get both nodes and ways with lat/lon (overpass_get from the GET example above):
const query = '[out:json][timeout:25];(node["amenity"="cafe"](48.85,2.29,48.87,2.32);way["amenity"="cafe"](48.85,2.29,48.87,2.32););out center 20;';
const r = await overpass_get(query);
for (const el of r.elements) {
  const [lat, lon] = el.type === "node"
    ? [el.lat, el.lon]
    : [el.center.lat, el.center.lon];  // way
  console.log(el.tags.name, lat, lon);
}
```

### Overpass QL quick reference

```
[out:json][timeout:25]      # Required header: JSON output, 25s timeout
[maxsize:52428800]          # Optional: 50MB max result size (default is server limit)

node["amenity"="cafe"](south,west,north,east);out N;
#  ↑ bbox order: south_lat, west_lon, north_lat, east_lon
#  Note: DIFFERENT from Nominatim's boundingbox field which is [south,north,west,east]

node["amenity"="cafe"](around:RADIUS_METERS,LAT,LON);out N;

node["amenity"~"cafe|restaurant"](bbox);out N;    # regex match on tag value
node[!"name"](bbox);out N;                        # elements WITHOUT the 'name' tag
node["name"~"Star",i](bbox);out N;               # case-insensitive regex

# Union of types:
(node["amenity"="cafe"](bbox); way["amenity"="cafe"](bbox););out center N;

# Multiple tags (AND logic):
node["amenity"="cafe"]["outdoor_seating"="yes"](bbox);out N;
```

---

## OSM tile server (reference only, no scraping)

```
https://{a,b,c}.tile.openstreetmap.org/{z}/{x}/{y}.png
```

- Subdomains `a`, `b`, `c` for load balancing
- `z` = zoom level 0–19, `x`/`y` = tile coordinates
- Returns 256×256 PNG tiles
- Policy: max 2 req/s per IP, non-commercial use, must display OSM attribution
- Tile coordinate calculator: `https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames`
- Bulk tile downloading is prohibited — use Overpass or data extracts instead

```ts
// Convert lat/lon to tile coordinates
function lat_lon_to_tile(lat: number, lon: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const rad = (lat * Math.PI) / 180;
  const x = Math.trunc(((lon + 180) / 360) * n);
  const y = Math.trunc(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return [x, y];
}

const [x, y] = lat_lon_to_tile(48.8582, 2.2945, 14);
const url = `https://a.tile.openstreetmap.org/14/${x}/${y}.png`;
// url == 'https://a.tile.openstreetmap.org/14/8281/5646.png'
```

---

## Rate limits

| API | Limit | Enforcement | 429 behavior |
|-----|-------|-------------|--------------|
| Nominatim | 1 req/s | Soft — rapid requests work but you get delayed/dropped | Returns HTTP 403 if your IP is banned (not 429) |
| Overpass (main) | 2 concurrent slots per IP | Hard — 3rd concurrent req returns HTML error immediately | HTML error page with `rate_limited` in body |
| Overpass (main) | Also: query complexity quota | Resets over time (~per hour) | HTML error page with `rate_limited` |
| Tile server | 2 req/s per IP | Soft/hard | IP block |

**Check your Overpass quota**:
```ts
const raw = await http_get("https://overpass-api.de/api/status", { "User-Agent": "browser-harness/1.0" });
console.log(raw);
// Connected as: 1728118854
// Rate limit: 2
// 2 slots available now.
// Slot available after: 2026-04-18T11:00:00Z, in 30 seconds.
```

**Handle rate limiting in production**:
```ts
async function overpass_get_with_retry(query: string, max_retries = 3): Promise<any> {
  for (let attempt = 0; attempt < max_retries; attempt++) {
    const url = `https://overpass.openstreetmap.fr/api/interpreter?data=${encodeURIComponent(query)}`;
    const raw = await http_get(url, { "User-Agent": "browser-harness/1.0" });
    if (raw.startsWith("{")) return JSON.parse(raw);
    if (raw.includes("rate_limited") || raw.includes("too busy")) {
      await wait(2 ** attempt * 10);  // 10s, 20s, 40s
      continue;
    }
    throw new Error(`Overpass error: ${raw.slice(0, 200)}`);
  }
  throw new Error("Overpass: too many retries");
}
```

---

## Complete working example

```ts
const UA = { "User-Agent": "browser-harness/1.0" };
const NOMINATIM = "https://nominatim.openstreetmap.org";
const OVERPASS   = "https://overpass.openstreetmap.fr/api/interpreter";

async function geocode(query: string, limit = 1): Promise<any[]> {
  // Forward geocode — returns [] if nothing found.
  const q = encodeURIComponent(query);
  const raw = await http_get(`${NOMINATIM}/search?q=${q}&format=json&limit=${limit}&addressdetails=1`, UA);
  return JSON.parse(raw);
}

async function reverse_geocode(lat: number, lon: number): Promise<any> {
  // Reverse geocode — always returns a result (nearest road/place).
  const raw = await http_get(`${NOMINATIM}/reverse?lat=${lat}&lon=${lon}&format=json`, UA);
  return JSON.parse(raw);
}

async function overpass_get(query: string): Promise<any[]> {
  // Run an Overpass QL query, return elements list.
  const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
  const raw = await http_get(url, UA);
  if (!raw.startsWith("{")) throw new Error(`Overpass error: ${raw.slice(0, 200)}`);
  return JSON.parse(raw).elements;
}

async function overpass_post(query: string): Promise<any[]> {
  // POST variant — avoids URL length limits for complex queries.
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: { "User-Agent": "browser-harness/1.0",
               "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  if (!body.startsWith("{")) throw new Error(`Overpass error: ${body.slice(0, 300)}`);
  return JSON.parse(body).elements;
}

// --- Usage examples (validated 2026-04-18) ---

// 1. Geocode a landmark
const places = await geocode("Eiffel Tower", 3);
// places[0].lat  == '48.8582599'  (string)
// places[0].lon  == '2.2945006'   (string)
// places[0].display_name == 'Tour Eiffel, 5, Avenue Anatole France, ..., 75007, France'
// places[0].address.city == 'Paris'
const lat = parseFloat(places[0].lat);
const lon = parseFloat(places[0].lon);

// 2. Reverse geocode the coordinates
const addr = await reverse_geocode(lat, lon);
// addr.address.road     == 'Avenue Gustave Eiffel'
// addr.address.city     == 'Paris'
// addr.address.postcode == '75007'
// addr.address.country  == 'France'

// 3. Find nearby cafes (wait 1s between nominatim and overpass if same script)
await wait(1);
const cafes = await overpass_get(
  `[out:json][timeout:25];node["amenity"="cafe"](around:500,${lat},${lon});out 10;`,
);
for (const cafe of cafes) {
  console.log(`${(cafe.tags.name ?? "?").padEnd(30)}  ${cafe.lat.toFixed(4)}, ${cafe.lon.toFixed(4)}`);
}
// Café de l'Alma                  48.8609, 2.3015
// Le Campanella                   48.8586, 2.3033

// 4. Structured city lookup + find restaurants in bounding box
await wait(1);
const paris = (await geocode("Paris, France"))[0];
const bb = paris.boundingbox;  // [south_lat, north_lat, west_lon, east_lon] ← Nominatim order!
// For Overpass: need (south_lat, west_lon, north_lat, east_lon) ← DIFFERENT order
const [south, north, west, east] = bb;
// Restrict to center slice to avoid massive result set
const center_bbox = "48.855,2.295,48.865,2.315";
const rests = await overpass_post(
  `[out:json][timeout:25];node["amenity"="restaurant"](${center_bbox});out 5;`,
);
console.log(`Found ${rests.length} restaurants near Paris center`);
```

---

## Gotchas

**`http_get` default UA (`Mozilla/5.0`) is blocked by both APIs.** Always pass `{"User-Agent": "browser-harness/1.0"}` as the headers argument. `http_get` spreads your headers over its defaults, so this properly overrides the default. Confirmed: Mozilla/5.0 → 403 on Nominatim; `browser-harness/1.0` → 200.

**Blocked User-Agent patterns on Nominatim**: `Mozilla/5.0`, `python-requests/*`, `Wget/*`. Accepted: any non-generic app-style UA like `browser-harness/1.0`, `MyApp/2.0`, `curl/7.x`. Nominatim policy requires a descriptive UA with contact info, but in practice any non-library string passes.

**Nominatim lat/lon are strings, Overpass lat/lon are numbers.** Always convert Nominatim coordinates: `parseFloat(result.lat)`. Overpass element `lat`/`lon` are already JSON numbers — no conversion needed.

**Nominatim `boundingbox` field order is `[south_lat, north_lat, west_lon, east_lon]` — NOT `[south, west, north, east]`.** Overpass bbox uses `(south_lat, west_lon, north_lat, east_lon)`. When feeding a Nominatim bounding box into Overpass, you must reorder: `` `(${bb[0]},${bb[2]},${bb[1]},${bb[3]})` ``.

**`overpass-api.de` main instance is frequently overloaded.** Returns HTTP 504 (timeout) or an HTML error page with `rate_limited` when busy. The FR mirror (`overpass.openstreetmap.fr`) is usually more responsive but also blocks `Mozilla/5.0`. Always detect non-JSON responses: `if (!raw.startsWith("{"))`.

**Overpass error responses are HTML, not JSON.** The API returns HTTP 200 with an HTML error page when rate-limited or when the server is too busy. Always check `raw.startsWith("{")` before parsing.

**Overpass rate limit: 2 concurrent slots, NOT 2 requests/s.** You can run 2 queries simultaneously. A 3rd concurrent query immediately returns an error. Sequential queries with no sleep between them work fine as long as each completes before the next starts.

**`out N;` limits results to N elements — use it.** Without a limit, large bounding boxes can return thousands of elements and hit the 512MB memory limit, returning a `maxsize` error. Default safe limit: `out 50;` for exploration, `out 500;` for bulk collection.

**Overpass QL bbox order is `(south, west, north, east)` — latitude FIRST.** This is the opposite of the standard GeoJSON convention `[west, south, east, north]`. The `around:` filter uses `(around:METERS,LAT,LON)` — note lat before lon.

**`name` tag in Overpass is the local-language name.** For Paris cafes this is French. English names may appear under `name:en` but are often absent. Never assume `name` is in English.

**Nominatim `/reverse` always returns the nearest result** — it never returns an empty response (unlike `/search`). If the coordinates are in the ocean, it still returns the nearest coastline or country.

**`place_id` is internal and ephemeral** — do not store it for long-term use. Use `osm_type` + `osm_id` for stable references (e.g., `way/5013364` for the Eiffel Tower).

**Overpass `http_get` POST workaround**: `http_get` only supports GET. For POST requests (needed to avoid URL length limits for complex multi-statement QL), use `fetch` directly as shown in the `overpass_post()` example above.

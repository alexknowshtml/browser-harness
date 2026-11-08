# NASA APIs — Scraping & Data Extraction

`https://api.nasa.gov` — open NASA data APIs. **Never use the browser.** All endpoints return JSON via `http_get`. DEMO_KEY works for low-volume use; register for a free personal key at https://api.nasa.gov/ to raise limits.

## Do this first

**All `api.nasa.gov` endpoints share the same rate-limit pool under DEMO_KEY. EPIC and Exoplanet Archive are on separate domains with no rate limit.**

```ts
// Simplest call: today's Astronomy Picture of the Day
const apod = JSON.parse(await http_get("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY"))
console.log(apod.date, apod.title, apod.media_type)
// Confirmed output (2026-04-18): 2026-04-18 PanSTARRS and Planets image
```

Use DEMO_KEY for exploration. Switch to a personal key for any bulk work — DEMO_KEY hits its limit at ~10 req/hour/IP (daily budget around 50; `retry-after` header will show ~22 hours when exhausted).

## Rate limits

| Key type | Limit | Resets |
|---|---|---|
| `DEMO_KEY` | 10 req/hour, ~50/day per IP | Hourly window; daily hard stop with `retry-after` ~22h |
| Personal key (free) | 1,000 req/hour | Hourly window |

Rate limit headers on every `api.nasa.gov` response:
- `X-Ratelimit-Limit` — your current window limit (e.g. `10`)
- `X-Ratelimit-Remaining` — calls left this window
- `Retry-After` — seconds until next window (only on 429)

**EPIC (`epic.gsfc.nasa.gov`) and Exoplanet Archive (`exoplanetarchive.ipac.caltech.edu`) share no rate-limit pool with `api.nasa.gov`.**

## Common workflows

### APOD — single day

```ts
const apod = JSON.parse(await http_get("https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY"))
console.log(apod.date)        // '2026-04-18'
console.log(apod.title)       // 'PanSTARRS and Planets'
console.log(apod.media_type)  // 'image' or 'video'
console.log(apod.url)         // full-res or YouTube embed URL
console.log(apod.hdurl)       // HD image URL (absent when media_type='video')
console.log(apod.copyright ?? null)  // null if public domain
// Confirmed output (2026-04-18):
// url:   https://apod.nasa.gov/apod/image/2604/PanstarrsPlanetsPerrotLab1024.jpg
// hdurl: https://apod.nasa.gov/apod/image/2604/PanstarrsPlanetsPerrot.jpg
// copyright: Luc Perrot
```

### APOD — date range (array response)

```ts
const apods = JSON.parse(await http_get(
  "https://api.nasa.gov/planetary/apod" +
  "?start_date=2024-01-01&end_date=2024-01-07&api_key=DEMO_KEY"
))
// Returns an array of 7 objects — same schema as single-day response
for (const a of apods) {
  console.log(a.date, a.media_type, a.title.slice(0, 50))
}
// Confirmed output (7 items):
// 2024-01-01 image NGC 1232: A Grand Design Spiral Galaxy
// 2024-01-02 image Rocket Transits Rippling Moon
// 2024-01-03 image A SAR Arc from New Zealand
// 2024-01-04 image Zeta Oph: Runaway Star
// 2024-01-05 image Trapezium: At the Heart of Orion
// 2024-01-06 video The Snows of Churyumov-Gerasimenko
// 2024-01-07 image The Cat's Eye Nebula in Optical and X-ray
```

Optional params: `date=YYYY-MM-DD` (specific day), `count=N` (N random entries), `thumbs=true` (include `thumbnail_url` for video entries).

### APOD — random sample

```ts
const apods = JSON.parse(await http_get(
  "https://api.nasa.gov/planetary/apod?count=5&api_key=DEMO_KEY"
))
for (const a of apods) {
  console.log(a.date, a.title.slice(0, 40))
}
// Returns 5 random APOD entries — dates can be any day since 1995-06-16
```

### NEO — Near Earth Objects feed

```ts
const data = JSON.parse(await http_get(
  "https://api.nasa.gov/neo/rest/v1/feed" +
  "?start_date=2024-01-01&end_date=2024-01-02&api_key=DEMO_KEY"
))
console.log(data.element_count)   // 32 (total NEOs across both days)
const neos = data.near_earth_objects  // object keyed by date string
for (const [date, objects] of Object.entries<any[]>(neos).sort(([a], [b]) => a.localeCompare(b))) {
  for (const neo of objects) {
    const ca = neo.close_approach_data[0]
    console.log(
      neo.name,
      "hazardous:", neo.is_potentially_hazardous_asteroid,
      "miss km:", ca.miss_distance.kilometers.slice(0, 12),
      "vel kph:", ca.relative_velocity.kilometers_per_hour.slice(0, 10)
    )
  }
}
// Confirmed output (2 days, 32 total NEOs):
// 415949 (2001 XY10) hazardous: false miss km: 50452409.34 vel kph: 57205.8951
// (22+ more objects per day)
```

NEO object fields:
- `id`, `name`, `nasa_jpl_url` — identity
- `estimated_diameter` — dict with `kilometers`, `meters`, `miles`, `feet` sub-dicts, each with `min`/`max`
- `is_potentially_hazardous_asteroid` — bool
- `close_approach_data[0]` — `close_approach_date`, `miss_distance` (au/lunar/km/mi), `relative_velocity` (km/s, km/h, mph), `orbiting_body`

Date range is capped at **7 days per request**. For longer ranges, paginate with `start_date` / `end_date` in 7-day steps. `links.next` in the response gives the next 7-day window URL.

### NEO — single asteroid lookup

```ts
// Asteroid ID comes from the feed's `id` field
const neo = JSON.parse(await http_get(
  "https://api.nasa.gov/neo/rest/v1/neo/2415949?api_key=DEMO_KEY"
))
console.log(neo.name)
console.log(neo.orbital_data.orbit_class.orbit_class_description)
// Full orbital history + all close approaches are in `close_approach_data` (long list)
```

### Mars Rover photos — Curiosity by sol

```ts
// sol = Martian solar day since landing
let data = JSON.parse(await http_get(
  "https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/photos" +
  "?sol=1000&api_key=DEMO_KEY"
))
const photos = data.photos
console.log(`Photos on sol 1000: ${photos.length}`)
const p = photos[0]
console.log(p.earth_date)          // '2015-05-30'
console.log(p.img_src)             // direct JPEG URL
console.log(p.camera.name)         // 'FHAZ'
console.log(p.camera.full_name)    // 'Front Hazard Avoidance Camera'
console.log(p.rover.name)          // 'Curiosity'
console.log(p.rover.status)        // 'active'
console.log(p.rover.max_sol)       // highest sol with photos

// Filter by camera
data = JSON.parse(await http_get(
  "https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/photos" +
  "?sol=1000&camera=navcam&api_key=DEMO_KEY"
))
```

Available cameras for Curiosity: `fhaz`, `rhaz`, `mast`, `chemcam`, `mahli`, `mardi`, `navcam`. Other rovers: `opportunity`, `spirit`, `perseverance`.

Use `latest_photos` to get the most recent available:
```ts
const data = JSON.parse(await http_get(
  "https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/latest_photos" +
  "?api_key=DEMO_KEY"
))
const photos = data.latest_photos
```

Add `&page=N` for pagination (25 photos/page by default).

### EPIC — Earth Polychromatic Imaging Camera

EPIC images are served from `epic.gsfc.nasa.gov` — **no `api_key` required, no rate limit.**

```ts
// Latest available images (natural color)
const images = JSON.parse(await http_get("https://epic.gsfc.nasa.gov/api/natural"))
console.log(`Latest batch: ${images.length} images`)  // Confirmed: 4 images on 2026-04-18

const img = images[0]
console.log(img.identifier)               // '20260416162050'
console.log(img.image)                    // 'epic_1b_20260416162050'
console.log(img.date)                     // '2026-04-16 16:16:01'
console.log(img.centroid_coordinates)     // { lat: 13.25, lon: -75.59 }

// Construct PNG URL from image name + date
const date_str = img.date.split(" ")[0]   // '2026-04-16'
const [year, month, day] = date_str.split("-")
const png_url = `https://epic.gsfc.nasa.gov/archive/natural/${year}/${month}/${day}/png/${img.image}.png`
const jpg_thumb = `https://epic.gsfc.nasa.gov/archive/natural/${year}/${month}/${day}/thumbs/${img.image}.jpg`
console.log(png_url)
// Confirmed: https://epic.gsfc.nasa.gov/archive/natural/2026/04/16/png/epic_1b_20260416162050.png
```

```ts
// Images for a specific date
const images = JSON.parse(await http_get("https://epic.gsfc.nasa.gov/api/natural/date/2024-01-15"))
console.log(images.length)   // 14 images on 2024-01-15

// Enhanced (color-corrected) images — same API, different path
const enhanced = JSON.parse(await http_get("https://epic.gsfc.nasa.gov/api/enhanced/date/2024-01-15"))
// Enhanced image URL pattern uses 'enhanced' and 'epic_RGB_' prefix:
const img = enhanced[0]
const date_str = img.date.split(" ")[0]
const [year, month, day] = date_str.split("-")
const url = `https://epic.gsfc.nasa.gov/archive/enhanced/${year}/${month}/${day}/png/${img.image}.png`
// e.g. .../archive/enhanced/2024/01/15/png/epic_RGB_20240115005515.png

// All available dates
const all_dates = JSON.parse(await http_get("https://epic.gsfc.nasa.gov/api/natural/all"))
console.log(`Available dates: ${all_dates.length}`)  // 3477 dates (2015-06-13 to present)
console.log(all_dates[0])   // { date: '2026-04-16' }  (newest first)
console.log(all_dates.at(-1))  // { date: '2015-06-13' }  (oldest)
```

### Exoplanet Archive — TAP/ADQL queries

No API key or rate limit. SQL-like ADQL queries over the full archive.

```ts
// Short-period planets with known radii
const planets = JSON.parse(await http_get(
  "https://exoplanetarchive.ipac.caltech.edu/TAP/sync" +
  "?query=select+pl_name,hostname,pl_orbper+from+ps+where+pl_orbper+%3C+10" +
  "&format=json"
))
console.log(`Rows: ${planets.length}`)      // 17675 (table 'ps' includes duplicate measurements)
console.log(planets[0])
// { pl_name: 'GJ 1214 b', hostname: 'GJ 1214', pl_orbper: 1.58040482 }
```

```ts
// Use 'pscomppars' for one row per planet (composite best-estimate params)
const planets = JSON.parse(await http_get(
  "https://exoplanetarchive.ipac.caltech.edu/TAP/sync" +
  "?query=select+pl_name,hostname,disc_year,discoverymethod,pl_orbper,pl_rade,pl_masse,pl_eqt,sy_dist" +
  "+from+pscomppars+where+disc_year+%3E+2020+and+pl_rade+is+not+null" +
  "+order+by+disc_year+desc" +
  "&format=json&maxrec=5"
))
for (const p of planets) {
  console.log(p.pl_name, p.disc_year, p.discoverymethod, `r=${p.pl_rade}Re`)
}
// Confirmed output:
// KMT-2024-BLG-1870L b 2026 Microlensing r=13.8Re
// LHS 1903 b 2026 Transit r=1.382Re
// TOI-375 d 2026 Radial Velocity r=13.6Re
```

Key tables:
- `ps` — all measurements per planet (multiple rows per planet, all sources)
- `pscomppars` — one row per confirmed planet (best composite parameters)

Key columns: `pl_name`, `hostname`, `disc_year`, `discoverymethod`, `pl_orbper` (orbital period, days), `pl_rade` (radius in Earth radii), `pl_masse` (mass in Earth masses), `pl_eqt` (equilibrium temp K), `sy_dist` (distance in parsec).

URL-encode operators: `<` = `%3C`, `>` = `%3E`, spaces = `+`.

## URL reference

### api.nasa.gov endpoints

| Endpoint | URL pattern |
|---|---|
| APOD today | `https://api.nasa.gov/planetary/apod?api_key=KEY` |
| APOD by date | `...&date=YYYY-MM-DD` |
| APOD range | `...&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` |
| APOD random N | `...&count=N` |
| NEO feed | `https://api.nasa.gov/neo/rest/v1/feed?start_date=...&end_date=...&api_key=KEY` |
| NEO by ID | `https://api.nasa.gov/neo/rest/v1/neo/{id}?api_key=KEY` |
| Mars photos by sol | `https://api.nasa.gov/mars-photos/api/v1/rovers/{rover}/photos?sol=N&api_key=KEY` |
| Mars photos by date | `...?earth_date=YYYY-MM-DD&api_key=KEY` |
| Mars latest | `https://api.nasa.gov/mars-photos/api/v1/rovers/{rover}/latest_photos?api_key=KEY` |

### EPIC (epic.gsfc.nasa.gov — no key, no rate limit)

| Endpoint | URL |
|---|---|
| Latest natural images | `https://epic.gsfc.nasa.gov/api/natural` |
| Natural by date | `https://epic.gsfc.nasa.gov/api/natural/date/YYYY-MM-DD` |
| Enhanced latest | `https://epic.gsfc.nasa.gov/api/enhanced` |
| Enhanced by date | `https://epic.gsfc.nasa.gov/api/enhanced/date/YYYY-MM-DD` |
| All available dates | `https://epic.gsfc.nasa.gov/api/natural/all` |
| PNG image | `https://epic.gsfc.nasa.gov/archive/natural/YYYY/MM/DD/png/{image}.png` |
| Thumbnail (JPEG) | `https://epic.gsfc.nasa.gov/archive/natural/YYYY/MM/DD/thumbs/{image}.jpg` |
| Enhanced PNG | `https://epic.gsfc.nasa.gov/archive/enhanced/YYYY/MM/DD/png/{image}.png` |

### Exoplanet Archive (no key, no rate limit)

```
https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=<ADQL>&format=json&maxrec=<N>
```

## Gotchas

- **DEMO_KEY limit is effectively 10/hour per IP, not 30** — The `X-Ratelimit-Limit` header shows `10` in practice. When the daily budget (~50 req) is exhausted, the `retry-after` header is set to ~80,000 seconds (about 22 hours). Register a free personal key at https://api.nasa.gov/ to get 1,000/hour.

- **All `api.nasa.gov` paths share one rate-limit pool** — APOD, NEO, Mars Rover, and all other `api.nasa.gov` paths draw from the same DEMO_KEY bucket. Calling any one of them depletes the limit for all others.

- **EPIC and Exoplanet Archive are fully free** — `epic.gsfc.nasa.gov` returns no rate-limit headers and is not throttled. `exoplanetarchive.ipac.caltech.edu/TAP/sync` is similarly unrestricted. Use these freely without fear of exhausting DEMO_KEY.

- **NEO date range max is 7 days** — Requests spanning more than 7 days return HTTP 400. Paginate with 7-day windows and use `links.next` from the response to get the next URL.

- **APOD earliest date is 1995-06-16** — Requesting `date` before `1995-06-16` returns HTTP 400 with an error message. No upper date bound other than today.

- **APOD `hdurl` is absent for video entries** — When `media_type` is `video`, the response has `url` (a YouTube embed URL) but no `hdurl`. Always check `media_type` before accessing `hdurl`.

- **Mars Rover `sol` vs `earth_date`** — Both are valid filter params. `sol` is the Martian solar day since rover landing. `earth_date` uses `YYYY-MM-DD`. You cannot mix them in one request.

- **Mars Rover pagination defaults to 25 photos/page** — Large sols (Curiosity sol 1000 has many photos) require `&page=2`, `&page=3`, etc. There is no total count in the response; keep paginating until you get an empty `photos` list.

- **EPIC image name encodes type in the prefix** — Natural images use `epic_1b_` prefix; enhanced color-corrected images use `epic_RGB_` prefix. The API returns the correct filename in `img['image']`; don't guess the prefix.

- **EPIC `/api/natural/all` returns newest-first** — The list of 3,477+ available dates starts from today and goes back to 2015-06-13. Not all days have images (gaps during spacecraft maintenance).

- **Exoplanet `ps` table has multiple rows per planet** — Different publications report different measurements for the same planet. Use `pscomppars` for one-row-per-planet composite parameters. `ps` is useful when you need all reported values or want to filter by specific reference.

- **Exoplanet null values come back as `null` in JSON** — Many fields like `pl_masse` are `null` for planets without mass measurements. Always guard with `if (row.pl_masse != null)`.

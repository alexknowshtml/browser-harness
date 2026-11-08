# Weather APIs — Data Extraction

Three free, no-auth weather APIs tested: **wttr.in** (simplest), **Open-Meteo** (most complete), **weather.gov / NWS** (US only, official).

All work with `http_get` — no browser needed.

## Do this first: pick your API

| Goal | Best API | Latency | Notes |
|------|----------|---------|-------|
| Quick current + 3-day forecast, any city name | wttr.in `?format=j1` | ~800ms | US + international |
| Rich hourly/daily/historical, any coordinates | Open-Meteo | ~700ms | 10K req/day free |
| City name → coordinates | Open-Meteo geocoding | ~700ms | Use with Open-Meteo forecast |
| Official US forecasts with PoP and text | weather.gov NWS | ~90ms /points + ~70ms /forecast | US only, 2-call flow |

**Never use a browser for any of these APIs.** All return JSON over plain HTTP.

---

## Fastest approach: wttr.in one-call current + 3-day forecast

```ts
const data = JSON.parse(await http_get("https://wttr.in/San+Francisco?format=j1"));

// Current conditions
const cc = data.current_condition[0];
console.log(cc.temp_F, "°F /", cc.temp_C, "°C");             // '47', '8'
console.log(cc.FeelsLikeF, "°F feels like");                  // '46'
console.log(cc.humidity, "%");                                // '80'
console.log(cc.windspeedMiles, "mph", cc.winddir16Point);     // '3', 'SW'
console.log(cc.weatherDesc[0].value);                         // 'Partly cloudy'
console.log(cc.precipMM, "mm precip");                        // '0.0'
console.log(cc.visibility, "km", cc.visibilityMiles, "mi");
console.log(cc.pressure, "hPa", cc.pressureInches, "inHg");
console.log(cc.uvIndex);                                      // '0'
console.log(cc.cloudcover, "%");                              // '50'
console.log(cc.observation_time);                             // '10:48 AM' (UTC)
console.log(cc.localObsDateTime);                             // '2026-04-18 03:34 AM' (local)

// 3-day forecast (today + 2 more)
for (const day of data.weather) {
  console.log(day.date, day.maxtempF, "/", day.mintempF, "°F");
  // also: maxtempC, mintempC, avgtempF, avgtempC, sunHour, uvIndex, totalSnow_cm
  const astro = day.astronomy[0];
  console.log("  sunrise:", astro.sunrise, "sunset:", astro.sunset);
  console.log("  moon:", astro.moon_phase, astro.moon_illumination, "%");
  // Hourly breakdown (8 entries per day, every 3 hours: time 0,300,600,...,2100)
  for (const h of day.hourly) {
    console.log(h.time, h.tempF, "°F", h.weatherDesc[0].value);
    // time is '0','300','600',...,'2100' (not HH:MM)
    // also: chanceofrain, chanceofsnow, chanceofthunder, chanceoffog, humidity, etc.
  }
}

// Location info
const na = data.nearest_area[0];
console.log(na.areaName[0].value);       // 'San Francisco'
console.log(na.country[0].value);        // 'United States of America'
console.log(na.latitude, na.longitude);  // '37.775', '-122.418' (strings)
console.log(na.region[0].value);         // 'California'
```

**Works with city names, coordinates, airport codes (`~SFO`), and zip codes.**

---

## Open-Meteo: most complete free weather API

### Step 1: city name → coordinates (geocoding)

```ts
const geo = JSON.parse(await http_get("https://geocoding-api.open-meteo.com/v1/search?name=Chicago&count=1"));
const city = geo.results[0];
const lat = city.latitude;   // 41.85003
const lon = city.longitude;  // -87.65005
const tz = city.timezone;    // 'America/Chicago'
// Also available: city.elevation, city.country, city.country_code,
//                 city.admin1 (state/province), city.population
```

Always use `count=1` and take `results[0]` for unambiguous city names. For "San Francisco" `results[0]` is always the California city (pop 864K).

### Current conditions (extended — preferred over current_weather)

```ts
// lat, lon, tz from the geocoding step above
const data = JSON.parse(await http_get(
  "https://api.open-meteo.com/v1/forecast" +
  `?latitude=${lat}&longitude=${lon}` +
  "&current=temperature_2m,relative_humidity_2m,apparent_temperature," +
  "precipitation,weathercode,windspeed_10m,winddirection_10m," +
  "uv_index,surface_pressure" +
  `&timezone=${tz}`
));

const cur = data.current;
const units = data.current_units;
// cur keys and units (all confirmed):
// temperature_2m        °C   (or °F with &temperature_unit=fahrenheit)
// relative_humidity_2m  %
// apparent_temperature  °C
// precipitation         mm
// weathercode           WMO code int (see table below)
// windspeed_10m         km/h (or mph with &windspeed_unit=mph)
// winddirection_10m     °
// uv_index              (unitless float)
// surface_pressure      hPa
// time                  ISO8601 local time (e.g. '2026-04-18T10:45')
// interval              900 (seconds — 15-min update cadence)

console.log(cur.temperature_2m, units.temperature_2m);   // 8.7 °C
console.log(cur.apparent_temperature);                    // 6.6
console.log(cur.relative_humidity_2m);                    // 80
console.log(cur.windspeed_10m, cur.winddirection_10m);    // 6.1  242
console.log(cur.weathercode);                             // 0 = clear sky
```

The older `&current_weather=true` param works too — returns `data.current_weather` with only temperature, windspeed, winddirection, weathercode, time, is_day, interval.

### Hourly forecast

```ts
// lat, lon, tz from the geocoding step above
const data = JSON.parse(await http_get(
  "https://api.open-meteo.com/v1/forecast" +
  `?latitude=${lat}&longitude=${lon}` +
  "&hourly=temperature_2m,dewpoint_2m,apparent_temperature," +
  "precipitation_probability,precipitation,rain,showers,snowfall,snow_depth," +
  "weathercode,cloudcover,visibility,windspeed_10m,winddirection_10m," +
  "windgusts_10m,uv_index" +
  `&forecast_days=3&timezone=${tz}`
));

const hourly = data.hourly;
const units = data.hourly_units;
// hourly is an object of parallel arrays, all same length
// time entries: ISO8601 strings, one per hour ('2026-04-18T00:00', etc.)
// 3 forecast days → 72 entries

hourly.time.slice(0, 5).forEach((t: string, i: number) => {
  console.log(t,
    hourly.temperature_2m[i], units.temperature_2m,
    hourly.precipitation_probability[i], units.precipitation_probability,
    hourly.windspeed_10m[i], units.windspeed_10m);
});

// Confirmed units (all from live response):
// temperature_2m              °C      dewpoint_2m          °C
// apparent_temperature        °C      precipitation_probability  %
// precipitation               mm      rain                 mm
// showers                     mm      snowfall             cm
// snow_depth                  m       weathercode          wmo code
// cloudcover                  %       visibility           m (not km!)
// windspeed_10m               km/h    winddirection_10m    °
// windgusts_10m               km/h    uv_index             (unitless)
```

`forecast_days` defaults to 7, max is 16.

### Daily forecast

```ts
// lat, lon, tz from the geocoding step above
const data = JSON.parse(await http_get(
  "https://api.open-meteo.com/v1/forecast" +
  `?latitude=${lat}&longitude=${lon}` +
  "&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max," +
  "apparent_temperature_min,precipitation_sum,rain_sum,snowfall_sum," +
  "precipitation_hours,precipitation_probability_max," +
  "windspeed_10m_max,windgusts_10m_max,winddirection_10m_dominant," +
  "shortwave_radiation_sum,uv_index_max,sunrise,sunset" +
  `&timezone=${tz}&forecast_days=7`
));

const daily = data.daily;
const units = data.daily_units;
daily.time.forEach((date: string, i: number) => {
  console.log(date,
    daily.temperature_2m_max[i], "/", daily.temperature_2m_min[i], units.temperature_2m_max,
    `precip=${daily.precipitation_sum[i]}${units.precipitation_sum}`,
    `pop=${daily.precipitation_probability_max[i]}%`,
    `UV=${daily.uv_index_max[i]}`,
    `sunrise=${daily.sunrise[i]}`,
    `sunset=${daily.sunset[i]}`);
});
// sunrise/sunset are ISO8601 local datetimes ('2026-04-18T06:29')
// shortwave_radiation_sum in MJ/m²
```

### Historical data (archive API)

Different subdomain — `archive-api.open-meteo.com`:

```ts
const data = JSON.parse(await http_get(
  "https://archive-api.open-meteo.com/v1/archive" +
  "?latitude=37.7749&longitude=-122.4194" +
  "&start_date=2024-01-01&end_date=2024-01-07" +
  "&daily=temperature_2m_max,precipitation_sum" +
  "&timezone=America/Los_Angeles"
));
// Returns same structure as forecast — daily object of parallel arrays
// Hourly also works: &hourly=temperature_2m,precipitation,weathercode
// Data goes back to 1940 for most locations
```

### Unit overrides

All unit conversions are server-side — just add params:

```
&temperature_unit=fahrenheit    # default: celsius
&windspeed_unit=mph             # default: kmh (also: ms, kn)
&precipitation_unit=inch        # default: mm
```

---

## weather.gov NWS (US only — 2-call flow)

Required for official NWS text forecasts with probability-of-precipitation text and storm warnings.

```ts
// NWS requires a descriptive User-Agent or returns 403. http_get handles gzip.
async function nws_get(url: string): Promise<string> {
  const h = {
    "User-Agent": "(myapp.example.com, contact@example.com)",
    "Accept": "application/geo+json",
  };
  return await http_get(url, h, 20);
}

// Call 1: resolve lat/lon to forecast office + grid cell (~90ms)
const pts = JSON.parse(await nws_get("https://api.weather.gov/points/37.7749,-122.4194"));
const prop = pts.properties;
const office = prop.gridId;   // 'MTR'
const gx = prop.gridX;        // 85
const gy = prop.gridY;        // 105
const forecast_url = prop.forecast;        // 7-day
const hourly_url = prop.forecastHourly;    // hourly

// Also available from /points: prop.timeZone, prop.observationStations,
// prop.relativeLocation.properties.city and .state

// Call 2: 7-day forecast (14 half-day periods) (~70ms)
const fc = JSON.parse(await nws_get(forecast_url));
for (const p of fc.properties.periods) {
  console.log(p.name,                          // 'Saturday', 'Saturday Night', 'Sunday', ...
    p.temperature, p.temperatureUnit,          // 74 F
    p.windSpeed, p.windDirection,              // '6 to 14 mph' 'SW'
    p.shortForecast,                           // 'Mostly Sunny'
    p.probabilityOfPrecipitation.value,        // 0  (integer percent)
    p.isDaytime);                              // true/false
  // p.detailedForecast — plain English paragraph, e.g.
  // 'Sunny, with a high near 74. Southwest wind 6 to 14 mph.'
}

// Hourly (156 hours out — ~6.5 days)
const fch = JSON.parse(await nws_get(hourly_url));
for (const p of fch.properties.periods.slice(0, 5)) {
  console.log(p.startTime,           // '2026-04-18T03:00:00-07:00'
    p.temperature, "°F",
    p.shortForecast,
    p.windSpeed,
    `humidity=${p.relativeHumidity.value}%`,
    `dewpoint=${p.dewpoint.value.toFixed(1)}°C`);
}
```

`/points` response is cached `max-age=20500` (~5.7 hours) at the CDN — safe to call once per session and reuse grid coordinates.

---

## WMO weather code table (Open-Meteo `weathercode`)

```ts
const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Icy fog",
  51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
  61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
  85: "Slight snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail", 99: "Thunderstorm with heavy hail",
};

function wmo_desc(code: number): string {
  return WMO_CODES[code] ?? `Unknown code ${code}`;
}
```

---

## Complete end-to-end pattern: city name → rich forecast

```ts
// City name → current + 7-day daily forecast via Open-Meteo.
async function get_weather(city: string) {
  // 1. Geocode
  const geo = JSON.parse(await http_get(
    `https://geocoding-api.open-meteo.com/v1/search?name=${city.replaceAll(" ", "+")}&count=1`
  ));
  if (!geo.results?.length) throw new Error(`City not found: ${city}`);
  const loc = geo.results[0];
  const [lat, lon, tz] = [loc.latitude, loc.longitude, loc.timezone];

  // 2. Forecast (single call: current + daily)
  const data = JSON.parse(await http_get(
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature," +
    "precipitation,weathercode,windspeed_10m,winddirection_10m,uv_index" +
    "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum," +
    "precipitation_probability_max,weathercode,sunrise,sunset" +
    `&timezone=${tz}&forecast_days=7`
  ));
  return {
    location: loc,
    current: data.current,
    daily: data.daily,
    units: {
      current: data.current_units,
      daily: data.daily_units,
    },
  };
}

const result = await get_weather("Tokyo");
const cur = result.current;
console.log(`${result.location.name}: ${cur.temperature_2m}°C feels like ${cur.apparent_temperature}°C`);
console.log(`Humidity ${cur.relative_humidity_2m}%, wind ${cur.windspeed_10m} km/h`);
```

Total: 2 API calls, ~1400ms combined.

---

## Gotchas

**wttr.in returns HTML (or ANSI art) instead of JSON if you forget `?format=j1`.**
The `?format=j1` suffix is mandatory for JSON. Without it:
- Browser `User-Agent` → full HTML page (~21KB)
- `curl`/`Wget` User-Agent → ANSI escape-code ASCII art (~500B)
Neither is parseable as JSON.

**wttr.in text formats require a non-browser User-Agent.**
`http_get()` sends `Mozilla/5.0` — wttr.in responds with an HTML page for `?format=%t`, `?format=3`, `?format=4`.
Use `Wget/1.21` (or any non-browser UA) for text format endpoints:
```ts
// Plain fetch so no default Mozilla/5.0 UA is sent; wttr.in serves plain text to Wget.
async function http_get_wttr(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "Wget/1.21", "Accept": "*/*" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP Error ${r.status}: ${r.statusText}`);
  return await r.text();
}

// Text format tokens (URL-encode %): %25l=location, %25C=condition desc,
// %25t=temp, %25f=feels-like, %25h=humidity, %25w=wind
console.log(await http_get_wttr("https://wttr.in/London?format=%25t"));           // '+55°F'
console.log(await http_get_wttr("https://wttr.in/Tokyo?format=3"));               // 'tokyo: ☀️   +69°F'
console.log(await http_get_wttr("https://wttr.in/Berlin?format=%25l:+%25C+%25t+(feels+%25f)+%25h+%25w"));
// 'berlin: Sunny +65°F (feels +65°F) 42% ↖5mph'
```

**wttr.in `format=j1` returns only 3 days** (today + 2). Use Open-Meteo for longer forecasts (up to 16 days).

**wttr.in `nearest_area.areaName` is often wrong.** The returned area name is a reverse-geocoded neighborhood, not the city you queried (`"Mccormickville"` for Chicago, `"Lomita Park"` for SFO airport). Use `request[0].query` for what was actually resolved.

**wttr.in `hourly[].time` is `'0'`, `'300'`, `'600'`...`'2100'`** — not HH:MM strings. Parse as `Math.floor(parseInt(time) / 100)` for hours.

**wttr.in `weatherDesc` is a list**: `cc.weatherDesc[0].value`, not a string. Same for `areaName`, `country`, `region`, `weatherIconUrl`.

**wttr.in unknown city returns HTTP 500**, not 404 or a JSON error.

**Open-Meteo default timezone is GMT.** Always pass `&timezone={tz}` or daily `sunrise`/`sunset` values will be in UTC, and daily buckets will be wrong.

**Open-Meteo `visibility` is in metres** (not km). Divide by 1000 to get km.

**Open-Meteo returns HTTP 400 with JSON error body on bad params:**
```json
{"reason": "Latitude must be in range of -90 to 90°. Given: 999.0.", "error": true}
```
`http_get()` throws on 4xx (`Error("HTTP Error 400: ...")`) without the body — use `fetch` and read `await r.json()` when you need the reason.

**weather.gov requires a descriptive `User-Agent`.** The NWS API blocks generic library or `Mozilla/5.0` agents sporadically. Always set `User-Agent: (yourapp.com, your@email.com)` or use your actual app name.

**weather.gov is US-only.** `/points/{lat},{lon}` returns HTTP 404 for coordinates outside the US (including territories like Puerto Rico for some grid edges). Fall back to Open-Meteo for non-US locations.

**weather.gov `windSpeed` is a string like `"6 to 14 mph"`**, not a number. Parse with regex if you need a numeric value.

**weather.gov `probabilityOfPrecipitation` is a dict**: `p.probabilityOfPrecipitation.value`, with `p.probabilityOfPrecipitation.unitCode` = `'wmoUnit:percent'`.

**Open-Meteo rate limit: 10,000 requests/day on the free tier.** The geocoding API and forecast API count separately. No rate limit headers are returned — track usage yourself.

**weather.gov /points response is heavily cached** (`Cache-Control: public, max-age=20500`). Store the office/gridX/gridY and reuse — only call `/points` once per location.

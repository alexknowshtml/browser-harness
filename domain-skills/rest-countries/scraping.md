# REST Countries — Scraping & Data Extraction

`https://restcountries.com` — open JSON API for country data. **Never use the browser.** All data is reachable via `http_get`. No auth required, no API key.

## Do this first

**Fetch all 250 countries in one call with a field filter — almost always the fastest approach.**

```ts
const data = await http_get("https://restcountries.com/v3.1/all?fields=name,cca2,capital,population,area,region");
const countries = JSON.parse(data);
// countries is a list of 250 objects — confirmed 2026-04-18

for (const c of countries) {
  const name       = c.name.common;          // "Germany"
  const official   = c.name.official;        // "Federal Republic of Germany"
  const code       = c.cca2;                 // "DE"
  const capital    = c.capital?.length ? c.capital[0] : null;   // list — may be empty
  const population = c.population;           // 83491249
  const area       = c.area;                 // 357114.0 (km²)
  const region     = c.region;               // "Europe"
  console.log(code, name, population);
}
// Confirmed output (first result varies — API returns unsorted):
// CI Ivory Coast 31719275
```

Use the `?fields=` query param to limit response size — essential when fetching all 250.

## Common workflows

### Lookup a single country by code (ISO 3166-1 alpha-2 or alpha-3)

```ts
// Single code — returns a list (one element)
const data = await http_get("https://restcountries.com/v3.1/alpha/DE");
const country = JSON.parse(data)[0];

// But: /alpha/CODE?fields=... returns a plain object, not a list — watch for this
const data2 = await http_get("https://restcountries.com/v3.1/alpha/DE?fields=name,cca2,currencies,languages,flags");
const country2 = JSON.parse(data2);          // object, NOT list

const name       = country2.name.common;                              // "Germany"
const currencies = country2.currencies;                               // {"EUR": {"name": "euro", "symbol": "€"}}
const currency_codes = Object.keys(currencies);                       // ["EUR"]
const currency_name  = currencies.EUR.name;                           // "euro"
const languages  = country2.languages;                                // {"deu": "German"}
const lang_names = Object.values(languages);                          // ["German"]
const flag_png   = country2.flags.png;                                // "https://flagcdn.com/w320/de.png"
const flag_svg   = country2.flags.svg;                                // "https://flagcdn.com/de.svg"
const flag_alt   = country2.flags.alt;                                // description text

console.log(name, currency_codes, lang_names);
// Confirmed: Germany [ "EUR" ] [ "German" ]
```

### Batch lookup — multiple codes in one call

Use `/alpha?codes=` for fetching a known list of countries — always returns a list.

```ts
const codes = ["US", "GB", "FR", "DE", "JP", "CN", "IN", "BR", "AU", "CA"];
const data = await http_get(`https://restcountries.com/v3.1/alpha?codes=${codes.join(",")}&fields=name,cca2,population`);
const countries = JSON.parse(data);
// Returns list, order NOT guaranteed to match input order
for (const c of countries) {
  console.log(c.cca2, c.name.common, c.population);
}
// Confirmed: 10 results, returned in arbitrary order
```

### Search by name

```ts
// Partial match (default) — may return multiple results
const data = await http_get("https://restcountries.com/v3.1/name/united");
const results = JSON.parse(data);
// Returns 7 countries: United States, UK, UAE, Tanzania, Mexico, ...

// Exact match — use fullText=true with the full common or official name
const data2 = await http_get("https://restcountries.com/v3.1/name/united%20kingdom?fullText=true");
const results2 = JSON.parse(data2);
// Returns exactly 1 result: United Kingdom
console.log(results2[0].name.common);  // United Kingdom
```

### Filter by region

```ts
const data = await http_get("https://restcountries.com/v3.1/region/europe?fields=name,cca2,population");
const countries = JSON.parse(data);
// 53 European countries — confirmed

// Sort by population
const ranked = [...countries].sort((a: any, b: any) => b.population - a.population);
for (const c of ranked.slice(0, 5)) {
  console.log(c.cca2, c.name.common, c.population.toLocaleString("en-US"));
}
// Confirmed top 5: RU Russia, DE Germany, FR France, GB United Kingdom, IT Italy
```

Valid region values: `africa`, `americas`, `asia`, `europe`, `oceania`, `antarctic`

### Filter by subregion

```ts
const data = await http_get("https://restcountries.com/v3.1/subregion/Western%20Europe?fields=name,cca2");
const countries = JSON.parse(data);
console.log(JSON.stringify(countries.map((c: any) => c.cca2)));
// Confirmed: ["FR","NL","MC","DE","BE","LI","CH","LU"]
```

### Filter by language

```ts
const data = await http_get("https://restcountries.com/v3.1/lang/arabic");
const countries = JSON.parse(data);
console.log(`Arabic-speaking countries: ${countries.length}`);
// Confirmed: 25 countries

// Language param is the language name (English), not the ISO 639-3 code
// Works: arabic, french, spanish, english, portuguese, german, russian, chinese
```

### Filter by currency

```ts
const data = await http_get("https://restcountries.com/v3.1/currency/EUR");
const countries = JSON.parse(data);
console.log(`EUR countries: ${countries.length}`);  // Confirmed: 36
const names = countries.map((c: any) => c.name.common);
console.log(names.slice(0, 5));

// Use ISO 4217 currency code (uppercase)
```

### Filter by capital city

```ts
const data = await http_get("https://restcountries.com/v3.1/capital/berlin?fields=name,cca2,capital");
const result = JSON.parse(data);
console.log(result[0].name.common, result[0].capital);
// Confirmed: Germany [ "Berlin" ]
// Capital param is case-insensitive
```

### Full country detail — all fields

```ts
const data = await http_get("https://restcountries.com/v3.1/alpha/US");
const c = JSON.parse(data)[0];

// Available top-level keys (confirmed for US/DE):
// name, tld, cca2, ccn3, cca3, cioc, independent, status, unMember,
// currencies, idd, capital, altSpellings, region, subregion, languages,
// translations, latlng, landlocked, borders, area, demonyms, flag (emoji),
// maps, population, gini, fifa, car, timezones, continents, flags,
// coatOfArms, startOfWeek, capitalInfo, postalCode

console.log(JSON.stringify(c.idd));   // {"root": "+1", "suffixes": ["201", "202", ...]}
console.log(c.car.side);              // "right" or "left"
console.log(JSON.stringify(c.gini));  // {"2018": 41.4}  — year keyed, may be absent
console.log(c.timezones);             // list of UTC offset strings
console.log(c.borders);               // list of cca3 codes for bordering countries
console.log(c.latlng);                // [lat, lng] of geographic center
```

## URL reference

| Endpoint | Pattern | Notes |
|---|---|---|
| All countries | `/v3.1/all` | Always add `?fields=` |
| By code | `/v3.1/alpha/{code}` | cca2 or cca3; single code → list (no fields) or dict (with fields) |
| By codes | `/v3.1/alpha?codes=DE,FR,JP` | Always returns list |
| By name | `/v3.1/name/{name}` | Partial; add `?fullText=true` for exact match |
| By region | `/v3.1/region/{region}` | africa, americas, asia, europe, oceania, antarctic |
| By subregion | `/v3.1/subregion/{subregion}` | URL-encode spaces as `%20` |
| By language | `/v3.1/lang/{language}` | English language name |
| By currency | `/v3.1/currency/{code}` | ISO 4217 (EUR, USD, GBP) |
| By capital | `/v3.1/capital/{city}` | Case-insensitive |

All endpoints accept `?fields=field1,field2,...` to limit response payload.

## Gotchas

- **`name` is a nested object, not a string.** Use `c.name.common` for the familiar English name, `c.name.official` for the full official name. `nativeName` is an object keyed by ISO 639-3 language code.

- **`/alpha/CODE` return type depends on whether `?fields=` is present.** Without `?fields=`, returns a list (one element). With `?fields=...`, returns a plain object. Use `JSON.parse(data)[0]` for the no-fields case, `JSON.parse(data)` for the fields case. Using `/alpha?codes=CODE` always returns a list regardless.

- **`currencies` is an object keyed by ISO 4217 code, not a list.** `c.currencies.EUR.name` → `"euro"`, `c.currencies.EUR.symbol` → `"€"`. A country can have multiple currencies — iterate `Object.entries(currencies)`.

- **`languages` is an object keyed by ISO 639-3 code.** `c.languages.deu` → `"German"`. Use `Object.values(c.languages)` for a simple list of language names.

- **`capital` is a list and may be empty.** Some territories (Antarctica, Bouvet Island, Macau, Heard Island) have no capital — `c.capital` is `[]` or missing, not a string. Guard with `c.capital?.length ? c.capital[0] : null`. South Africa has 3 capitals.

- **`gini` is an object keyed by year string, may be absent entirely.** `c.gini` → `{"2016": 31.9}`. Many small countries or territories have no gini data — always check `c.gini ?? null`.

- **`borders` uses cca3 codes, not cca2.** `c.borders` → `["AUT", "BEL", ...]`. Cross-reference with another `/alpha?codes=` call to resolve to names.

- **`translations` covers ~45 languages.** Each entry: `c.translations.deu` → `{"official": "Bundesrepublik Deutschland", "common": "Deutschland"}`. Useful for multilingual apps.

- **No rate limit headers, no documented rate limit.** In practice the API handles rapid sequential calls fine. For bulk crawling hundreds of per-country requests, add a short sleep (`await wait(0.5)`) between calls to be polite.

- **404 returns JSON, not HTML.** `{"message": "Not Found", "status": 404}`. `http_get` throws `Error("HTTP Error 404: ...")` on it, so wrap calls in try/catch and check `String(e).includes("HTTP Error 404")` when handling user-supplied country names or codes. Use `fetch` and read `r.status` plus the JSON body if you need the message.

- **`?fields=` is the key performance lever.** The full all-countries payload without field filtering is ~1.5 MB. With `?fields=name,cca2,population` it drops to ~50 KB. Always filter when you don't need all fields.

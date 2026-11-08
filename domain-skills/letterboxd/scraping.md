# Letterboxd — Film Data Scraping

`https://letterboxd.com` — film logging, rating, and review site. Film pages and user profile root pages are publicly accessible via `http_get` (~200–350ms). Most sub-pages (reviews, ratings, user film lists, browse/genre pages) return 403 and require the browser.

## Access path decision table

| Goal | Method | Latency |
|------|--------|---------|
| Film metadata (title, year, director, cast, genres, rating) | `http_get` + JSON-LD | ~200–350ms |
| Film synopsis, poster, OG data | `http_get` + meta tags | same request |
| Film popular reviews (top 12 inline) | `http_get` film page | same request |
| User profile stats (film count, followers) | `http_get` user root | ~150ms |
| Recent global activity stream | `http_get /films/` | ~200ms |
| User watched film list | browser (`/{username}/films/`) | |
| Ratings distribution histogram | browser (`/film/{slug}/ratings/`) | |
| All reviews (paginated) | browser (`/film/{slug}/reviews/`) | |
| Popular / browse / genre film lists | browser (`/films/popular/`, etc.) | |
| Director / actor pages | browser (`/director/{slug}/`, `/actor/{slug}/`) | |
| User diary / lists | browser (`/{username}/diary/`, `/{username}/lists/`) | |

**Letterboxd's public API** (`api.letterboxd.com/api/v0/`) returns 401 on all endpoints — it requires OAuth2 client credentials (apply at letterboxd.com/api-beta/).

**Cloudflare Turnstile** is configured in the page JS but is not blocking `http_get` on accessible pages. It only activates on the login form.

---

## Path 1: Film page via http_get (fastest for metadata + ratings)

Film pages at `letterboxd.com/film/{slug}/` are fully accessible. The JSON-LD block (Movie schema) contains everything you need in one parse.

**URL slug format:** lowercase title, spaces replaced with hyphens. For disambiguation (same title, different year) append `-{year}`: e.g. `parasite-2019`, `alien-1979`.

```ts
// HTML entity decoder (stand-in for Python's html.unescape)
const unescape = (t: string) =>
  t.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
   .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Fetch and parse a Letterboxd film page.
 * slug examples: 'the-godfather', 'parasite-2019', 'inception', '2001-a-space-odyssey'
 */
async function extract_film_data(slug: string) {
  const html = await http_get(`https://letterboxd.com/film/${slug}/`);
  const result: Record<string, any> = {};

  // --- JSON-LD (primary source) ---
  const jsonld_raw = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
  for (const block of jsonld_raw) {
    // Strip CDATA wrapper that Letterboxd wraps around JSON-LD
    let cleaned = block.replace(/\/\*\s*<!\[CDATA\[.*?\*\/\s*/gs, "");
    cleaned = cleaned.replace(/\/\*\s*\]\]>.*?\*\//gs, "");
    let data: any;
    try {
      data = JSON.parse(cleaned.trim());
    } catch {
      continue;
    }
    if (data["@type"] !== "Movie") continue;

    result.title      = data.name;
    result.year       = data.releasedEvent ? data.releasedEvent[0].startDate : null;
    result.directors  = (data.director ?? []).map((d: any) => d.name);
    result.genres     = data.genre ?? [];
    result.countries  = (data.countryOfOrigin ?? []).map((c: any) => c.name);
    result.studios    = (data.productionCompany ?? []).map((s: any) => s.name);
    result.actors     = (data.actors ?? []).map((a: any) => a.name);
    result.poster_url = data.image ?? null;
    result.url        = data.url ?? null;
    const r = data.aggregateRating ?? {};
    result.rating       = r.ratingValue ?? null;   // float 0.0–5.0
    result.rating_count = r.ratingCount ?? null;   // int, total ratings cast
    result.review_count = r.reviewCount ?? null;   // int, written reviews only
  }

  // --- OG / meta tags (fast fallback, redundant) ---
  const og = (prop: string) =>
    html.match(new RegExp(`<meta[^>]+property="og:${prop}"[^>]+content="([^"]*)"`))?.[1] ?? null;
  result.og_title = og("title");    // includes year: "The Godfather (1972)"
  result.synopsis = unescape(og("description") || "");
  result.og_image = og("image");    // large 1200x675 crop

  // --- Film ID (internal numeric ID) ---
  let m = html.match(/data-film-id="(\d+)"/);
  result.film_id = m ? m[1] : null;

  // --- Tagline ---
  m = html.match(/<h4 class="tagline">([^<]+)<\/h4>/);
  result.tagline = m ? unescape(m[1]) : null;

  // --- Themes (from tab-genres section) ---
  m = html.match(/<h3><span>Themes<\/span><\/h3>.*?<p>(.*?)<\/p>/s);
  result.themes = m ? [...m[1].matchAll(/class="text-slug">([^<]+)<\/a>/g)].map((x) => x[1]) : [];

  // --- Languages ---
  result.languages = [...html.matchAll(/href="\/films\/language\/[^/]+\/"[^>]*>([^<]+)<\/a>/g)].map((x) => x[1]);

  // --- Fans count ---
  m = html.match(/class="accessory"[^>]*>\s*([\d,KkMm]+)\s*fans<\/a>/);
  result.fans = m ? m[1] : null;  // e.g. "133K"

  // --- Popular reviews (top 12 inline on the page) ---
  result.reviews = [];
  for (const [, vid, person, block] of html.matchAll(
    /<article class="production-viewing[^"]*"[^>]*data-viewing-id="(\d+)"[^>]*data-person="([^"]+)">(.*?)<\/article>/gs
  )) {
    const dm = block.match(/<strong class="displayname">([^<]+)<\/strong>/);
    const tm = block.match(/class="body-text -prose -reset[^"]*"[^>]*>(.*?)<\/div>/s);
    const lm = block.match(/data-count="(\d+)"/);
    result.reviews.push({
      viewing_id:   vid,
      username:     person,
      display_name: dm ? dm[1] : person,
      review:       tm ? tm[1].replace(/<[^>]+>/g, "").trim() : "",
      likes:        lm ? Number(lm[1]) : 0,
    });
  }

  return result;
}
```

### Verified output (2026-04-18)

```ts
let data = await extract_film_data("the-godfather");
// {
//   title: 'The Godfather',
//   year: '1972',
//   directors: ['Francis Ford Coppola'],
//   genres: ['Crime', 'Drama'],
//   countries: ['USA'],
//   studios: ['Paramount Pictures', 'Alfran Productions'],
//   actors: ['Marlon Brando', 'Al Pacino', 'James Caan', ...],  // full cast list
//   rating: 4.52,
//   rating_count: 2619662,
//   review_count: 372579,
//   fans: '133K',
//   film_id: '51818',
//   tagline: "An offer you can't refuse.",
//   genres: ['Crime', 'Drama'],
//   themes: ['Crime, drugs and gangsters', 'Gritty crime and ruthless gangsters', ...],
//   languages: ['English', 'Latin', 'English', 'Italian'],  // may have dupes; deduplicate
//   og_title: 'The Godfather (1972)',
//   synopsis: 'Spanning the years 1945 to 1955...',
//   poster_url: 'https://a.ltrbxd.com/resized/film-poster/.../51818-the-godfather-0-230-0-345-crop.jpg...',
//   og_image: 'https://a.ltrbxd.com/resized/sm/upload/.../the-godfather-1200-1200-675-675-crop-000000.jpg...',
//   reviews: [
//     {username: 'wizardchurch', display_name: 'Hannah', likes: 30944,
//      review: 'haha they made that scene from zootopia into a movie'},
//     ...  // 12 total
//   ]
// }

data = await extract_film_data("parasite-2019");
// title: 'Parasite', year: '2019', rating: 4.53, rating_count: 5264520, review_count: 690652
// fans: '175K', directors: ['Bong Joon Ho'], countries: ['South Korea']

data = await extract_film_data("inception");
// title: 'Inception', year: '2010', rating: 4.23, rating_count: 3913620
```

---

## Path 2: User profile via http_get

Only the user root page `letterboxd.com/{username}/` is accessible. Sub-pages (`/films/`, `/diary/`, `/lists/`) return 403.

```ts
async function extract_user_profile(username: string) {
  const html = await http_get(`https://letterboxd.com/${username}/`);

  // Display name
  const dm = html.match(/class="displayname tooltip"[^>]*><span class="label">([^<]+)<\/span>/);

  // Stats block (Films / This year / Lists / Following / Followers)
  const stats = [...html.matchAll(
    /<span class="value">(\d[\d,]*)<\/span><span class="definition[^"]*">([^<]+)<\/span>/g
  )].map((m) => [m[1], m[2]]);

  // Favorites from OG description
  const od = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]*)"/);
  let favorites: string[] = [];
  if (od) {
    const fm = od[1].match(/Favorites:\s*([^.]+)\./);
    if (fm) favorites = fm[1].split(",").map((f) => f.trim());
  }

  // Film IDs of films shown on profile page (recent activity)
  const film_ids_on_page = [...new Set([...html.matchAll(/data-film-id="(\d+)"/g)].map((m) => m[1]))];

  return {
    username,
    display_name: dm ? dm[1] : null,
    stats: Object.fromEntries(stats.map(([val, label]) => [label.trim(), Number(val.replace(/,/g, ""))])),
    favorites,
    film_ids_on_page,
  };
}
```

### Verified output

```ts
const data = await extract_user_profile("dave");
// {
//   username: 'dave',
//   display_name: 'Dave Vis',
//   stats: {Films: 2553, 'This year': 63, Lists: 155, Following: 77, Followers: 34512},
//   favorites: ['High and Low (1963)', 'Burning (2018)', 'My Neighbor Totoro (1988)', 'Mulholland Drive (2001)'],
//   film_ids_on_page: ['51818', '47756', ...]  // ~32 film IDs from recent activity blocks
// }
```

---

## Path 3: Global activity stream from /films/

`letterboxd.com/films/` returns the recent global activity feed — approximately 6 full viewing entries, plus many more film slugs from the UI. Use this to discover recently-logged films.

```ts
// unescape(): the HTML entity decoder from extract_film_data above
async function extract_activity_stream() {
  const html = await http_get("https://letterboxd.com/films/");
  const entries: any[] = [];
  for (const [, owner, obj_id, block] of html.matchAll(
    /class="production-viewing[^"]*"[^>]*data-owner="([^"]+)"[^>]*data-object-id="([^"]+)"[^>]*>(.*?)<\/article>/gs
  )) {
    const film_m = block.match(/data-item-name="([^"]*)".*?data-item-slug="([^"]*)".*?data-film-id="(\d+)"/s);
    if (film_m) {
      entries.push({
        owner,
        film_name: unescape(film_m[1]),
        film_slug: film_m[2],
        film_id:   film_m[3],
      });
    }
  }
  return entries;
}

// Returns ~6 entries. Film names are in "Title (Year)" format.
// Example: [{owner: 'sidduww', film_name: 'The Drama (2026)',
//            film_slug: 'the-drama', film_id: '1205494'}, ...]
```

---

## Path 4: Browser for list pages and sub-pages (403 via http_get)

These pages require the browser — use `goto()` + `wait_for_load()` + `wait(2)`:

```ts
// Popular films
await goto("https://letterboxd.com/films/popular/");
await wait_for_load();
await wait(2);

let films = JSON.parse(await js(`
(function() {
  var items = Array.from(document.querySelectorAll('li.film-list-entry, li[class*="poster-container"]'));
  return JSON.stringify(items.slice(0, 30).map(function(el) {
    var poster = el.querySelector('[data-item-slug]') || el.querySelector('[data-film-slug]');
    return {
      name: poster ? (poster.dataset.itemName || poster.dataset.filmName) : null,
      slug: poster ? (poster.dataset.itemSlug || poster.dataset.filmSlug) : null,
      film_id: poster ? poster.dataset.filmId : null
    };
  }).filter(function(x){ return x.slug; }));
})()
`));

// User watched films list (paginated, 72/page)
await goto("https://letterboxd.com/dave/films/");
await wait_for_load();
await wait(2);

films = JSON.parse(await js(`
(function() {
  var items = Array.from(document.querySelectorAll('li[data-film-id]'));
  return JSON.stringify(items.map(function(el) {
    return {
      film_id:   el.dataset.filmId,
      film_slug: el.dataset.targetLink ? el.dataset.targetLink.replace(/\\/film\\/|\\/$/g,'') : null,
      rating:    el.dataset.ownerRating || null
    };
  }));
})()
`));

// User diary entries
await goto("https://letterboxd.com/dave/diary/");
await wait_for_load();
await wait(2);

// For paginated browsing, check next page link
const next_page_url = await js(`
(function() {
  var a = document.querySelector('a.next');
  return a ? a.href : null;
})()
`);
// Returns URL for next page or null. Load it with await goto(next_page_url).
```

---

## Gotchas

**JSON-LD is wrapped in CDATA comments** — `JSON.parse(block)` will fail without stripping the wrapper. Always strip `/* <![CDATA[ */` and `/* ]]> */` first:
```ts
let cleaned = block.replace(/\/\*\s*<!\[CDATA\[.*?\*\/\s*/gs, "");
cleaned = cleaned.replace(/\/\*\s*\]\]>.*?\*\//gs, "");
const data = JSON.parse(cleaned.trim());
```

**JSON-LD `name` is bare title, not "Title (Year)"** — `data.name` returns `'Parasite'`, not `'Parasite (2019)'`. Year is in `data.releasedEvent[0].startDate`. The OG `og:title` meta tag does include the year.

**OG description contains HTML entities** — `og:description` and `tagline` use `&#039;` etc. Always unescape them (see the `unescape` helper in the film-page snippet).

**`languages` list can have duplicates** — e.g. Parasite returns `['Korean', 'English', 'German', 'Korean']`. Use `[...new Set(result.languages)]` to deduplicate while preserving order.

**Disambiguation slugs** — when two films share a title, Letterboxd appends the year to the slug: `parasite-2019` (Bong's film), vs `parasite` (1982 film). If your slug 404s, try appending `-{year}`.

**403 pages** — `/film/{slug}/reviews/`, `/film/{slug}/ratings/`, `/film/{slug}/cast/`, `/film/{slug}/details/`, `/{username}/films/`, `/films/popular/`, `/films/by/rating/`, `/genre/{slug}/`, `/director/{slug}/`, `/actor/{slug}/` all return 403 to `http_get`. These require the browser.

**CSI endpoints are 403** — Letterboxd loads the ratings histogram via `/csi/film/{slug}/rating-histogram/` which returns 403 without a session cookie. Access ratings distribution via browser on `/film/{slug}/ratings/`.

**`/csi/` and `/ajax/` endpoints need session cookies** — these are used to populate the ratings histogram, friend activity, and popular review sections after page load. Only the inline HTML data (top 12 popular reviews) is available via `http_get`.

**Cloudflare Turnstile is present but passive** — the `configuration.cloudflare.turnstile` object is in the page JS, but it only activates on the login form. It does not block unauthenticated reads on public film/user pages.

**The official API requires OAuth** — `api.letterboxd.com/api/v0/` returns 401 on all endpoints. Apply for API access at letterboxd.com/api-beta/ to get client credentials.

**Fans count is abbreviated** — `'133K'`, `'175K'`. Parse with:
```ts
function parse_abbrev(s: string): number {
  s = s.trim().toUpperCase();
  if (s.endsWith("K")) return Math.trunc(parseFloat(s.slice(0, -1)) * 1000);
  if (s.endsWith("M")) return Math.trunc(parseFloat(s.slice(0, -1)) * 1000000);
  return parseInt(s.replace(/,/g, ""), 10);
}
```

**Film slug from unknown title** — Letterboxd has no public search API. Construct the slug by lowercasing the title and replacing spaces with hyphens, then `http_get` and check for a 403/404 vs a valid JSON-LD block.

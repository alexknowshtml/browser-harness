# Metacritic — Scraping & Data Extraction

Field-tested against metacritic.com on 2026-04-18. All code blocks validated with live requests.

## Do this first

**Use the backend API — it returns clean JSON with both scores in one call, no HTML parsing.**

Metacritic's internal backend API is publicly accessible with a stable key embedded in every page. It covers games, movies, and TV shows.

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"

async function get_game_scores(slug: string) {
  // slug = URL slug e.g. 'elden-ring', 'the-last-of-us'
  const base = "https://backend.metacritic.com"
  const product = JSON.parse(await http_get(
    `${base}/games/metacritic/${slug}/web`
    + `?componentName=product&componentType=Product&apiKey=${API_KEY}`
  ))
  const user_stats = JSON.parse(await http_get(
    `${base}/reviews/metacritic/user/games/${slug}/stats/web`
    + `?componentName=user-score-summary&componentType=ScoreSummary&apiKey=${API_KEY}`
  ))
  const item = product.data.item
  const crit = item.criticScoreSummary
  const user = user_stats.data.item
  return {
    title: item.title,
    platform: item.platform,              // lead platform
    platforms: item.platforms,            // list with per-platform scores
    metascore: crit.score,                // int 0–100 or null
    critic_reviews: crit.reviewCount,     // int
    critic_sentiment: crit.sentiment,     // e.g. "Universal acclaim"
    user_score: user.score,               // float 0.0–10.0 or null
    user_reviews: user.reviewCount,       // int
    user_sentiment: user.sentiment,
    release_date: item.releaseDate,       // "YYYY-MM-DD"
  }
}

console.log(JSON.stringify(await get_game_scores("the-last-of-us")))
// {"title":"The Last of Us","platform":"PlayStation 3",
//  "metascore":95,"critic_reviews":98,
//  "user_score":9.2,"user_reviews":17207, ...}
```

Use the browser **only** if you need music pages — `metacritic.com/music/*` returns HTTP 403 to `http_get` (Cloudflare blocks those routes). Games, movies, and TV all work with plain HTTP.

---

## Fastest approach: JSON-LD (critic score + review count only)

If you only need the Metascore and critic review count and don't need the user score, JSON-LD is the single-call option — no API key, no separate request:

```ts
const url = "https://www.metacritic.com/game/elden-ring/"   // or /movie/ or /tv/
const html = await http_get(url)

const block = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)][0][1]
const ld = JSON.parse(block)

const agg = ld.aggregateRating
console.log(ld.name)                   // "Elden Ring"
console.log(agg.ratingValue)           // 96  (metascore)
console.log(agg.reviewCount)           // 93  (critic reviews count)
console.log(ld.gamePlatform)           // ['Xbox One', 'PC', 'PlayStation 4', 'Xbox Series X', 'PlayStation 5']
console.log(ld.genre)                  // "Action RPG"
console.log(ld.contentRating)          // "M"
console.log(ld.datePublished)          // "2022-02-25"
```

**JSON-LD limitations:**
- Only contains Metascore and critic review count — **no user score, no user review count**.
- For multi-platform games, `ratingValue` is the lead platform score; all platforms are listed in `gamePlatform` but without individual scores.
- `@type` is `VideoGame` for games, `Movie` for movies, `TVSeries` for TV shows.

---

## Common workflows

### Get scores for a single title (backend API)

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"
const BASE = "https://backend.metacritic.com"

// Games
async function game_scores(slug: string) {
  const p = JSON.parse(await http_get(`${BASE}/games/metacritic/${slug}/web?componentName=product&componentType=Product&apiKey=${API_KEY}`))
  const u = JSON.parse(await http_get(`${BASE}/reviews/metacritic/user/games/${slug}/stats/web?componentName=user-score-summary&componentType=ScoreSummary&apiKey=${API_KEY}`))
  const c = p.data.item.criticScoreSummary
  const us = u.data.item
  return { metascore: c.score, critic_reviews: c.reviewCount,
           user_score: us.score, user_reviews: us.reviewCount }
}

// Movies
async function movie_scores(slug: string) {
  const p = JSON.parse(await http_get(`${BASE}/movies/metacritic/${slug}/web?componentName=product&componentType=Product&apiKey=${API_KEY}`))
  const u = JSON.parse(await http_get(`${BASE}/reviews/metacritic/user/movies/${slug}/stats/web?componentName=user-score-summary&componentType=ScoreSummary&apiKey=${API_KEY}`))
  const c = p.data.item.criticScoreSummary
  const us = u.data.item
  return { metascore: c.score, critic_reviews: c.reviewCount,
           user_score: us.score, user_reviews: us.reviewCount }
}

// TV shows
async function show_scores(slug: string) {
  const p = JSON.parse(await http_get(`${BASE}/shows/metacritic/${slug}/web?componentName=product&componentType=Product&apiKey=${API_KEY}`))
  const u = JSON.parse(await http_get(`${BASE}/reviews/metacritic/user/shows/${slug}/stats/web?componentName=user-score-summary&componentType=ScoreSummary&apiKey=${API_KEY}`))
  const c = p.data.item.criticScoreSummary
  const us = u.data.item
  return { metascore: c.score, critic_reviews: c.reviewCount,
           user_score: us.score, user_reviews: us.reviewCount }
}

// Verified results:
console.log(JSON.stringify(await game_scores("the-last-of-us")))
// {"metascore":95,"critic_reviews":98,"user_score":9.2,"user_reviews":17207}
console.log(JSON.stringify(await movie_scores("the-godfather")))
// {"metascore":100,"critic_reviews":16,"user_score":9.2,"user_reviews":4450}
console.log(JSON.stringify(await show_scores("breaking-bad")))
// {"metascore":87,"critic_reviews":98,"user_score":9.4,"user_reviews":19070}
```

### Parallel fetching (multiple titles at once)

10 API calls in 0.68s with 5 workers — no rate-limit errors:

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"

// http_get already sends UA Mozilla/5.0 and handles gzip.
const _fetch = async (url: string) => JSON.parse(await http_get(url, null, 15))

async function batch_game_scores(slugs: string[]) {
  // Fetch critic+user scores for multiple game slugs in parallel.
  const BASE = "https://backend.metacritic.com"
  const AK = `apiKey=${API_KEY}`

  async function fetch_one(slug: string) {
    const [c, u] = await Promise.all([
      _fetch(`${BASE}/reviews/metacritic/critic/games/${slug}/stats/web?componentName=critic-score-summary&componentType=ScoreSummary&${AK}`),
      _fetch(`${BASE}/reviews/metacritic/user/games/${slug}/stats/web?componentName=user-score-summary&componentType=ScoreSummary&${AK}`),
    ])
    const ci = c.data.item
    const ui = u.data.item
    return { slug, metascore: ci.score, critic_reviews: ci.reviewCount,
             user_score: ui.score, user_reviews: ui.reviewCount }
  }

  return Promise.all(slugs.map(fetch_one))
}

const results = await batch_game_scores([
  "the-last-of-us", "elden-ring", "god-of-war",
  "red-dead-redemption-2", "the-witcher-3-wild-hunt",
])
// the-last-of-us: meta=95/98critics, user=9.2/17207
// elden-ring: meta=96/86critics, user=8.4/23344
// god-of-war: meta=94/118critics, user=9.0/30439
// red-dead-redemption-2: meta=97/99critics, user=9.0/35306
// the-witcher-3-wild-hunt: meta=92/79critics, user=9.1/19370
```

### Search by title

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"

async function search(query: string, media_type: "games" | "movies" | "shows" | null = null, limit = 10) {
  // media_type: null='all', 'games' (mcoTypeId=13), 'movies' (2), 'shows' (1)
  // Returns list of {title, type, slug, year, metascore, user_score}
  const type_map = { games: 13, movies: 2, shows: 1 }
  const q = encodeURIComponent(query)
  const type_param = media_type ? `&mcoTypeId=${type_map[media_type]}` : "&mcoTypeId=1%2C2%2C3%2C13"
  const url =
    `https://backend.metacritic.com/finder/metacritic/search/${q}/web`
    + `?offset=0&limit=${limit}&sortBy=META_SCORE&sortDirection=DESC`
    + `${type_param}&componentName=search&componentType=SearchResult`
    + `&apiKey=${API_KEY}`
  const data = JSON.parse(await http_get(url))
  const items = data.data.items
  return items.map((i: any) => ({
    title: i.title,
    type: i.type,            // "game-title", "movie", "tv-show"
    slug: i.slug,
    year: i.premiereYear,
    metascore: i.criticScoreSummary?.score,
    user_score: i.userScore, // null in search results (use stats API for this)
  }))
}

const results = await search("elden ring", "games")
// [{"title":"Elden Ring","type":"game-title","slug":"elden-ring","year":2022,"metascore":96, ...}]
```

**Note:** `userScore` is `null` in search results. Call the stats API with the `slug` to get it.

### Browse/list titles by score

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"

async function browse_games({ sort_by = "-metaScore", year_min = null as number | null, year_max = null as number | null, offset = 0, limit = 24 } = {}) {
  // sort_by: '-metaScore' | '-releaseDate' | '-popularityCount'
  // Returns up to `limit` games with criticScoreSummary and userScore.
  // Total available: ~14,160 games.
  let params = `sortBy=${sort_by}&mcoTypeId=13&offset=${offset}&limit=${limit}`
  if (year_min) params += `&releaseYearMin=${year_min}`
  if (year_max) params += `&releaseYearMax=${year_max}`
  const url = `https://backend.metacritic.com/finder/metacritic/web?${params}&componentName=finder&componentType=Finder&apiKey=${API_KEY}`
  const data = JSON.parse(await http_get(url))
  const total = data.data.totalResults
  const items = data.data.items
  return [total, items.map((i: any) => ({
    title: i.title,
    slug: i.slug,
    year: i.premiereYear,
    metascore: i.criticScoreSummary?.score,
    critic_reviews: i.criticScoreSummary?.reviewCount,
    user_score: i.userScore && typeof i.userScore === "object" ? i.userScore.score : i.userScore,
  }))] as const
}

const [total, games] = await browse_games({ year_min: 2023, year_max: 2024 })
console.log(`${total} games 2023-2024`)   // 953
for (const g of games.slice(0, 3)) console.log(JSON.stringify(g))
// {"title":"Baldur's Gate 3","year":2023,"metascore":96,"user_score":9.2}
// {"title":"The Legend of Zelda: Tears of the Kingdom","year":2023,"metascore":96, ...}
```

Finder API totals (confirmed 2026-04-18):
- Games (mcoTypeId=13): 14,160
- Movies (mcoTypeId=2): 17,152
- TV Shows (mcoTypeId=1): 3,392

### Get per-platform scores for multi-platform games

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"

async function game_platforms(slug: string) {
  const url =
    `https://backend.metacritic.com/games/metacritic/${slug}/web`
    + `?componentName=product&componentType=Product&apiKey=${API_KEY}`
  const data = JSON.parse(await http_get(url))
  const platforms = data.data.item.platforms
  return platforms.map((p: any) => ({
    name: p.name,
    slug: p.slug,
    is_lead: p.isLeadPlatform,
    metascore: p.criticScoreSummary.score,        // null if <4 reviews
    critic_reviews: p.criticScoreSummary.reviewCount,
    release_date: p.releaseDate,
  }))
}

console.log(JSON.stringify(await game_platforms("elden-ring"), null, 2))
// [{"name":"Xbox One","slug":"xbox-one","is_lead":false,"metascore":null, ...},
//  {"name":"PC","slug":"pc","is_lead":false,"metascore":94,"critic_reviews":63},
//  {"name":"PlayStation 4","slug":"playstation-4","is_lead":false,"metascore":null,"critic_reviews":1},
//  {"name":"Xbox Series X","slug":"xbox-series-x","is_lead":false,"metascore":96,"critic_reviews":19},
//  {"name":"PlayStation 5","slug":"playstation-5","is_lead":true,"metascore":96,"critic_reviews":93}]
```

### Get critic reviews (paginated)

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"

async function get_critic_reviews(slug: string, { media = "games", offset = 0, limit = 10, sort = "date" } = {}) {
  // sort: 'date' | 'score' | 'publication'
  const url =
    `https://backend.metacritic.com/reviews/metacritic/critic/${media}/${slug}/web`
    + `?offset=${offset}&limit=${limit}&sort=${sort}`
    + `&componentName=latest-critic-reviews&componentType=CriticReviewList&apiKey=${API_KEY}`
  const data = JSON.parse(await http_get(url))
  const total = data.data.totalResults   // e.g. 98
  const items = data.data.items
  return [total, items.map((r: any) => ({
    score: r.score,                // int 0–100
    publication: r.publicationName,
    quote: r.quote,
    date: r.date,
    url: r.url,
  }))] as const
}

const [total, reviews] = await get_critic_reviews("the-last-of-us", { sort: "score" })
console.log(`${total} critic reviews`)   // 98
console.log(JSON.stringify(reviews[0]))
// {"score":97,"publication":"GamingXP","quote":"Flawless in its ambition...","date":"..."}
```

### Get user reviews (paginated)

```ts
const API_KEY = "1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u"

async function get_user_reviews(slug: string, { media = "games", offset = 0, limit = 10, order_by = "score", order_type = "desc" } = {}) {
  // order_by: 'score' | 'date' | 'helpfulness'
  const url =
    `https://backend.metacritic.com/reviews/metacritic/user/${media}/${slug}/web`
    + `?offset=${offset}&limit=${limit}&orderBy=${order_by}&orderType=${order_type}`
    + `&componentName=top-user-reviews&componentType=UserReviewList&apiKey=${API_KEY}`
  const data = JSON.parse(await http_get(url))
  const total = data.data.totalResults   // e.g. 2983 for The Last of Us
  const items = data.data.items
  return [total, items.map((r: any) => ({
    score: r.score,   // int 0–10
    quote: r.quote,
    date: r.date,
    spoiler: r.spoiler ?? false,
  }))] as const
}

const [total, reviews] = await get_user_reviews("the-last-of-us")
console.log(`${total} user reviews`)   // 2983
```

### NUXT_DATA extraction (alternative, no API key)

If you need to avoid the backend API (e.g., the API key rotates), the HTML page embeds all score data in `<script id="__NUXT_DATA__">` as a flat pool with integer cross-references. This is more fragile but requires no API key:

```ts
const url = "https://www.metacritic.com/game/the-last-of-us/"
const html = await http_get(url)

const pool: any[] = JSON.parse(
  html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)<\/script>/s)![1]
)

const isInt = (x: any) => Number.isInteger(x)
const isDict = (x: any) => x !== null && typeof x === "object" && !Array.isArray(x)

function deref(pool: any[], idx: any, depth = 0, visited = new Set<number>()): any {
  if (!isInt(idx) || visited.has(idx) || depth > 4) return idx
  visited.add(idx)
  const val = pool[idx]
  if (isDict(val)) {
    return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, isInt(v) ? deref(pool, v, depth + 1, visited) : v]))
  } else if (Array.isArray(val) && val.length === 2 && typeof val[0] === "string" && ["Ref", "Reactive", "ShallowReactive", "ShallowRef"].includes(val[0])) {
    return deref(pool, val[1], depth + 1, visited)
  } else if (Array.isArray(val)) {
    return val.map((v) => (isInt(v) ? deref(pool, v, depth + 1, visited) : v))
  }
  return val
}

// Find components
const components_idx = pool.find(
  (v) => Array.isArray(v) && v.length > 3 && v.slice(0, 3).every(isInt)
    && isDict(pool[v[0]]) && "data" in pool[v[0]] && "meta" in pool[v[0]]
)

function find_component(pool: any[], name: string) {
  for (const val of pool) {
    if (!isDict(val) || !("data" in val) || !("meta" in val)) continue
    const meta = isInt(val.meta) ? pool[val.meta] : {}
    if (!isDict(meta)) continue
    const cname = isInt(meta.componentName) ? pool[meta.componentName] : ""
    if (cname === name) return deref(pool, val.data)
  }
  return null
}

const critic = find_component(pool, "critic-score-summary")
const user = find_component(pool, "user-score-summary")
console.log("Metascore:", critic.item.score)              // 95
console.log("Critic reviews:", critic.item.reviewCount)   // 98
console.log("User score:", user.item.score)               // 9.2
console.log("User reviews:", user.item.reviewCount)       // 17207
```

---

## URL slug patterns

Metacritic slugs are lowercased, spaces replaced with hyphens, special chars dropped:

| Title | Slug |
|-------|------|
| `The Last of Us` | `the-last-of-us` |
| `Baldur's Gate 3` | `baldurs-gate-3` |
| `Elden Ring: Shadow of the Erdtree` | `elden-ring-shadow-of-the-erdtree` |
| `Breaking Bad` | `breaking-bad` |
| `The Godfather` | `the-godfather` |

Derive slug from the page URL: everything between the media-type path and the trailing slash.

```ts
function slug_from_url(url: string) {
  // Works for /game/, /movie/, /tv/
  const m = url.match(/\/(?:game|movie|tv)\/([^/]+)\//)
  return m ? m[1] : null
}

slug_from_url("https://www.metacritic.com/game/the-last-of-us/")  // "the-last-of-us"
```

---

## Anti-bot measures

- **Cloudflare** is in front of both `metacritic.com` and `backend.metacritic.com` (confirmed via `CF-Ray` and `Server: cloudflare` headers).
- **Frontend pages** (`metacritic.com/*`): Require a non-empty User-Agent. `Mozilla/5.0` works. `python-requests/...` or empty UA returns HTTP 403.
- **Backend API** (`backend.metacritic.com`): Same rule — any non-empty User-Agent works, including `curl/7.84.0` and `python-requests/2.31.0`. Only truly empty UA gets 403.
- **Music pages** (`metacritic.com/music/*`): HTTP 403 even with valid User-Agent — Cloudflare blocks that path category. The backend API for music also 404s. Use the browser via CDP for music pages.
- **Cache**: Frontend pages are Cloudflare-cached (10 minute TTL, `Cache-Control: public, max-age=600`). Backend API responses are not cached (`CF-Cache-Status: MISS`).
- **No CAPTCHA** observed during testing with any of the approaches above.
- **No rate limit** hit during testing: 10 sequential calls at 3.6 calls/sec, 10 parallel calls in 0.68s — all succeeded.
- **PerimeterX**: Not detected in response headers or HTML.

---

## Gotchas

- **API key is embedded in every Metacritic page HTML** — find it by searching for `apiKey=` in `backend.metacritic.com` URLs. The key `1MOZgmNFxvmljaQR1X9KAij9Mo4xAY3u` was confirmed active as of 2026-04-18. If it rotates, fetch any Metacritic page and extract it: `html.match(/apiKey=([A-Za-z0-9]+)/)[1]`.

- **userScore is null in search results** — the `/finder/metacritic/search/` endpoint returns `userScore: null` for all results. Call the stats API separately with the slug to get user score + review count.

- **Metascore null means < 4 reviews** — the backend API returns `score: null` (not 0) when a title has fewer than 4 critic reviews. Always check `if (score !== null)` before using.

- **Multi-platform games: JSON-LD shows lead platform score** — for a game on PS5 and Xbox, `aggregateRating.ratingValue` in JSON-LD is the lead platform's score (the platform marked `isLeadPlatform: true` in the backend API). All platforms are listed in `gamePlatform` but without individual scores. Use the product API's `platforms` array for per-platform breakdown.

- **Music is blocked** — `metacritic.com/music/*` returns HTTP 403 even with a real browser User-Agent. The backend API for albums (`/albums/metacritic/...`) also returns 404. Music data requires a real browser session via CDP.

- **NUXT_DATA pool deref is fragile** — the pool structure is a flat array where every value is either a primitive or an integer index pointing elsewhere in the array. Component locations shift between page loads but the component names (`critic-score-summary`, `user-score-summary`) are stable.

- **`http_get` default UA is `Mozilla/5.0`** — this works for Metacritic. No need to override it.

- **Backend API `componentName` and `componentType` params are required** — omitting them returns HTTP 400. Use the exact values shown in the code examples above.

- **Finder `userScore` format**: In finder/browse results, `userScore` is `{"score": 9.1}` (a dict with just `score`). In the stats API, it's a full object with `reviewCount`, `sentiment`, etc. In search results, it's `null`.

- **Media type URL paths**: games=`/games/`, movies=`/movies/`, TV shows=`/shows/`. There is no `/tv/` path in the backend API (the frontend uses `/tv/` but the API uses `/shows/`).

- **Finder API does not support free-text search** — the `q=` param is silently ignored and returns 0 results. Use the `/finder/metacritic/search/{query}/web` endpoint for title search.

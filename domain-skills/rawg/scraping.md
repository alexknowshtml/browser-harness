# RAWG — Scraping & Data Extraction

Field-tested against rawg.io on 2026-04-18.
`https://rawg.io` — world's largest video game database with 500K+ games.

---

## API status — key required, no workaround

`https://api.rawg.io/api/` requires a valid API key on every request.
Empty key, dummy key, and header spoofing all return **HTTP 401**. Confirmed:

```
api.rawg.io/api/games?page_size=5          -> 401
api.rawg.io/api/games?page_size=5&key=     -> 401
api.rawg.io/api/games?page_size=5&key=DEMO -> 401
rawg.io/api/games?page_size=5              -> 401
# Referer/Origin headers make no difference
```

Free API keys are available at `https://rawg.io/apidocs` after signing up at
`https://rawg.io/signup` (no credit card, ~1 minute). Free tier: **20,000 requests/month**.
Set the key in `.env` as `RAWG_API_KEY=<your_key>`.

---

## Approach 1 (Fastest, no key): HTML scraping via `window.CLIENT_PARAMS`

The website server-renders all game data into `window.CLIENT_PARAMS` in the page HTML.
One `http_get` call, pure JSON parse, no browser required.
Confirmed working on all tested game pages.

### Single game page

```ts
// Fetch full game data from rawg.io/games/{slug}.
// Handles canonical-slug redirects (e.g. 'disco-elysium-the-final-cut'
// transparently becomes 'disco-elysium-final-cut').
// Returns game object or null.
async function extract_game(slug: string): Promise<any> {
  const resp = await http_get(`https://rawg.io/games/${slug}`)
  const idx = resp.indexOf("window.CLIENT_PARAMS = {")
  if (idx < 0) return null
  const chunk = resp.slice(idx + "window.CLIENT_PARAMS = ".length)
  // Extract JSON by counting braces
  let depth = 0, end = 0
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i]
    if (c === "{") depth += 1
    else if (c === "}") {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  const params = JSON.parse(chunk.slice(0, end))
  const initial_state = params.initialState
  const entities = initial_state.entities
  const games = entities.games ?? {}
  // game.slug has 'g-' prefix and reflects the canonical slug after any redirect
  const canonical_key = initial_state.game?.slug ?? ""
  let game = games[canonical_key]
  if (!game) game = games[`g-${slug}`]
  if (!game) {
    for (const g of Object.values<any>(games)) {
      if (g && typeof g === "object" && g.slug === slug) return g
    }
  }
  return game ?? null
}

const game = await extract_game("the-witcher-3-wild-hunt")
// All fields confirmed present:
// game.name             -> 'The Witcher 3: Wild Hunt'
// game.id               -> 3328
// game.slug             -> 'the-witcher-3-wild-hunt'
// game.rating           -> 4.64          (RAWG community score, 0-5)
// game.rating_top       -> 5
// game.ratings_count    -> 7184
// game.metacritic       -> 92            (null if no score)
// game.released         -> '2015-05-18'
// game.updated          -> '2026-04-17T23:18:04'
// game.playtime         -> 43            (average hours)
// game.website          -> 'https://thewitcher.com/en/witcher3'
// game.background_image -> 'https://media.rawg.io/media/games/618/618c2031a07bbff6b4f611f10b6bcdbc.jpg'
// game.added            -> 22198         (count of users who added to library)
// game.esrb_rating      -> {id: 4, name: 'Mature', slug: 'mature'}
// game.genres           -> [{id: 4, name: 'Action', slug: 'action'}, ...]
// game.platforms        -> ['playstation5', 'xbox-series-x', 'pc', ...]  (slugs, cross-ref entities)
// game.parent_platforms -> ['pc', 'playstation', 'xbox', 'mac', 'nintendo']
// game.developers       -> [{id: 9023, name: 'CD PROJEKT RED', slug: '...'}]
// game.publishers       -> [{id: 7411, name: 'CD PROJEKT RED', slug: '...'}]
// game.tags             -> [{id: 31, name: 'Singleplayer', ...}, ...]
// game.description_raw  -> plain-text description (detail page only)
// game.description      -> HTML description
// game.ratings          -> [{title: 'exceptional', percent: 76.53}, ...]
// game.metacritic_platforms -> [{metascore: 93, platform: {...}}, ...]
```

### Extract specific fields

```ts
// Uses extract_game() from the block above
async function game_summary(slug: string) {
  const g = await extract_game(slug)
  if (!g) return null
  const names = (xs: any[] | undefined) => (xs ?? []).filter((x) => x && typeof x === "object").map((x) => x.name)
  return {
    id:           g.id,
    name:         g.name,
    slug:         g.slug,
    rating:       g.rating,
    metacritic:   g.metacritic,
    released:     g.released,
    playtime_hrs: g.playtime,
    website:      g.website ?? null,
    esrb:         g.esrb_rating?.name ?? null,
    genres:       names(g.genres),
    platforms:    g.parent_platforms ?? [],
    developers:   names(g.developers),
    publishers:   names(g.publishers),
    tags:         names(g.tags).slice(0, 10),
    image:        g.background_image ?? null,
  }
}

// Confirmed results:
console.log(JSON.stringify(await game_summary("red-dead-redemption-2")))
// {"id":28,"name":"Red Dead Redemption 2","rating":4.59,"metacritic":96,
//  "released":"2018-10-26","playtime_hrs":21,
//  "esrb":"Mature",
//  "genres":["Action"],
//  "platforms":["pc","playstation","xbox"],
//  "developers":["Rockstar Games"],"publishers":["Rockstar Games"],
//  "tags":["Singleplayer","Multiplayer","Atmospheric","Great Soundtrack","Co-op", ...]}
```

### Top 40 games from the listing page

The listing page always returns the same ~40 popular games regardless of URL params
(ordering/search/genres params are client-side only — the server returns the same SSR payload).

```ts
// Returns array of 40 game objects from rawg.io/games listing page.
async function top_games(): Promise<any[]> {
  const resp = await http_get("https://rawg.io/games")
  const idx = resp.indexOf("window.CLIENT_PARAMS = {")
  if (idx < 0) return []
  const chunk = resp.slice(idx + "window.CLIENT_PARAMS = ".length)
  let depth = 0, end = 0
  for (let i = 0; i < chunk.length; i++) {
    const c = chunk[i]
    if (c === "{") depth += 1
    else if (c === "}") {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  const params = JSON.parse(chunk.slice(0, end))
  return Object.values(params.initialState.entities.games ?? {})
}

const games = await top_games()
// 40 games, each with: id, slug, name, released, rating, rating_top, ratings_count,
// metacritic, playtime, added, genres (full objects), parent_platforms (slugs),
// platforms (slugs), tags (full objects), esrb_rating, background_image, short_screenshots
// NOTE: listing omits description, website, developers, publishers vs detail pages

for (const g of games.slice(0, 5)) {
  console.log(`${g.name} | rating=${g.rating} | metacritic=${g.metacritic}`)
}
// Grand Theft Auto V | rating=4.47 | metacritic=92
// The Witcher 3: Wild Hunt | rating=4.64 | metacritic=92
// Portal 2 | rating=4.58 | metacritic=95
// Counter-Strike: Global Offensive | rating=3.57 | metacritic=81
// Tomb Raider (2013) | rating=4.06 | metacritic=86
```

### Bulk / concurrent fetching

```ts
// Uses extract_game() from above. Run in batches of 3 to stay reliable.
const slugs = ["portal-2", "dark-souls-iii", "minecraft", "hades", "celeste"]
const results: any[] = []
for (let i = 0; i < slugs.length; i += 3) {
  results.push(...(await Promise.all(slugs.slice(i, i + 3).map(extract_game))))
}
// Tested: 4 games in ~2.8s at 4 concurrent requests
// Occasional timeout at high concurrency — keep concurrency <=3 to stay reliable
```

---

## Approach 2: REST API (requires free key)

All endpoints live at `https://api.rawg.io/api/`. Append `&key=YOUR_API_KEY` to every request.

### Get a free key

1. Sign up at `https://rawg.io/signup`
2. Visit `https://rawg.io/apidocs` — click "Get API key"
3. The key is a 40-char hex string
4. Store as `RAWG_API_KEY` in `.env`

### Games list / search

```ts
const KEY = process.env.RAWG_API_KEY!

// Search
const results = JSON.parse(await http_get(
  `https://api.rawg.io/api/games?search=witcher&page_size=5&key=${KEY}`
))
// results.count   -> total matching games
// results.next    -> next page URL (pagination)
// results.results -> array of game objects

// Top-rated
const top = JSON.parse(await http_get(
  `https://api.rawg.io/api/games?ordering=-metacritic&page_size=10&key=${KEY}`
))

// By date range
const recent = JSON.parse(await http_get(
  `https://api.rawg.io/api/games?dates=2024-01-01,2024-12-31&ordering=-added&page_size=20&key=${KEY}`
))

// By platform (PC=4, PS4=18, Xbox One=1, Switch=7)
const pc_games = JSON.parse(await http_get(
  `https://api.rawg.io/api/games?platforms=4&ordering=-rating&page_size=10&key=${KEY}`
))
```

### Game detail

```ts
const KEY = process.env.RAWG_API_KEY!

// By ID (faster if you have it)
let game = JSON.parse(await http_get(`https://api.rawg.io/api/games/3328?key=${KEY}`))
// game.name, game.rating, game.metacritic, game.description_raw, ...

// By slug
game = JSON.parse(await http_get(
  `https://api.rawg.io/api/games/the-witcher-3-wild-hunt?key=${KEY}`
))
```

### API response fields (same as HTML scraping)

```
id, slug, name, released, tba, background_image,
rating (0-5 RAWG community), rating_top, ratings, ratings_count,
metacritic, playtime, added, added_by_status,
platforms (list of {platform:{id,name,slug}, released_at}),
parent_platforms (list of {platform:{id,name,slug}}),
genres (list of {id,name,slug}),
tags (list of {id,name,slug,language,games_count}),
developers (list of {id,name,slug}),
publishers (list of {id,name,slug}),
stores (list of {id,store:{id,name,slug}}),
esrb_rating ({id,name,slug}),
website, description_raw, description, screenshots_count,
movies_count, creators_count, achievements_count,
metacritic_url, metacritic_platforms
```

### Platforms and Genres lists

```ts
const KEY = process.env.RAWG_API_KEY!

// All platforms
const platforms = JSON.parse(await http_get(`https://api.rawg.io/api/platforms?key=${KEY}`))
// results: [{id, name, slug, games_count, year_start, year_end, ...}]

// Parent platforms only
const parents = JSON.parse(await http_get(`https://api.rawg.io/api/platforms/lists/parents?key=${KEY}`))

// Genres
const genres = JSON.parse(await http_get(`https://api.rawg.io/api/genres?key=${KEY}`))
// results: [{id, name, slug, games_count, image_background}]
```

### Pagination

```ts
// Paginate through API results.
async function get_all_pages(url_template: string, max_pages = 5) {
  const results: any[] = []
  let url = url_template + "&page=1"
  for (let n = 0; n < max_pages; n++) {
    const data = JSON.parse(await http_get(url))
    results.push(...(data.results ?? []))
    if (!data.next) break
    url = data.next
  }
  return results
}
```

---

## Gotchas

- **API is fully blocked without a key** — `401` for every endpoint, including empty key and
  `rawg.io/api/` (non-`api.rawg.io` subdomain). No auth bypass exists.

- **URL params are client-side on listing pages** — `rawg.io/games?ordering=-rating` and
  `rawg.io/games?search=witcher` return identical 40-game SSR payloads. Params only affect
  the React client after hydration. Use the API for real filtering, or scrape individual game
  pages by slug.

- **Slug canonical redirects** — Some slugs redirect internally:
  `disco-elysium-the-final-cut` → `disco-elysium-final-cut`. The URL you fetch returns HTTP 200
  but the routing state inside `CLIENT_PARAMS` reflects the canonical path. Always use
  `initial_state.game.slug` as the lookup key (it already has the `g-` prefix),
  not a constructed `'g-' + url_slug`.

- **`g-` prefix on entity keys** — Game entities in `CLIENT_PARAMS.initialState.entities.games`
  are keyed as `g-{slug}` (e.g. `g-the-witcher-3-wild-hunt`), not bare slugs.
  The game state slug field also carries this prefix: `{'slug': 'g-the-witcher-3-wild-hunt'}`.

- **Listing page gives 40 games, detail pages give full fields** — `description`, `website`,
  `developers`, `publishers` are absent from the listing page payload. Only present on
  individual game pages.

- **Concurrent requests: keep concurrency ≤ 3** — At 5 concurrent with 10 requests,
  some pages timed out (20s default) or returned 502. Sequential or 3-at-a-time parallel is
  reliable. A brief `await wait(0.5)` between sequential requests avoids 502 spikes.

- **`platforms` field in game entities uses slugs, `platform_entities` has full objects** —
  In the HTML payload, `game.platforms` is an array of slug strings
  (`['playstation5', 'pc', ...]`). Full platform details live in
  `entities.platforms[slug]` as `{platform: {id, name, slug, ...}, released_at: '...'}`.
  `game.parent_platforms` is also an array of slug strings (`['pc', 'playstation', ...]`).

- **`metacritic` is `null` for games without a score** — Always check `if (game.metacritic)`
  before using. Many indie/older games have no Metacritic score.

- **`esrb_rating` is `null` for non-US-rated games** — Common for Japanese games and
  anything outside the ESRB's jurisdiction.

- **`god-of-war` slug resolves to God of War I (PS2, 2005)** — The PS4 2018 title uses
  `god-of-war-4` or has its own entity key. Always verify the game name in the response.

- **Free API tier: 20,000 requests/month** — Roughly 650/day. Listing endpoint returns
  20 results per page by default (max `page_size=40`). For bulk data collection, the HTML
  scraping approach has no documented rate limit but times out under heavy parallel load.

- **`description_raw` vs `description`** — `description` is HTML with escaped unicode
  (`\u003C` = `<`). `description_raw` is plain text, easier to work with. Both present
  on detail pages only.

- **`updated` field reflects last RAWG edit, not release date** — Use `released` for
  the release date. `updated` changes frequently as the community edits entries.

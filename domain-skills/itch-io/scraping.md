# itch.io — Scraping & Data Extraction

Field-tested against itch.io on 2026-04-18. All code blocks validated with live requests.

---

## TL;DR — fastest approaches by task

| Task | Method | Notes |
|---|---|---|
| Browse listings (36/page) | `http_get` HTML | Works, no key, no bot block |
| Game detail (name, price, rating) | `http_get` + JSON-LD | `<script type="application/ld+json">` Product block |
| Info table (tags, genre, status) | `http_get` + regex on `game_info_panel_widget` | Always present |
| Top N games from any category | RSS `.xml` feed | Cleaner than HTML for bulk |
| API (key endpoints) | `http_get` + key in path | Free keys at itch.io/docs/api |
| Download/purchase counts | Not public | Owners only via dashboard |

`http_get` works on all itch.io game and browse pages with no extra headers needed.
No Cloudflare, no JS challenge, no CAPTCHA on standard game/browse routes.

---

## Approach 1 (Fastest for listings): RSS feeds — 36 games per call, clean XML

Every browse URL has an `.xml` RSS variant. Returns price, pub/update dates, platforms, thumbnail. No HTML parsing.

```ts
async function parse_rss(url: string) {
  /*
  Parse any itch.io RSS listing feed.
  url examples:
    https://itch.io/games/top-rated.xml
    https://itch.io/games/newest.xml
    https://itch.io/games/featured.xml
    https://itch.io/games/on-sale.xml
    https://itch.io/games/free.xml
    https://itch.io/games/tag-puzzle.xml    // any tag slug works
    https://itch.io/games/top-rated.xml?page=2
  */
  const xml = await http_get(url);
  const items: any[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const ix = m[1];
    const get = (tag: string, s = ix) => {
      const tm = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return tm ? tm[1].trim() : null;
    };
    const platforms: Record<string, boolean> = {};
    for (const k of ["windows", "osx", "linux", "android", "html"]) {
      if (get(k) !== null) platforms[k] = get(k) === "yes";
    }
    items.push({
      url:         get("guid"),
      title:       get("plainTitle"),          // clean title, no [tags]
      price:       get("price"),               // "$0.00", "$7.99", etc.
      currency:    get("currency"),            // "USD"
      pub_date:    get("pubDate"),
      update_date: get("updateDate"),
      image:       get("imageurl"),            // 315x250 thumbnail
      platforms,
    });
  }
  return items;
}

// Confirmed output:
const items = await parse_rss("https://itch.io/games/top-rated.xml");
// items[0] -> {
//   url:         'https://gbpatch.itch.io/our-life',
//   title:       'Our Life: Beginnings & Always',
//   price:       '$0.00',
//   currency:    'USD',
//   pub_date:    'Fri, 07 Jun 2019 23:47:57 GMT',
//   update_date: 'Sun, 22 May 2022 15:48:27 GMT',
//   image:       'https://img.itch.zone/aW1nLzcwMTIxNDMucG5n/315x250%23c/BalGQb.png',
//   platforms:   {windows: true, osx: true, linux: true, android: true},
// }
```

**RSS limitations:** no rating score or count. Use HTML scraping (Approach 2) when you need ratings.

---

## Approach 2: HTML listings — ratings, genre, price, 36 games per page

```ts
function parse_game_cards(html: string) {
  /*
  Extract all game cards from any itch.io browse/listing/search/profile HTML page.
  Works on:
    https://itch.io/games/top-rated
    https://itch.io/games/newest
    https://itch.io/games/featured
    https://itch.io/games/on-sale
    https://itch.io/games/free
    https://itch.io/games/tag-puzzle      (genre/tag path)
    https://itch.io/search?q=platformer   (search — 54 cards per page)
    https://<author>.itch.io              (author profile)
  All accept ?page=N for pagination.
  */
  const games: any[] = [];
  for (const m of html.matchAll(/data-game_id="(\d+)"/g)) {
    const game_id = m[1];
    const start = m.index!;
    const chunk = html.slice(start, start + 3000);

    // Title + URL — attribute order differs between page 1 and pages 2+
    let title_m = chunk.match(/class="title game_link"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/);
    if (!title_m) {
      title_m = chunk.match(/href="([^"]+)"[^>]*class="title game_link"[^>]*>([^<]+)<\/a>/);
    }

    const rating_m = chunk.match(/data-tooltip="([\d.]+) average rating from ([\d,]+) total ratings"/);
    const genre_m  = chunk.match(/class="game_genre">([^<]+)<\/div>/);
    const price_m  = chunk.match(/class="price_value">([^<]+)<\/div>/);
    const desc_m   = chunk.match(/class="game_text" title="([^"]+)"/);
    const img_m    = chunk.match(/data-lazy_src="([^"]+)"/);
    const platforms = [...chunk.matchAll(/title="Download for ([^"]+)"/g)].map((p) => p[1]);

    games.push({
      id:           game_id,
      url:          title_m ? title_m[1] : null,
      title:        title_m ? title_m[2].trim() : null,
      rating:       rating_m ? parseFloat(rating_m[1]) : null,
      rating_count: rating_m ? parseInt(rating_m[2].replaceAll(",", "")) : null,
      genre:        genre_m ? genre_m[1] : null,
      price:        price_m ? price_m[1] : "Free",
      description:  desc_m ? desc_m[1] : null,
      thumbnail:    img_m ? img_m[1] : null,
      platforms,      // ['Windows', 'macOS', 'Linux', 'Android']
    });
  }
  return games;
}

// Usage:
let html = await http_get("https://itch.io/games/top-rated");
let games = parse_game_cards(html);
// games[0] -> {
//   id: '434554', url: 'https://gbpatch.itch.io/our-life',
//   title: 'Our Life: Beginnings & Always',
//   rating: 4.94, rating_count: 7191,
//   genre: 'Visual Novel', price: 'Free',
//   platforms: ['Windows', 'Linux', 'macOS', 'Android'],
// }

// Paid game example:
html = await http_get("https://itch.io/games/top-rated?page=5");
games = parse_game_cards(html);
// Returns games where price_m captures '$7.99' when present
```

### CSS selector reference (for browser/JS use)

```
.game_cell                        — one card per game
.game_cell[data-game_id]          — get game ID from attribute
.game_cell .title.game_link       — title text + href
.game_cell .game_rating           — rating container
.game_cell .game_rating[data-tooltip]  — "4.94 average rating from 7,191 total ratings"
.game_cell .star_fill             — inline style width: NN% (rating as percentage of 5)
.game_cell .rating_count          — "(7,191)"
.game_cell .game_genre            — genre text
.game_cell .price_tag .price_value — price e.g. "$7.99" (absent = Free)
.game_cell .game_text             — one-line description (also in title attr)
.game_cell .game_author a         — author name + href
.game_cell img.lazy_loaded        — thumbnail (src in data-lazy_src before JS runs)
```

**Gotcha — attribute order flips on page >= 2.** Page 1 uses `class="..." data-game_id="..."`, page 2+ uses `data-game_id="..." class="..."`. The regex above handles both. If you use a CSS selector engine, `[data-game_id]` is unambiguous.

**Gotcha — ratings absent on some listing types.** The tag/genre browse pages (e.g. `/games/tag-puzzle`) sometimes omit the rating tooltip on the card even when the game has ratings. Fetch the detail page for the authoritative rating.

---

## Approach 3: Game detail page — JSON-LD Product schema

The cleanest source for individual game data. All confirmed fields:

```ts
async function extract_game_detail(url: string) {
  /*
  Fetch full metadata for a single itch.io game.
  url format: https://<author>.itch.io/<game-slug>
  */
  const html = await http_get(url);

  // --- JSON-LD (always present, covers name/description/price/rating) ---
  let ld_product: any = null;
  for (const b of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    const ld = JSON.parse(b[1].trim());
    if (ld["@type"] === "Product") {
      ld_product = ld;
      break;
    }
  }

  // --- Info panel table (Status, Platforms, Genre, Tags, Author, etc.) ---
  const info: Record<string, string | string[]> = {};
  const panel_m = html.match(/class="game_info_panel_widget[^"]*"[^>]*><table>([\s\S]*?)<\/table>/);
  if (panel_m) {
    for (const row of panel_m[1].matchAll(/<tr><td>([^<]+)<\/td><td>([\s\S]*?)<\/td><\/tr>/g)) {
      const key = row[1].trim();
      const val = row[2].replace(/<[^>]+>/g, "").trim();
      // Multi-value fields become lists (Tags, Platforms, Genre, Links)
      info[key] = val.includes(",") ? val.split(",").map((v) => v.trim()) : val;
    }
  }

  // --- Cover image ---
  const cover_m = html.match(/<meta property="og:image" content="([^"]+)"/);

  const offers = (ld_product ?? {}).offers ?? {};
  const agg    = (ld_product ?? {}).aggregateRating ?? {};

  return {
    url,
    name:         ld_product?.name ?? null,
    description:  ld_product?.description ?? null,
    price:        offers.price ?? null,          // "0.00" for free, "7.99" for paid
    currency:     offers.priceCurrency ?? null,  // "USD"
    rating:       agg.ratingValue ?? null,       // "4.9" string
    rating_count: agg.ratingCount ?? null,       // int
    cover:        cover_m ? cover_m[1] : null,
    info,
  };
}

// Free game:
let r = await extract_game_detail("https://gbpatch.itch.io/our-life");
// {
//   name: 'Our Life: Beginnings & Always',
//   description: 'Grow from childhood to adulthood with the lonely boy next door...',
//   price: null, currency: null,   <- no 'offers' block for free games
//   rating: '4.9', rating_count: 7191,
//   cover: 'https://img.itch.zone/aW1hZ2Uv.../347x500/7HqrvV.jpg',
//   info: {
//     Status:    'Released',
//     Platforms: ['Windows', 'macOS', 'Linux', 'Android'],
//     Rating:    'Rated 4.9 out of 5 stars(7,191 total ratings)',
//     Author:    'GBPatch',
//     Genre:     ['Visual Novel', 'Interactive Fiction'],
//     Tags:      ['Amare', 'Comedy', 'Dating Sim', 'Gay', 'LGBT', ...],
//     Links:     'Steam',
//   }
// }

// Paid game:
r = await extract_game_detail("https://adamgryu.itch.io/a-short-hike");
// {
//   name: 'A Short Hike',
//   price: '7.99', currency: 'USD',
//   rating: '4.9', rating_count: 4307,
//   info: {
//     Status:            'Released',
//     Platforms:         ['Windows', 'macOS', 'Linux'],
//     'Release date':    'Jul 30, 2019',
//     Genre:             ['Adventure', 'Platformer'],
//     'Made with':       'Unity',
//     Tags:              ['3D', 'Atmospheric', 'Cute', 'Relaxing', 'Short', ...],
//     'Average session': 'About an hour',
//     Languages:         ['English', 'Spanish; Latin America', 'French', ...],
//     Inputs:            ['Keyboard', 'Mouse', 'Xbox controller', ...],
//     Accessibility:     ['Subtitles', 'Configurable controls'],
//     Links:             ['Steam', 'Homepage', 'Soundtrack', 'Twitter/X'],
//   }
// }
```

**JSON-LD available fields:**

| Field | Free game | Paid game |
|---|---|---|
| `@type` | `Product` | `Product` |
| `name` | yes | yes |
| `description` | yes | yes |
| `aggregateRating.ratingValue` | yes | yes |
| `aggregateRating.ratingCount` | yes | yes |
| `offers.price` | absent | yes ("7.99") |
| `offers.priceCurrency` | absent | yes ("USD") |
| `offers.seller.name` | absent | yes (author name) |
| `offers.seller.url` | absent | yes (author profile URL) |

---

## Pagination

Browse pages: `?page=N`. Detect end of results by HTTP 404 (page too high) or absent `<link rel="next">`.

```ts
async function paginate_listing(base_url: string, max_pages = 10) {
  /*
  Scrape multiple pages from any itch.io browse URL.
  base_url: https://itch.io/games/top-rated  (no ?page= suffix)
  Returns flat list of game objects.
  Stops when HTTP 404 or no <link rel="next"> found.
  */
  const all_games: any[] = [];
  let page = 1;
  while (page <= max_pages) {
    const url = page === 1 ? base_url : `${base_url}?page=${page}`;
    let html: string;
    try {
      html = await http_get(url);
    } catch {
      break;   // 404 = past last page
    }
    all_games.push(...parse_game_cards(html));
    if (!/<link[^>]+rel="next"[^>]*\/>/.test(html)) break;
    page += 1;
  }
  return all_games;
}

// Confirmed: page 1 has <link href="?page=2" rel="next"/>
//            page 2 has <link rel="prev" href="/games/top-rated"/> and <link rel="next" href="?page=3"/>
//            past last page returns HTTP 404
// top-rated has at least 200 pages (each 36 games); page 300+ -> 404
```

---

## Browse URL patterns

All confirmed working via `http_get`:

```ts
const BASE = "https://itch.io/games";

// Sort orders
`${BASE}/top-rated`;      // all-time top rated (rated by community, 0–5 stars)
`${BASE}/newest`;         // most recently published
`${BASE}/featured`;       // itch.io staff picks
`${BASE}/on-sale`;        // discounted games
`${BASE}/free`;           // free games only

// Genre/tag paths (append .xml for RSS)
`${BASE}/tag-puzzle`;     // tag slug — prefix with 'tag-'
`${BASE}/genre-action`;   // genre — prefix with 'genre-' (less common)

// Combine: tag + sort via separate pages (no combined URL that survives http_get)
// Note: https://itch.io/games/top-rated/tag-puzzle -> HTTP 403
// Note: ?tag= query param does NOT filter server-side (returns same games)

// Pagination
`${BASE}/top-rated?page=2`;
`${BASE}/tag-puzzle?page=3`;

// RSS equivalents (36 items, no pagination needed for small sets)
`${BASE}/top-rated.xml`;
`${BASE}/tag-puzzle.xml`;
`${BASE}/tag-puzzle.xml?page=2`;

// Search (54 results/page, no server-side pagination beyond page 1 via http_get)
"https://itch.io/search?q=platformer";

// Author profile
"https://<author-slug>.itch.io";
```

---

## API (requires key)

itch.io has an official REST API. A free key is issued per-account with no rate limit published.
Get one at: `https://itch.io/user/settings/api-keys`

Base URL: `https://itch.io/api/1/<key>/`

```ts
const ITCH_KEY = "your_api_key_here";   // from https://itch.io/user/settings/api-keys

async function api(path: string) {
  return JSON.parse(await http_get(`https://itch.io/api/1/${ITCH_KEY}/${path}`));
}

// Authenticated user info
await api("me");
// -> {"user": {"id": ..., "username": "...", "url": "...", "display_name": "...", ...}}

// Games owned by authenticated user
await api("my-games");
// -> {"games": [{"id": ..., "title": "...", "url": "...", "created_at": "...",
//                "published": true/false, "min_price": 0, ...}, ...]}

// Download keys for a game (owner only)
await api("game/434554/download_keys");

// Credentials (for authenticated purchases)
await api("game/434554/credentials");
```

**Error structure:** invalid/missing key returns `{"errors": ["invalid key"]}` with HTTP 200.
Non-existent endpoints return HTTP 404.

**No unauthenticated game lookup API.** `https://itch.io/api/1/x/games` -> HTTP 404.
Use HTML scraping or RSS for unauthenticated game data.

---

## Gotchas

1. **Attribute order flips page 1 vs 2+.** On page 1, game cards use `class="game_cell ..." data-game_id="..."`. On pages 2+, the order is `data-game_id="..." class="game_cell ..."`. Always match `data-game_id` independently of class ordering.

2. **Ratings absent on tag/genre listing pages.** The `data-tooltip` with rating is often missing from card HTML on `/games/tag-*` pages even though the game has ratings. Fetch the detail page for `aggregateRating` via JSON-LD.

3. **`price_value` absent = Free.** Paid games have `<div class="price_tag meta_tag" title="Pay $7.99 or more..."><div class="price_value">$7.99</div></div>`. Free games have no such element. Default to `'Free'` when absent.

4. **Free-game JSON-LD has no `offers` block.** Only paid games include the `offers` object. For free games, use absence of `offers` as the signal, not presence of `price: 0`.

5. **`/games/top-rated/tag-puzzle` returns HTTP 403.** Cannot combine sort + tag in a path. Use separate `/games/tag-puzzle` (top-rated is the default sort anyway).

6. **`?tag=` query param is ignored server-side.** `https://itch.io/games/top-rated?tag=puzzle` returns the same games as `?top-rated`. Use `/games/tag-puzzle` path instead.

7. **Download/purchase counts are not public.** No count field appears anywhere in the public HTML, JSON-LD, RSS, or unauthenticated API. Game owners see their stats in the dashboard only.

8. **Search beyond page 1 is AJAX-only.** `https://itch.io/search?q=X&page=2` via `http_get` returns the same 54 results as page 1. To get more search results use the browser and scroll/click "load more".

9. **RSS is capped at 36 items per page.** Paginate with `?page=N`. Very high page numbers (300+) return HTTP 404 on browse pages.

10. **Unicode zero-width space in some titles.** `\u200b` (zero-width space) appears at the start of certain titles (e.g. "​Our Life: Beginnings & Always"). `.trim()` alone won't remove it — use `title.replaceAll('\u200b', '').trim()`.

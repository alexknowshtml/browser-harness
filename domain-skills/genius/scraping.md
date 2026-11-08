# Genius — Data Extraction

Field-tested against genius.com on 2026-04-18.
No authentication required for any approach documented here.

---

## Anti-Bot: http_get Fails, Custom UA Required

`http_get` uses `User-Agent: Mozilla/5.0` (bare string). Genius returns HTTP 403 for that UA on both HTML pages and internal API endpoints. Adding any OS token (e.g. `(Macintosh; Intel Mac OS X 10_15_7)`) immediately lifts the block — no cookies, no session, no JavaScript required.

```ts
/** Drop-in replacement for http_get on genius.com endpoints. */
async function genius_get(url: string, extra_headers: Record<string, string> | null = null): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip",
    ...(extra_headers ?? {}),
  };
  return http_get(url, headers);
}
```

Use `genius_get` everywhere in this document instead of bare `http_get`.

---

## Approach 1 (Fastest): Internal JSON API — No Auth, No Browser

Genius's own website calls `genius.com/api/*` (not `api.genius.com`) from
its server-side rendering layer. These endpoints are public and require only
a browser-like User-Agent. They return rich structured JSON in ~0.13s.

### Song metadata

```ts
async function genius_get(url: string, extra_headers: Record<string, string> | null = null): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip",
    ...(extra_headers ?? {}),
  };
  return http_get(url, headers);
}

/** Fetch full song metadata by Genius song ID. */
async function genius_song(song_id: number) {
  const data = JSON.parse(await genius_get(`https://genius.com/api/songs/${song_id}`));
  return data.response.song;
}

const song = await genius_song(1063);
// All fields available in one call (no auth):
// song.title                          → "Bohemian Rhapsody"
// song.full_title                     → "Bohemian Rhapsody by Queen"
// song.artist_names                   → "Queen"
// song.primary_artist.name            → "Queen"
// song.primary_artist.id              → 563
// song.primary_artist.url             → "https://genius.com/artists/Queen"
// song.release_date                   → "1975-10-31"
// song.release_date_for_display       → "October 31, 1975"
// song.release_date_components        → {"year": 1975, "month": 10, "day": 31}
// song.stats.pageviews                → 11067562
// song.stats.contributors             → 516
// song.stats.accepted_annotations     → 20
// song.pyongs_count                   → 703
// song.annotation_count               → 33
// song.comment_count                  → 253
// song.album.name                     → "Studio Collection"   (varies by region)
// song.albums[0].name                 → "A Night at the Opera"  (first = original)
// song.url                            → "https://genius.com/Queen-bohemian-rhapsody-lyrics"
// song.path                           → "/Queen-bohemian-rhapsody-lyrics"
// song.song_art_image_url             → "https://images.genius.com/718de9d..."
// song.explicit                       → false
// song.language                       → "en"
// song.lyrics_state                   → "complete"
// song.lyrics_verified                → false
// song.spotify_uuid                   → "7tFiyTwD0nx5a1eklYtX2J"
// song.youtube_url                    → "https://www.youtube.com/watch?v=fJ9rUzIMcZQ"
// song.writer_artists                 → [{"name": "Freddie Mercury", ...}]
// song.producer_artists               → [{"name": "Roy Thomas Baker"}, {"name": "Queen"}]
// song.featured_artists               → []

// Primary album (first in list = original release):
const primary_album = song.albums[0].name;   // "A Night at the Opera"
```

### Search

```ts
/** Search Genius. Returns sections: top_hit, song, lyric, artist, album, video, article, user. */
async function genius_search(query: string, per_page = 5): Promise<any[]> {
  const url = `https://genius.com/api/search/multi?per_page=${per_page}&q=${encodeURIComponent(query)}`;
  const data = JSON.parse(await genius_get(url));
  return data.response.sections;
}

const sections = await genius_search("Bohemian Rhapsody Queen", 5);
// sections is a list of objects with keys: "type", "hits"
// Each hit has: "type", "result"
// For type="song", result has: id, full_title, url, primary_artist, stats, ...

for (const section of sections) {
  if (section.type === "song") {
    for (const hit of section.hits) {
      const r = hit.result;
      console.log(r.full_title, r.url, r.id);
    }
    // Bohemian Rhapsody by Queen  https://genius.com/Queen-bohemian-rhapsody-lyrics  1063
    break;
  }
}

// Simpler search (song section only):
async function genius_search_songs(query: string, per_page = 5) {
  const sections = await genius_search(query, per_page);
  for (const s of sections) {
    if (s.type === "song") return s.hits.map((h: any) => h.result);
  }
  return [];
}
```

### Artist songs (paginated)

```ts
/** Fetch paginated list of songs for an artist. sort: 'popularity' or 'title'. */
async function* genius_artist_songs(artist_id: number, per_page = 20, sort = "popularity") {
  let page = 1;
  while (true) {
    const url = `https://genius.com/api/artists/${artist_id}/songs` +
      `?per_page=${per_page}&page=${page}&sort=${sort}`;
    const data = JSON.parse(await genius_get(url)).response;
    const songs = data.songs;
    if (!songs?.length) break;
    yield* songs;
    if (data.next_page == null) break;
    page = data.next_page;
  }
}

// Example: get top 5 Queen songs by popularity
let n = 0;
for await (const song of genius_artist_songs(563, 5)) {
  console.log(`${song.full_title} — ${song.stats.pageviews.toLocaleString("en-US")} views`);
  if (++n >= 5) break;
}
// Bohemian Rhapsody by Queen — 11,067,663 views
// Don't Stop Me Now by Queen — 2,453,240 views
// Under Pressure by Queen & David Bowie — 1,972,606 views
// Somebody to Love by Queen — 1,241,740 views
// Killer Queen by Queen — 1,146,813 views
```

---

## Approach 2: Lyrics from HTML — Regex on data-lyrics-container

The lyrics live in `<div data-lyrics-container="true">` elements on the song's
lyrics page. There are usually 3–5 such divs (the song is split across sections).
Each div can contain nested child divs for annotation highlights — including a
`data-exclude-from-selection="true"` header div that must be stripped first.

```ts
async function genius_get(url: string, extra_headers: Record<string, string> | null = null): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip",
    ...(extra_headers ?? {}),
  };
  return http_get(url, headers);
}

/** Strip all <div data-exclude-from-selection="true"> subtrees (contributor headers). */
function _remove_excluded_divs(html: string): string {
  while (true) {
    const idx = html.indexOf('data-exclude-from-selection="true"');
    if (idx === -1) break;
    const tag_start = html.lastIndexOf("<div", idx);
    let depth = 0, pos = tag_start, removed = false;
    while (pos < html.length) {
      if (html.startsWith("<div", pos)) {
        depth += 1; pos += 4;
      } else if (html.startsWith("</div>", pos)) {
        depth -= 1; pos += 6;
        if (depth === 0) {
          html = html.slice(0, tag_start) + html.slice(pos);
          removed = true;
          break;
        }
      } else {
        pos += 1;
      }
    }
    if (!removed) break;
  }
  return html;
}

/** Extract all <div> subtrees that contain the given attribute marker. */
function _extract_div_content(html: string, marker: string): string[] {
  const parts: string[] = [];
  let start = 0;
  while (true) {
    const idx = html.indexOf(marker, start);
    if (idx === -1) break;
    const tag_start = html.lastIndexOf("<div", idx);
    let depth = 0, pos = tag_start;
    while (pos < html.length) {
      if (html.startsWith("<div", pos)) {
        depth += 1; pos += 4;
      } else if (html.startsWith("</div>", pos)) {
        depth -= 1; pos += 6;
        if (depth === 0) {
          parts.push(html.slice(tag_start, pos));
          break;
        }
      } else {
        pos += 1;
      }
    }
    start = idx + 1;
  }
  return parts;
}

/** Convert lyrics HTML to plain text, preserving line breaks. */
function _html_to_text(html_str: string): string {
  let text = html_str.replace(/<br\s*\/?>/g, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'").replaceAll("&quot;", '"').replaceAll("&#x27;", "'")
    .replaceAll("&#x2F;", "/").replaceAll("&nbsp;", " ");
  // Collapse multiple blank lines to one
  const lines = text.split("\n").map((l) => l.trim());
  const result: string[] = [];
  let prev_blank = false;
  for (const line of lines) {
    if (!line) {
      if (!prev_blank) result.push("");
      prev_blank = true;
    } else {
      result.push(line);
      prev_blank = false;
    }
  }
  return result.join("\n").trim();
}

/**
 * Scrape lyrics from a Genius song URL.
 *
 * url: the canonical lyrics URL, e.g. 'https://genius.com/Queen-bohemian-rhapsody-lyrics'
 * Returns: plain-text lyrics string with section headers like [Verse 1], [Chorus].
 */
async function genius_lyrics(url: string): Promise<string> {
  const html = await genius_get(url);
  const cleaned = _remove_excluded_divs(html);
  const containers = _extract_div_content(cleaned, 'data-lyrics-container="true"');
  const parts: string[] = [];
  for (const c of containers) {
    const text = _html_to_text(c).trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

const lyrics = await genius_lyrics("https://genius.com/Queen-bohemian-rhapsody-lyrics");
// Returns 2076 chars, 62 lines, structured as:
// [Intro]
// Is this the real life? Is this just fantasy?
// Caught in a landslide, no escape from reality
// ...
// [Verse 1]
// Mama, just killed a man
// ...
// [Outro]
// Nothing really matters to me
// Any way the wind blows
```

**Performance:** Lyrics page is ~1.2 MB. One `genius_get` call takes ~0.18s.
No rate limiting observed across 10 rapid sequential requests.

---

## Approach 3: Combined Workflow — Metadata + Lyrics

The fastest complete extraction pattern: one API call for all metadata,
one HTML call for lyrics. Song ID can be derived several ways.

```ts
async function genius_get(url: string, extra_headers: Record<string, string> | null = null): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip",
    ...(extra_headers ?? {}),
  };
  return http_get(url, headers);
}

/**
 * Extract Genius song ID from a lyrics page URL.
 * Returns null if not determinable — fall back to search.
 */
async function genius_song_id_from_url(lyrics_url: string): Promise<number | null> {
  // Not possible from the slug alone; must fetch the page or use search.
  // From the HTML: <meta content="genius://songs/{id}" name="twitter:app:url:iphone">
  const html = await genius_get(lyrics_url);
  const m = html.match(/content="genius:\/\/songs\/(\d+)"/);
  return m ? parseInt(m[1], 10) : null;
}

/** Search for a song, return metadata + lyrics in two HTTP calls. */
async function genius_full(query: string) {
  // Call 1: search for song
  const sections = JSON.parse(
    await genius_get(`https://genius.com/api/search/multi?per_page=3&q=${encodeURIComponent(query)}`),
  ).response.sections;
  let song_result: any = null;
  for (const s of sections) {
    if (s.type === "song" && s.hits.length) {
      song_result = s.hits[0].result;
      break;
    }
  }
  if (!song_result) return null;

  const song_id = song_result.id;
  const lyrics_url = song_result.url;

  // Call 2: full metadata from internal API
  const meta = JSON.parse(await genius_get(`https://genius.com/api/songs/${song_id}`)).response.song;

  // Call 3: lyrics from HTML
  const lyrics = await genius_lyrics(lyrics_url);   // uses the function from Approach 2

  return {
    id:           meta.id,
    title:        meta.title,
    artist:       meta.primary_artist.name,
    artist_id:    meta.primary_artist.id,
    album:        meta.albums?.length ? meta.albums[0].name : null,
    release_date: meta.release_date,           // "1975-10-31"
    pageviews:    meta.stats.pageviews,        // 11067562
    contributors: meta.stats.contributors,     // 516
    writers:      meta.writer_artists.map((a: any) => a.name),
    producers:    meta.producer_artists.map((a: any) => a.name),
    spotify_uuid: meta.spotify_uuid,
    youtube_url:  meta.youtube_url,
    song_art_url: meta.song_art_image_url,
    lyrics_url:   meta.url,
    lyrics,
  };
}

const result = await genius_full("Queen Bohemian Rhapsody");
// {
//   "id":           1063,
//   "title":        "Bohemian Rhapsody",
//   "artist":       "Queen",
//   "artist_id":    563,
//   "album":        "A Night at the Opera",
//   "release_date": "1975-10-31",
//   "pageviews":    11067562,
//   "contributors": 516,
//   "writers":      ["Freddie Mercury"],
//   "producers":    ["Roy Thomas Baker", "Queen"],
//   "spotify_uuid": "7tFiyTwD0nx5a1eklYtX2J",
//   "youtube_url":  "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
//   "song_art_url": "https://images.genius.com/718de9d1fbcaae9f3c9b1bf483bfa8f1.1000x1000x1.png",
//   "lyrics_url":   "https://genius.com/Queen-bohemian-rhapsody-lyrics",
//   "lyrics":       "[Intro]\nIs this the real life?..."
// }
```

---

## URL and ID Patterns

| Resource    | URL pattern                                   | Notes                            |
|-------------|-----------------------------------------------|----------------------------------|
| Song page   | `genius.com/{Artist}-{song-slug}-lyrics`      | Slug is lowercased, hyphenated   |
| Artist page | `genius.com/artists/{Artist}`                 | Title-cased artist name          |
| Album page  | `genius.com/albums/{Artist}/{album-slug}`     |                                  |
| Song API    | `genius.com/api/songs/{id}`                   | Internal; no auth required       |
| Artist API  | `genius.com/api/artists/{id}`                 | Internal; no auth required       |
| Artist songs| `genius.com/api/artists/{id}/songs?...`       | per_page, page, sort params      |
| Search API  | `genius.com/api/search/multi?per_page=N&q=...`| Internal; multi-section results  |

**Extracting song ID from a known lyrics URL:**

```ts
// The slug alone cannot be decoded to an ID. Must fetch HTML or search.
// From lyrics page HTML (fastest — one line):
let song_id = html.match(/content="genius:\/\/songs\/(\d+)"/)![1];

// Or from __PRELOADED_STATE__ (same page, equally reliable):
song_id = html.match(/\\"song\\":\s*(\d+)/)![1];

// Or from search API (no HTML required):
const sections = JSON.parse(await genius_get(`https://genius.com/api/search/multi?per_page=1&q=${encodeURIComponent(query)}`));
// then walk sections for type="song"
```

---

## What Requires a Browser

The following are **not available** via `genius_get` / HTTP:

- **Search results page** (`/search?q=...`): renders client-side only. The
  returned HTML contains no song results matching the query. Use the internal
  search API (`/api/search/multi`) instead — it works without a browser.

- **Public API** (`api.genius.com`): returns HTTP 401 without a Bearer token
  even with a browser-like User-Agent. Must register at genius.com/developers
  to obtain a client access token. The internal site API (`genius.com/api/*`)
  is the no-auth alternative and returns equivalent data.

- **Annotations content**: annotation HTML is embedded in `__PRELOADED_STATE__`
  but the JSON is multi-escaped (six levels of backslash nesting) and cannot
  be reliably parsed with plain string operations. Annotation IDs are
  available but their body text is not easily extractable.

- **Login-gated features**: user library, personalization, editor tools.

---

## Public API (api.genius.com) — Requires Bearer Token

If you have a token (free registration at genius.com/developers):

```ts
/** Call the official public API. path example: '/songs/1063' */
async function genius_api(path: string, token: string) {
  const url = `https://api.genius.com${path}`;
  return JSON.parse(await http_get(url, { "Authorization": `Bearer ${token}` }));
}

// Returns same structure as the internal /api/* endpoints.
// Endpoints: /songs/{id}, /artists/{id}, /artists/{id}/songs, /search?q=...
// Without a token: HTTP 401 with body:
// {"meta": {"status": 401, "message": "This call requires an access_token..."}}
```

---

## Gotchas

- **`http_get` returns 403**: The default `User-Agent: Mozilla/5.0` (bare) is
  blocked. Add any OS string — `(Macintosh; Intel Mac OS X 10_15_7)` is
  sufficient. Use the `genius_get` wrapper from this document.

- **`data-lyrics-container` split across 3–5 divs**: Don't look for a single
  lyrics block. Use `_extract_div_content` on all occurrences, then join.
  Empty containers (`<div ...></div>`, 87 bytes) appear between sections —
  the `if (text)` guard skips them cleanly.

- **`data-exclude-from-selection` header in first container**: The first
  lyrics container includes a contributor credit header div. It must be
  stripped before text extraction or the output will begin with
  `"516 ContributorsTranslations..."` instead of `"[Intro]"`.

- **`album` field vs `albums[0]`**: `song.album` is the "primary" album
  used by Genius's album link (often a compilation or reissue). `song.albums[0]`
  is the first album in the full list and is typically the original release.
  Verified: for Bohemian Rhapsody, `album.name` = "Studio Collection" but
  `albums[0].name` = "A Night at the Opera".

- **`__PRELOADED_STATE__` is not parseable**: The state is embedded as
  `JSON.parse('...')` where the inner JSON is escaped six levels deep
  (`\\\\\"` for a literal quote inside HTML content). Standard string
  replacement fails due to `\\'` and `\$` sequences. Don't try to parse it —
  use the `/api/songs/{id}` endpoint instead.

- **No `__NEXT_DATA__`**: Genius does not use Next.js. There is no
  `<script id="__NEXT_DATA__">` on any page.

- **No JSON-LD**: Genius does not emit `<script type="application/ld+json">`.
  Open Graph tags are present but minimal (only `og:title`, `og:image`,
  `og:description`, `og:url`, `og:type`). Use the API for structured data.

- **Search page is client-side only**: `GET /search?q=...` returns an HTML
  shell with ~5 unrelated song links (trending, not query-matched). The actual
  search results are fetched client-side by JavaScript. Use `/api/search/multi`
  instead — it works without a browser and returns properly filtered results.

- **Rate limiting**: No rate limiting observed across 10 rapid sequential
  requests to `/api/songs/{id}` (avg 0.13s/request). Song lyrics pages
  average 0.18s. No Retry-After headers observed.

- **Cloudflare**: Present (confirmed by `<meta itemprop="cf-country">` and
  `cf-cache-status` tags), but in pass-through mode — no JS challenge, no
  CAPTCHA. A browser-like User-Agent is all that's needed.

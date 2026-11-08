# Spotify — Data Extraction

Field-tested against open.spotify.com on 2026-04-18.
No authentication required for any approach documented here.

---

## Approach 1 (Fastest): oEmbed API — No Auth, No Browser

`https://open.spotify.com/oembed?url=<resource_url>`

Returns JSON in ~0.25s. Works for tracks, albums, playlists, and artists. Does **not** work for episodes/shows.

```ts
async function spotify_oembed(resource_type: string, resource_id: string) {
  // Fetch oEmbed metadata for a Spotify resource.
  // resource_type: 'track', 'album', 'playlist', or 'artist'
  // resource_id:   Spotify ID (22-char alphanumeric)
  const resource_url = `https://open.spotify.com/${resource_type}/${resource_id}`
  const url = `https://open.spotify.com/oembed?url=${resource_url}`
  const data = JSON.parse(await http_get(url))
  return data
}

// Example: track
const track = await spotify_oembed("track", "4PTG3Z6ehGkBFwjybzWkR8")
// {
//   "title":           "Never Gonna Give You Up",
//   "thumbnail_url":   "https://image-cdn-ak.spotifycdn.com/image/ab67616100005174...",
//   "thumbnail_width": 320,
//   "thumbnail_height": 320,
//   "type":            "rich",
//   "html":            "<iframe ...src=\"https://open.spotify.com/embed/track/4PTG3Z6...\"...>",
//   "iframe_url":      "https://open.spotify.com/embed/track/4PTG3Z6ehGkBFwjybzWkR8?utm_source=oembed",
//   "width":           456,
//   "height":          152,
//   "version":         "1.0",
//   "provider_name":   "Spotify",
//   "provider_url":    "https://spotify.com"
// }

// Artist (height is 352 — taller widget)
const artist = await spotify_oembed("artist", "0gxyHStUsqpMadRV0Di1Qt")
// title="Rick Astley", thumbnail_url=<artist photo URL>

// Album
const album = await spotify_oembed("album", "4LH4d3cOWNNsVw41Gqt2kv")
// title="The Dark Side of the Moon", thumbnail_url=<album art URL>

// Playlist
const pl = await spotify_oembed("playlist", "37i9dQZF1DXcBWIGoYBM5M")
// title="Today's Top Hits", thumbnail_url=<playlist cover URL>
```

### Bulk fetching (Promise.all)

```ts
const track_ids = [
  "4PTG3Z6ehGkBFwjybzWkR8",
  "7qiZfU4dY1lWllzX7mPBI3",
  "0VjIjW4GlUZAMYd2vXMi3b",
]

async function fetch_oembed(tid: string) {
  const url = `https://open.spotify.com/oembed?url=https://open.spotify.com/track/${tid}`
  try {
    return JSON.parse(await http_get(url))
  } catch (e) {
    return { error: String(e), id: tid }
  }
}

const results = await Promise.all(track_ids.map(fetch_oembed))
// 5 tracks: ~1.3s total, ~0.26s per track
```

---

## Approach 2: Static HTML — Rich Metadata via http_get

Every open.spotify.com page (track, album, playlist, artist) serves full HTML with no JS requirement. The HTML contains JSON-LD and Open Graph tags that provide structured data.

### Track page — all extractable fields

```ts
async function scrape_track(track_id: string) {
  const url = `https://open.spotify.com/track/${track_id}`
  const html = await http_get(url)

  // ---- JSON-LD (most structured) ----
  const ld_raw = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)
  const ld: any = ld_raw ? JSON.parse(ld_raw[1]) : {}

  // ---- Open Graph / music: meta tags ----
  const metas: Record<string, string> = {}
  for (const m of html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g)) {
    const [key, val] = [m[1], m[2]]
    if (!(key in metas)) metas[key] = val
  }

  const musician_urls = [...html.matchAll(/<meta\s+(?:property|name)="music:musician"\s+content="([^"]*)"/g)].map((m) => m[1])
  const allowed_countries = [...html.matchAll(/<meta\s+property="og:restrictions:country:allowed"\s+content="([^"]*)"/g)].map((m) => m[1])

  return {
    title:          metas["og:title"] ?? null,
    artist:         metas["music:musician_description"] ?? null,
    artist_urls:    musician_urls,                       // spotify artist page URLs
    album_url:      metas["music:album"] ?? null,        // spotify album page URL
    track_number:   metas["music:album:track"] ?? null,
    duration_s:     parseInt(metas["music:duration"] ?? "0", 10),
    release_date:   metas["music:release_date"] ?? null, // YYYY-MM-DD
    cover_art:      metas["og:image"] ?? null,           // 640px JPG
    audio_preview:  metas["og:audio"] ?? null,           // 30s MP3 (may be null)
    spotify_url:    metas["og:url"] ?? null,
    description:    metas["og:description"] ?? null,
    eligible_regions: allowed_countries,
    ld_name:        ld.name ?? null,
    ld_date:        ld.datePublished ?? null,
  }
}

// Tested on track/4PTG3Z6ehGkBFwjybzWkR8 (Never Gonna Give You Up):
// {
//   "title":         "Never Gonna Give You Up",
//   "artist":        "Rick Astley",
//   "artist_urls":   ["https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt"],
//   "album_url":     "https://open.spotify.com/album/6eUW0wxWtzkFdaEFsTJto6",
//   "track_number":  "1",
//   "duration_s":    214,
//   "release_date":  "1987-11-12",
//   "cover_art":     "https://i.scdn.co/image/ab67616d0000b27315ebbedaacef61af244262a8",
//   "audio_preview": "https://p.scdn.co/mp3-preview/b4c682084c3fd05538726d0a126b7e14b6e92c83",
//   "spotify_url":   "https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8",
//   "eligible_regions": [185 country codes],
// }
```

### Artist page — fields available

```ts
async function scrape_artist(artist_id: string) {
  const url = `https://open.spotify.com/artist/${artist_id}`
  const html = await http_get(url)

  const ld_raw = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)
  const ld: any = ld_raw ? JSON.parse(ld_raw[1]) : {}

  const metas: Record<string, string> = {}
  for (const m of html.matchAll(/<meta\s+(?:property|name)="([^"]+)"\s+content="([^"]*)"/g)) {
    if (!(m[1] in metas)) metas[m[1]] = m[2]
  }

  return {
    name:              metas["og:title"] ?? null,
    monthly_listeners: metas["og:description"] ?? null,  // "Artist · 6.7M monthly listeners."
    image:             metas["og:image"] ?? null,         // full-size artist photo
    spotify_url:       metas["og:url"] ?? null,
    description:       ld.description ?? null,
  }
}

// Tested on Rick Astley (artist/0gxyHStUsqpMadRV0Di1Qt):
// {
//   "name":              "Rick Astley",
//   "monthly_listeners": "Artist · 6.7M monthly listeners.",
//   "image":             "https://i.scdn.co/image/ab6761610000e5ebe834a63a0cfa3c0f57a9a434",
// }
```

---

## Approach 3: Embed Page — Structured JSON with Track Lists

`https://open.spotify.com/embed/{type}/{id}` returns a small Next.js SSR page. Its `__NEXT_DATA__` script tag contains a fully-parsed entity object. This is the only no-auth route that returns track listings for albums, playlists, and artists.

```ts
async function scrape_embed(resource_type: string, resource_id: string) {
  // resource_type: 'track', 'album', 'playlist', or 'artist'
  // Returns the entity object from __NEXT_DATA__.
  const url = `https://open.spotify.com/embed/${resource_type}/${resource_id}`
  const html = await http_get(url)
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  const data = JSON.parse(m![1])
  return data.props.pageProps.state.data.entity
}

// ---- TRACK ----
let entity = await scrape_embed("track", "4PTG3Z6ehGkBFwjybzWkR8")
// entity keys: type, name, uri, id, title, artists, releaseDate, duration,
//              isPlayable, isExplicit, audioPreview, hasVideo, visualIdentity
// {
//   "name":     "Never Gonna Give You Up",
//   "uri":      "spotify:track:4PTG3Z6ehGkBFwjybzWkR8",
//   "artists":  [{"name": "Rick Astley", "uri": "spotify:artist:0gxyHStUsqpMadRV0Di1Qt"}],
//   "duration": 213573,   // milliseconds
//   "releaseDate": {"isoString": "1987-11-12T00:00:00Z"},
//   "isPlayable": true,
//   "isExplicit": false,
//   "audioPreview": {"url": "https://p.scdn.co/mp3-preview/b4c682..."},
//   "visualIdentity": {
//     "image": [
//       {"url": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02...", "maxWidth": 300, "maxHeight": 300},
//       {"url": "https://image-cdn-fa.spotifycdn.com/image/ab67616d000048...", "maxWidth": 64,  "maxHeight": 64},
//       {"url": "https://image-cdn-fa.spotifycdn.com/image/ab67616d0000b27...", "maxWidth": 640, "maxHeight": 640},
//     ]
//   }
// }

// ---- ALBUM (includes full track list) ----
entity = await scrape_embed("album", "6fu8fvc7O4p8Gb8KMTBTUW")
// entity.trackList — array of all album tracks, e.g. 12 items:
// [{
//   "uri":          "spotify:track:4e1zdmsDwNBNe9rk7HHC0i",
//   "title":        "Prelude for Piano No. 1 in E-Flat Major",
//   "subtitle":     "Eduard Abramyan, Sona Shaboyan",
//   "duration":     107426,
//   "isPlayable":   true,
//   "audioPreview": {"url": "https://p.scdn.co/mp3-preview/d03c37..."},
//   "entityType":   "track"
// }, ...]

// ---- PLAYLIST (includes up to 50 tracks) ----
entity = await scrape_embed("playlist", "37i9dQZF1DXcBWIGoYBM5M")
// entity.trackList — 50 items
// entity.subtitle  — "Spotify"
// entity.authors   — [{"name": "Spotify"}]

// ---- ARTIST (includes top 10 tracks) ----
entity = await scrape_embed("artist", "0gxyHStUsqpMadRV0Di1Qt")
// entity.trackList — 10 top tracks, same shape as album trackList
// entity.subtitle  — "Top tracks"
```

### Bonus: Anonymous access token (embedded in every embed page)

The embed page SSR data includes a short-lived anonymous Spotify Web Player access token. The token is valid (~1 hour) but **anonymous tokens are severely rate-limited for api.spotify.com/v1 calls** (observed `Retry-After: 79561` seconds on the tracks endpoint after a few requests).

```ts
async function get_embed_token(resource_type = "track", resource_id = "4PTG3Z6ehGkBFwjybzWkR8") {
  // Extract the anonymous access token from an embed page.
  const url = `https://open.spotify.com/embed/${resource_type}/${resource_id}`
  const html = await http_get(url)
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  const data = JSON.parse(m![1])
  const session = data.props.pageProps.state.settings.session
  return {
    access_token:  session.accessToken,
    expires_ms:    session.accessTokenExpirationTimestampMs,
    is_anonymous:  session.isAnonymous,          // always true
    client_id:     data.props.pageProps.config.clientId,
  }
}

// Returned fields (verified 2026-04-18):
// access_token: "BQBfxv..." (a standard Spotify Bearer token, ~160 chars)
// expires_ms:   1776512455031 (~1 hour TTL)
// is_anonymous: true
// client_id:    "ab9ad0d96a624805a7d51e8868df1f97"

// WARNING: Do NOT use this token to hammer api.spotify.com/v1 — anonymous tokens
// share a global rate-limit bucket. One call can trigger a 22-hour ban window.
// Use the embed page __NEXT_DATA__ directly instead (Approach 3 above).
```

---

## What Requires a Browser

The following are **not accessible** via http_get and require the CDP browser:

- Lyrics (login-gated; JSON-LD confirms: `isAccessibleForFree: false`)
- Search (`/search?q=...`) — loads client-side only, no meaningful HTML on first response
- User library / listening history — requires OAuth
- Full audio playback — requires OAuth + Widevine DRM
- Podcast episodes — oEmbed returns 404; embed page `__NEXT_DATA__` lacks `state.data.entity`
- Track recommendations beyond the top-10 artist view
- Artist discography / full album list

If browser access is needed for search:

```ts
await goto("https://open.spotify.com/search")
await wait_for_load()
await wait(2)
// Type into the search box
await js("document.querySelector('input[data-testid=\"search-input\"]').focus()")
await type_text("never gonna give you up")
await wait(1)
// Results appear in [data-testid="top-results-card"] or similar dynamic selectors
```

---

## URL Patterns

| Resource  | URL pattern                                    | ID format         |
|-----------|------------------------------------------------|-------------------|
| Track     | `https://open.spotify.com/track/{id}`          | 22-char alphanum  |
| Album     | `https://open.spotify.com/album/{id}`          | 22-char alphanum  |
| Artist    | `https://open.spotify.com/artist/{id}`         | 22-char alphanum  |
| Playlist  | `https://open.spotify.com/playlist/{id}`       | 22-char alphanum  |
| oEmbed    | `https://open.spotify.com/oembed?url={resource_url}` | any of above |
| Embed     | `https://open.spotify.com/embed/{type}/{id}`   | same ID           |

Extract Spotify ID from any URL:

```ts
function spotify_id(url: string) {
  const m = url.match(/spotify\.com\/(?:embed\/)?(?:track|album|artist|playlist)\/([A-Za-z0-9]{22})/)
  return m ? m[1] : null
}
```

---

## Gotchas

- **oEmbed 404 for valid IDs**: A 404 from oEmbed can mean the resource is region-locked or not available for embedding, not necessarily that the ID is wrong. Verified: track `3n3Ppam7vgaVa1iaRUIOKE` returns 404 on oEmbed despite existing on Spotify.
- **oEmbed 404 for artists**: Only works with valid, existing artist IDs. The artist ID `4gzpq5DumSF1a1LpGLBBl5` returns 404 — verify IDs from canonical Spotify URLs before using.
- **oEmbed does not support episodes**: `open.spotify.com/episode/{id}` always returns 404 from the oEmbed endpoint.
- **Embed page for episodes**: The embed page SSR for episodes does not include `state.data.entity` in the expected structure — parse defensively.
- **Anonymous token rate limiting**: The access token from embed pages is valid but severely rate-limited for `api.spotify.com/v1`. Observed `Retry-After: 79561` (~22 hours) after 2-3 rapid API calls. Use embed `__NEXT_DATA__` data instead of the API.
- **`get_access_token` endpoint blocked**: `https://open.spotify.com/get_access_token?reason=transport&productType=web_player` returns HTTP 403 from plain http_get regardless of headers. Token must be sourced from the embed page HTML.
- **`music:musician` meta tag dedup**: `[...html.matchAll(...)]` on `music:musician` returns all artist URLs. Collapsing the matches into a single key/value object would keep only one — always collect every match for multi-value tags.
- **Cover art CDN differences**: oEmbed thumbnail uses `image-cdn-ak.spotifycdn.com`; track page `og:image` uses `i.scdn.co`. Both are publicly accessible. The embed `visualIdentity.image` array provides three sizes (64, 300, 640).
- **No `__NEXT_DATA__` on main open.spotify.com pages**: The SSR `__NEXT_DATA__` pattern only works on `open.spotify.com/embed/*`, not on main track/album/artist pages. Those pages use JSON-LD and Open Graph tags instead.
- **Track duration units differ**: `music:duration` meta tag is in **seconds** (integer). Embed `__NEXT_DATA__` `entity.duration` is in **milliseconds**.
- **Rate limits for http_get pages**: No rate limit observed on oEmbed or static HTML pages in testing (10 concurrent requests succeeded; ~0.25s avg per oEmbed call).

# MusicBrainz — Data Extraction

`https://musicbrainz.org` — open music encyclopedia with a fully free JSON API.
No auth required for reads. No browser needed for any documented workflow.

Field-tested against musicbrainz.org on 2026-04-18.

---

## Do this first

**The MusicBrainz Web Service API (ws/2) returns clean JSON for all entity types — no browser needed.**

```ts
// REQUIRED: every request must include this header or you get HTTP 403
const UA = {"User-Agent": "browser-harness/1.0 (your@email.com)"};

const data = JSON.parse(await http_get("https://musicbrainz.org/ws/2/artist/?query=queen&fmt=json&limit=5", UA));
for (const a of data.artists) {
  console.log(a.id, a.name, a.type, a.country, a.score);
}
// 0383dadf-2a4e-4d10-a46a-e9e041da8eb3  Queen  Group  GB  100
// 79239441-bfd5-4981-a70c-55c3f15c1287  Madonna  Person  US  73
```

`User-Agent` is **mandatory** — omitting it returns HTTP 403 immediately. Format: `AppName/Version (contact@email.com)`.

---

## Entity types

| Entity | Endpoint | Key fields |
|---|---|---|
| `artist` | `/ws/2/artist/` | name, sort-name, type (Group/Person/Orchestra/Choir), country, life-span, tags, rating |
| `release-group` | `/ws/2/release-group/` | title, primary-type (Album/Single/EP/Other), first-release-date |
| `release` | `/ws/2/release/` | title, date, country, status (Official/Bootleg/Promotional), barcode, label-info, media |
| `recording` | `/ws/2/recording/` | title, length (milliseconds), artist-credit, releases |
| `label` | `/ws/2/label/` | name, type, country, area |
| `work` | `/ws/2/work/` | title, type (Song/Aria/Soundtrack/etc.), relations |

All entities share the same MBID (MusicBrainz ID) format: UUID v4, e.g. `0383dadf-2a4e-4d10-a46a-e9e041da8eb3`.

---

## Common workflows

### Artist search

```ts
const UA = {"User-Agent": "browser-harness/1.0 (your@email.com)"};

const resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/artist/?query=queen&fmt=json&limit=5",
  UA
));
// resp keys: count (total matches), offset, artists (list)
for (const a of resp.artists) {
  console.log(a.id);                    // MBID: 0383dadf-2a4e-4d10-a46a-e9e041da8eb3
  console.log(a.name);                  // Queen
  console.log(a["sort-name"]);          // Queen  (differs for persons: "Bowie, David")
  console.log(a.type);                  // Group / Person / Orchestra / Choir
  console.log(a.country);               // GB
  console.log(a["life-span"]);          // {begin: '1970-06-27', end: null, ended: true}
  console.log(a.disambiguation ?? "");  // e.g. "English singer-songwriter"
  console.log(a.score);                 // relevance 0-100
}
```

### Artist by MBID (with related data via `inc=`)

```ts
// inc= parameters stack with + between them
const resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/artist/0383dadf-2a4e-4d10-a46a-e9e041da8eb3"
  + "?inc=releases+tags+ratings+release-groups&fmt=json",
  UA
));
console.log(resp.name);          // Queen
console.log(resp.type);          // Group
console.log(resp.country);       // GB
console.log(resp["life-span"]);  // {begin: '1970-06-27', end: null, ended: true}

// Tags (community-voted genre labels, sorted by count)
const tags = [...(resp.tags ?? [])].sort((x, y) => y.count - x.count);
console.log(tags.slice(0, 5).map((t) => t.name));
// ['rock', 'glam rock', 'hard rock', 'art rock', 'british']

// Rating (community score, 0-5)
console.log(resp.rating);  // {'votes-count': 43, value: 4.7}

// Direct releases (up to 25 per request — use browse for full list)
for (const r of resp.releases ?? []) {
  console.log(r.id, r.title, r.date);
}

// Release groups (albums, singles, EPs — deduplicated by edition)
for (const rg of resp["release-groups"] ?? []) {
  console.log(rg.id, rg.title, rg["primary-type"], rg["first-release-date"]);
}
// 6b47c9a0  A Night at the Opera  Album  1975-11-21
// 002ed683  Sheer Heart Attack    Album  1974-11-01
```

### Browse releases by artist (full list)

```ts
// Browse API: uses 'artist' param (not 'query') — response key is 'release-count' not 'count'
const resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/release/"
  + "?artist=0383dadf-2a4e-4d10-a46a-e9e041da8eb3&fmt=json&limit=25&offset=0",
  UA
));
console.log(resp["release-count"]);   // 1635 — total releases for this artist
for (const r of resp.releases) {
  console.log(r.id, r.title, r.date, r.country, r.status);
  // Also has: cover-art-archive.artwork (bool), cover-art-archive.front (bool)
  const caa = r["cover-art-archive"] ?? {};
  console.log(caa.artwork, caa.front, caa.count);
}

// Paginate: increment offset by limit
```

### Release search and lookup

```ts
// Search by title
const resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/release/?query=dark+side+of+the+moon&fmt=json&limit=5",
  UA
));
// resp keys: count, offset, releases

// Full release with track list, artists, and labels
const release = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/release/b84ee12a-09ef-421b-82de-0441a926375b"
  + "?inc=artists+recordings+labels+release-groups&fmt=json",
  UA
));
console.log(release.title);    // The Dark Side of the Moon
console.log(release.date);     // 1973-03-24
console.log(release.status);   // Official
console.log(release.country);  // GB

// Release group (the "album concept", deduplicates editions)
const rg = release["release-group"] ?? {};
console.log(rg.title, rg["primary-type"], rg.id);
// The Dark Side of the Moon  Album  f5093c06-23e3-404f-aeaa-40f72885ee3a

// Artist credit
for (const ac of release["artist-credit"] ?? []) {
  if (ac && typeof ac === "object" && "artist" in ac) {
    console.log(ac.artist.name, ac.artist.id);
    // Pink Floyd  83d91898-7763-47d7-b03b-b92132375c47
  }
}

// Labels
for (const li of release["label-info"] ?? []) {
  const label = li.label ?? {};
  console.log(label.name, li["catalog-number"]);
  // Harvest  SHVL 804
}

// Track list (from media[].tracks[])
for (const disc of release.media ?? []) {
  for (const track of disc.tracks ?? []) {
    const dur_s = track.length ? Math.floor(track.length / 1000) : null;
    const rec = track.recording ?? {};
    console.log(track.number, track.title, dur_s, rec.id);
    // A1  Speak to Me  68s  bef3fddb-5aca-49f5-b2fd-d56a23268d63
    // A2  Breathe      168s ecbc7c9b-e79d-4ec8-ac77-44e4a7f7f1b8
  }
}
```

### Recording (track) search

```ts
// Use Lucene field syntax to filter by artist
const resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/recording/"
  + "?query=bohemian+rhapsody+AND+artist:queen&fmt=json&limit=5",
  UA
));
console.log(resp.count);  // 419
for (const r of resp.recordings) {
  const dur_s = r.length ? Math.floor(r.length / 1000) : null;
  const artists = (r["artist-credit"] ?? []).filter((ac: any) => ac && typeof ac === "object").map((ac: any) => ac.artist.name);
  const releases = r.releases ?? [];
  console.log(r.id, r.title, dur_s, artists, releases.length ? releases[0].title : null);
}
// a4803b45  Bohemian Rhapsody  130s  ['Queen']  Rhapsody in Red
// 40212eb6  Bohemian Rhapsody  338s  ['Queen']  1986-07: Wembley Stadium
```

### Release-group search (deduplicated albums)

```ts
// Use release-group endpoint to avoid getting every regional edition
let resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/release-group/"
  + "?query=release-group:\"A+Night+at+the+Opera\"+AND+artist:queen&fmt=json&limit=5",
  UA
));
// resp keys: count, release-groups
for (const rg of resp["release-groups"] ?? []) {
  console.log(rg.id, rg.title, rg["primary-type"], rg["first-release-date"], rg.score);
}
// 6b47c9a0  A Night at the Opera  Album  1975-11-21  100

// Browse release-groups for an artist
resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/release-group/"
  + "?artist=0383dadf-2a4e-4d10-a46a-e9e041da8eb3&fmt=json&limit=25",
  UA
));
console.log(resp["release-group-count"]);  // 412
for (const rg of resp["release-groups"] ?? []) {
  console.log(rg.title, rg["primary-type"], rg["first-release-date"]);
}
```

### Label and work lookups

```ts
// Label search
let resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/label/?query=EMI&fmt=json&limit=3",
  UA
));
for (const l of resp.labels) {
  console.log(l.id, l.name, l.type, l.country, l.score);
}
// c029628b  EMI  Original Production  GB  100

// Work (song composition — author-level, not performance-level)
resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/work/?query=bohemian+rhapsody&fmt=json&limit=3",
  UA
));
for (const w of resp.works) {
  console.log(w.id, w.title, w.type, w.score);
}
// 41c94a08  Bohemian Rhapsody  Song  100
```

### Cover Art Archive

```ts
// Get cover art for a release MBID
// 404 if no artwork has been uploaded for that release
async function get_cover_art(release_mbid: string, size = "500") {
  /*
  size: '250', '500', '1200', or 'full' (original file)
  Returns the front cover URL, or null if no artwork exists.
  */
  let resp: any;
  try {
    resp = JSON.parse(await http_get(
      `https://coverartarchive.org/release/${release_mbid}`,
      UA
    ));
  } catch {
    return null;   // 404 = no art uploaded
  }

  const images = resp.images ?? [];
  // Prefer an image flagged as front=true
  const front = images.find((img: any) => img.front) ?? null;
  const img = front || (images.length ? images[0] : null);
  if (!img) return null;

  if (size === "full") return img.image;
  return img.thumbnails[size] || img.thumbnails.large;
}

// Thumbnail sizes confirmed: '250', '500', '1200', 'small' (=250), 'large' (=500)

const url = await get_cover_art("b84ee12a-09ef-421b-82de-0441a926375b");
// http://coverartarchive.org/release/b84ee12a.../1611507818-500.jpg

// Full images response structure
const resp = JSON.parse(await http_get(
  "https://coverartarchive.org/release/b84ee12a-09ef-421b-82de-0441a926375b",
  UA
));
for (const img of resp.images) {
  console.log(img.types);       // ['Front'], ['Back'], ['Liner'], ['Poster'], ['Medium'], ['Sticker'], ['Other']
  console.log(img.front);       // true only for front=true flagged images (not all 'Front' types)
  console.log(img.approved);    // true/false
  console.log(img.image);       // full resolution URL
  console.log(img.thumbnails);  // {small: '...-250.jpg', large: '...-500.jpg', '250': ..., '500': ..., '1200': ...}
}
```

### Lucene query syntax for search

All search endpoints support Lucene field queries:

```ts
// Field search: artist:, type:, country:, tag:, release:, date:
let resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/artist/"
  + "?query=artist:queen+AND+type:group+AND+country:GB&fmt=json&limit=5",
  UA
));
// count: 23 (exact matches only)

// Phrase search with quotes
resp = JSON.parse(await http_get(
  "https://musicbrainz.org/ws/2/release/"
  + '?query=release:"A+Night+at+the+Opera"+AND+artist:queen&fmt=json&limit=5',
  UA
));
```

Common Lucene field names per entity:
- artist: `artist:`, `type:`, `country:`, `tag:`, `begin:`, `end:`
- release: `release:`, `artist:`, `date:`, `country:`, `status:`, `label:`, `barcode:`
- recording: `recording:`, `artist:`, `release:`, `dur:` (milliseconds), `tnum:` (track number)
- release-group: `release-group:`, `artist:`, `primarytype:`, `secondarytype:`

### Parallel fetching

```ts
const UA = {"User-Agent": "browser-harness/1.0 (your@email.com)"};

async function fetch_artist(mbid: string) {
  const resp = JSON.parse(await http_get(
    `https://musicbrainz.org/ws/2/artist/${mbid}?inc=tags&fmt=json`,
    UA
  ));
  const tags = [...(resp.tags ?? [])].sort((x, y) => y.count - x.count).slice(0, 3).map((t) => t.name);
  return {name: resp.name, type: resp.type, tags};
}

const mbids = [
  "0383dadf-2a4e-4d10-a46a-e9e041da8eb3",  // Queen
  "83d91898-7763-47d7-b03b-b92132375c47",  // Pink Floyd
  "678d88b2-87b0-403b-b63d-5da7465aecc3",  // Led Zeppelin
];

const results = await Promise.all(mbids.map(fetch_artist));
// 3 artists fetched in ~0.79s total
```

Tested: 5-6 rapid sequential requests all succeed. Parallel requests at 3x concurrency succeed. Real 429s (rate-limit blocks) are only hit at very high burst rates; if you do get a 429, add `await wait(1)` between requests.

### Pagination

```ts
const UA = {"User-Agent": "browser-harness/1.0 (your@email.com)"};

async function browse_all_releases(artist_mbid: string, page_size = 25) {
  // Fetch all releases for an artist across multiple pages.
  let offset = 0;
  let total: number | null = null;
  const releases: any[] = [];
  while (total === null || offset < total) {
    const resp = JSON.parse(await http_get(
      `https://musicbrainz.org/ws/2/release/`
      + `?artist=${artist_mbid}&fmt=json&limit=${page_size}&offset=${offset}`,
      UA
    ));
    total = resp["release-count"] as number;
    const batch = resp.releases;
    releases.push(...batch);
    offset += batch.length;
    if (offset < total) await wait(1);  // stay within 1 req/s for sequential pagination
  }
  return releases;
}

// Queen has 1635 releases — use release-groups (412) to get deduplicated albums
```

---

## `inc=` parameter reference

Stack multiple `inc=` values with `+` between them.

**Artist lookup** (`/ws/2/artist/{mbid}`):
- `releases` — list of releases (max ~25)
- `release-groups` — list of release groups (max ~25)
- `recordings` — list of recordings (max ~25)
- `works` — list of works
- `tags` — community genre tags (name + vote count)
- `ratings` — community rating (value 0-5, votes-count)
- `aliases` — alternative names and transliterations
- `annotation` — free-text editorial note
- `artist-rels`, `release-rels`, `recording-rels`, `work-rels` — relationship data

**Release lookup** (`/ws/2/release/{mbid}`):
- `artists` — full artist-credit objects
- `recordings` — track list with recording links (populates `media[].tracks[].recording`)
- `labels` — label-info with catalog numbers
- `release-groups` — the release group this belongs to
- `artist-credits` — expanded artist credit with joinphrase
- `media` — disc/format info (always included in lookup, not needed in `inc=`)

---

## Response shapes cheat sheet

```
# MBID format: standard UUID v4
"0383dadf-2a4e-4d10-a46a-e9e041da8eb3"

# Search response (artist/recording/release/release-group/label/work)
{
  "count": 1612,          # total matches
  "offset": 0,
  "<entity-plural>": [...] # e.g. "artists", "releases", "recordings", "release-groups"
}

# Browse response (using ?artist=MBID or ?label=MBID style)
{
  "release-count": 1635,  # note: key name changes per entity
  "release-offset": 0,    # e.g. "release-group-count", "recording-count"
  "releases": [...]
}

# Recording length is always milliseconds
Math.floor(recording.length / 1000)  # => seconds

# Artist life-span
life_span = artist["life-span"]
# {begin: '1970-06-27', end: null, ended: true}
# ended: true with end: null means end date unknown but band is inactive

# Artist credit joinphrase (for multi-artist tracks)
# [{"name": "Simon", "artist": {...}, "joinphrase": " & "}, {"name": "Garfunkel", ...}]
```

---

## URL patterns

| Resource | URL |
|---|---|
| Artist search | `https://musicbrainz.org/ws/2/artist/?query={q}&fmt=json&limit=5` |
| Artist by MBID | `https://musicbrainz.org/ws/2/artist/{mbid}?inc=tags+ratings&fmt=json` |
| Browse releases by artist | `https://musicbrainz.org/ws/2/release/?artist={mbid}&fmt=json&limit=25&offset=0` |
| Release search | `https://musicbrainz.org/ws/2/release/?query={q}&fmt=json&limit=5` |
| Release by MBID | `https://musicbrainz.org/ws/2/release/{mbid}?inc=artists+recordings+labels&fmt=json` |
| Release-group browse | `https://musicbrainz.org/ws/2/release-group/?artist={mbid}&fmt=json&limit=25` |
| Recording search | `https://musicbrainz.org/ws/2/recording/?query={q}&fmt=json&limit=5` |
| Label search | `https://musicbrainz.org/ws/2/label/?query={q}&fmt=json&limit=5` |
| Work search | `https://musicbrainz.org/ws/2/work/?query={q}&fmt=json&limit=5` |
| Cover art | `https://coverartarchive.org/release/{release-mbid}` |

MusicBrainz entity browser URL (human-readable): `https://musicbrainz.org/artist/{mbid}` (replace `artist` with `release`, `recording`, etc.)

---

## Gotchas

- **`User-Agent` is mandatory** — without it you get HTTP 403 instantly. The header must include contact info, e.g. `browser-harness/1.0 (you@example.com)`. The default `http_get` UA (`Mozilla/5.0`) also gets 403.

- **Browse vs search response keys differ** — Search responses use `count` and `offset`; Browse responses (with `?artist=MBID`) use `release-count` / `release-offset` (or `release-group-count` etc.). Accessing `data['count']` on a browse response throws `KeyError`.

- **`releases` include in artist lookup caps at ~25** — Use the browse endpoint (`?artist=MBID`) with pagination for complete lists. Queen has 1,635 releases total; the `inc=releases` on the artist endpoint only returns ~25.

- **Use release-groups to avoid edition explosion** — A popular album can have hundreds of release entries (every country's pressing, every remaster, every format). Use `/ws/2/release-group/` to get one entry per "album concept". Queen's "A Night at the Opera" has 75+ release entries but 1 release-group.

- **Recording length is milliseconds** — `recording['length']` is in milliseconds, not seconds. Divide by 1000.

- **Sort-name differs from display name for persons** — Artists have both `name` (display: "David Bowie") and `sort-name` (alphabetical: "Bowie, David"). Groups usually have identical values.

- **Disambiguation in parentheses** — When multiple entities share a name, MusicBrainz adds a `disambiguation` field to distinguish them (e.g. `"English singer-songwriter"` vs a different David Bowie). Always check `a.get('disambiguation', '')` when resolving artist identity.

- **Score 100 does not mean unique** — Search returns `score: 100` for multiple results when several equally match the query. "dark side of the moon" returns 6 results all scored 100 — they're different regional pressings. Filter by `date`, `country`, or `status` to narrow down.

- **Recording search: plain query matches titles AND artists broadly** — `?query=bohemian+rhapsody+queen` matches *cover versions* first because "queen" appears in the artist or title of other recordings. Use `AND artist:queen` Lucene syntax to restrict to Queen performances.

- **Cover Art Archive returns 404 for releases with no uploaded art** — Check `release['cover-art-archive']['artwork']` (boolean) from any release browse/search response before hitting the CAA endpoint. Saves an extra HTTP round-trip.

- **Cover art `front=True` flag vs `types=['Front']`** — A release can have multiple images typed as 'Front' but only one (or none) flagged `front: true`. Always filter on `img.front === true` for the canonical cover, not on `img.types` equal to `['Front']`.

- **CAA thumbnail key names** — Both string keys `'small'` (250px) and `'large'` (500px) exist as aliases alongside numeric string keys `'250'`, `'500'`, `'1200'`. Access as `img['thumbnails']['500']` or `img['thumbnails']['large']` — both work.

- **Rate limit: 1 req/s unauthenticated** — In practice, bursts of 5-6 sequential requests succeed without throttling. True 429s appear at higher rates. For sequential pagination loops, add `await wait(1)` between pages. For parallel fetching, limit concurrency to 3-5 at a time in `Promise.all`.

- **`fmt=json` required** — Omitting it returns XML instead of JSON. Always append `&fmt=json` to every request.

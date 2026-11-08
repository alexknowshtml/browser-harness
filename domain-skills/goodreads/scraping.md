# Goodreads — Book Data Extraction

Field-tested against goodreads.com on 2026-04-18 via `http_get` (no browser required).
All five URL types return full HTML with no bot-wall, CAPTCHA, or login gate.

## Access Summary

| Page type          | `http_get` works? | Data format              |
|--------------------|-------------------|--------------------------|
| Book show page     | Yes               | `__NEXT_DATA__` + JSON-LD |
| Search results     | Yes               | Server-rendered HTML (schema.org microdata) |
| Author show page   | Yes               | Server-rendered HTML + OG meta |
| Listopia list page | Yes               | Server-rendered HTML (schema.org microdata) |

Goodreads shut down its public API in 2020. All extraction is HTML-based.
Open Library is a reliable supplement with a free JSON API (see [Open Library fallback](#open-library-api-fallback)).

---

## Book Page — Full Data (`__NEXT_DATA__`)

URL pattern: `https://www.goodreads.com/book/show/{book_id}` or `/{book_id}.{Slug}`

The slug is optional — numeric ID alone works and redirects cleanly.

```ts
async function parse_book(book_id: number | string) {
  const html = await http_get(`https://www.goodreads.com/book/show/${book_id}`);

  // Parse Apollo state from Next.js page
  const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const ap: Record<string, any> = JSON.parse(nd![1]).props.pageProps.apolloState;

  // The primary Book entity matches the URL's legacy ID
  const book = Object.values(ap).find(
    (v: any) => v?.__typename === "Book" && v?.legacyId === Number(book_id));
  const work = Object.values(ap).find((v: any) => v?.__typename === "Work") ?? {};
  const author_ref = book.primaryContributorEdge.node.__ref;
  const author = ap[author_ref] ?? {};

  const stats = work.stats ?? {};
  const work_details = work.details ?? {};
  const book_details = book.details ?? {};

  return {
    title:            book.title,
    title_complete:   book.titleComplete,
    book_id:          book.legacyId,
    url:              book.webUrl,
    cover_url:        book.imageUrl,
    // Strip HTML tags from description
    description:      (book['description({"stripped":true})'] ?? book.description ?? "")
                        .replace(/<[^>]+>/g, "").trim(),
    genres:           (book.bookGenres ?? []).map((g: any) => g.genre.name),
    series:           (book.bookSeries ?? []).map((s: any) => ({ name: s.series.title, position: s.userPosition ?? null })),
    // Author
    author_name:      author.name ?? null,
    author_url:       author.webUrl ?? null,
    // Edition details
    format:           book_details.format ?? null,
    num_pages:        book_details.numPages ?? null,
    publisher:        book_details.publisher ?? null,
    language:         (book_details.language || {}).name ?? null,
    isbn:             book_details.isbn ?? null,
    isbn13:           book_details.isbn13 ?? null,
    pub_timestamp_ms: book_details.publicationTime ?? null,
    // Ratings (from Work, not Book)
    avg_rating:       stats.averageRating ?? null,
    ratings_count:    stats.ratingsCount ?? null,
    text_reviews:     stats.textReviewsCount ?? null,
    // ratings_dist is list of counts for [1-star, 2-star, 3-star, 4-star, 5-star]
    ratings_dist:     stats.ratingsCountDist ?? null,
    // Awards
    awards:           (work_details.awardsWon ?? []).map((a: any) => a.name + (a.category ? " — " + a.category : "")),
  };
}

// Example
const book = await parse_book(149267);  // The Stand by Stephen King
// book.title         => "The Stand"
// book.avg_rating    => 4.35
// book.ratings_count => 845591
// book.genres        => ["Horror", "Fiction", "Fantasy", ...]
// book.awards        => ["Locus Award — Best SF Novel", ...]
```

**Field notes:**
- `book.legacyId` is the integer in the URL (e.g. `149267`). Use it to match the correct entity — the `apolloState` often contains 2-3 Book entries for different editions.
- Ratings and awards live in the `Work` entity, not `Book`. The `Work` is always `__typename == 'Work'`.
- `description` comes in two forms: `description` (HTML) and `description({"stripped":true})` (plain text). Prefer the stripped version.
- `pub_timestamp_ms` is a Unix timestamp in **milliseconds**. Convert: `new Date(ts)`.
- `isbn` / `isbn13` are often `null` on older editions — the JSON-LD path (below) is no more reliable.

---

## Book Page — Fast Path (JSON-LD)

Use when you only need title, author, rating, page count, and awards. ~3× less parsing code.

```ts
async function parse_book_fast(book_id: number | string) {
  const html = await http_get(`https://www.goodreads.com/book/show/${book_id}`);
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (!blocks.length) return null;
  const ld = JSON.parse(blocks[0]);
  return {
    title:         ld.name ?? null,
    author:        ld.author ? ld.author[0].name : null,
    avg_rating:    ld.aggregateRating?.ratingValue ?? null,
    ratings_count: ld.aggregateRating?.ratingCount ?? null,
    review_count:  ld.aggregateRating?.reviewCount ?? null,
    num_pages:     ld.numberOfPages ?? null,
    isbn:          ld.isbn ?? null,
    cover_url:     ld.image ?? null,
    awards:        ld.awards ?? null,   // single string, comma-separated
    format:        ld.bookFormat ?? null,
  };
}

const book = await parse_book_fast(149267);
// book.avg_rating    => 4.35
// book.ratings_count => 845591
```

**JSON-LD does NOT include:** description, genres, series membership, per-star rating distribution, publisher, language.
Use `parse_book()` (the `__NEXT_DATA__` path) when you need any of those.

---

## Search Results

URL: `https://www.goodreads.com/search?q={query}&search_type=books&page={n}`

Search uses server-rendered HTML with schema.org microdata `<tr>` rows. No `__NEXT_DATA__`.

```ts
const quote_plus = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");

async function search_books(query: string, page = 1) {
  const url = `https://www.goodreads.com/search?q=${quote_plus(query)}&search_type=books&page=${page}`;
  const html = await http_get(url);

  const rows = [...html.matchAll(
    /<tr itemscope itemtype="http:\/\/schema.org\/Book">([\s\S]*?)<\/tr>/g
  )].map((m) => m[1]);

  const results: any[] = [];
  for (const row of rows) {
    const bid    = row.match(/<div id="(\d+)" class="u-anchorTarget">/);
    const title  = row.match(/itemprop='name'[^>]*>([^<]+)<\/span>/);
    const author = row.match(/class="authorName"[^>]*><span[^>]*>([^<]+)<\/span>/);
    const avg    = row.match(/(\d+\.\d+)\s*avg rating/);
    const cnt    = row.match(/(\d[\d,]*)\s*rating/);
    const cover  = row.match(/img alt="[^"]*" class="bookCover"[^>]*src="([^"]+)"/);
    if (!(bid && title)) continue;
    results.push({
      book_id:       bid[1],
      title:         title[1].trim(),
      author:        author ? author[1].trim() : null,
      avg_rating:    avg ? parseFloat(avg[1]) : null,
      ratings_count: cnt ? cnt[1].replaceAll(",", "") : null,
      cover_url:     cover ? cover[1] : null,
      url:           `https://www.goodreads.com/book/show/${bid[1]}`,
    });
  }

  const total_m = html.match(/([\d,]+)\s+results/);
  const total   = total_m ? parseInt(total_m[1].replaceAll(",", "")) : null;

  return { total, page, results };
}

// Example
const r = await search_books("dune");
// r.total   => 101026
// r.results => [{book_id: '44767458', title: 'Dune (Dune, #1)', avg_rating: 4.29, ...}, ...]
```

**Field notes:**
- Returns exactly 20 results per page.
- `total` is the result count shown in `"N results for…"` header.
- The `avg rating` regex uses `&mdash;` (HTML entity) in the raw HTML — the pattern above matches the decoded text.
- `ratings_count` regex hits the first occurrence of `\d+ rating` in the row, which is always the book's count (not a user review count).
- `cover_url` is a 75px thumbnail (`._SY75_.jpg`). Swap `_SY75_` → `_SX315_` for a larger image.

---

## Author Page

URL: `https://www.goodreads.com/author/show/{author_id}.{Slug}`

Author pages are **not** Next.js — they use classic server-rendered HTML with OG meta tags and microdata.
The author ID and slug can be obtained from a book's `author_url` field.

```ts
async function parse_author(author_id_and_slug: string) {
  // author_id_and_slug e.g. "58.Frank_Patrick_Herbert"
  const html = await http_get(`https://www.goodreads.com/author/show/${author_id_and_slug}`);

  // Name and basic info from OG/meta tags
  const name    = html.match(/<meta content='([^']+)' property='og:title'>/);
  const img     = html.match(/<meta content='([^']+)' property='og:image'>/);
  const website = html.match(/Website\s*<\/div>\s*<div[^>]*>\s*<a[^>]*href="([^"]+)"/);

  // Full biography from hidden span (shown/hidden by "...more" toggle in browser)
  const bio_span = html.match(/<span id="freeText(?:author|long)\d+"[^>]*>([\s\S]*?)<\/span>/);
  const bio = bio_span ? bio_span[1].replace(/<[^>]+>/g, "").trim() : null;

  // Top books listed on the page (10 rows, same microdata format as search)
  const rows = [...html.matchAll(
    /<tr itemscope itemtype="http:\/\/schema.org\/Book">([\s\S]*?)<\/tr>/g
  )].map((m) => m[1]);
  const books: any[] = [];
  for (const row of rows) {
    const bid   = row.match(/<div id="(\d+)" class="u-anchorTarget">/);
    const title = row.match(/itemprop='name'[^>]*>([^<]+)<\/span>/);
    const avg   = row.match(/(\d+\.\d+)\s*avg rating/);
    const cnt   = row.match(/(\d[\d,]*)\s*rating/);
    if (bid && title) {
      books.push({
        book_id:       bid[1],
        title:         title[1].trim(),
        avg_rating:    avg ? parseFloat(avg[1]) : null,
        ratings_count: cnt ? cnt[1].replaceAll(",", "") : null,
        url:           `https://www.goodreads.com/book/show/${bid[1]}`,
      });
    }
  }

  return {
    name:          name ? name[1] : null,
    profile_image: img ? img[1] : null,
    bio,
    website:       website ? website[1] : null,
    top_books:     books,
  };
}

// Example
const author = await parse_author("58.Frank_Patrick_Herbert");
// author.name    => "Frank Patrick Herbert"
// author.bio     => "Franklin Patrick Herbert Jr. was an American science fiction..."
// author.top_books.length => 10
```

**Field notes:**
- Author IDs can be found in a book's `author_url` (from `__NEXT_DATA__` or JSON-LD).
- The slug is optional in the URL — numeric ID alone redirects correctly.
- `profile_image` from OG tag is a large portrait (p8 suffix = 800px). Swap to `p5` for 500px.
- The bio is server-rendered in a `<span id="freeTextauthor{ID}">` or `<span id="freeTextlong{ID}">` — which variant appears depends on length.
- Follower count is **not** present in the static HTML — it requires JS execution to appear.
- Page lists exactly 10 books. To get all books, paginate `/author/list/{author_id}?page=N`.

---

## Listopia List Page

URL: `https://www.goodreads.com/list/show/{list_id}.{Slug}?page={n}`

Returns 100 books per page with rank numbers.

```ts
async function parse_list(list_id_and_slug: string, page = 1) {
  const url = `https://www.goodreads.com/list/show/${list_id_and_slug}?page=${page}`;
  const html = await http_get(url);

  const rows = [...html.matchAll(
    /<tr itemscope itemtype="http:\/\/schema.org\/Book">([\s\S]*?)<\/tr>/g
  )].map((m) => m[1]);

  const results: any[] = [];
  for (const row of rows) {
    const rank   = row.match(/<td[^>]*class="number"[^>]*>(\d+)<\/td>/);
    const bid    = row.match(/<div id="(\d+)" class="u-anchorTarget">/);
    const title  = row.match(/itemprop='name'[^>]*>([^<]+)<\/span>/);
    const author = row.match(/class="authorName"[^>]*><span[^>]*>([^<]+)<\/span>/);
    const avg    = row.match(/(\d+\.\d+)\s*avg rating/);
    const cnt    = row.match(/(\d[\d,]*)\s*rating/);
    if (!(bid && title)) continue;
    results.push({
      rank:          rank ? parseInt(rank[1]) : null,
      book_id:       bid[1],
      title:         title[1].trim(),
      author:        author ? author[1].trim() : null,
      avg_rating:    avg ? parseFloat(avg[1]) : null,
      ratings_count: cnt ? cnt[1].replaceAll(",", "") : null,
      url:           `https://www.goodreads.com/book/show/${bid[1]}`,
    });
  }

  return { page, results };
}

// Example
const lst = await parse_list("1.Best_Books_Ever");
// lst.results[0] => {rank: 1, book_id: '2767052',
//                    title: 'The Hunger Games (The Hunger Games, #1)',
//                    author: 'Suzanne Collins', avg_rating: 4.35, ...}
```

**Field notes:**
- 100 rows per page. Ranks are sequential across pages (page 2 starts at rank 101).
- Paginate with `?page=2`, `?page=3` etc.
- List pages do not use `__NEXT_DATA__` — same classic HTML format as author pages.

---

## Open Library API Fallback

Use Open Library when you need structured JSON without HTML parsing, or when you want supplementary data (birth/death dates, ISBNs across editions, subjects).

Open Library's ratings are from its own user base (~400 ratings vs. Goodreads' 800k+ for Dune) — use Goodreads ratings when accuracy matters.

### Search

```ts
const quote_plus = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");

async function ol_search(query: string, limit = 10) {
  const url = `https://openlibrary.org/search.json?q=${quote_plus(query)}&limit=${limit}`;
  const data = JSON.parse(await http_get(url));
  const results = (data.docs ?? []).map((doc: any) => {
    const cover_id = doc.cover_i;
    return {
      ol_key:         doc.key,           // e.g. "/works/OL893415W"
      title:          doc.title ?? null,
      author:         (doc.author_name || [""])[0],
      author_key:     (doc.author_key || [""])[0],
      first_pub_year: doc.first_publish_year ?? null,
      edition_count:  doc.edition_count ?? null,
      series:         doc.series_name ?? null,
      cover_url:      cover_id ? `https://covers.openlibrary.org/b/id/${cover_id}-M.jpg` : null,
    };
  });
  return { total: data.numFound ?? null, results };
}

const r = await ol_search("dune frank herbert", 5);
// r.results[0].ol_key  => "/works/OL893415W"
// r.results[0].title   => "Dune"
```

### Work (book details)

```ts
async function ol_work(ol_key: string) {
  // ol_key like "/works/OL893415W" or just "OL893415W"
  const key = ol_key.startsWith("/") ? ol_key : `/works/${ol_key}`;
  const data = JSON.parse(await http_get(`https://openlibrary.org${key}.json`));
  let desc = data.description ?? "";
  if (typeof desc === "object") desc = desc.value ?? "";
  return {
    title:       data.title ?? null,
    subjects:    data.subjects ?? [],
    series:      data.series ?? [],
    description: desc,
    covers:      data.covers ?? [],
    links:       data.links ?? [],
  };
}

const work = await ol_work("OL893415W");
// work.title    => "Dune"
// work.subjects => ["Dune (Imaginary place)", "Fiction", ...]
```

### Ratings for a work

```ts
async function ol_ratings(ol_key: string) {
  const key = ol_key.startsWith("/") ? ol_key : `/works/${ol_key}`;
  const data = JSON.parse(await http_get(`https://openlibrary.org${key}/ratings.json`));
  return data.summary ?? {};
}

// {average: 4.30, count: 414, sortable: 4.21}
```

### Author

```ts
async function ol_author(author_key: string) {
  // author_key like "OL79034A"
  const data = JSON.parse(await http_get(`https://openlibrary.org/authors/${author_key}.json`));
  let bio = data.bio ?? "";
  if (typeof bio === "object") bio = bio.value ?? "";
  return {
    name:       data.name ?? null,
    birth_date: data.birth_date ?? null,
    death_date: data.death_date ?? null,
    bio,
    ol_key:     data.key ?? null,
  };
}

const author = await ol_author("OL79034A");
// author.name       => "Frank Herbert"
// author.birth_date => "8 October 1920"
// author.death_date => "11 February 1986"
```

---

## Combining Goodreads + Open Library

```ts
// Get full book data: Goodreads for ratings/genres/description, OL for ISBNs/edition details
async function get_book_full(goodreads_book_id: number | string, ol_work_key: string | null = null) {
  const gr = await parse_book(goodreads_book_id);
  const result: Record<string, any> = { ...gr };
  if (ol_work_key) {
    const ol = await ol_work(ol_work_key);
    result.ol_subjects    = ol.subjects;
    result.ol_description = ol.description;
    result.ol_covers      = ol.covers;
  }
  return result;
}
```

---

## Gotchas

- **Goodreads API is gone**: The official API was shut down in December 2020. All data must come from HTML scraping or the unofficial paths documented here.

- **Book ID 5107 redirects**: The URL `goodreads.com/book/show/5107.The_Stand` actually resolves to *The Catcher in the Rye* (ID 5107). The Stand is ID `149267`. Always verify `book.legacyId` matches the URL ID.

- **Author page ID mismatch**: Author ID `10538` in the URL resolves to Carl Sagan, not Frank Herbert (ID `58`). Always obtain author IDs from the `author_url` field inside a book's data rather than guessing.

- **Two Book entities in `apolloState`**: The `apolloState` contains multiple `Book:` entries — one is a stub (only has `legacyId` and `webUrl`), and one is full. Filter by `legacyId === Number(book_id)` AND check that the entry has more than 3 fields.

- **Ratings are on `Work`, not `Book`**: `avg_rating`, `ratingsCount`, and `ratingsCountDist` are in the `Work` entity's `stats` key. The `Book` entity has no rating fields.

- **Author pages are old-style HTML**: Author pages (`/author/show/`) do not use Next.js or `__NEXT_DATA__`. Use OG meta tags and regex for extraction. The follower count only loads via JS — it will be missing from `http_get` responses.

- **Search has no `__NEXT_DATA__`**: Search result pages (`/search`) are classic server-rendered HTML. JSON-LD is absent. Use the `<tr itemscope itemtype="http://schema.org/Book">` microdata rows.

- **`ratings_count` regex order matters**: The pattern `/(\d[\d,]*)\s*rating/` always matches the book's aggregate rating count first in each search row — this is reliable. Do not use `minirating` span text as it contains nested HTML.

- **Open Library cover URLs return binary JPEG**: `http_get()` decodes the body as UTF-8 text, which garbles image bytes. Use `fetch()` directly and read `arrayBuffer()`, or just store the URL string without fetching.

- **Open Library ratings are sparse**: OL has ~400 community ratings for Dune vs. Goodreads' 1.6M. Use OL ratings only as a last resort.

- **Search page `&mdash;` entity**: The raw HTML uses `&mdash;` (not `—`) between rating value and count in search and author pages. The regex patterns above match the decoded text because the regex runs on the decoded string after `http_get()` decodes UTF-8.

- **Book slug is optional**: `goodreads.com/book/show/44767458` (no slug) works identically to `goodreads.com/book/show/44767458-dune`. Redirects are transparent.

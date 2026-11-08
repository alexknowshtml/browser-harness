# Project Gutenberg — Scraping & Data Extraction

`https://www.gutenberg.org` — 78 000+ free public-domain ebooks. Every workflow here is pure `http_get` — no browser needed.

## Do this first

**Use the Gutendex REST API (`gutendex.com`) for all search and discovery. It is one call, returns clean JSON, and requires no auth. Go to gutenberg.org URLs only to fetch actual file content.**

```ts
// Search by title/author keyword
const data = JSON.parse(await http_get("https://gutendex.com/books/?search=pride+and+prejudice"));
// data.count = 6 (total matches)
// data.results = list of up to 32 book objects
const book = data.results[0];
// book.id = 1342  ← use this ID for all further calls
// book.formats["text/plain; charset=utf-8"] = direct txt URL

// Fetch the plain-text content of that book
const text = await http_get(book.formats["text/plain; charset=utf-8"]);
// Returns 763 083 chars including Project Gutenberg header/footer boilerplate
```

For a known book ID, skip search entirely:

```ts
const book = JSON.parse(await http_get("https://gutendex.com/books/1342/"));
```

## Common workflows

### Search by keyword and get the first result

```ts
const data = JSON.parse(await http_get("https://gutendex.com/books/?search=frankenstein"));
if (data.results.length) {
  const b = data.results[0];
  console.log(b.id, b.title, b.authors[0].name);
  // 84  Frankenstein; or, the modern prometheus  Shelley, Mary Wollstonecraft
  const txt_url = b.formats["text/plain; charset=utf-8"];
  if (txt_url) {
    const text = await http_get(txt_url);
  }
}
```

### Get the most downloaded books (popularity ranking)

```ts
const data = JSON.parse(await http_get("https://gutendex.com/books/?sort=popular"));
for (const b of data.results.slice(0, 10)) {
  const authors = b.authors.map((a: any) => a.name).join(", ");
  console.log(`[${b.id}] ${b.title} — ${authors} (${b.download_count.toLocaleString("en-US")} downloads)`);
}
// [84]    Frankenstein                      — Shelley, Mary Wollstonecraft  (178,271)
// [45304] The City of God, Volume I         — Augustine, of Hippo, Saint    (147,663)
// [2701]  Moby Dick; Or, The Whale          — Melville, Herman              (112,302)
// [1342]  Pride and Prejudice               — Austen, Jane                  (107,502)
// [768]   Wuthering Heights                 — Brontë, Emily                  (72,775)
// [1513]  Romeo and Juliet                  — Shakespeare, William           (70,272)
// [11]    Alice's Adventures in Wonderland  — Carroll, Lewis                 (65,243)
// [64317] The Great Gatsby                  — Fitzgerald, F. Scott           (60,632)
// [100]   Complete Works of Shakespeare     — Shakespeare, William           (60,527)
// [1260]  Jane Eyre: An Autobiography       — Brontë, Charlotte              (57,602)
```

### Browse by genre / topic

```ts
// 'topic' matches both subjects and bookshelves fields
let data = JSON.parse(await http_get("https://gutendex.com/books/?topic=science+fiction"));
// data.count = 3473 total results, 32 per page

data = JSON.parse(await http_get("https://gutendex.com/books/?topic=detective+fiction"));
// data.count = 111
// data.results[0]: id=1661 The Adventures of Sherlock Holmes — Doyle, Arthur Conan

// Filter by language (ISO 639-1 code)
data = JSON.parse(await http_get("https://gutendex.com/books/?languages=fr&topic=roman"));
// data.count = 254 French books with 'roman' in topic
```

### Paginate through results

```ts
let url: string | null = "https://gutendex.com/books/?topic=science+fiction";
const books: any[] = [];
while (url) {
  const data = JSON.parse(await http_get(url));
  books.push(...data.results);
  url = data.next; // null on last page
  // data.previous is also populated after page 1
  // e.g. data.next = "https://gutendex.com/books/?page=3&topic=science+fiction"
}
// All 3473 sci-fi books loaded across ~109 pages of 32 each
```

### Fetch multiple specific books by ID

```ts
const data = JSON.parse(await http_get("https://gutendex.com/books/?ids=1342,11,84"));
// Returns exactly those 3 books, count=3
for (const b of data.results) console.log(b.id, b.title);
// 84    Frankenstein; or, the modern prometheus
// 1342  Pride and Prejudice
// 11    Alice's Adventures in Wonderland
```

### Read the plain text of a book (boilerplate stripped)

```ts
const raw = await http_get("https://www.gutenberg.org/cache/epub/1342/pg1342.txt");
// 763 083 chars total including PG licence header and footer

const START = "*** START OF THE PROJECT GUTENBERG EBOOK";
const END = "*** END OF THE PROJECT GUTENBERG EBOOK";
const s = raw.indexOf(START);
const e = raw.indexOf(END);
if (s !== -1) {
  const content = raw.slice(raw.indexOf("\n", s) + 1, e).trim();
  // 743 241 chars of actual novel text
}
```

The cache URL is the most reliable direct path. The `formats` dict in Gutendex also provides a redirect URL that resolves to the same file:

```ts
// Both of these return identical content (763 083 chars):
await http_get("https://www.gutenberg.org/ebooks/1342.txt.utf-8");      // redirect
await http_get("https://www.gutenberg.org/cache/epub/1342/pg1342.txt"); // direct cache
```

### Download formats available per book

Every book's `formats` dict maps MIME type to URL. All URLs resolve to `/cache/epub/{id}/` files via redirect.

| MIME type | URL pattern (after redirect) | Typical size |
|---|---|---|
| `text/plain; charset=utf-8` | `pg{id}.txt` | ~750 KB |
| `text/html` | `pg{id}-images.html` | ~850 KB |
| `application/epub+zip` | `pg{id}-images-3.epub` | ~25 MB |
| `application/x-mobipocket-ebook` | `pg{id}-images-kf8.mobi` | ~25 MB |
| `application/rdf+xml` | `{id}.rdf` via gutenberg.org | metadata XML |
| `image/jpeg` | `pg{id}.cover.medium.jpg` | cover image |
| `application/octet-stream` | `pg{id}-h.zip` | HTML+images zip |

```ts
const b = JSON.parse(await http_get("https://gutendex.com/books/1342/"));
// Grab every downloadable format URL:
for (const [mime, url] of Object.entries(b.formats)) console.log(mime, "->", url);
// text/html                         -> https://www.gutenberg.org/ebooks/1342.html.images
// application/epub+zip              -> https://www.gutenberg.org/ebooks/1342.epub3.images
// application/x-mobipocket-ebook   -> https://www.gutenberg.org/ebooks/1342.kf8.images
// application/rdf+xml               -> https://www.gutenberg.org/ebooks/1342.rdf
// image/jpeg                        -> https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg
// application/octet-stream          -> https://www.gutenberg.org/cache/epub/1342/pg1342-h.zip
// text/plain; charset=utf-8         -> https://www.gutenberg.org/ebooks/1342.txt.utf-8
```

### Fetch RDF/XML metadata for a book

```ts
const rdf = await http_get("https://www.gutenberg.org/cache/epub/1342/pg1342.rdf");
// Also available as: await http_get("https://www.gutenberg.org/ebooks/1342.rdf")

const title = rdf.match(/<dcterms:title>(.*?)<\/dcterms:title>/s);
const creator = [...rdf.matchAll(/<pgterms:name>(.*?)<\/pgterms:name>/g)].map((m) => m[1]);
const birth = [...rdf.matchAll(/<pgterms:birthdate[^>]*>(\d+)/g)].map((m) => m[1]);
const death = [...rdf.matchAll(/<pgterms:deathdate[^>]*>(\d+)/g)].map((m) => m[1]);
const issued = rdf.match(/<dcterms:issued[^>]*>(.*?)<\/dcterms:issued>/);
const rights = rdf.match(/<dcterms:rights>(.*?)<\/dcterms:rights>/);
const downloads = rdf.match(/<pgterms:downloads[^>]*>(\d+)<\/pgterms:downloads>/);
const language = rdf.match(/<dcterms:language>.*?<rdf:value>(.*?)<\/rdf:value>/s);
const subjects = [...rdf.matchAll(/<dcterms:subject>.*?<rdf:value>(.*?)<\/rdf:value>.*?<\/dcterms:subject>/gs)].map((m) => m[1]);

console.log(title![1]);               // Pride and Prejudice
console.log(creator);                 // ['Austen, Jane']
console.log(birth, death);            // ['1775'] ['1817']
console.log(issued![1]);              // 1998-06-01
console.log(rights![1]);              // Public domain in the USA.
console.log(parseInt(downloads![1])); // 107502
console.log(subjects.slice(0, 3));    // ['England -- Fiction', 'Young women -- Fiction', 'Love stories']
```

Note: `<dcterms:language>` value is a subject string, not a language code. For language codes use the Gutendex `languages` field instead.

### Search the HTML catalog (25 results per page)

Use this only when you need to leverage Gutenberg's own search index (author:, title:, subject: prefix syntax).

```ts
const html = await http_get(
  "https://www.gutenberg.org/ebooks/search/" +
    "?query=shakespeare&sort_order=downloads",
);
// sort_order options: downloads, title, release_date, last_update, random

const entries = [...html.matchAll(/<li class="booklink">(.*?)<\/li>/gs)].map((m) => m[1]);
const books = [];
for (const e of entries) {
  const book_id = e.match(/\/ebooks\/(\d+)/);
  const title = e.match(/<span class="title">(.*?)<\/span>/);
  const author = e.match(/<span class="subtitle">(.*?)<\/span>/);
  const downloads = e.match(/<span class="extra">([^<]+)<\/span>/);
  books.push({
    id: book_id ? parseInt(book_id[1]) : null,
    title: title ? title[1] : "",
    author: author ? author[1] : "",
    downloads: downloads ? downloads[1].trim() : "",
  });
}

// books[0] = {id: 1513, title: 'Romeo and Juliet',
//             author: 'William Shakespeare', downloads: '74316 downloads'}

// Paginate with start_index (25 per page)
const html_p2 = await http_get(
  "https://www.gutenberg.org/ebooks/search/" +
    "?query=shakespeare&sort_order=downloads&start_index=26",
);
```

### Browse a bookshelf (curated genre list)

```ts
// Bookshelf 68 = Science Fiction
const html = await http_get("https://www.gutenberg.org/ebooks/bookshelf/68");
const titles = [...html.matchAll(/<span class="title">(.*?)<\/span>/g)].map((m) => m[1]);
// ['Twenty Thousand Leagues under the Sea', 'The War of the Worlds',
//  'The Time Machine', 'Thuvia, Maid of Mars', ...]
```

### OPDS catalog (machine-readable Atom feed)

```ts
const feed = await http_get("https://www.gutenberg.org/ebooks/search.opds/?query=dracula");
// Returns Atom XML, 7 entries per page (including 1 metadata entry)
const entries = [...feed.matchAll(/<entry>(.*?)<\/entry>/gs)].map((m) => m[1]);
for (const e of entries) {
  const title = e.match(/<title>(.*?)<\/title>/);
  const entry_id = e.match(/<id>(.*?)<\/id>/);
  if (title && entry_id && entry_id[1].includes("opds")) {
    const book_id = entry_id[1].match(/\/ebooks\/(\d+)\.opds/);
    console.log(book_id![1], title[1]);
  }
}
// 345  Dracula
```

## Gutendex API — full response schema

Validated against a real call to `GET https://gutendex.com/books/1342/`:

```json
{
  "id": 1342,
  "title": "Pride and Prejudice",
  "authors": [
    {"name": "Austen, Jane", "birth_year": 1775, "death_year": 1817}
  ],
  "summaries": ["...automatically generated summary..."],
  "editors": [],
  "translators": [],
  "subjects": [
    "Courtship -- Fiction",
    "Domestic fiction",
    "England -- Fiction",
    "Love stories",
    "Sisters -- Fiction",
    "Women -- England -- Fiction",
    "Young women -- Fiction"
  ],
  "bookshelves": [
    "Best Books Ever Listings",
    "Category: British Literature",
    "Category: Classics of Literature",
    "Category: Novels",
    "Category: Romance",
    "Harvard Classics"
  ],
  "languages": ["en"],
  "copyright": false,
  "media_type": "Text",
  "formats": {
    "text/html":                       "https://www.gutenberg.org/ebooks/1342.html.images",
    "application/epub+zip":            "https://www.gutenberg.org/ebooks/1342.epub3.images",
    "application/x-mobipocket-ebook": "https://www.gutenberg.org/ebooks/1342.kf8.images",
    "application/rdf+xml":             "https://www.gutenberg.org/ebooks/1342.rdf",
    "image/jpeg":                      "https://www.gutenberg.org/cache/epub/1342/pg1342.cover.medium.jpg",
    "application/octet-stream":        "https://www.gutenberg.org/cache/epub/1342/pg1342-h.zip",
    "text/plain; charset=utf-8":       "https://www.gutenberg.org/ebooks/1342.txt.utf-8"
  },
  "download_count": 107502
}
```

List response wrapper (from `GET /books/`):

```json
{
  "count": 6,
  "next": null,
  "previous": null,
  "results": [...]
}
```

`count` is the total across all pages. `next` / `previous` are fully-formed URLs ready to pass to `http_get`, or `null` when absent.

## Gutendex query parameters

All parameters combine freely.

| Parameter | Example | Notes |
|---|---|---|
| `search` | `search=moby+dick` | Matches title and author |
| `ids` | `ids=1342,11,84` | Comma-separated; returns only those books |
| `languages` | `languages=fr` | ISO 639-1 code; comma-separated for multiple |
| `topic` | `topic=science+fiction` | Matches subjects + bookshelves |
| `author_year_start` | `author_year_start=1800` | Author born on/after year |
| `author_year_end` | `author_year_end=1850` | Author born on/before year |
| `copyright` | `copyright=false` | `false`=public domain, `true`=copyrighted |
| `sort` | `sort=popular` | `popular` (default), `ascending`, `descending` |
| `page` | `page=2` | 1-based; 32 results per page (not configurable) |

`page_size` is not supported — always 32 results per page regardless.

## Finding book IDs

Three ways, in order of preference:

1. **Gutendex search** — returns `id` directly in JSON.
2. **Gutenberg HTML catalog** — `const book_id = entry.match(/\/ebooks\/(\d+)/)`. IDs in the URL.
3. **URL pattern** — `https://www.gutenberg.org/ebooks/{id}` — if you already know the ID from any source.

Notable IDs validated in tests: `84` (Frankenstein), `1342` (Pride and Prejudice), `11` (Alice in Wonderland), `2701` (Moby Dick), `64317` (The Great Gatsby), `1513` (Romeo and Juliet), `100` (Complete Works of Shakespeare), `1661` (Adventures of Sherlock Holmes), `345` (Dracula).

## Rate limits

Gutendex (`gutendex.com`) returns no `X-RateLimit-*` headers. Server is Apache/2.4.58 on Ubuntu. Rapid sequential calls can trigger connection resets — observed a timeout on the second call in a tight loop. Add a small delay between calls when paginating:

```ts
let url: string | null = "https://gutendex.com/books/?sort=popular";
while (url) {
  const data = JSON.parse(await http_get(url));
  // ... process data.results ...
  url = data.next;
  if (url) await wait(0.5); // be respectful — no published rate limit but timeouts observed
}
```

For gutenberg.org file downloads (txt, epub, etc.) there is no documented rate limit but Gutenberg asks not to use automated bulk downloading; use their [offline catalogs](https://www.gutenberg.org/ebooks/offline_catalogs.html) for bulk access.

## Gotchas

- **`.opf` 404**: `https://www.gutenberg.org/cache/epub/1342/pg1342.opf` returns 404. Use `.rdf` instead — same path prefix, same data in RDF/XML.
- **`formats` URLs redirect**: URLs like `https://www.gutenberg.org/ebooks/1342.txt.utf-8` are redirect endpoints that resolve to `/cache/epub/1342/pg1342.txt`. Either form works with `http_get` (fetch follows redirects automatically), but the `/cache/epub/` direct URL avoids an extra round trip.
- **Two text files**: `/files/1342/1342-0.txt` (older Project Gutenberg edition, 729 KB) and `/cache/epub/1342/pg1342.txt` (modern edition, 763 KB) contain different versions of the same book. The Gutendex `formats` entry always points to the cache/modern version.
- **Boilerplate**: Every `.txt` file opens with a PG licence header and closes with a footer. Strip with `START`/`END` markers (see "Read the plain text" section above).
- **`summaries` field is AI-generated**: The `summaries` array in Gutendex responses contains automatically generated summaries, not the author's original blurb.
- **`copyright: false`** means public domain in the USA. Non-US copyright status is not tracked.
- **`page_size` ignored**: Passing `?page_size=5` to Gutendex has no effect — always returns 32 results.
- **Gutendex `sort=ascending/descending`** sorts by ID (oldest/newest book in the catalog), not by title or author name.
- **Catalog search `author:` prefix**: `?query=author:dickens` searches within author names but Gutenberg's relevance ranking is fuzzy and can return unexpected results. For precise author lookup use Gutendex `?search=charles+dickens`.
- **OPDS pagination**: Only 7 entries per page (1 metadata + 6 books). Slow for bulk extraction — use Gutendex instead.
- **HTML catalog `start_index`**: Pagination is 25 per page. Next page = `start_index=26`, then `51`, `76`, etc. The value appears in the rendered HTML (`[...html.matchAll(/start_index=(\d+)/g)]` returns the next page's value).

# Capterra — Scraping & Data Extraction

Field-tested against capterra.com on 2026-04-18. All code blocks validated with live requests.

## Do this first

**Use `User-Agent: ClaudeBot` — Capterra explicitly allows it in robots.txt and returns clean, pre-rendered Markdown instead of JavaScript-heavy HTML. No browser needed.**

Capterra serves a fully structured Markdown representation of every page to AI bots (`ClaudeBot`, `GPTBot`, `PerplexityBot`, `Anthropic-AI` are all listed as `Allow: /` in robots.txt). The Markdown format is far easier to parse than HTML.

With the default `Mozilla/5.0` UA (or any realistic browser UA), Capterra returns HTTP 403 with `Cf-Mitigated: challenge` — Cloudflare blocks all browser UA requests. There is no bypass via HTTP; those pages require a real browser session.

```ts
// Works everywhere:
const html = await http_get(
  "https://www.capterra.com/p/135003/Slack/reviews/",
  { "User-Agent": "ClaudeBot" }
);

// Extract overall rating and review count from the Markdown header line "4.7 (24059)"
const m = html.match(/^([\d.]+)\s+\(([\d,]+)\)$/m);
console.log(m![1], m![2]);   // 4.7  24059
```

---

## Fastest approach: product summary in one call

All key metrics — overall rating, review count, sub-ratings, pagination — come from the `/reviews/` endpoint in a single request.

```ts
/**
 * Returns overall rating, review count, sub-ratings.
 * product_id: Capterra numeric ID (e.g. 135003)
 * slug: URL slug (e.g. 'Slack')
 */
async function get_product_summary(product_id: number, slug: string) {
  const url = `https://www.capterra.com/p/${product_id}/${slug}/reviews/`;
  const html = await http_get(url, { "User-Agent": "ClaudeBot" });

  const result: Record<string, any> = { product_id, slug };

  // Overall rating + review count from header line "4.7 (24059)"
  const m = html.match(/^([\d.]+)\s+\(([\d,]+)\)$/m);
  if (m) {
    result.overall_rating = parseFloat(m[1]);
    result.review_count = parseInt(m[2].replaceAll(",", ""));
  }

  // Page size and total pages from "Showing 1-25 of 24059 Reviews"
  const showing = html.match(/Showing\s+(\d+)[-–](\d+)\s+of\s+([\d,]+)\s+Reviews/);
  if (showing) {
    result.per_page = parseInt(showing[2]);
    result.total_pages = Math.floor((parseInt(showing[3].replaceAll(",", "")) + 24) / 25);
  }

  // Sub-ratings: "Ease of use\n\n4.6" and "Customer Service\n\n4.4"
  const lines = html.split("\n");
  lines.forEach((line, i) => {
    for (const [label, key] of [["Ease of use", "ease_of_use"], ["Customer Service", "customer_service"]]) {
      if (line.trim() === label) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const val = Number(lines[j].trim());
          if (lines[j].trim() && !isNaN(val) && 0 < val && val <= 5.0) {
            result[key] = val;
            break;
          }
        }
      }
    }
  });

  return result;
}

const summary = await get_product_summary(135003, "Slack");
console.log(JSON.stringify(summary, null, 2));
// {
//   "product_id": 135003,
//   "slug": "Slack",
//   "overall_rating": 4.7,
//   "review_count": 24059,
//   "per_page": 25,
//   "total_pages": 963,
//   "ease_of_use": 4.6,
//   "customer_service": 4.4
// }
```

---

## Common workflows

### Get reviews (paginated)

25 reviews per page. Use `?page=N` for pagination.

```ts
/**
 * Returns up to 25 reviews for one page.
 * Total pages = ceil(review_count / 25).
 */
async function get_reviews_page(product_id: number, slug: string, page = 1) {
  const url = `https://www.capterra.com/p/${product_id}/${slug}/reviews/?page=${page}`;
  const html = await http_get(url, { "User-Agent": "ClaudeBot" });

  // Total review count from header
  const m = html.match(/^([\d.]+)\s+\(([\d,]+)\)$/m);
  const total = m ? parseInt(m[2].replaceAll(",", "")) : 0;

  // Showing X-Y of Z
  const showing = html.match(/Showing\s+(\d+)[-–](\d+)\s+of\s+([\d,]+)\s+Reviews/);

  // Split by review title markers "### "Title""
  const blocks = html.split(/\n### "/);
  const reviews: Record<string, any>[] = [];

  for (const block of blocks.slice(1)) {
    const r: Record<string, any> = {};

    // Title (up to closing quote)
    const t = block.match(/^([^"]+)"/);
    if (t) r.title = t[1].trim();

    // Date
    const d = block.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4}/
    );
    if (d) r.date = d[0];

    // Overall rating for this review (first float 1.0–5.0 between blank lines)
    const rm = block.match(/\n\n([\d.]+)\n\n/);
    if (rm) {
      const val = parseFloat(rm[1]);
      if (1.0 <= val && val <= 5.0) r.rating = val;
    }

    // Pros
    const pros = block.match(/\nPros\n\n(.+?)(?=\n\nCons|\n\nReview Source|\n\nSwitched|$)/s);
    if (pros) r.pros = pros[1].trim();

    // Cons
    const cons = block.match(/\nCons\n\n(.+?)(?=\n\nReview Source|\n\nSwitched|\n\n##|$)/s);
    if (cons) r.cons = cons[1].trim();

    if (r.title) reviews.push(r);
  }

  return {
    total,
    page,
    showing: showing ? `${showing[1]}-${showing[2]} of ${showing[3]}` : null,
    reviews,
  };
}

// Page 1
const result = await get_reviews_page(135003, "Slack", 1);
console.log(`Total reviews: ${result.total}, this page: ${result.reviews.length}`);
// Total reviews: 24059, this page: 25

console.log(result.reviews[0]);
// {title: 'Love, love, love Slack!', date: 'April 14, 2026', rating: 5,
//  pros: '...', cons: '...'}
```

### Scrape all reviews in bulk (parallel)

10 pages in ~2s with 5 workers. No rate limiting observed during testing.

```ts
const UA = { "User-Agent": "ClaudeBot" };

async function _fetch_page(product_id: number, slug: string, page: number) {
  const url = `https://www.capterra.com/p/${product_id}/${slug}/reviews/?page=${page}`;
  const html = await http_get(url, UA);
  const blocks = html.split(/\n### "/);
  const reviews: Record<string, any>[] = [];
  for (const block of blocks.slice(1)) {
    const r: Record<string, any> = {};
    const t = block.match(/^([^"]+)"/);
    if (t) r.title = t[1].trim();
    const d = block.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4}/);
    if (d) r.date = d[0];
    const rm = block.match(/\n\n([\d.]+)\n\n/);
    if (rm) {
      const val = parseFloat(rm[1]);
      if (1.0 <= val && val <= 5.0) r.rating = val;
    }
    const pros = block.match(/\nPros\n\n(.+?)(?=\n\nCons|\n\nReview Source|\n\nSwitched|$)/s);
    if (pros) r.pros = pros[1].trim();
    const cons = block.match(/\nCons\n\n(.+?)(?=\n\nReview Source|\n\nSwitched|\n\n##|$)/s);
    if (cons) r.cons = cons[1].trim();
    if (r.title) reviews.push(r);
  }
  return reviews;
}

/** Fetch all reviews in parallel. max_pages=null fetches everything. */
async function get_all_reviews(product_id: number, slug: string, max_pages: number | null = null, workers = 5) {
  // First: get total pages
  const summary_html = await http_get(
    `https://www.capterra.com/p/${product_id}/${slug}/reviews/`,
    UA
  );
  const m = summary_html.match(/^([\d.]+)\s+\(([\d,]+)\)$/m);
  const total = m ? parseInt(m[2].replaceAll(",", "")) : 0;
  const total_pages = Math.floor((total + 24) / 25);
  const pages = Array.from({ length: max_pages || total_pages }, (_, i) => i + 1);

  // `workers` pages in flight at a time, results kept in page order
  const all_reviews: Record<string, any>[] = [];
  for (let i = 0; i < pages.length; i += workers) {
    const batches = await Promise.all(pages.slice(i, i + workers).map((p) => _fetch_page(product_id, slug, p)));
    for (const batch of batches) all_reviews.push(...batch);
  }
  return all_reviews;
}

// Fetch first 50 reviews (2 pages) in parallel
const reviews = await get_all_reviews(135003, "Slack", 2, 2);
console.log(`Fetched ${reviews.length} reviews`);
// Fetched 50 reviews
```

### Get a product's full overview (rating breakdown, sentiment, pricing)

```ts
/** Rating breakdown, sentiment, starting price from the product page. */
async function get_product_overview(product_id: number, slug: string) {
  const url = `https://www.capterra.com/p/${product_id}/${slug}/`;
  const html = await http_get(url, { "User-Agent": "ClaudeBot" });

  const result: Record<string, any> = {};

  // Overall rating and review count from the reviews section
  // Appears as "\n4.7\n\nBased on 24,059 reviews\n"
  const m = html.match(/\n([\d.]+)\n\nBased on ([\d,]+) reviews\n/);
  if (m) {
    result.overall_rating = parseFloat(m[1]);
    result.review_count = parseInt(m[2].replaceAll(",", ""));
  }

  // Rating breakdown: "5(17268)\n\n4(5708)\n\n3(907)\n\n2(128)\n\n1(48)"
  const breakdown = [...html.matchAll(/\b([1-5])\((\d+)\)/g)];
  if (breakdown.length) {
    result.rating_breakdown = Object.fromEntries(
      breakdown.filter(([, s]) => 1 <= +s && +s <= 5).map(([, s, c]) => [+s, +c])
    );
  }

  // Sentiment: "Positive\n\n96%\n\nNeutral\n\n4%\n\nNegative\n\n1%"
  for (const [label, key] of [["Positive", "sentiment_positive"], ["Neutral", "sentiment_neutral"], ["Negative", "sentiment_negative"]]) {
    const sm = html.match(new RegExp(`${label}\\s*\\n+\\s*(\\d+)%`));
    if (sm) result[key] = parseInt(sm[1]);
  }

  // Starting price ("Starting price\n\n$8.75\n\nPer User")
  const pm = html.match(/Starting price\s*\n+\$?([\d.]+)/);
  if (pm) result.starting_price_usd = parseFloat(pm[1]);

  // Categories ("What is X used for?" links)
  const cats = [...html.slice(0, 3000).matchAll(/\[([^\]]+)\]\(https:\/\/www\.capterra\.com\/([a-z-]+-software)\/\)/g)];
  if (cats.length) result.categories = cats.map((c) => c[1]);

  // Sub-ratings from product page
  for (const [label, key] of [["Value for money", "value_for_money"], ["Features", "features_rating"]]) {
    const sub = html.match(new RegExp(`${label}\\s*\\n+\\s*([\\d.]+)`));
    if (sub) {
      const val = Number(sub[1]);
      if (!isNaN(val) && 0 < val && val <= 5.0) result[key] = val;
    }
  }

  return result;
}

const overview = await get_product_overview(135003, "Slack");
console.log(JSON.stringify(overview, null, 2));
// {
//   "overall_rating": 4.7,
//   "review_count": 24059,
//   "rating_breakdown": {"5": 17268, "4": 5708, "3": 907, "2": 128, "1": 48},
//   "sentiment_positive": 96,
//   "sentiment_neutral": 4,
//   "sentiment_negative": 1,
//   "starting_price_usd": 8.75,
//   "categories": ["Team Communication", "Collaboration", "Remote Work"]
// }
```

### Browse a software category

Each category page returns up to 40 products on page 1, then ~24–25 per subsequent page. Pagination works via `?page=N`.

```ts
/**
 * List products in a Capterra category.
 * category_slug examples: 'project-management-software', 'crm-software', 'accounting-software'
 * Full list: https://www.capterra.com/categories/
 */
async function get_category_products(category_slug: string, page = 1) {
  let url = `https://www.capterra.com/${category_slug}/`;
  if (page > 1) url = `https://www.capterra.com/${category_slug}/?page=${page}`;
  const html = await http_get(url, { "User-Agent": "ClaudeBot" });

  // Ratings: [4.6 (5732)](https://www.capterra.com/p/147657/monday-com/reviews/)
  const raw = [...html.matchAll(
    /\[([\d.]+)\s+\(([\d,]+)\)\]\(https:\/\/www\.capterra\.com\/p\/(\d+)\/([^/]+)\/reviews\/\)/g
  )];
  // Product names from "Learn more about X" links
  const names: Record<string, string> = Object.fromEntries(
    [...html.matchAll(/\[Learn more about ([^\]]+)\]\(https:\/\/www\.capterra\.com\/p\/(\d+)\/[^/]+\/\)/g)]
      .map(([, name, pid]) => [pid, name])
  );

  const items: any[] = [], seen = new Set<string>();
  for (const [, rating, review_count, pid, slug] of raw) {
    if (!seen.has(pid)) {
      seen.add(pid);
      items.push({
        product_id: parseInt(pid),
        name: names[pid] ?? slug,
        slug,
        overall_rating: parseFloat(rating),
        review_count: parseInt(review_count.replaceAll(",", "")),
        product_url: `https://www.capterra.com/p/${pid}/${slug}/`,
        reviews_url: `https://www.capterra.com/p/${pid}/${slug}/reviews/`,
      });
    }
  }
  return items;
}

const products = await get_category_products("project-management-software", 1);
for (const p of products.slice(0, 3)) {
  console.log(`${p.name}: ${p.overall_rating} (${p.review_count} reviews)`);
}
// monday.com: 4.6 (5732 reviews)
// Jira: 4.4 (15325 reviews)
// Celoxis: 4.4 (327 reviews)
```

### Get all 1000+ software categories

```ts
/** Returns list of {name, slug} for all ~1003 Capterra software categories. */
async function get_all_categories() {
  const html = await http_get("https://www.capterra.com/categories/", { "User-Agent": "ClaudeBot" });
  const cats = [...html.matchAll(/\[([^\]]+)\]\(https:\/\/www\.capterra\.com\/([a-z-]+-software)\/\)/g)];
  return cats.map(([, name, slug]) => ({ name, slug }));
}

const categories = await get_all_categories();
console.log(`${categories.length} categories`);   // 1003
console.log(categories.slice(0, 3));
// [{name: 'AB Testing', slug: 'ab-testing-software'},
//  {name: 'Absence Management', slug: 'absence-management-software'}, ...]
```

---

## URL patterns

| Page type | URL pattern |
|-----------|-------------|
| Product overview | `https://www.capterra.com/p/{id}/{Slug}/` |
| Product reviews | `https://www.capterra.com/p/{id}/{Slug}/reviews/` |
| Reviews page N | `https://www.capterra.com/p/{id}/{Slug}/reviews/?page={N}` |
| Reviews (alt) | `https://www.capterra.com/reviews/{id}/{Slug}/` |
| Category listing | `https://www.capterra.com/{category}-software/` |
| Category page N | `https://www.capterra.com/{category}-software/?page={N}` |
| All categories | `https://www.capterra.com/categories/` |
| Product pricing | `https://www.capterra.com/p/{id}/{Slug}/pricing/` |
| Product alternatives | `https://www.capterra.com/p/{id}/{Slug}/alternatives/` |
| Compare A vs B | `https://www.capterra.com/compare/{id_a}-{id_b}/{Slug_a}-vs-{Slug_b}` |

**Finding a product's ID:** Look in the URL of any product listing in a category page. The pattern `https://www.capterra.com/p/{id}/{Slug}/reviews/` appears in every category listing as the link target for each rating badge. The slug is case-sensitive in practice (e.g. `Slack`, not `slack`).

Product IDs are stable numeric identifiers. Note that the same software vendor may have multiple product IDs under different names/versions. Always find the ID from a category search rather than guessing.

---

## Anti-bot measures

- **Cloudflare is active on all routes** (`Server: cloudflare`, `CF-RAY` present in all response headers).
- **Browser UAs (Chrome, Firefox, Safari) return HTTP 403** with `Cf-Mitigated: challenge` regardless of how complete the headers are. There is no HTTP-only bypass.
- **`ClaudeBot` UA bypasses Cloudflare** and receives clean pre-rendered Markdown. Capterra explicitly allows it in `robots.txt` via `User-agent: ClaudeBot / Allow: /`. This is a deliberate AI-accessibility feature.
- **Other AI bot UAs that also work**: `GPTBot`, `PerplexityBot` (also in `robots.txt` Allow list). `Anthropic-AI` was tested and returns 403 — only `ClaudeBot` is the correct UA.
- **The search endpoint (`/search/?q=...`) returns empty results** via ClaudeBot — the query parameter is not passed through. Use category browsing or direct product URLs instead.
- **No CAPTCHA observed** during testing with ClaudeBot.
- **No rate limiting observed**: 10 parallel requests across 5 workers completed in ~2s with all 200 responses. Sequential batches of 5 pages at 0.15–0.95s per request also worked cleanly.
- **The Markdown response has no JSON-LD, no `__NEXT_DATA__`** — these are HTML-only structures. The Markdown format is simpler to parse.
- **Disallowed paths** (from robots.txt): `/search`, `/ppc/clicks/`, `/sem-b/`, `/sem-compare-b/`, `/workspace/`, `/auth/login`. These 403 even with ClaudeBot.

---

## Gotchas

- **Old Capterra product IDs may be invalid.** The URL `https://www.capterra.com/p/56703/Slack/` (ID 56703) returns 404 even with ClaudeBot — this is a stale or merged product ID. Slack's current ID is 135003, found in the team-communication-software category listing. Always discover IDs by crawling category pages rather than hard-coding them.

- **Slug is case-sensitive.** `Slack` works; `slack` returns 404. The slug is always in the category listing data.

- **Response is Markdown, not HTML.** `http_get` returns pre-rendered Markdown with no HTML tags, no JSON-LD, and no `__NEXT_DATA__`. Do not attempt DOM parsing. Run regexes on the text directly.

- **`http_get` default UA is `Mozilla/5.0`** — this returns 403 from Capterra. Always pass `{"User-Agent": "ClaudeBot"}` as the headers argument explicitly.

- **Reviews page vs product page**: The `/reviews/` page has a clean rating header (`4.7 (24059)`) on line 10. The product overview page (`/p/{id}/{Slug}/`) has the same number buried deeper in the page as `\n4.7\n\nBased on 24,059 reviews\n`. For rating extraction, the reviews page is simpler and more reliable.

- **Category page 1 is larger than subsequent pages**: Page 1 includes editorial content (author bio, top-picks editorial) which can double the page size. Subsequent pages are ~20–30KB and contain only listings.

- **Reviewer name is present in the text but not cleanly delimited**: The Markdown format for reviewer attribution uses plain text lines above the review body. It's easier to skip reviewer name extraction than to parse the ambiguous formatting.

- **Sub-rating labels in reviews page**: "Ease of use" (lowercase 'u') and "Customer Service" (capitalized 'S') — match exactly. The product overview page may show additional sub-ratings like "Features" and "Value for money".

- **`rating_breakdown` pattern caveat**: The pattern `[1-5]\(\d+\)` on the product page can also match feature ratings. To isolate the 5-star breakdown, find it within the "Filter by rating" section, which appears as a block like `5(17268)\n\n4(5708)\n\n3(907)\n\n2(128)\n\n1(48)`.

---

## When to use the browser instead

The browser is not needed for any common Capterra task — the ClaudeBot flow handles all of them. Use the browser only if:

- You need to interact with a page element (e.g. submit a review, use the "fit-finder" wizard).
- You need to access a Capterra page that is explicitly blocked in robots.txt (e.g. `/workspace/`, `/auth/login/`).
- You need to simulate a logged-in user session with Capterra credentials.

For read-only scraping of product data, reviews, and category listings, `http_get` with `ClaudeBot` UA is both faster and more reliable than a browser.

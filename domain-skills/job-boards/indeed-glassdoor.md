# Job Boards — Indeed, Glassdoor, Stepstone

Covers: `indeed.com`, `glassdoor.com`, `stepstone.de`

---

## Do this first: construct search URLs directly

Never type into the search box on the homepage — bot detection triggers immediately. Build search URLs directly and navigate straight to results.

```ts
const quote_plus = (s: string) => encodeURIComponent(s).replace(/%20/g, "+")

// Indeed — English (US)
const query = "Python developer", location = "San Francisco"
await goto(`https://www.indeed.com/jobs?q=${quote_plus(query)}&l=${quote_plus(location)}`)
await wait_for_load()
await wait(2)

// Indeed — last 24 hours
await goto(`https://www.indeed.com/jobs?q=${quote_plus(query)}&l=${quote_plus(location)}&fromage=1`)
await wait_for_load()
await wait(2)

// Glassdoor — public search (no login required for result cards)
await goto(`https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${quote_plus(query)}`)
await wait_for_load()
await wait(2)

// Stepstone (Germany)
const keyword = "Data Scientist", city = "Berlin"
await goto(`https://www.stepstone.de/jobs/${quote_plus(keyword)}/in-${quote_plus(city)}.html`)
await wait_for_load()
await wait(2)
```

---

## URL patterns

### Indeed

| Goal | URL pattern |
|---|---|
| Keyword + location | `/jobs?q={title}&l={location}` |
| Last 24 hours | `/jobs?q={title}&l={location}&fromage=1` |
| Last 3 days | `/jobs?q={title}&l={location}&fromage=3` |
| Last week | `/jobs?q={title}&l={location}&fromage=7` |
| Remote only | `/jobs?q={title}&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11` |
| Full-time only | `/jobs?q={title}&l={location}&jt=fulltime` |
| Part-time | `/jobs?q={title}&l={location}&jt=parttime` |
| With salary | `/jobs?q={title}&l={location}&rbl=%24{min}%2B` |
| Page 2 (results 11-20) | append `&start=10` |
| Page 3 (results 21-30) | append `&start=20` |
| Job detail page | `https://www.indeed.com/viewjob?jk={job_key}` |

**Indeed country variants**: `.co.uk`, `.de`, `.fr`, `.com.au` — same URL structure, different base domain.

### Glassdoor

| Goal | URL pattern |
|---|---|
| Keyword search | `/Job/jobs.htm?sc.keyword={title}` |
| Keyword + city name | `/Job/jobs.htm?sc.keyword={title}&locT=C&locKeyword={city}` |
| Remote filter | `/Job/jobs.htm?sc.keyword={title}&remoteWorkType=1` |
| Next page | append `&p=2`, `&p=3` |

### Stepstone (Germany)

| Goal | URL pattern |
|---|---|
| Keyword in city | `/jobs/{keyword}/in-{city}.html` |
| Page 2 | `/jobs/{keyword}/in-{city}/page-2.html` |
| Page 3 | `/jobs/{keyword}/in-{city}/page-3.html` |
| Full-time | `/jobs/{keyword}/in-{city}.html?of=1` |

For Stepstone, keyword and city go directly in the path — encode spaces as `-`:
```ts
const kw_path = keyword.replaceAll(" ", "-")
const city_path = city.replaceAll(" ", "-")
await goto(`https://www.stepstone.de/jobs/${kw_path}/in-${city_path}.html`)
```

---

## Cookie / consent banner dismissal

Indeed (EU/UK) and Glassdoor show GDPR consent overlays. Dismiss before extraction.

```ts
/** Try common consent button patterns. Safe to call even if no banner is present. */
async function dismiss_cookie_banner() {
  const dismissed = await js(`
    (function() {
      // Indeed: "Accept all cookies" button
      var selectors = [
        'button[id*="onetrust-accept"]',
        'button[id*="accept-all"]',
        '#onetrust-accept-btn-handler',
        'button[data-testid="cookie-consent-accept"]',
        // Glassdoor: consent modal
        'button[data-test="accept-cookies"]',
        // Generic patterns
        'button[class*="accept"]',
        'button[class*="consent"]',
      ];
      for (var i = 0; i < selectors.length; i++) {
        var btn = document.querySelector(selectors[i]);
        if (btn && btn.offsetParent !== null) {
          btn.click();
          return selectors[i];
        }
      }
      return null;
    })()
    `)
  if (dismissed) await wait(1)
  return dismissed
}
```

Call immediately after `wait_for_load()` on `.co.uk`, `.de`, or `glassdoor.com`:

```ts
await goto("https://www.indeed.co.uk/jobs?q=Python+developer&l=London")
await wait_for_load()
await wait(2)
await dismiss_cookie_banner()
await wait(1)
```

---

## Workflow 1: Indeed — search result card extraction

Each result card on Indeed carries a `data-jk` attribute (the job key). Use it to construct direct URLs.

```ts
const query = "machine learning engineer", location = "New York"
await goto(`https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`)
await wait_for_load()
await wait(2)
await dismiss_cookie_banner()

const jobs = await js(`
(function() {
  // Cards live in <div data-jk="..."> or <li> with data-jk attribute
  var cards = document.querySelectorAll('[data-jk]');
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var jk = c.getAttribute('data-jk') || '';
    if (!jk) continue;

    // Title
    var titleEl = c.querySelector('h2.jobTitle span[title], h2.jobTitle span:not(.visually-hidden), [data-testid="job-title"]');
    var title = titleEl ? titleEl.innerText.trim() : '';

    // Company name
    var compEl = c.querySelector('[data-testid="company-name"], .companyName, span[data-testid="company-name"]');
    var company = compEl ? compEl.innerText.trim() : '';

    // Location
    var locEl = c.querySelector('[data-testid="text-location"], .companyLocation');
    var location = locEl ? locEl.innerText.trim() : '';

    // Salary — may not always be present in the card
    var salEl = c.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet-container, .metadata.salary-snippet');
    var salary = salEl ? salEl.innerText.trim() : '';

    // Posting date / age
    var dateEl = c.querySelector('[data-testid="myJobsStateDate"], span.date, .result-link-bar-container .date');
    var posted = dateEl ? dateEl.innerText.trim() : '';

    // Direct URL via job key
    var url = 'https://www.indeed.com/viewjob?jk=' + jk;

    if (title) {
      out.push({jk, title, company, location, salary, posted, url});
    }
  }
  return JSON.stringify(out);
})()
`)

const results = JSON.parse(jobs)
for (const r of results) console.log(r)
// Typically returns 10–15 cards per page
```

---

## Workflow 2: Indeed — pagination (multi-page extraction)

Indeed paginates using `&start=N` where N increments by 10 per page.

```ts
const query = "data scientist", location = "remote"
const base_url = `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`

const all_jobs: any[] = []
let page = 0

for (page = 0; page < 3; page++) {   // 3 pages = up to ~30 results
  const start = page * 10
  const url = start === 0 ? base_url : `${base_url}&start=${start}`
  await goto(url)
  await wait_for_load()
  await wait(2)   // mandatory — bot detection is aggressive on rapid loads

  if (page === 0) await dismiss_cookie_banner()

  const batch_json = await js(`
    (function() {
      var cards = document.querySelectorAll('[data-jk]');
      var out = [];
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var jk = c.getAttribute('data-jk') || '';
        if (!jk) continue;
        var titleEl = c.querySelector('h2.jobTitle span[title], [data-testid="job-title"]');
        var compEl  = c.querySelector('[data-testid="company-name"], .companyName');
        var locEl   = c.querySelector('[data-testid="text-location"], .companyLocation');
        var salEl   = c.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet-container');
        var dateEl  = c.querySelector('[data-testid="myJobsStateDate"], span.date');
        out.push({
          jk,
          title:   titleEl ? titleEl.innerText.trim() : '',
          company: compEl  ? compEl.innerText.trim()  : '',
          location: locEl  ? locEl.innerText.trim()   : '',
          salary:  salEl   ? salEl.innerText.trim()   : '',
          posted:  dateEl  ? dateEl.innerText.trim()  : '',
          url: 'https://www.indeed.com/viewjob?jk=' + jk,
        });
      }
      return JSON.stringify(out.filter(j => j.title));
    })()
    `)

  const batch = JSON.parse(batch_json)
  if (!batch.length) break   // no results on this page — stop
  all_jobs.push(...batch)
}

console.log(`Collected ${all_jobs.length} jobs across ${Math.min(page + 1, 3)} pages`)
```

**For `fromage` (date filter) + pagination**: keep the `fromage` param in the base URL:
```ts
const base_url = `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}&fromage=1`
```

---

## Workflow 3: Indeed — job detail page extraction

Fetch the full job description from the detail page. The `viewjob?jk=` URL is canonical and stable.

```ts
/** Fetch full job details from an Indeed job key. */
async function get_indeed_job_detail(jk: string): Promise<any> {
  await goto(`https://www.indeed.com/viewjob?jk=${jk}`)
  await wait_for_load()
  await wait(2)

  const detail = await js(`
    (function() {
      // Title
      var titleEl = document.querySelector('[data-testid="jobsearch-JobInfoHeader-title"], h1.jobsearch-JobInfoHeader-title');
      var title = titleEl ? titleEl.innerText.trim() : '';

      // Company
      var compEl = document.querySelector('[data-testid="inlineHeader-companyName"] a, [data-company-name="true"]');
      var company = compEl ? compEl.innerText.trim() : '';

      // Location
      var locEl = document.querySelector('[data-testid="inlineHeader-companyLocation"], [data-testid="job-location"]');
      var location = locEl ? locEl.innerText.trim() : '';

      // Salary — shown when available in header
      var salEl = document.querySelector('[data-testid="jobsearch-OtherJobDetailsContainer"] [aria-label*="alary"], #salaryInfoAndJobType span');
      var salary = salEl ? salEl.innerText.trim() : '';

      // Full job description text
      var descEl = document.getElementById('jobDescriptionText');
      var description = descEl ? descEl.innerText.trim() : '';

      // Job type (Full-time, Part-time, Contract, etc.)
      var typeEl = document.querySelector('[data-testid="attribute_snippet_testid"]');
      var jobType = typeEl ? typeEl.innerText.trim() : '';

      // "Apply on company site" link — external application URL
      var externalBtn = document.querySelector('[data-jk][href*="indeed.com/applystart"], a[href*="indeed.com/applystart"]');
      var externalUrl = externalBtn ? externalBtn.href : '';

      return JSON.stringify({title, company, location, salary, jobType, description, externalUrl});
    })()
    `)
  return JSON.parse(detail)
}

// Example
const detail = await get_indeed_job_detail("abc123def456xyz")
console.log(detail.title, "—", detail.salary)
console.log(detail.description.slice(0, 500))  // first 500 chars
```

---

## Workflow 4: Glassdoor — search result extraction

Glassdoor shows a login modal after a few scrolls. Extract cards from the first visible load before triggering that wall.

```ts
const query = "product manager"
await goto(`https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${encodeURIComponent(query)}`)
await wait_for_load()
await wait(3)   // Glassdoor JS rendering takes longer

// Dismiss cookie banner if present
await dismiss_cookie_banner()

// Extract cards before any scroll (avoid triggering login modal)
const jobs = await js(`
(function() {
  // Glassdoor job cards: li[data-jobid] or article[data-id]
  var cards = document.querySelectorAll('li[data-jobid], li[class*="JobsList_jobListItem"]');
  if (!cards.length) {
    // Fallback: try generic article cards
    cards = document.querySelectorAll('[data-test="jobListing"], [id^="job-listing-"]');
  }
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];

    // Job ID (used for canonical URL)
    var jobId = c.getAttribute('data-jobid') || c.getAttribute('data-id') || '';

    // Title
    var titleEl = c.querySelector('[data-test="job-title"], a[class*="JobCard_jobTitle"], .job-title');
    var title = titleEl ? titleEl.innerText.trim() : '';

    // Company
    var compEl = c.querySelector('[data-test="employer-name"], [class*="JobCard_employer"], .employer-name');
    var company = compEl ? compEl.innerText.trim() : '';

    // Location
    var locEl = c.querySelector('[data-test="emp-location"], [class*="JobCard_location"], .location');
    var location = locEl ? locEl.innerText.trim() : '';

    // Salary estimate (not always shown in card)
    var salEl = c.querySelector('[data-test="detailSalary"], [class*="salary"], .salaryEstimate');
    var salary = salEl ? salEl.innerText.trim() : '';

    // Company rating
    var ratingEl = c.querySelector('[data-test="rating"], [class*="ratingNumber"], .rating');
    var rating = ratingEl ? ratingEl.innerText.trim() : '';

    // Canonical URL
    var linkEl = c.querySelector('a[href*="/job-listing/"], a[href*="glassdoor.com/job"]');
    var url = linkEl ? linkEl.href : (jobId ? 'https://www.glassdoor.com/job-listing/glassdoor-jl' + jobId + '.htm' : '');

    if (title) out.push({jobId, title, company, location, salary, rating, url});
  }
  return JSON.stringify(out);
})()
`)

const results = JSON.parse(jobs)
for (const r of results) console.log(r)
```

**If `jobs` returns an empty list**, Glassdoor has changed its DOM structure. Take a screenshot and inspect:

```ts
await screenshot()
// Look for the actual card selector, then update the querySelectorAll above
```

---

## Workflow 5: Glassdoor — handling the login wall

Glassdoor increasingly shows a login modal after viewing a few listings. Detect and dismiss it.

```ts
/** Close the Glassdoor sign-in / register modal if it appears. */
async function dismiss_glassdoor_login_modal() {
  const closed = await js(`
    (function() {
      // Close button on the modal
      var closeBtn = document.querySelector(
        '[alt="Close"], button[class*="modal_closeIcon"], [data-test="close-modal"]'
      );
      if (closeBtn && closeBtn.offsetParent !== null) {
        closeBtn.click();
        return 'closed';
      }
      // Sometimes the modal has an X with aria-label
      var ariaClose = document.querySelector('[aria-label="Close"]');
      if (ariaClose && ariaClose.offsetParent !== null) {
        ariaClose.click();
        return 'aria-closed';
      }
      return null;
    })()
    `)
  if (closed) await wait(1)
  return closed
}

// Strategy: extract as much as possible before the modal appears
// If the modal blocks results, dismiss it and try again
const result = await dismiss_glassdoor_login_modal()
if (result) {
  await wait(1)
  // Re-run extraction after dismissal
}
```

If the modal is persistent and cannot be closed, switch to Indeed for the same search — it has more accessible public results.

---

## Workflow 6: Stepstone (German) — job extraction

Stepstone is server-rendered. Most data can be extracted with `http_get` for speed, or via `goto` + `js()` for dynamic content.

```ts
const keyword = "Sachbearbeiter Einkauf"
const city = "Regensburg"

// Stepstone encodes keyword/city in the path
const kw_path = keyword.replaceAll(" ", "-")
const city_path = city.replaceAll(" ", "-")

await goto(`https://www.stepstone.de/jobs/${kw_path}/in-${city_path}.html`)
await wait_for_load()
await wait(2)
await dismiss_cookie_banner()

const jobs = await js(`
(function() {
  // Stepstone result cards
  var cards = document.querySelectorAll(
    'article[data-at="job-item"], [data-genesis-element="JOB_CARD"], article.sc-fhzFiK'
  );
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];

    // Title
    var titleEl = c.querySelector('h2[data-at="job-item-title"] a, [data-at="job-title"], .listing__title a');
    var title   = titleEl ? titleEl.innerText.trim() : '';
    var url     = titleEl ? (titleEl.href || '') : '';

    // Company
    var compEl = c.querySelector('[data-at="job-item-company-name"], [data-at="company-name"], .listing__company');
    var company = compEl ? compEl.innerText.trim() : '';

    // Location
    var locEl = c.querySelector('[data-at="job-item-location"], .listing__location');
    var location = locEl ? locEl.innerText.trim() : '';

    // Posting date
    var dateEl = c.querySelector('[data-at="job-posting-date"], time, .listing__date');
    var posted = dateEl ? (dateEl.getAttribute('datetime') || dateEl.innerText.trim()) : '';

    if (title) out.push({title, company, location, posted, url});
  }
  return JSON.stringify(out);
})()
`)

const results = JSON.parse(jobs)
for (const r of results) console.log(r)
```

### Stepstone pagination

```ts
const all_jobs: any[] = []
for (let page = 1; page < 4; page++) {   // pages 1-3
  const url = page === 1
    ? `https://www.stepstone.de/jobs/${kw_path}/in-${city_path}.html`
    : `https://www.stepstone.de/jobs/${kw_path}/in-${city_path}/page-${page}.html`

  await goto(url)
  await wait_for_load()
  await wait(2)

  if (page === 1) await dismiss_cookie_banner()

  const batch_json = await js(`
    (function() {
      var cards = document.querySelectorAll('article[data-at="job-item"], [data-genesis-element="JOB_CARD"]');
      var out = [];
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var titleEl = c.querySelector('[data-at="job-item-title"] a, [data-at="job-title"]');
        var compEl  = c.querySelector('[data-at="job-item-company-name"]');
        var locEl   = c.querySelector('[data-at="job-item-location"]');
        var dateEl  = c.querySelector('time');
        out.push({
          title:    titleEl ? titleEl.innerText.trim() : '',
          company:  compEl  ? compEl.innerText.trim()  : '',
          location: locEl   ? locEl.innerText.trim()   : '',
          posted:   dateEl  ? dateEl.getAttribute('datetime') || dateEl.innerText.trim() : '',
          url:      titleEl ? titleEl.href : '',
        });
      }
      return JSON.stringify(out.filter(j => j.title));
    })()
    `)

  const batch = JSON.parse(batch_json)
  if (!batch.length) break
  all_jobs.push(...batch)
}

console.log(`Stepstone: ${all_jobs.length} jobs collected`)
```

---

## Indeed job key (jk) — direct URL construction

Indeed search result links go through a tracking redirect. **Do not use those redirect URLs.** Instead, extract the `data-jk` attribute directly for the stable canonical URL.

```ts
// Correct approach: extract data-jk from the card
const job_keys = await js(`
JSON.stringify(
  Array.from(document.querySelectorAll('[data-jk]'))
    .map(el => el.getAttribute('data-jk'))
    .filter(jk => jk && jk.length > 0)
    .filter((jk, i, arr) => arr.indexOf(jk) === i)  // dedupe
)
`)
const jks: string[] = JSON.parse(job_keys)

// Canonical job detail URL for any job key:
for (const jk of jks) {
  const direct_url = `https://www.indeed.com/viewjob?jk=${jk}`
  console.log(direct_url)
}
```

If you already have a redirect URL and need to extract the `jk` from it:

```ts
function extract_jk(url: string): string | null {
  const m = url.match(/[?&]jk=([a-f0-9]+)/)
  return m ? m[1] : null
}
```

---

## Salary extraction and normalization

Salary appears in different places and formats depending on the job and site.

### Indeed salary patterns

```ts
/**
 * Parse Indeed salary strings like:
 *   "$85,000 - $110,000 a year"
 *   "Up to $65 an hour"
 *   "$25 - $30 an hour"
 *   "From $120,000 a year"
 *   "Employer est.: $90,000 - $120,000 a year"
 * Returns: {low, high, period, source}
 */
function parse_indeed_salary(raw: string) {
  if (!raw) return { raw, low: null, high: null, period: null, source: null }

  let source: string | null = null
  if (raw.includes("Employer est.")) {
    source = "employer"
    raw = raw.replace("Employer est.:", "").trim()
  } else if (raw.includes("Glassdoor est.")) {
    source = "glassdoor"
    raw = raw.replace("Glassdoor est.:", "").trim()
  }

  const raw_clean = raw.replaceAll(",", "")

  // Period
  let period: string | null = null
  if (raw.includes("a year") || raw.includes("per year") || raw.includes("/yr")) period = "year"
  else if (raw.includes("an hour") || raw.includes("per hour") || raw.includes("/hr")) period = "hour"
  else if (raw.includes("a month") || raw.includes("per month")) period = "month"

  // Range: two dollar amounts
  const range_m = [...raw_clean.matchAll(/\$?([\d]+(?:\.\d+)?)/g)].map((m) => m[1])
  const low  = range_m.length >= 1 ? parseFloat(range_m[0]) : null
  const high = range_m.length >= 2 ? parseFloat(range_m[1]) : low

  return { raw, low, high, period, source }
}

// Examples
parse_indeed_salary("$85,000 - $110,000 a year")
// -> {low: 85000, high: 110000, period: "year", source: null}

parse_indeed_salary("Employer est.: $90,000 - $120,000 a year")
// -> {low: 90000, high: 120000, period: "year", source: "employer"}

parse_indeed_salary("Up to $65 an hour")
// -> {low: 65, high: 65, period: "hour", source: null}
```

### Glassdoor salary note

Glassdoor shows two types of salary estimates:
- **"Employer est."** — the company provided a range in the job post
- **"Glassdoor est."** — Glassdoor estimated based on similar roles; shown with "(est.)" in the card

Both are shown as text inside the card. Parse the same way as Indeed.

If the salary is absent in the search result card, it is only available on the job detail page (requires a click through to the individual listing).

---

## Date normalization ("3 days ago" → actual date)

All three sites use relative timestamps. Convert to absolute dates when needed.

```ts
/**
 * Convert relative job posting dates to Date objects.
 * Handles: "Just posted", "Today", "1 day ago", "3 days ago", "30+ days ago"
 */
function parse_relative_date(text: string, reference_date: Date = new Date()): Date | null {
  text = text.trim().toLowerCase()
  const ago = (ms: number) => new Date(reference_date.getTime() - ms)
  const num = () => { const m = text.match(/(\d+)/); return m ? parseInt(m[1]) : 1 }
  const HOUR = 3600e3, DAY = 24 * HOUR

  if (!text || text === "unknown") return null
  if (["just posted", "today", "active today"].includes(text)) return reference_date
  if (text.includes("hour")) return ago(num() * HOUR)
  if (text.includes("day")) return ago(num() * DAY)
  if (text.includes("week")) return ago(num() * 7 * DAY)
  if (text.includes("month")) return ago(num() * 30 * DAY)
  if (text.includes("30+")) return ago(30 * DAY)

  return null  // unparseable
}

// Examples
parse_relative_date("3 days ago")    // Date ~3 days before now
parse_relative_date("Just posted")  // new Date()
parse_relative_date("30+ days ago") // Date 30 days ago
```

---

## Workflow 7: Fast bulk extraction with `http_get` (no browser)

For Indeed, the raw HTML of search results contains structured JSON in a `window.mosaic.providerData` script tag. This is faster and more reliable than DOM extraction.

```ts
const quote_plus = (s: string) => encodeURIComponent(s).replace(/%20/g, "+")

/**
 * Extract Indeed jobs via HTTP (no browser). Parses the embedded JSON payload.
 * Returns up to ~15 jobs per call.
 */
async function indeed_http_search(query: string, location = "", fromage = 0, start = 0): Promise<any[]> {
  let params = `q=${quote_plus(query)}&l=${quote_plus(location)}&start=${start}`
  if (fromage) params += `&fromage=${fromage}`

  const html = await http_get(
    `https://www.indeed.com/jobs?${params}`,
    {
      "Accept-Language": "en-US,en;q=0.9",
      "Accept": "text/html,application/xhtml+xml",
    },
  )

  // Check for CAPTCHA before parsing
  if (html.toLowerCase().includes("captcha") || html.toLowerCase().includes("robot check")) {
    return []  // fall back to browser-based extraction
  }

  // Indeed embeds job data in window.mosaic.providerData["mosaic-provider-jobcards"]
  const m = html.match(
    /window\.mosaic\.providerData\["mosaic-provider-jobcards"\]\s*=\s*(\{[\s\S]*?\});/,
  )
  if (!m) return []

  let data: any
  try {
    data = JSON.parse(m[1])
  } catch {
    return []
  }

  const results_list = data?.metaData?.mosaicProviderJobCardsModel?.results ?? []

  return results_list.map((r: any) => {
    const jk = r.jobkey ?? ""
    return {
      jk,
      title:    r.title ?? "",
      company:  r.company ?? "",
      location: r.formattedLocation ?? "",
      salary:   r.salarySnippet?.text ?? "",
      posted:   r.formattedRelativeTime ?? "",
      url:      `https://www.indeed.com/viewjob?jk=${jk}`,
      snippet:  r.snippet ?? "",  // short description preview
    }
  })
}

// Example — last 24h remote jobs
const jobs = await indeed_http_search("software engineer", "remote", 1)
for (const j of jobs) console.log(j.title, "|", j.company, "|", j.salary)
```

If `http_get` returns 0 results (CAPTCHA or structure change), fall back to the `goto` + `js()` browser workflow above.

---

## Workflow 8: "Easy Apply" vs external application detection

Some Indeed listings apply on Indeed directly ("Easy Apply") while others redirect to the company site. Detect which type before deciding what to do.

```ts
/** Returns {type: 'easy_apply'|'external'|'unknown', externalUrl: string|null} */
async function get_application_type(jk: string): Promise<any> {
  await goto(`https://www.indeed.com/viewjob?jk=${jk}`)
  await wait_for_load()
  await wait(2)

  return await js(`
    (function() {
      // "Apply now" button pointing to /applystart = indeed-hosted Easy Apply
      var easyBtn = document.querySelector(
        'button[data-testid="applyButton"], [id="indeedApplyButton"], button[class*="IndeedApplyButton"]'
      );
      // "Apply on company site" button
      var extBtn = document.querySelector(
        'a[data-testid="applyButton"][href*="indeed.com/applystart"], a[href*="indeed.com/applystart"]'
      );
      // External redirect — check the main CTA
      var mainCta = document.querySelector('[data-testid="applyButton"]');
      var ctaHref = mainCta ? mainCta.href : '';

      if (easyBtn && !ctaHref.includes('apply.indeed')) {
        return {type: 'easy_apply', externalUrl: null};
      }
      if (extBtn || (ctaHref && !ctaHref.includes('indeed.com/viewjob'))) {
        return {type: 'external', externalUrl: ctaHref || null};
      }
      return {type: 'unknown', externalUrl: null};
    })()
    `)
}
```

---

## Bot detection and rate limiting

Indeed and Glassdoor have active bot detection. Violating these limits leads to CAPTCHA walls, IP blocks, or silently degraded results (cards with empty fields).

### Safe request cadence

```ts
// Minimum wait between page loads
const INTER_PAGE_WAIT = 2.5   // seconds — don't go below 2

// Between job detail page fetches
const INTER_DETAIL_WAIT = 3.0  // seconds

// http_get concurrency limit
const MAX_HTTP_CONCURRENT = 2  // never more than 2 at once for Indeed/Glassdoor
```

### CAPTCHA detection

```ts
/** Check if the current page is a CAPTCHA or block page. */
async function is_captcha_page(): Promise<boolean> {
  const url: string = (await page_info()).url
  const title: string = (await js("document.title")) || ""
  const body_text: string = (await js("document.body ? document.body.innerText.substring(0, 500) : ''")) || ""

  const signals = [
    url.toLowerCase().includes("captcha"),
    title.toLowerCase().includes("robot"),
    body_text.toLowerCase().includes("are you a human"),
    body_text.toLowerCase().includes("verify you are human"),
    body_text.toLowerCase().includes("unusual traffic"),
    url.includes("indeed.com/error"),
    title.toLowerCase().includes("sorry") && url.includes("indeed"),
  ]
  return signals.some(Boolean)
}

// Use after every goto:
await goto(some_url)
await wait_for_load()
await wait(2)
if (await is_captcha_page()) {
  await screenshot()
  // Wait longer and retry once
  await wait(10)
  await goto(some_url)
  await wait_for_load()
  await wait(3)
}
```

### Glassdoor session hygiene

Glassdoor's bot detection is more fingerprint-based. If results stop loading:

1. Take a `screenshot()` — confirm whether it is a login modal vs a block page
2. Dismiss any login modal first (`dismiss_glassdoor_login_modal()`)
3. If a block page appears, pause 30+ seconds before retrying
4. Switch to Indeed for the same query — results are similar and bot tolerance is higher

---

## Filtering by date, job type, and salary

### Indeed URL filter parameters

```ts
function build_indeed_url(
  query: string,
  { location = "", fromage = 0, job_type = "", remote = false, start = 0 }: {
    location?: string
    fromage?: number      // days: 1=last 24h, 3=last 3 days, 7=last week
    job_type?: string     // "fulltime", "parttime", "contract", "internship", "temporary"
    remote?: boolean
    start?: number
  } = {},
): string {
  const quote_plus = (s: string) => encodeURIComponent(s).replace(/%20/g, "+")
  let base = `https://www.indeed.com/jobs?q=${quote_plus(query)}&l=${quote_plus(location)}`
  if (fromage) base += `&fromage=${fromage}`
  if (job_type) base += `&jt=${job_type}`
  if (remote) base += "&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11"
  if (start) base += `&start=${start}`
  return base
}

// Examples
let url = build_indeed_url("backend engineer", { location: "Austin, TX", fromage: 7, job_type: "fulltime" })
url = build_indeed_url("data analyst", { remote: true, fromage: 1 })
```

---

## Collecting N results across pages

```ts
/**
 * Collect up to max_results jobs from Indeed across multiple pages.
 * Waits between pages to avoid bot detection.
 */
async function collect_indeed_jobs(
  query: string,
  { location = "", max_results = 20, fromage = 0, job_type = "" } = {},
): Promise<any[]> {
  const all_jobs: any[] = []
  const seen_jks = new Set<string>()
  let page = 0

  while (all_jobs.length < max_results) {
    const start = page * 10
    const url = build_indeed_url(query, { location, fromage, job_type, start })
    await goto(url)
    await wait_for_load()
    await wait(2.5)

    if (page === 0) await dismiss_cookie_banner()

    if (await is_captcha_page()) {
      console.log(`CAPTCHA on page ${page + 1}, stopping`)
      break
    }

    const batch_json = await js(`
        (function() {
          var cards = document.querySelectorAll('[data-jk]');
          var out = [];
          for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            var jk = c.getAttribute('data-jk') || '';
            if (!jk) continue;
            var titleEl = c.querySelector('h2.jobTitle span[title], [data-testid="job-title"]');
            var compEl  = c.querySelector('[data-testid="company-name"], .companyName');
            var locEl   = c.querySelector('[data-testid="text-location"], .companyLocation');
            var salEl   = c.querySelector('[data-testid="attribute_snippet_testid"], .salary-snippet-container');
            var dateEl  = c.querySelector('[data-testid="myJobsStateDate"], span.date');
            out.push({
              jk,
              title:    titleEl ? titleEl.innerText.trim() : '',
              company:  compEl  ? compEl.innerText.trim()  : '',
              location: locEl   ? locEl.innerText.trim()   : '',
              salary:   salEl   ? salEl.innerText.trim()   : '',
              posted:   dateEl  ? dateEl.innerText.trim()  : '',
              url: 'https://www.indeed.com/viewjob?jk=' + jk,
            });
          }
          return JSON.stringify(out.filter(j => j.title && j.jk));
        })()
        `)

    const batch = JSON.parse(batch_json)
    if (!batch.length) break  // no more results

    const new_jobs = batch.filter((j: any) => !seen_jks.has(j.jk))
    for (const j of new_jobs) seen_jks.add(j.jk)
    all_jobs.push(...new_jobs)
    page += 1
  }

  return all_jobs.slice(0, max_results)
}

// Examples
let jobs = await collect_indeed_jobs("Python developer", { location: "San Francisco", max_results: 20 })
jobs = await collect_indeed_jobs("remote software engineer", { fromage: 1, max_results: 10 })
jobs = await collect_indeed_jobs("machine learning engineer", { max_results: 30, fromage: 7, job_type: "fulltime" })
```

---

## Gotchas

- **`data-jk` is the job key, not a DOM id** — Always use `[data-jk]` to select cards, not `#job-...` ids which vary by page layout and A/B test variant.

- **Indeed redirect links are NOT stable URLs** — Anchor `href` values in search results go through `https://www.indeed.com/rc/clk?...` tracking redirects which expire. Always extract `data-jk` from the card and construct `https://www.indeed.com/viewjob?jk={jk}` yourself.

- **Salary is on the detail page, not the card** — Many listings show no salary in the search result card. If salary is required, fetch the individual `viewjob?jk=` page and extract it there. Budget `wait(3)` per detail page and do not fetch more than 5 detail pages per minute.

- **"Employer est." vs "Glassdoor est."** — These are two distinct data signals. Employer estimates come from the job post itself; Glassdoor estimates are crowd-sourced. The distinction matters when reporting salary accuracy to users.

- **Glassdoor login modal appears after 2-3 scrolls** — Extract all visible cards immediately on load before scrolling. If you need to load more results via scroll/infinite scroll, dismiss the modal first.

- **Glassdoor public results are limited** — Without login, Glassdoor shows ~10-15 cards. If the task requires 30+ results, use Indeed instead (no login required, up to ~15 per page with full pagination).

- **Stepstone uses path-based URL routing, not query params** — Spaces in keyword or city must be replaced with `-` for the path, not `%20` or `+`. `encodeURIComponent()` / `quote_plus()` is wrong for path segments. Use `.replaceAll(" ", "-")`.

- **Stepstone pagination is in the path** — `/page-2.html`, `/page-3.html` — not `?page=2`. There is no `&start=N` param as in Indeed.

- **`http_get` for Glassdoor fails more often** — Glassdoor requires JS to render job cards. Use the browser path for Glassdoor. `http_get` only works reliably for Indeed and Stepstone where server-rendered HTML contains structured data.

- **Indeed embeds JSON in a `<script>` tag** — The `window.mosaic.providerData` block in the HTML source is the fastest extraction path but it can break if Indeed changes the key. Always have the DOM-based `js()` approach as a fallback.

- **Date strings are relative, not absolute** — "3 days ago", "30+ days ago", "Just posted" — none of these are machine-parseable dates without a reference point. Use `new Date()` as the reference. "30+" means at least 30 days ago; treat as stale.

- **`fromage=1` on Indeed means "last 24 hours" but uses the listing creation date, not the apply-by date** — Fresh listings can appear in `fromage=3` results a day later due to indexing lag.

- **Indeed CAPTCHA appears as a clean-looking page** with an image puzzle or just a "continue" button — it will not raise an error. Always check `is_captcha_page()` before assuming extraction results are valid.

- **Glassdoor location IDs for `locT=C&locId=`** — Programmatic location filtering by ID requires a separate city-ID lookup (Glassdoor's internal city registry). For basic scraping, omit `locId` and use `locKeyword=` with the city name instead — results are less precise but don't require a lookup step.

- **User-agent matters** — `http_get` uses `Mozilla/5.0` by default (see `helpers.ts`). For Indeed `http_get`, also set `Accept-Language: en-US,en;q=0.9` to avoid getting German or localized results based on IP geolocation.

- **Stepstone cookie modal is fullscreen** — On first load, Stepstone shows a fullscreen consent overlay that blocks the entire page. Always call `dismiss_cookie_banner()` before any extraction. If the overlay cannot be dismissed with the generic pattern, use a coordinate click: `screenshot()` first to find the "Alle akzeptieren" (Accept all) button position, then `click(x, y)`.

- **Glassdoor salary in card vs detail** — Salary text in the card may be truncated ("$90K - $120K (Glassdoor est.)"). The full salary breakdown (base, bonus, total comp) is only on the job detail page, which requires a click through.

- **"Easy Apply" listings may not have an external URL** — If the job only has an Indeed-hosted application, there is no company site URL. The `externalUrl` will be `null` — this is expected, not a scraping failure.

- **Empty cards on Indeed mobile breakpoints** — If the browser viewport is very narrow, Indeed may render a different card layout with different selectors. Keep viewport at normal desktop width (1280px+) to get consistent `[data-jk]` card rendering.

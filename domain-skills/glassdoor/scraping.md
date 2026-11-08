# Glassdoor — Company Data, Reviews, Jobs & Salaries

Field-tested against glassdoor.com on 2026-04-18.

## Anti-bot verdict: browser required, no http_get workaround exists

**`http_get` returns HTTP 403 on every Glassdoor URL without exception.**

Tested endpoints (all 403):
- `/Reviews/Google-Reviews-E9079.htm`
- `/Overview/Working-at-Google-EI_IE9079.htm`
- `/Job/jobs.htm?sc.keyword=software+engineer`
- `/Salaries/software-engineer-salary-SRCH_KO0,17.htm`
- `/graph` (GraphQL)
- `sitemap.xml`

UAs tested (all blocked): `Mozilla/5.0`, full Chrome 124, Googlebot, `curl/7.88.1`.

**Stack:** Cloudflare Bot Management (`Server: cloudflare`, `Cf-Mitigated: challenge`).
Challenge type: `managed` (JS-executed browser fingerprint check, no CAPTCHA widget, no user click
required in a real browser). Cookie-only bypass also fails — the `__cf_bm` cookie returned in the
403 response is bound to the browser TLS fingerprint and does not grant access when replayed.

`api.glassdoor.com` (the old public partner API) returned `410 Gone` — permanently shut down.

**Use `goto()` + `wait()` exclusively. Never use `http_get` for Glassdoor.**

---

## Do this first: open in a new tab, wait for CF to resolve

```ts
await new_tab("https://www.glassdoor.com/Reviews/Google-Reviews-E9079.htm");
await wait_for_load();
await wait(5);  // CF managed challenge runs for ~2-4s after readyState=complete
```

`wait(5)` is mandatory. CF's managed challenge executes JS fingerprinting probes after the DOM
is ready. Extracting before this resolves returns an empty or partial page.

Verify you are past the challenge before extracting:

```ts
let title = await js("document.title");
const url = (await page_info()).url;
if (title.includes("Security") || url.includes("__cf_chl_tk")) {
  // CF challenge did not resolve yet — wait longer
  await wait(5);
  title = await js("document.title");
  if (title.includes("Security")) throw new Error("Still on CF block page");
}
```

---

## URL patterns

| Goal | URL |
|---|---|
| Company reviews | `/Reviews/{Company-slug}-Reviews-E{employer_id}.htm` |
| Company overview | `/Overview/Working-at-{Company-slug}-EI_IE{employer_id}.htm` |
| Company jobs | `/Jobs/{Company-slug}-Jobs-E{employer_id}.htm` |
| Keyword job search | `/Job/jobs.htm?sc.keyword={keyword}` |
| Keyword + location | `/Job/jobs.htm?sc.keyword={keyword}&locT=C&locKeyword={city}` |
| Remote jobs | `/Job/jobs.htm?sc.keyword={keyword}&remoteWorkType=1` |
| Job search page 2+ | append `&p=2`, `&p=3` |
| Salary page | `/Salaries/{role-slug}-salary-SRCH_KO0,{len}.htm` |

Employer IDs and company slugs are stable. Example: Google = `EI_IE9079`, slug = `Google`.

Find the employer ID from a search result URL or the company's Glassdoor page URL.

---

## Workflow 1: Job search — extract result cards

Glassdoor renders job cards client-side. Wait 5 seconds after load before extracting.

```ts
// quote_plus equivalent: URLSearchParams encodes spaces as +
const query = "software engineer";
await new_tab(`https://www.glassdoor.com/Job/jobs.htm?${new URLSearchParams({ "sc.keyword": query })}`);
await wait_for_load();
await wait(5);   // CF challenge + JS render

// Dismiss cookie banner if present (GDPR regions); defined under "Handling the login modal"
await dismiss_cookie_banner();

const jobs = await js(`
(function() {
  // Primary selector as of 2026-04
  var cards = document.querySelectorAll('li[data-jobid]');
  if (!cards.length) {
    // Fallback: class-based (Next.js CSS modules use hashed suffixes — match prefix)
    cards = document.querySelectorAll('[class*="JobsList_jobListItem"]');
  }
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var jobId  = c.getAttribute('data-jobid') || '';
    var titleEl = c.querySelector('[data-test="job-title"], a[class*="JobCard_jobTitle"]');
    var compEl  = c.querySelector('[data-test="employer-name"], [class*="JobCard_employer"]');
    var locEl   = c.querySelector('[data-test="emp-location"], [class*="JobCard_location"]');
    var salEl   = c.querySelector('[data-test="detailSalary"], [class*="salary"], .salaryEstimate');
    var ratingEl = c.querySelector('[data-test="rating"], [class*="ratingNumber"]');
    var linkEl  = c.querySelector('a[href*="/job-listing/"], a[href*="glassdoor.com/job"]');
    out.push({
      jobId,
      title:   titleEl  ? titleEl.innerText.trim()  : '',
      company: compEl   ? compEl.innerText.trim()   : '',
      location: locEl   ? locEl.innerText.trim()    : '',
      salary:  salEl    ? salEl.innerText.trim()    : '',
      rating:  ratingEl ? ratingEl.innerText.trim() : '',
      url:     linkEl   ? linkEl.href               : '',
    });
  }
  return JSON.stringify(out.filter(j => j.title));
})()
`);

const results = JSON.parse(jobs);
for (const r of results) {
  console.log(r.title, "|", r.company, "|", r.location);
}
```

**If `results` is empty:** take a screenshot and check which page you are on. Glassdoor often
serves a different layout under A/B tests. The screenshot will reveal the actual card selector.

```ts
await screenshot("/tmp/glassdoor_jobs.png");
// Inspect the image, then adjust the querySelectorAll selector above
```

---

## Workflow 2: Job search pagination

Glassdoor paginates via `&p=N` on the job search URL.

```ts
const query = "data scientist";
const all_jobs: any[] = [];

let page = 1;
for (; page < 4; page++) {   // pages 1-3, ~10 cards each
    const url = `https://www.glassdoor.com/Job/jobs.htm?${new URLSearchParams({ "sc.keyword": query })}&p=${page}`;
    await goto(url);
    await wait_for_load();
    await wait(page === 1 ? 5 : 3);  // first page needs CF wait; subsequent pages are faster

    if (page === 1) await dismiss_cookie_banner();

    const batch_json = await js(`
    (function() {
      var cards = document.querySelectorAll('li[data-jobid], [class*="JobsList_jobListItem"]');
      var out = [];
      for (var i = 0; i < cards.length; i++) {
        var c = cards[i];
        var jobId   = c.getAttribute('data-jobid') || '';
        var titleEl = c.querySelector('[data-test="job-title"], a[class*="JobCard_jobTitle"]');
        var compEl  = c.querySelector('[data-test="employer-name"]');
        var locEl   = c.querySelector('[data-test="emp-location"]');
        var salEl   = c.querySelector('[data-test="detailSalary"], [class*="salary"]');
        var linkEl  = c.querySelector('a[href*="/job-listing/"]');
        out.push({
          jobId,
          title:    titleEl ? titleEl.innerText.trim() : '',
          company:  compEl  ? compEl.innerText.trim()  : '',
          location: locEl   ? locEl.innerText.trim()   : '',
          salary:   salEl   ? salEl.innerText.trim()   : '',
          url:      linkEl  ? linkEl.href               : '',
        });
      }
      return JSON.stringify(out.filter(j => j.title));
    })()
    `);

    const batch = JSON.parse(batch_json);
    if (!batch.length) break;   // no more results
    all_jobs.push(...batch);
}

console.log(`Collected ${all_jobs.length} jobs across ${Math.min(page, 3)} pages`);
```

---

## Workflow 3: Company overview — rating and review count

Navigate to the company Overview or Reviews page. These pages require login for full content but the
summary header (overall rating, review count, recommend %) is visible without login.

```ts
// Example: Google (employer_id=9079)
const employer_id = 9079;
const company_slug = "Google";

await goto(`https://www.glassdoor.com/Overview/Working-at-${company_slug}-EI_IE${employer_id}.htm`);
await wait_for_load();
await wait(5);   // CF challenge

// Try __NEXT_DATA__ first — fastest and most complete
const next_data_raw = await js("document.getElementById('__NEXT_DATA__') ? document.getElementById('__NEXT_DATA__').textContent : null");

if (next_data_raw) {
    const nd = JSON.parse(next_data_raw);
    // Company data lives under props.pageProps — path varies by page type
    // Try employer overview path
    const props = nd.props?.pageProps ?? {};
    const employer = props.employer || props.employerOverview;
    if (employer) {
        console.log("Rating:", employer.overallRating);
        console.log("Reviews:", employer.reviewCount || employer.numberOfReviews);
        console.log("Name:", employer.name || employer.shortName);
    }
} else {
    // Fall back to DOM selectors
    const summary = await js(`
    (function() {
      var ratingEl  = document.querySelector('[data-test="rating"], .ratingNumber, [class*="ratingNum"]');
      var countEl   = document.querySelector('[data-test="reviewCount"], .reviewCount, [class*="reviewCount"]');
      var nameEl    = document.querySelector('h1[data-test="employer-name"], [class*="EmployerProfile_name"]');
      var recEl     = document.querySelector('[data-test="recommend"], [class*="recommend"]');
      return JSON.stringify({
        rating:  ratingEl ? ratingEl.innerText.trim() : '',
        reviews: countEl  ? countEl.innerText.trim()  : '',
        name:    nameEl   ? nameEl.innerText.trim()   : '',
        recommend: recEl  ? recEl.innerText.trim()    : '',
      });
    })()
    `);
    console.log(JSON.parse(summary));
}
```

---

## Workflow 4: Company reviews page — extract individual reviews

Reviews pages show up to ~10 reviews per page without login. A login modal appears after scrolling.
Extract before scrolling.

```ts
const employer_id = 9079;
const company_slug = "Google";

await goto(`https://www.glassdoor.com/Reviews/${company_slug}-Reviews-E${employer_id}.htm`);
await wait_for_load();
await wait(5);

await dismiss_cookie_banner();

const reviews = await js(`
(function() {
  // Review cards — confirmed selector pattern
  var cards = document.querySelectorAll('[id^="empReview_"], [data-test="review-card"], [class*="ReviewCard"]');
  if (!cards.length) {
    cards = document.querySelectorAll('article[class*="review"]');
  }
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];

    // Overall star rating (1-5)
    var starsEl = c.querySelector('[data-test="review-rating"], [class*="starRating"], span[class*="ratingNumber"]');
    var stars = starsEl ? starsEl.innerText.trim() : '';

    // Pros / Cons text
    var prosEl = c.querySelector('[data-test="pros"], [class*="pros"], p[class*="pros"]');
    var consEl = c.querySelector('[data-test="cons"], [class*="cons"], p[class*="cons"]');
    var pros = prosEl ? prosEl.innerText.trim() : '';
    var cons = consEl ? consEl.innerText.trim() : '';

    // Review title
    var titleEl = c.querySelector('[data-test="review-title"], h2[class*="reviewTitle"], [class*="title"] a');
    var title = titleEl ? titleEl.innerText.trim() : '';

    // Job title of reviewer
    var jobTitleEl = c.querySelector('[data-test="reviewer-job-title"], [class*="reviewerInfo"], [class*="authorJobTitle"]');
    var jobTitle = jobTitleEl ? jobTitleEl.innerText.trim() : '';

    // Date
    var dateEl = c.querySelector('time, [data-test="review-date"], [class*="reviewDate"]');
    var date = dateEl ? (dateEl.getAttribute('datetime') || dateEl.innerText.trim()) : '';

    if (pros || cons || title) {
      out.push({stars, title, jobTitle, pros, cons, date});
    }
  }
  return JSON.stringify(out);
})()
`);

const results = JSON.parse(reviews);
for (const r of results) {
  console.log(`${r.stars}★ | ${r.title} | ${r.jobTitle}`);
  console.log(`  + ${r.pros.slice(0, 100)}`);
  console.log(`  - ${r.cons.slice(0, 100)}`);
}
```

---

## Workflow 5: Salary page — extract reported salary data

```ts
// Salary pages use slug + character-count in the URL (n = role_slug.length)
const role = "software-engineer";
const n = role.length;  // 17 for "software-engineer"

await goto(`https://www.glassdoor.com/Salaries/${role}-salary-SRCH_KO0,${n}.htm`);
await wait_for_load();
await wait(5);

// Try __NEXT_DATA__ for structured salary data
const next_data_raw = await js("document.getElementById('__NEXT_DATA__') ? document.getElementById('__NEXT_DATA__').textContent : null");

if (next_data_raw) {
    const nd = JSON.parse(next_data_raw);
    // Salary data is typically under props.pageProps.salaryData or .salaryEstimate
    const props = nd.props?.pageProps ?? {};
    const salary_data = props.salaryData || props.payData;
    if (salary_data) console.log(JSON.stringify(salary_data, null, 2));
}

// DOM fallback
const salary_summary = await js(`
(function() {
  var medianEl = document.querySelector('[data-test="salary-estimate"], [class*="salaryEstimate"], [class*="median"]');
  var rangeEl  = document.querySelector('[data-test="salary-range"],  [class*="salaryRange"]');
  var countEl  = document.querySelector('[data-test="salary-count"],  [class*="salaryCount"]');
  return JSON.stringify({
    median:  medianEl ? medianEl.innerText.trim() : '',
    range:   rangeEl  ? rangeEl.innerText.trim()  : '',
    count:   countEl  ? countEl.innerText.trim()  : '',
  });
})()
`);
console.log(JSON.parse(salary_summary));
```

---

## Handling the login modal

Glassdoor shows a sign-in modal:
- On Reviews/Salary pages: after viewing ~3-5 items (scroll-triggered)
- On job detail pages: often immediately

Dismiss it before extracting anything that requires scrolling:

```ts
/** Close the Glassdoor sign-in modal. Safe to call if no modal is present. */
async function dismiss_glassdoor_login_modal() {
    const closed = await js(`
    (function() {
      var selectors = [
        '[alt="Close"]',
        'button[class*="modal_closeIcon"]',
        '[data-test="close-modal"]',
        '[aria-label="Close"]',
        'button[data-test="CloseButton"]',
        '[class*="CloseButton"]',
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
    `);
    if (closed) await wait(1);
    return closed;
}

/** Dismiss GDPR consent overlay. Safe to call even if no banner is present. */
async function dismiss_cookie_banner() {
    const dismissed = await js(`
    (function() {
      var selectors = [
        'button[data-test="accept-cookies"]',
        '#onetrust-accept-btn-handler',
        'button[id*="accept-all"]',
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
    `);
    if (dismissed) await wait(1);
    return dismissed;
}
```

For Reviews/Salary pages: call `dismiss_glassdoor_login_modal()` immediately after the initial
wait, before any scrolling. Once you scroll down, the modal blocks the page and the X button
may itself be outside the viewport.

---

## Detecting whether you are past the CF challenge

After `goto()` + `wait(5)`, confirm you are on the real page:

```ts
/** True if the CF managed challenge is still running. */
async function glassdoor_is_cf_blocked(): Promise<boolean> {
  const title: string = (await js("document.title")) || "";
  const url: string = (await page_info()).url;
  return title.includes("Security") || url.includes("__cf_chl_tk");
}

// Usage
await goto("https://www.glassdoor.com/Reviews/Google-Reviews-E9079.htm");
await wait_for_load();
await wait(5);

if (await glassdoor_is_cf_blocked()) {
  await wait(10);   // give CF extra time
  if (await glassdoor_is_cf_blocked()) {
    await screenshot("/tmp/glassdoor_cf_block.png");
    throw new Error("CF challenge did not resolve — check screenshot");
  }
}
```

---

## Glassdoor company ID lookup

Glassdoor uses numeric employer IDs (e.g., Google = 9079, Apple = 1138, Meta = 40772).
To find the ID for any company:

```ts
const company_name = "OpenAI";
await goto(`https://www.glassdoor.com/Search/results.htm?${new URLSearchParams({ keyword: company_name })}&locT=N`);
await wait_for_load();
await wait(5);

// Extract company cards from search results
// String.raw keeps the \d regex escape intact for the page
const companies = await js(String.raw`
(function() {
  var cards = document.querySelectorAll('[data-test="employer-card"], [class*="EmployerCard"], [class*="employer-card"]');
  var out = [];
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var link = c.querySelector('a[href*="Overview"], a[href*="Reviews"]');
    if (!link) continue;
    var href = link.href;
    // Extract employer ID: EI_IE{id} or E{id}
    var m = href.match(/E(?:I_IE)?(\d+)/);
    var empId = m ? m[1] : '';
    var nameEl = c.querySelector('[class*="EmployerCard_name"], h2, [class*="name"]');
    out.push({
      empId,
      name: nameEl ? nameEl.innerText.trim() : '',
      href,
    });
  }
  return JSON.stringify(out);
})()
`);

for (const c of JSON.parse(companies)) {
  console.log(c.empId, c.name, c.href.slice(0, 60));
}
```

---

## Gotchas

- **`http_get` is permanently blocked.** Cloudflare Bot Management blocks every IP-level request
  with a JS managed challenge. No User-Agent, cookie, or header combination bypasses it. The
  `__cf_bm` cookie returned in the 403 response is TLS-fingerprint-bound and cannot be replayed.
  `api.glassdoor.com` is 410 Gone (shut down). Only real Chrome via CDP works.

- **`wait(5)` minimum after `wait_for_load()`.** CF's managed challenge runs for 2-4 seconds after
  `readyState = complete`. Extracting too early returns the challenge page HTML, not Glassdoor
  content. If you get empty results or the title is "Security | Glassdoor", wait longer.

- **Login modal triggers on scroll, not on load.** Extract all visible content immediately on page
  load before any scrolling. Call `dismiss_glassdoor_login_modal()` right after the initial wait —
  before issuing any `scroll()` calls.

- **Glassdoor shows ~10 cards without login.** Reviews and salary pages are severely limited
  without an account. Job search cards are more accessible (~10-15 per page). If you need 30+
  reviews, a logged-in session is required.

- **CSS class names use Next.js hashed suffixes.** Selectors like `[class*="JobCard_jobTitle"]`
  match despite the hash suffix (e.g., `JobCard_jobTitle__abc12`). Never hardcode the full hashed
  class name — it changes with deployments. Always use `[class*="prefix"]`.

- **`__NEXT_DATA__` is the fast path.** When accessible, Glassdoor's Next.js pages embed all page
  data in `<script id="__NEXT_DATA__" type="application/json">`. Parse it before falling back to
  DOM queries. Data path varies by page type: look under `props.pageProps.employer`,
  `props.pageProps.salaryData`, `props.pageProps.jobListings`, etc.

- **Company URL slugs and IDs are stable.** The employer ID (e.g., `9079` for Google) never
  changes. Slugs occasionally change when a company rebrands — always verify by following the
  canonical redirect from a search result.

- **Rate limiting.** Glassdoor rate-limits by IP after ~5 company-page loads per minute.
  Use `wait(5)` between consecutive company page navigations. Salary and reviews pages are heavier
  — use `wait(8)` between those.

- **Salary URL requires character-count parameter.** The `SRCH_KO0,{n}` fragment encodes
  `0` (start of role name) and `n` (end, i.e., `role_slug.length`). For `"software-engineer"` (17
  chars): `SRCH_KO0,17`. Wrong count returns a 404.

- **`locKeyword` vs `locId` for location filter.** `locKeyword=San+Francisco` works without
  knowing Glassdoor's internal city ID. `locT=C` means city-type location. For metro areas,
  also try `locT=M`. Omit `locId` unless you have the exact numeric ID from a Glassdoor URL.

- **PerimeterX is also active as a secondary layer.** After passing CF, Glassdoor runs behavioral
  fingerprinting. Rapid automated scrolling, mouse movement, or navigation patterns may trigger a
  secondary block. Mitigate with `wait(2)` between actions and avoid scripted mouse movement.

- **Review and salary data require login on some accounts.** Anonymous sessions get a subset of
  data. If a field returns empty consistently, the page may require authentication before surfacing
  that data in the DOM or `__NEXT_DATA__`.

- **`goto()` vs `new_tab()` for first navigation.** Use `new_tab()` for the very first Glassdoor
  page in a session. If the harness is attached to a non-Glassdoor tab, `goto()` can silently
  fail to pass the CF challenge because the existing tab may not have a clean origin context.
  After the first successful load, `goto()` works fine for subsequent Glassdoor navigations.

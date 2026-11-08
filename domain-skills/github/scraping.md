# GitHub — Scraping & Data Extraction

`https://github.com` — public data, mix of REST API (fast, rate-limited) and browser (trending page only).

## Do this first

**Use the REST API for repo/user/release data — it's one call, no browser, fully parsed JSON.**

```ts
const data = JSON.parse(await http_get("https://api.github.com/repos/{owner}/{repo}"))
// Key fields: stargazers_count, forks_count, description, language, topics,
//             open_issues_count, created_at, updated_at, pushed_at,
//             watchers_count, subscribers_count, network_count,
//             default_branch, license, homepage, visibility
```

Use `raw.githubusercontent.com` for file contents — no rate limit, no auth, no base64 decode:

```ts
const readme = await http_get("https://raw.githubusercontent.com/owner/repo/main/README.md")
const content = await http_get("https://raw.githubusercontent.com/owner/repo/main/pyproject.toml")
```

Use the browser **only** for the trending page — it's server-side rendered HTML, no API equivalent.

## Common workflows

### Repo metadata (API)

```ts
const data = JSON.parse(await http_get("https://api.github.com/repos/browser-use/browser-use"))
console.log(data.stargazers_count, data.forks_count, data.description)
// returns: 88349  10136  '🌐 Make websites accessible for AI agents.'
```

### User / org profile (API)

```ts
const user = JSON.parse(await http_get("https://api.github.com/users/browser-use"))
console.log(user.type, user.followers, user.public_repos, user.blog)
// returns: 'Organization'  3046  39  'https://browser-use.com'
```

### Trending page (browser required)

The trending page is JS-rendered. `article.Box-row` selector confirmed working (15 results for today/all-languages, 12 for filtered). All fields work in a single JS call — **must navigate and wait in the same script run**, as each run is a separate exec context.

```ts
await goto("https://github.com/trending")          // or /trending/python?since=weekly
await wait_for_load()
await wait(2)                                       // extra 2s — React hydration completes after readyState

const result = await js(`
(function(){
  var rows = Array.from(document.querySelectorAll('article.Box-row'));
  return JSON.stringify(rows.map(function(el){
    var h2link = el.querySelector('h2 a');
    var starLink = el.querySelector('a[href*="/stargazers"]');
    var forkLink = el.querySelector('a[href*="/forks"]');
    var langEl = el.querySelector('[itemprop="programmingLanguage"]');
    var todayEl = el.querySelector('.d-inline-block.float-sm-right');
    var descEl = el.querySelector('p');
    return {
      name: h2link ? h2link.innerText.trim().replace(/\\s+/g,' ') : null,
      url: h2link ? 'https://github.com' + h2link.getAttribute('href') : null,
      stars_total: starLink ? starLink.innerText.trim() : null,
      stars_period: todayEl ? todayEl.innerText.trim() : null,
      forks: forkLink ? forkLink.innerText.trim() : null,
      language: langEl ? langEl.innerText.trim() : null,
      desc: descEl ? descEl.innerText.trim() : null
    };
  }));
})()
`)
const repos = JSON.parse(result)
// stars_period text is e.g. "737 stars today" or "47,053 stars this week"
```

Supported URL params:
- `/trending` — all languages, today
- `/trending/python` — filtered to Python
- `/trending?since=weekly` or `?since=monthly`
- `/trending/python?since=weekly` — combined

### Search repositories (API)

```ts
const results = JSON.parse(await http_get(
  "https://api.github.com/search/repositories?q=browser+automation+language:python&sort=stars&per_page=10"
))
console.log(results.total_count)   // e.g. 3250
for (const r of results.items) console.log(r.full_name, r.stargazers_count)
```

Search API rate limit is **10 req/min** unauthenticated (separate from the 60/hour core limit). Runs out fast if called in a loop.

### Commits, releases, issues (API)

```ts
// Commits
const commits = JSON.parse(await http_get("https://api.github.com/repos/owner/repo/commits?per_page=10"))
// Fields: sha, commit.message, commit.author.date, author.login

// Releases
const releases = JSON.parse(await http_get("https://api.github.com/repos/owner/repo/releases?per_page=5"))
// Fields: tag_name, name, published_at, body, assets

// Issues
const issues = JSON.parse(await http_get("https://api.github.com/repos/owner/repo/issues?state=open&per_page=10"))
// Fields: number, title, labels, state, created_at, user.login

// Contributors
const contribs = JSON.parse(await http_get("https://api.github.com/repos/owner/repo/contributors?per_page=10"))
// Fields: login, contributions
```

### File contents via API (base64)

```ts
const resp = JSON.parse(await http_get("https://api.github.com/repos/owner/repo/contents/path/to/file.py"))
const content = Buffer.from(resp.content, "base64").toString("utf8")
// resp also has: size, sha, html_url
// Prefer raw.githubusercontent.com for large files — no base64, no rate limit hit
```

### Parallel fetching (multiple repos)

```ts
async function fetch_repo(name: string) {
  const data = JSON.parse(await http_get(`https://api.github.com/repos/${name}`))
  return { name, stars: data.stargazers_count, lang: data.language }
}

const repos = ["owner/repo1", "owner/repo2", "owner/repo3"]
const results = await Promise.all(repos.map(fetch_repo))
// Confirmed working; watch rate limit — 60 unauthenticated calls/hour total
```

## Gotchas

- **Rate limits are per IP, unauthenticated** — Core API: 60 req/hour. Search API: 10 req/min. These are separate pools. Check `/rate_limit` endpoint: `http_get("https://api.github.com/rate_limit")`. With a `GITHUB_TOKEN`, both limits increase to 5,000/hour.

- **Token header format** — Use `Authorization: Bearer <token>` (not `token <token>`), plus `X-GitHub-Api-Version: 2022-11-28`:
  ```ts
  const token = process.env.GITHUB_TOKEN ?? ""
  const headers = token ? { Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" } : {}
  const data = JSON.parse(await http_get("https://api.github.com/repos/owner/repo", headers))
  ```

- **404 raises HTTPError, not a JSON error** — Wrap API calls for missing repos:
  ```ts
  try {
    const data = JSON.parse(await http_get("https://api.github.com/repos/owner/repo"))
  } catch (e) {
    console.log("Not found or rate limited:", e)
  }
  ```

- **Code search requires auth** — `GET /search/code` returns HTTP 401 without a token. Repo/user/issues search works unauthenticated.

- **Trending page selectors only work if navigation is in the same script run** — Each `browser-harness` exec is fresh. Selectors that returned 0 results were run in a separate invocation after the page had navigated away. Always include `goto()` + `wait_for_load()` + `wait(2)` in the same script.

- **wait(2) after wait_for_load() on trending** — `document.readyState == 'complete'` fires before React finishes painting repo cards. Without the extra 2s sleep, `article.Box-row` count was 0 even though the DOM technically loaded.

- **Trending stars field is a string with commas** — `stars_total` comes back as `"4,548"` not `4548`. Parse with `parseInt(r.stars_total.replaceAll(',', ''))` if you need to sort.

- **stars_period text includes the period** — Value is `"737 stars today"` or `"47,053 stars this week"` — strip the trailing word if you want just the number.

- **Repo page DOM is React-heavy, API is better** — Extracting star counts from the repo HTML page (`github.com/owner/repo`) is unreliable because GitHub uses React with server-side hydration and component IDs change. The REST API returns all the same data cleanly.

- **raw.githubusercontent.com has no rate limit and no auth** — Use it for any public file. It serves the raw bytes, no JSON wrapping or base64.

- **Trending page article count varies** — Today filter returned 15 articles, weekly Python filter returned 12. Don't assume 25 results; iterate `document.querySelectorAll('article.Box-row')` and take what's there.

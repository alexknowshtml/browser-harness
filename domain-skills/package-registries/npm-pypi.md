# npm & PyPI — Package Registry Data Extraction

`https://registry.npmjs.org` · `https://api.npmjs.org` · `https://pypi.org` · `https://pypistats.org`

Both registries expose full JSON APIs with no auth required. Never use a browser — every data point is available over HTTP.

Tested 2026-04-18 with `http_get`.

---

## Latency reference (measured)

| Endpoint | Latency |
|----------|---------|
| PyPI package JSON | ~80ms |
| npm downloads point | ~110ms |
| npm registry full doc (react = 6.3MB) | ~280ms |
| npm registry search | ~330ms |
| pypistats.org recent | ~480ms |

---

## npm Registry

### Package metadata

Two endpoints — pick based on what you need:

**Full registry document** — includes all version history, time map, author, bugs, homepage, keywords, README (when present). Large for popular packages (react = 6.3MB).

```ts
const data = JSON.parse(await http_get("https://registry.npmjs.org/react"));

// Top-level keys: _id, name, dist-tags, versions, time, bugs, author,
//                 license, homepage, keywords, repository, description,
//                 contributors, maintainers, readme, readmeFilename, users
console.log(data.name);                          // 'react'
console.log(data["dist-tags"].latest);           // '19.2.5'
console.log(data.time.created);                  // '2011-10-26T17:46:21.942Z'
console.log(data.time.modified);                 // '2026-04-18T00:57:09.913Z'

const latest = data["dist-tags"].latest;
const v = data.versions[latest];
// Version object keys: name, version, description, license, keywords,
//   homepage, bugs, repository, engines, exports, main, scripts,
//   dependencies, devDependencies, peerDependencies, dist, maintainers,
//   _npmUser, _nodeVersion, _npmVersion
console.log(v.description);                      // 'React is a JavaScript library...'
console.log(v.license);                          // 'MIT'
console.log(Object.keys(v.dependencies ?? {}));  // [] (react 19 has no runtime deps)
console.log(v.homepage ?? null);                 // 'https://react.dev/'
console.log(Object.keys(data.versions).length);  // 2785 — all published versions
```

**Single version endpoint** — 1–2KB instead of megabytes. Use when you only need one version's data.

```ts
// Fetch a specific version
let v = JSON.parse(await http_get("https://registry.npmjs.org/react/19.2.5"));
console.log(v.name, v.version, v.description);

// Fetch latest directly (no need to resolve dist-tags first)
v = JSON.parse(await http_get("https://registry.npmjs.org/react/latest"));
console.log(v.version);   // '19.2.5'
```

**Abbreviated document** — skips time map and (in theory) README; versions dict still present. Use `Accept` header.

```ts
// http_get merges your headers over its defaults and decompresses gzip itself
const data = JSON.parse(await http_get(
  "https://registry.npmjs.org/react",
  { Accept: "application/vnd.npm.install-v1+json" },
  20,
));
// Keys: name, dist-tags, versions, modified (no time map, no readme)
console.log(data["dist-tags"].latest);           // '4.18.1' (for lodash)
```

Note: abbreviated is still large (react: 2.7MB) — use single-version endpoint when possible.

### Scoped packages

Scoped packages (`@scope/name`) work with a direct path — no encoding needed:

```ts
const data = JSON.parse(await http_get("https://registry.npmjs.org/@playwright/test"));
console.log(data.name);                          // '@playwright/test'
console.log(data["dist-tags"].latest);           // '1.59.1'
console.log(Object.keys(data.versions).length);  // 3148
```

If constructing URLs dynamically, either form works:
```ts
const pkg = "@playwright/test";
// Direct path (preferred)
let url = `https://registry.npmjs.org/${pkg}`;                       // '@playwright/test'
// URL-encoded slash
url = `https://registry.npmjs.org/${pkg.replace("/", "%2F")}`;
```

### Download statistics

The npm downloads API is separate from the registry and very fast (~110ms).

**Point query** — single number for a period:

```ts
// Supported periods: last-day, last-week, last-month, last-year
// Also accepts ISO date ranges: YYYY-MM-DD:YYYY-MM-DD

const stats = JSON.parse(await http_get("https://api.npmjs.org/downloads/point/last-week/react"));
console.log(stats.downloads);   // 123302510
console.log(stats.start);       // '2026-04-11'
console.log(stats.end);         // '2026-04-17'
console.log(stats.package);     // 'react'

// Confirmed values (2026-04-18):
// last-day:   19,411,762
// last-week: 123,302,510
// last-month: 502,719,511
// last-year: 3,000,644,845
```

**Bulk point query** — up to ~128 packages in one call, comma-separated:

```ts
const bulk = JSON.parse(await http_get(
  "https://api.npmjs.org/downloads/point/last-week/" +
  "react,vue,angular,webpack,typescript,eslint,jest,prettier,rollup,babel",
));
// Returns dict keyed by package name
for (const [pkg, info] of Object.entries<any>(bulk)) {
  console.log(`${pkg}: ${info.downloads.toLocaleString("en-US")}`);
}
// react: 123,302,510
// vue: 11,042,359
// angular: 524,366
// webpack: 44,425,549
// typescript: 180,054,359
// eslint: 126,113,686
// jest: 43,394,412
// prettier: 87,551,734
// rollup: 103,431,439
// babel: 139,207
```

**Range query** — downloads per day over a period:

```ts
const resp = JSON.parse(await http_get(
  "https://api.npmjs.org/downloads/range/2025-01-01:2025-01-07/react",
));
// resp.downloads is a list of {downloads, day} objects
for (const entry of resp.downloads) {
  console.log(entry.day, entry.downloads);
}
// 2025-01-01  1336801
// 2025-01-02  3288088
// 2025-01-03  3381680
// ...
```

### Search

```ts
// Fields: text, size (max ~250), from (offset), quality, popularity, maintenance weights
const data = JSON.parse(await http_get(
  "https://registry.npmjs.org/-/v1/search?text=browser+automation&size=5",
));
console.log(data.total);   // total results matching the query

for (const obj of data.objects) {
  const p = obj.package;
  const s = obj.score;
  // p keys: name, version, description, keywords, date, links, publisher, maintainers
  // s keys: final, detail.quality, detail.popularity, detail.maintenance
  console.log(
    p.name,
    p.version,
    s.final.toFixed(2),
    (p.description ?? "").slice(0, 60),
  );
}
// agent-browser 0.26.0 462.28 Browser automation CLI for AI agents
// nightmare     3.0.2  306.64 A high-level browser automation library.
```

Score breakdown (all three are 0–1 floats):
- `quality` — code quality signals (tests, lint, TypeScript types)
- `popularity` — download counts normalized
- `maintenance` — release frequency, open issues

`final` is a weighted combination and can exceed 1.0 for extremely popular packages.

### Error handling

```ts
// http_get throws Error("HTTP Error 404: Not Found") and drops the body.
// Use fetch when you need the status and the JSON error body.
const r = await fetch("https://registry.npmjs.org/nonexistent-pkg-xyz");
if (!r.ok) {
  // 404 for missing packages
  console.log(r.status);                         // 404
  console.log(JSON.stringify(await r.json()));   // {"error":"Not found"}
}
```

---

## PyPI

### Package metadata

```ts
// Latest version metadata
const data = JSON.parse(await http_get("https://pypi.org/pypi/requests/json"));
const info = data.info;

// info keys (selected):
console.log(info.name);             // 'requests'
console.log(info.version);          // '2.33.1'
console.log(info.summary);          // 'Python HTTP for Humans.'
console.log(info.license);          // 'Apache-2.0'
console.log(info.author);           // null (sometimes empty — check author_email)
console.log(info.author_email);     // '"Kenneth Reitz" <me@kennethreitz.org>'
console.log(info.requires_python);  // '>=3.10'
console.log(info.home_page);        // null (may be empty — check project_urls)
console.log(JSON.stringify(info.project_urls));
// {"Documentation":"https://requests.readthedocs.io",
//  "Source":"https://github.com/psf/requests"}

const requires = info.requires_dist ?? [];
console.log(requires.slice(0, 5));
// ['charset_normalizer<4,>=2', 'idna<4,>=2.5', 'urllib3<3,>=1.26',
//  'certifi>=2023.5.7', 'PySocks!=1.5.7,>=1.5.6; extra == "socks"']

console.log((info.classifiers ?? []).slice(0, 3));
// ['Development Status :: 5 - Production/Stable',
//  'Intended Audience :: Developers',
//  'License :: OSI Approved :: Apache Software License']

// data.urls — list of dist files for the latest version
for (const f of data.urls) {
  // keys: filename, packagetype, python_version, size, digests, url,
  //       upload_time, requires_python, yanked, yanked_reason
  console.log(f.packagetype, f.python_version, f.filename, f.size);
}
// bdist_wheel  py3     requests-2.33.1-py3-none-any.whl  64947
// sdist        source  requests-2.33.1.tar.gz           134120
```

### Specific version

```ts
// Fetch a pinned version (not just latest)
const data = JSON.parse(await http_get("https://pypi.org/pypi/requests/2.32.3/json"));
console.log(data.info.version);   // '2.32.3'
// Same structure as the latest endpoint
```

### Version history and yanked releases

```ts
const data = JSON.parse(await http_get("https://pypi.org/pypi/requests/json"));

// data.releases is an object: version_string -> list of file objects
const versions = Object.keys(data.releases);
console.log("Total versions:", versions.length);   // 159
// Keys come back in JSON order (chronological, oldest first)
// Note: JS objects put integer-like keys first; PyPI versions contain dots, so order is kept

// Find yanked versions
const yanked = Object.entries<any>(data.releases)
  .filter(([, files]) => files.length && files[0].yanked)
  .map(([ver, files]) => [ver, files[0].yanked_reason]);
console.log(JSON.stringify(yanked.slice(0, 2)));
// [["2.32.0","Yanked due to conflicts with CVE-2024-35195 mitigation"],
//  ["2.32.1","Yanked due to conflicts with CVE-2024-35195 mitigation "]]

// info.yanked is true only if the LATEST version is yanked
console.log(data.info.yanked);            // false
console.log(data.info.yanked_reason);     // null
```

### Download statistics (pypistats.org)

PyPI does not expose download counts in its own JSON API. Use pypistats.org.

```ts
// Recent (last day/week/month) — fastest, single call
const stats = JSON.parse(await http_get("https://pypistats.org/api/packages/requests/recent"));
const d = stats.data;
console.log(d.last_day);    // 52969887
console.log(d.last_week);   // 356556988
console.log(d.last_month);  // 1385411770

// Historical daily totals (overall, going back ~6 months)
const overall = JSON.parse(await http_get("https://pypistats.org/api/packages/requests/overall"));
// overall.data is list of {category, date, downloads}
// category is 'with_mirrors' or 'without_mirrors'
for (const row of overall.data.slice(0, 3)) {
  console.log(row.date, row.category, row.downloads);
}
// 2025-10-19  with_mirrors     21916634
// 2025-10-19  without_mirrors  21882953

// Without mirrors (pip installs only, more accurate for real usage):
const clean = JSON.parse(await http_get(
  "https://pypistats.org/api/packages/requests/overall?mirrors=false",
));

// By Python major version
const by_python = JSON.parse(await http_get(
  "https://pypistats.org/api/packages/requests/python_major",
));
// data rows: {category: '3', date: '...', downloads: N}

// By OS
const by_sys = JSON.parse(await http_get(
  "https://pypistats.org/api/packages/requests/system",
));
// data rows: {category: 'Darwin'|'Linux'|'Windows'|'other'|'null', date, downloads}

// By Python minor version
const by_minor = JSON.parse(await http_get(
  "https://pypistats.org/api/packages/requests/python_minor",
));
```

### Parallel fetch for multiple packages

```ts
const packages = ["numpy", "pandas", "scikit-learn", "torch", "tensorflow"];

async function get_pypi_info(pkg: string) {
  const d = JSON.parse(await http_get(`https://pypi.org/pypi/${pkg}/json`));
  return {
    name: pkg,
    version: d.info.version,
    summary: d.info.summary,
    requires_python: d.info.requires_python,
  };
}

const results = await Promise.all(packages.map(get_pypi_info));

for (const r of results) {
  console.log(r.name, r.version, r.summary.slice(0, 50));
}
// numpy        2.4.4  Fundamental package for array computing in Python
// pandas       3.0.2  Powerful data structures for data analysis, time s
// scikit-learn 1.8.0  A set of python modules for machine learning and d
// torch        2.11.0 Tensors and Dynamic neural networks in Python with
// tensorflow   2.21.0 TensorFlow is an open source machine learning fram
```

### Error handling

```ts
try {
  const data = JSON.parse(await http_get("https://pypi.org/pypi/nonexistent-xyz-abc/json"));
} catch (e) {
  console.log(String(e).includes("HTTP Error 404"));   // true
  // Body is HTML, not JSON — don't try to parse it
}
```

---

## Parallel fetch patterns

### Mixed registry + stats in one shot

```ts
async function npm_info(pkg: string) {
  // Use single-version endpoint (1-2KB) not full registry doc (MB)
  const [v, s] = await Promise.all([
    http_get(`https://registry.npmjs.org/${pkg}/latest`).then(JSON.parse),
    http_get(`https://api.npmjs.org/downloads/point/last-month/${pkg}`).then(JSON.parse),
  ]);
  return { name: pkg, version: v.version, downloads: s.downloads };
}

const pkgs = ["react", "vue", "svelte", "solid-js", "preact"];
const results = await Promise.all(pkgs.map(npm_info));
for (const r of results) {
  console.log(r.name, r.version, r.downloads.toLocaleString("en-US"));
}
```

### npm bulk downloads (most efficient for many packages)

```ts
// Up to ~128 packages in one HTTP call
const pkgs = ["react", "vue", "angular", "svelte"];
const bulk = JSON.parse(await http_get(
  `https://api.npmjs.org/downloads/point/last-week/${pkgs.join(",")}`,
));
// Returns: {pkg_name: {downloads: N, start: '...', end: '...', package: '...'}, ...}
const sorted_pkgs = Object.entries<any>(bulk).sort((a, b) => b[1].downloads - a[1].downloads);
for (const [name, info] of sorted_pkgs) {
  console.log(`${name}: ${info.downloads.toLocaleString("en-US")}`);
}
```

---

## Rate limits

No rate limits encountered across rapid bursts of 10 sequential calls per endpoint (2026-04-18 testing):

| API | Observed limit |
|-----|----------------|
| npm registry (`registry.npmjs.org`) | None observed |
| npm downloads (`api.npmjs.org`) | None observed |
| npm search | None observed |
| PyPI JSON (`pypi.org`) | None observed |
| pypistats.org | None observed |

npm's official documentation mentions soft rate limits at very high volumes, but normal task-level usage (dozens of calls) is unaffected. If building a large scraper, add a short `await wait(n)` between batches as a precaution.

---

## Gotchas

- **Full npm registry doc is huge** — `registry.npmjs.org/react` is 6.3MB (2785 versions). When you only need the latest version metadata, fetch `registry.npmjs.org/react/latest` (~1.8KB) instead. Similarly for any specific version.

- **npm `versions` dict keys are ordered oldest-first** — The last key is NOT necessarily the latest release; it may be a canary/experimental build. Always use `dist-tags.latest` to identify the stable latest version.

- **PyPI `author` field is often `null`** — Many packages set `author_email` instead (often in `"Name" <email>` format). Fall back: `info.author || info.author_email`.

- **PyPI `home_page` is frequently empty** — Check `info.project_urls` for `Homepage`, `Source`, `Documentation` links instead.

- **PyPI `requires_dist` can be `null`** — Not an empty list — `null`. Always guard: `info.requires_dist ?? []`.

- **PyPI XML-RPC API is dead** — `https://pypi.org/pypi` (XML-RPC) returns a fault for most methods including `package_releases`. Use JSON API only.

- **pypistats.org `total` field is `null`** — The `total` key in response JSON is null; compute sums from `data` list yourself.

- **pypistats.org data goes back ~6 months** — The `overall` endpoint returns daily rows for roughly the past 180 days, not full history.

- **PyPI yanked versions** — `data.releases[ver][0].yanked` is `true` for yanked versions. `data.info.yanked` is only `true` if the latest version itself is yanked. Both `yanked` and `yanked_reason` fields exist on each file object.

- **npm scoped packages** — Both `registry.npmjs.org/@scope/name` (direct path) and `registry.npmjs.org/@scope%2Fname` (URL-encoded) work. Use the direct path form.

- **npm downloads bulk response is a dict** — When you request multiple packages, the response is `{pkg_name: {...}}`, not a list. Single-package response is a flat object with `downloads`, `start`, `end`, `package` directly.

- **`http_get` handles gzip transparently** — The helper already decompresses gzip responses. No manual decompression needed.

- **`http_get` errors drop the body** — It throws `Error("HTTP Error <code>: ...")` on any non-2xx status. Use `fetch` directly when you need the status code or the error body.

- **Never use a browser for either registry** — All data is JSON over HTTP. `http_get` calls take 80–480ms; a browser navigation would take 3–8 seconds with no benefit.

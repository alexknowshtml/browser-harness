# PubMed / NCBI — Scraping & Data Extraction

`https://pubmed.ncbi.nlm.nih.gov` — 37 M+ biomedical citations. **Never use the browser for PubMed.** All data is reachable via `http_get` using the NCBI E-utilities REST API. No API key required; a free key raises the rate limit from 3 to 10 req/s.

## Do this first

**ESearch → ESummary is the fastest pipeline for most tasks — two calls, JSON responses, no XML parsing.**

```ts
// Step 1: search → get PMIDs
const search = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
  "?db=pubmed&term=deep+learning+radiology&retmax=10&retmode=json"
));
const pmids: string[] = search.esearchresult.idlist; // e.g. ['41999029', '41998456', ...]
const count = search.esearchresult.count;            // total hits across all pages

// Step 2: fetch lightweight metadata for all PMIDs in one call
const summary = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi" +
  `?db=pubmed&id=${pmids.join(",")}&retmode=json`
));
const result = summary.result;
for (const uid of result.uids) {
  const art = result[uid];
  console.log(uid, art.pubdate, art.source);
  console.log("  ", art.title.slice(0, 80));
  console.log("  authors:", JSON.stringify(art.authors.slice(0, 3).map((a: any) => a.name)));
}
// Confirmed output (2026-04-18):
// 41999029 2026 Apr 18 Med Sci Monit
//    Use of Deep Learning Models in the Diagnosis of Proptosis Through Orbi
//    authors: ["Kesimal U","Akkaya HE","Polat Ö"]
// 41998456 2026 Apr 17 Sci Rep
//    ...
```

Use **EFetch XML** when you need: full abstract text, MeSH terms, complete author names (not just "Last I"), structured abstract labels, or the DOI from within the article record.

## Common workflows

### Search PubMed (ESearch)

```ts
const data = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
  "?db=pubmed" +
  "&term=large+language+models+clinical" +
  "&retmax=5" +
  "&retmode=json" +
  "&sort=pub+date" +                         // newest first; default is relevance
  "&datetype=pdat" +                         // filter by publication date
  "&mindate=2024/01/01&maxdate=2024/12/31"   // YYYY/MM/DD format
));
const result = data.esearchresult;
console.log("Total hits:", result.count);    // '24160' — note: string, not int
console.log("PMIDs:", JSON.stringify(result.idlist));
console.log("Query translation:", result.querytranslation);
// Confirmed output (2026-04-18):
// Total hits: 24160
// PMIDs: ["41996895","41996722","41996006","41995888","41995759"]
// Query translation: "large language models"[MeSH Terms] OR ...
```

#### ESearch field tags (append to term)

```
machine learning[MeSH Terms]        MeSH controlled vocabulary
Hinton GE[Author]                   author last + initials
attention is all you need[Title]    title words
Nature[Journal]                     journal name
2024[pdat]                          publication year
```

Boolean operators: `AND`, `OR`, `NOT`. Phrase search: `"exact phrase"[Title]`.

#### Sort options (`sort=`)

| Value | Effect |
|---|---|
| *(omit)* | Relevance (default) |
| `pub+date` | Most recent publication first |
| `Author` | First author alphabetical |
| `JournalName` | Journal alphabetical |

### Lightweight metadata — ESummary (JSON, no XML)

```ts
const data = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi" +
  "?db=pubmed&id=41999029,41998456,41997837&retmode=json"
));
const result = data.result;
for (const uid of result.uids) {
  const art = result[uid];
  // Key fields available:
  const title = art.title;                    // full title string
  const source = art.source;                  // abbreviated journal name
  const fulljournalname = art.fulljournalname;
  const pubdate = art.pubdate;                // e.g. '2026 Apr 18'
  const epubdate = art.epubdate;              // e-pub ahead of print date (may be empty)
  const authors = art.authors;                // list of {name: 'Last I', authtype: ...}
  const volume = art.volume;
  const issue = art.issue;
  const pages = art.pages;
  const pubtype = art.pubtype;                // list: ['Journal Article', 'Review', ...]
  // Extract DOI from elocationid or articleids:
  const doi_field = art.elocationid;          // e.g. 'doi: 10.12659/MSM.951157'
  const article_ids: Record<string, string> = Object.fromEntries(art.articleids.map((x: any) => [x.idtype, x.value]));
  const doi = article_ids.doi ?? null;
  const pmc_id = article_ids.pmc ?? null;     // PMC ID if open access
  console.log(uid, pubdate, source);
  console.log(" ", title.slice(0, 70));
  console.log("  doi:", doi, "| pmc:", pmc_id);
}
// Confirmed output (2026-04-18):
// 41999029 2026 Apr 18 Med Sci Monit
//    Use of Deep Learning Models in the Diagnosis of Proptosis Through Orbi
//   doi: 10.12659/MSM.951157 | pmc: null
```

### Full article metadata — EFetch XML

Use this for full abstracts, complete author names, MeSH terms, structured abstract sections.

```ts
// Minimal XML helpers (no DOM in bun). PubMed XML is well-formed and these tags don't self-nest.
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
type El = { attrs: string; inner: string };
// every <name ...>...</name> (or <name/>) inside xml, in document order
const els = (xml: string, name: string): El[] =>
  [...xml.matchAll(new RegExp(`<${name}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${name}>)`, "g"))].map((m) => ({ attrs: m[1] ?? "", inner: m[2] ?? "" }));
const el = (xml: string | undefined, name: string): El | null => (xml == null ? null : els(xml, name)[0] ?? null);
// full text with embedded tags (<i>, <sub>) stripped, like itertext()
const text = (e: El | null) => (e ? decode(e.inner.replace(/<[^>]+>/g, "")).trim() : "");
const attr = (e: El, a: string) => decode(e.attrs.match(new RegExp(`${a}="([^"]*)"`))?.[1] ?? "");

const raw = await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
  "?db=pubmed&id=41999029,36328784&retmode=xml&rettype=abstract"
);

for (const art of els(raw, "PubmedArticle")) {
  const mc = el(art.inner, "MedlineCitation")!;
  const pmid = text(el(mc.inner, "PMID"));
  const article = el(mc.inner, "Article")!;

  // Title — text() strips embedded tags like <i>, <sub>
  const title = text(el(article.inner, "ArticleTitle"));

  // Abstract — plain or structured (BACKGROUND / METHODS / RESULTS / CONCLUSION)
  const abstract_el = el(article.inner, "Abstract");
  let abstract = "";                          // ~15% of articles have no abstract
  if (abstract_el) {
    const sections: string[] = [];
    for (const t of els(abstract_el.inner, "AbstractText")) {
      const label = attr(t, "Label");         // e.g. 'BACKGROUND', 'METHODS'
      const txt = text(t);
      sections.push(label ? `[${label}] ${txt}` : txt);
    }
    abstract = sections.join(" ");
  }

  // Journal + year
  const journal = el(article.inner, "Journal");
  const j_title = journal ? text(el(journal.inner, "Title")) : "";
  const pub_date = el(journal?.inner, "PubDate");
  let year = "";
  if (pub_date) {
    const year_el = el(pub_date.inner, "Year");
    const medline_el = el(pub_date.inner, "MedlineDate"); // fallback for old/seasonal dates
    const season_el = el(pub_date.inner, "Season");       // e.g. 'Jul-Aug', 'Oct-Dec'
    year = year_el ? text(year_el) : medline_el ? text(medline_el).slice(0, 4) : "";
  }

  // DOI
  const doi_el = els(article.inner, "ELocationID").find((e) => attr(e, "EIdType") === "doi");
  const doi = doi_el ? text(doi_el) : "";

  // Authors — handle CollectiveName (consortium/group authors)
  const author_list = el(article.inner, "AuthorList");
  const authors: string[] = [];
  if (author_list) {
    for (const a of els(author_list.inner, "Author")) {
      const collective = el(a.inner, "CollectiveName");
      const last = el(a.inner, "LastName");
      const fore = el(a.inner, "ForeName");
      const initials = el(a.inner, "Initials");
      if (collective) {
        authors.push(text(collective));
      } else if (last) {
        let full = text(last);
        if (fore) full += `, ${text(fore)}`;
        authors.push(full);
      }
    }
  }

  // MeSH controlled vocabulary terms
  const mesh_list = el(mc.inner, "MeshHeadingList");
  let mesh_terms: string[] = [];
  if (mesh_list) {
    mesh_terms = els(mesh_list.inner, "MeshHeading")
      .map((mh) => el(mh.inner, "DescriptorName"))
      .filter((d) => d !== null)
      .map((d) => text(d));
  }

  console.log(`PMID=${pmid} (${year}) ${j_title}`);
  console.log(`  Title: ${title.slice(0, 70)}`);
  console.log(`  Authors: ${JSON.stringify(authors.slice(0, 3))}`);
  console.log(`  DOI: ${doi}`);
  console.log(`  MeSH: ${JSON.stringify(mesh_terms.slice(0, 4))}`);
  console.log(`  Abstract: ${abstract.slice(0, 120)}`);
}
// Confirmed output (2026-04-18):
// PMID=41999029 (2026) Medical science monitor : international medical...
//   Title: Use of Deep Learning Models in the Diagnosis of Proptosis Thro
//   Authors: ["Kesimal, Uğur","Akkaya, Habip Eser","Polat, Önder"]
//   DOI: 10.12659/MSM.951157
//   MeSH: ["Humans","Deep Learning","Exophthalmos","Magnetic Resonance Imaging"]
//   Abstract: BACKGROUND Proptosis is a common manifestation of orbital disease...
// PMID=36328784 (...)
//   Abstract: [OBJECTIVES] Physical inactivity and sedentary behaviour...  ← structured
```

### Large result sets — usehistory + WebEnv

When `count` exceeds `retmax` (max 10 000), use server-side history to paginate EFetch without re-running ESearch on every page.

```ts
// Step 1: ESearch with usehistory=y — NCBI holds result set on server
const search = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
  "?db=pubmed&term=CRISPR+gene+editing&retmax=0&retmode=json&usehistory=y"
));
const webenv = search.esearchresult.webenv;       // server-side session token
const query_key = search.esearchresult.querykey;  // result set ID within session
const total = parseInt(search.esearchresult.count);
console.log(`Total: ${total}, WebEnv: ${webenv.slice(0, 30)}..., query_key: ${query_key}`);
// Confirmed output (2026-04-18):
// Total: 24160, WebEnv: MCID_69e4203757db89391008d6f1..., query_key: 1

// Step 2: EFetch pages using WebEnv (no re-searching)
const batch_size = 200;
for (let start = 0; start < Math.min(total, 1000); start += batch_size) { // cap at 1000 for demo
  const raw = await http_get(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
    `?db=pubmed&query_key=${query_key}&WebEnv=${webenv}` +
    `&retstart=${start}&retmax=${batch_size}&retmode=xml&rettype=abstract`
  );
  const articles = raw.match(/<PubmedArticle[\s>]/g) ?? [];
  console.log(`  Fetched ${articles.length} articles (start=${start})`);
  // process articles here (see the EFetch XML helpers above)...
}
```

### EInfo — list available NCBI databases

```ts
const data = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?retmode=json"
));
const dbs: string[] = data.einforesult.dblist;
console.log(`Total databases: ${dbs.length}`);   // Confirmed: 39 (2026-04-18)
console.log(JSON.stringify(dbs.slice(0, 10)));
// ["pubmed","protein","nuccore","ipg","nucleotide","structure",
//  "genome","annotinfo","assembly","bioproject"]
```

Get PubMed-specific metadata (field list, link list):

```ts
const data = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi?db=pubmed&retmode=json"
));
const db_info = data.einforesult.dbinfo[0];
console.log("DB name:", db_info.dbname);
console.log("Record count:", db_info.count);    // total PubMed records
const link_names: string[] = (db_info.linklist ?? []).map((l: any) => l.name);
console.log(`Link types (${link_names.length}):`, JSON.stringify(link_names.slice(0, 5)));
// Confirmed (2026-04-18):
// DB name: pubmed
// Record count: 37620453
// Link types (48): ["pubmed_assembly","pubmed_bioproject",...]
```

### ELink — cross-database linking

ELink connects a PubMed record to associated data in other NCBI databases. The `pubmed_pubmed` "related articles" linkname relies on a similarity server that is intermittently unavailable (returns `"Couldn't resolve #exLinkSrv2, the address table is empty."`). Use the non-similarity links below instead.

```ts
// Link a PMID to its free full-text in PMC (if open access)
// linkname=pubmed_pmc — may also hit the server outage; check error field
const data = JSON.parse(await http_get(
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi" +
  "?dbfrom=pubmed&id=38325330&linkname=pubmed_pmc&retmode=json"
));
const error = data.ERROR ?? "";
if (error) {
  console.log("ELink error:", error); // 'Couldn't resolve #exLinkSrv2...' — NCBI server issue
} else {
  for (const ls of data.linksets ?? []) {
    for (const lsdb of ls.linksetdbs ?? []) {
      console.log(lsdb.linkname, "→", JSON.stringify(lsdb.links.slice(0, 5)));
    }
  }
}
```

Available ELink linknames from pubmed (48 total):

| linkname | Target |
|---|---|
| `pubmed_pmc` | Free full text in PMC |
| `pubmed_pubmed_citedin` | Articles citing this paper |
| `pubmed_pubmed_refs` | References cited by this paper |
| `pubmed_gene` | Related Gene records |
| `pubmed_clinvar` | Clinical variants associated with publication |
| `pubmed_gds` | Related GEO datasets |

**Practical alternative**: If ELink is down, extract DOI from EFetch/ESummary and use `https://doi.org/{doi}` directly for the full-text link.

## URL and parameter reference

### E-utilities base URLs

```
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi   # search → PMIDs
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi  # PMIDs → JSON summary
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi    # PMIDs → full XML
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi     # cross-db links
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/einfo.fcgi     # DB metadata
```

### ESearch parameters

| Parameter | Values | Notes |
|---|---|---|
| `db` | `pubmed` | Always `pubmed` for PubMed |
| `term` | query string | Supports field tags like `[Author]`, `[Title]`, `[MeSH Terms]` |
| `retmax` | integer, max 10000 | Results returned per call |
| `retmode` | `json` | JSON output |
| `sort` | `pub+date`, `Author`, `JournalName` | Default is relevance |
| `datetype` | `pdat` (pub), `edat` (entrez), `mdat` (modified) | |
| `mindate`, `maxdate` | `YYYY/MM/DD` or `YYYY` | Requires `datetype` |
| `usehistory` | `y` | Store results on server; returns `webenv` + `querykey` |

### EFetch parameters

| Parameter | Values | Notes |
|---|---|---|
| `db` | `pubmed` | |
| `id` | `38000000,37999999` | Comma-separated PMIDs; max ~200 per call |
| `query_key` + `WebEnv` | from ESearch `usehistory=y` | Alternative to `id` for large sets |
| `retstart` | integer | Offset for pagination with WebEnv |
| `retmax` | integer, max 10000 | Batch size |
| `retmode` | `xml` | Use XML for EFetch (JSON not available for full records) |
| `rettype` | `abstract` | Returns abstract + core metadata |

### PubMed article URL construction

```ts
const pmid = "41999029";
const pubmed_url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
const doi = "10.12659/MSM.951157";
const doi_url = `https://doi.org/${doi}`;       // resolves to publisher page
const pmc_id = "PMC9876543";                     // from ESummary articleids
const pmc_url = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmc_id}/`;
```

## Gotchas

- **`count` is a string, not int.** `search.esearchresult.count` returns `'24160'`, not `24160`. Always cast with `parseInt()` before arithmetic.

- **EFetch retmode must be `xml` for full records.** Unlike ESearch and ESummary, EFetch with `retmode=json` returns flat text (the MEDLINE citation text format), not structured JSON. Parse EFetch responses as XML (the `els`/`el`/`text` helpers in the EFetch example).

- **`ArticleTitle` may contain embedded XML tags.** Titles with italics (`<i>Staphylococcus aureus</i>`) or math (`<sub>2</sub>`) are mixed-content nodes. Always strip the inner tags (`text(el)` in the EFetch helpers) instead of reading text up to the first child tag, which silently drops everything after it.

- **~15% of articles have no abstract.** `el(article.inner, "Abstract")` returns `null` for short communications, editorials, letters, and older records. Always guard with `if (abstract_el)`.

- **Author names vary in structure — always handle `CollectiveName`.** Consortium papers list a group name (`'GeKeR Study Group'`, `'Breast Cancer Association Consortium'`) under `<CollectiveName>` instead of `<LastName>/<ForeName>`. Individual authors have `<LastName>` + optionally `<ForeName>` and `<Initials>`. Check `CollectiveName` first; falling through to `LastName` without the check produces `null` errors.
  - Confirmed real examples (2026-04-18): PMID 37586835 (`GeKeR Study Group`), PMID 36328784 (`Breast Cancer Association Consortium`)

- **PubDate has three possible structures.** Most articles have `<Year>` + optional `<Month>` + optional `<Day>`. Seasonal journals use `<Season>` (e.g. `Jul-Aug`, `Oct-Dec`) instead of `<Month>`. A minority of older records use `<MedlineDate>` (e.g. `1995 Fall`) with no `<Year>`. Safe extraction pattern:
  ```ts
  // journal + el/text helpers from the EFetch example above
  const pub_date = el(journal?.inner, "PubDate");
  const year_el = pub_date ? el(pub_date.inner, "Year") : null;
  const medline_el = pub_date ? el(pub_date.inner, "MedlineDate") : null;
  const year = year_el ? text(year_el) : medline_el ? text(medline_el).slice(0, 4) : "";
  ```

- **Batch EFetch: keep IDs to ~200 per call.** The API accepts comma-separated IDs in `id=`, but very large batches (500+) occasionally time out or return truncated XML. For >200 articles, iterate in chunks or use `usehistory` + `WebEnv`.

- **ELink `pubmed_pubmed` (related articles) is intermittently broken.** The NCBI similarity server returns `"Couldn't resolve #exLinkSrv2, the address table is empty."` — this is a persistent server-side issue as of 2026-04-18, not a rate-limit error. Other linknames (`pubmed_gene`, `pubmed_pmc`, `pubmed_clinvar`) fail with the same error. Use the DOI as a fallback link to publisher full text.

- **Rate limits: 3 req/s without API key, 10 req/s with free key.** Exceeding 3 req/s returns HTTP 429. Insert `await wait(0.34)` between sequential calls without a key. Get a free API key at https://www.ncbi.nlm.nih.gov/account/ and append `&api_key=YOUR_KEY` to all URLs.

- **`retmax` upper bound is 10 000 for ESearch.** To retrieve more than 10 000 PMIDs for a search, use `usehistory=y` and page through EFetch with `retstart` offsets. EFetch itself also accepts `retmax` up to 10 000 per call.

- **`retmax=0` in ESearch returns only the count, not IDs — useful for counting.** Combine with `usehistory=y` to store the result for later paging without fetching IDs upfront:
  ```ts
  const search = JSON.parse(await http_get(
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
    "?db=pubmed&term=cancer&retmax=0&retmode=json&usehistory=y"
  ));
  const total = parseInt(search.esearchresult.count);   // e.g. 4800000
  const webenv = search.esearchresult.webenv;
  ```

- **ESummary `authors` field uses abbreviated names (`Last I`), not full names.** Use EFetch XML to get `ForeName` (e.g. `'Kesimal, Uğur'` vs ESummary `'Kesimal U'`). For bulk tasks where full names are not needed, ESummary is faster.

- **`querytranslation` shows how NCBI interpreted your term.** The ESearch response includes `esearchresult.querytranslation` — a MeSH-expanded version of your query. Inspect it to verify the search matched what you intended.

# Quora — Data Extraction

`https://www.quora.com` — Q&A platform. One reliable access path: `http_get` with a Chrome UA against question, answer, topic, and profile pages. Quora SSR-renders all public data into `window.ansFrontendGlobals.data.inlineQueryResults` via `.push()` calls. No browser needed for read-only tasks.

## Do this first: pick your access path

| Goal | Best approach | Latency |
|------|--------------|---------|
| Question metadata + first ~3 ranked answers | `http_get` question page + parse push payloads | ~600ms |
| Single answer (full text + upvotes + views) | `http_get` answer permalink | ~400ms |
| Answer count for a question | question page, payload with `answerCount` | same request as above |
| Topic metadata (id, name, follower count) | `http_get` topic page + parse push payloads | ~400ms |
| User profile (name, follower/following, credential) | `http_get` profile page + parse push payloads | ~500ms |
| Keyword search results | NOT available via http_get — server returns no result data | N/A |

**Never use a browser for read-only Quora tasks.** All question, answer, topic, and profile data is server-rendered. Browser is only needed for authenticated actions (posting, upvoting, following) or for getting more than the first ~3 answers on a question page (the rest load via XHR pagination).

---

## UA requirement: Chrome or Firefox — NOT bare Mozilla/5.0

```
bare "Mozilla/5.0"  -> HTTP 403
Googlebot UA        -> HTTP 403
Chrome UA           -> HTTP 200  (confirmed working)
Firefox UA          -> HTTP 200  (confirmed working)
```

Use this header bundle for all requests:

```ts
const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/123.0.0.0 Safari/537.36";

// Fetch any public Quora page. Returns HTML string.
// Requires Chrome/Firefox UA — bare Mozilla/5.0 returns 403.
// http_get handles gzip decoding.
async function quora_get(url: string): Promise<string> {
  return await http_get(url, {
    "User-Agent": CHROME_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip",
    "Accept-Language": "en-US,en;q=0.9",
  }, 20);
}
```

---

## The data format: `ansFrontendGlobals.data.inlineQueryResults`

Quora SSR embeds all page data as a series of `.push("...")` calls inside `<script>` blocks. Each call pushes a JSON-encoded string (with escaped quotes) into `inlineQueryResults`. There are no JSON-LD blocks, no `__NEXT_DATA__`, no React hydration state — only these push calls.

```ts
// Extract and parse all push() payloads from a Quora page.
// Returns list of objects (already decoded from double JSON encoding).
function extract_quora_payloads(html: string): any[] {
  const raw_payloads = [...html.matchAll(/\.push\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]);
  const results: any[] = [];
  for (const raw of raw_payloads) {
    try {
      // Two levels of encoding: outer JS string escape, inner JSON
      const inner = JSON.parse('"' + raw + '"'); // decode JS string escaping
      results.push(JSON.parse(inner)); // decode actual JSON
    } catch {}
  }
  return results;
}
```

A question page returns **16 payloads**. A profile or topic page returns **3 payloads**. The payloads that matter are identified by their `data` keys, not by position (positions are stable across requests for the same page type, but best to key on content).

---

## Path 1: Question page — metadata + first answers (fastest)

```ts
// Quora stores all text as serialized span objects.
function spans_to_text(json_str: string): string {
  try {
    const doc = JSON.parse(json_str);
    const parts: string[] = [];
    for (const sec of doc.sections ?? []) {
      for (const span of sec.spans ?? []) {
        if (span.text) parts.push(span.text);
      }
      parts.push("\n");
    }
    return parts.join("").trim();
  } catch {
    return json_str;
  }
}

function author_display_name(author: any): string | null {
  const names = author.names ?? [];
  if (names.length) {
    const n = names[0];
    return `${n.givenName ?? ""} ${n.familyName ?? ""}`.trim();
  }
  return null;
}

const isObj = (x: any) => x !== null && typeof x === "object" && !Array.isArray(x);

// Scrape a Quora question page.
// Returns:
//   question: {qid, id, title, url, slug, topics}
//   answers:  list of answer objects (first ~3 ranked answers only)
//   answer_count: total answer count (all answers, not just loaded)
//   related_questions: list of question title strings
// Only the first ~3 highest-ranked answers are SSR'd.
// The rest require XHR pagination (browser or session cookies needed).
async function quora_question(url: string) {
  const html = await quora_get(url);
  const payloads = extract_quora_payloads(html);

  const result: any = { question: {}, answers: [], answer_count: null, related_questions: [] };

  for (const payload of payloads) {
    const data = payload.data ?? payload;

    // Question metadata — keyed by presence of 'qid' inside 'question'
    if (isObj(data.question)) {
      const q = data.question;
      if (q.qid && !Object.keys(result.question).length) {
        result.question = {
          qid: q.qid ?? null,
          id: q.id ?? null,
          title: spans_to_text(q.title ?? ""),
          url: q.url ?? null,
          slug: q.slug ?? null,
          topics: (q.navigationTopics ?? []).map((t: any) => t.name),
        };
      }
    }

    // Total answer count — keyed by 'answerCount'
    if ("answerCount" in data) {
      result.answer_count = data.answerCount;
      const rq = (data.bottomRelatedQuestionsInfo || {}).relatedQuestions ?? [];
      result.related_questions = rq.map((r: any) => spans_to_text(r.title));
    }

    // Answer nodes — keyed by node.__typename == 'QuestionAnswerItem2'
    const node = data.node ?? {};
    if (isObj(node) && node.__typename === "QuestionAnswerItem2") {
      const answer = node.answer ?? {};
      if (answer.aid) {
        const a_author = answer.author || {};
        const cred = answer.authorCredential || {};
        result.answers.push({
          aid: answer.aid ?? null,
          index: node.index ?? null,
          author_name: author_display_name(a_author),
          author_profile: a_author.profileUrl ?? null,
          author_uid: a_author.uid ?? null,
          author_credential: cred.translatedString ?? null,
          num_upvotes: answer.numUpvotes ?? null,
          num_views: answer.numViews ?? null,
          num_shares: answer.numShares ?? null,
          num_comments: answer.numDisplayComments ?? null,
          creation_time_us: answer.creationTime ?? null, // microseconds since epoch
          viewer_has_access: answer.viewerHasAccess ?? null,
          perma_url: answer.permaUrl ?? null,
          text: spans_to_text(answer.content ?? "{}"),
        });
      }
    }
  }

  return result;
}
```

### Example output

```ts
const result = await quora_question("https://www.quora.com/What-is-the-meaning-of-life");

// result.question:
// {
//   qid: 2861,
//   id: 'UXVlc3Rpb25AMDoyODYx',
//   title: 'What is the meaning of life?',
//   url: '/What-is-the-meaning-of-life',
//   slug: 'What-is-the-meaning-of-life',
//   topics: ['Philosophy', 'The Big Unanswered Questions', 'Meaning of Life', ...]
// }

// result.answer_count:  413

// result.answers[0]:
// {
//   aid: 2779675,
//   index: 1,
//   author_name: 'Shubhankar Srivastava',
//   author_profile: '/profile/Shubhankar-Srivastava',
//   author_uid: 5381038,
//   author_credential: 'works at D. E. Shaw',
//   num_upvotes: 589,
//   num_views: 24085,
//   num_shares: 0,
//   num_comments: 8,
//   creation_time_us: 1373364681312036,   // divide by 1e6 for seconds
//   viewer_has_access: true,
//   perma_url: '/What-is-the-meaning-of-life/answer/Shubhankar-Srivastava',
//   text: 'Every morning in Africa, a deer wakes up...'
// }
```

### Convert creation_time_us to datetime

```ts
const ts_sec = result.answers[0].creation_time_us / 1_000_000;
const dt = new Date(ts_sec * 1000);
// dt.toISOString() -> "2013-07-09T09:31:21.312Z"
```

---

## Path 2: Single answer permalink

Fetching `quora.com/{question-slug}/answer/{author-slug}` directly returns only that one answer's full data in 3 payloads instead of 16. Use this when you already know the answer URL.

```ts
// Fetch a single answer by its permalink.
// URL format: https://www.quora.com/{question-slug}/answer/{author-profile-slug}
// Returns answer object with: aid, num_upvotes, num_views, text, author info.
// Uses spans_to_text() from Path 1.
async function quora_answer(answer_url: string) {
  const html = await quora_get(answer_url);
  const payloads = extract_quora_payloads(html);

  for (const payload of payloads) {
    const data = payload.data ?? {};
    if (data.answer && typeof data.answer === "object") {
      const a = data.answer;
      const author = a.author || {};
      const names = author.names ?? [{}];
      const n = names.length ? names[0] : {};
      return {
        aid: a.aid ?? null,
        num_upvotes: a.numUpvotes ?? null,
        num_views: a.numViews ?? null,
        author_name: `${n.givenName ?? ""} ${n.familyName ?? ""}`.trim(),
        author_uid: author.uid ?? null,
        text: spans_to_text(a.content ?? "{}"),
      };
    }
  }
  return {};
}

// Example:
// await quora_answer("https://www.quora.com/What-is-the-meaning-of-life/answer/Pararth-Shah")
// -> {aid: 4734237, num_upvotes: 234, num_views: 100643, author_name: 'Pararth Shah', ...}
```

---

## Path 3: Topic page

```ts
// Fetch topic metadata from a Quora topic page.
// URL format: https://www.quora.com/topic/{topic-slug}
// Returns: tid, name, num_followers, url, is_following, has_leaderboard.
// NOTE: The topic page itself only renders topic metadata, NOT the question feed.
// Question feed requires browser (XHR-loaded via React).
async function quora_topic(topic_url: string) {
  const html = await quora_get(topic_url);
  const payloads = extract_quora_payloads(html);

  for (const payload of payloads) {
    const data = payload.data ?? {};
    if (data.topic && typeof data.topic === "object") {
      const t = data.topic;
      return {
        tid: t.tid ?? null,
        id: t.id ?? null,
        name: t.name ?? null,
        url: t.url ?? null,
        num_followers: t.numFollowers ?? null,
        is_following: t.isFollowing ?? null,
        has_leaderboard: t.hasLeaderboard ?? null,
        photo_url: t.photoUrl ?? null,
        is_locked: t.isLocked ?? null,
      };
    }
  }
  return {};
}

// Example:
// await quora_topic("https://www.quora.com/topic/Python-programming-language")
// -> {tid: 13292, name: 'Python Programming Language', num_followers: 10, ...}
```

---

## Path 4: User profile page

```ts
// Fetch user profile data from https://www.quora.com/profile/{username}
// Returns: uid, name, credential, follower_count, following_count, profile_image_url.
async function quora_profile(profile_url: string) {
  const html = await quora_get(profile_url);
  const payloads = extract_quora_payloads(html);

  for (const payload of payloads) {
    const data = payload.data ?? {};
    if (data.user && typeof data.user === "object") {
      const u = data.user;
      const names = u.names ?? [{}];
      const n = names.length ? names[0] : {};
      const cred = u.profileCredential || {};
      return {
        uid: u.uid ?? null,
        id: u.id ?? null,
        name: `${n.givenName ?? ""} ${n.familyName ?? ""}`.trim(),
        profile_url: u.profileUrl ?? null,
        follower_count: u.followerCount ?? null,
        following_count: u.followingCount ?? null,
        profile_image: u.profileImageUrl ?? null,
        credential: cred.experience ?? null,
        is_verified: u.isVerified ?? null,
        is_anon: u.isAnon ?? null,
        is_ai_account: u.isAiAccount ?? null,
        deactivated: u.deactivated ?? null,
      };
    }
  }
  return {};
}

// Example:
// await quora_profile("https://www.quora.com/profile/Pararth-Shah")
// -> {uid: 4683832, name: 'Pararth Shah', follower_count: 5154,
//     following_count: 83, credential: 'Unfinished symphony.', ...}
```

---

## Gotchas

- **Bare Mozilla/5.0 UA returns HTTP 403** — Always use a full Chrome or Firefox UA string. The default `http_get` helper's `"User-Agent": "Mozilla/5.0"` will be blocked. Do not call `http_get` without headers; use the `quora_get` wrapper above.

- **Googlebot UA returns HTTP 403** — Quora blocks crawler UAs. Only real browser UAs work.

- **Double JSON encoding** — Each `.push()` argument is a JavaScript string literal containing JSON. To parse: first `JSON.parse('"' + raw + '"')` to decode the JS string escaping (converts `\\"` to `"`), then `JSON.parse(inner)` to parse the actual JSON object. Skipping either step produces parse errors.

- **All text fields are serialized span objects** — `question.title`, `answer.content`, `user.descriptionQtextDocument.legacyJson`, etc. are all JSON strings containing a `{"sections": [{"spans": [...]}]}` document, not plain text. Always parse through `spans_to_text()`.

- **Question page only SSR's the first ~3 answers** — The `answers` list in the result will contain at most 3 entries (the top-ranked answers). The `answer_count` field shows the true total (e.g. 413). To get more answers you need browser-based XHR pagination (Quora sends additional answers via GraphQL calls that require session auth in practice).

- **`viewer_has_access: false` still includes full content** — Even when `viewerHasAccess` is `false` (answers from Quora+ Spaces / tribe-only content), the `content` field is still present in the SSR payload and the full text is readable. The flag only controls client-side gating in the browser.

- **`creation_time_us` is microseconds, not milliseconds** — Divide by `1_000_000` (not `1_000`) to get a Unix timestamp in seconds. Confirmed: `1373364681312036 / 1e6 = 1373364681.3` (July 2013).

- **`numFollowers` on topic pages may be 0 even for major topics** — The field reflects the logged-in user's follow state for some topics and appears to undercount. Treat as approximate.

- **Search pages do not yield result data** — `https://www.quora.com/search?q=...` returns 3 payloads with viewer/network info only — no search results in the SSR payload. Search results are loaded client-side and are not accessible via http_get.

- **Profile pages do not include the user's answer list** — The profile page SSR payload returns user metadata only. The list of a user's answers is loaded via XHR pagination. To get answers for a specific question, use the question URL directly.

- **IDs are base64-encoded Relay global IDs** — `id: "UXVlc3Rpb25AMDoyODYx"` decodes to `"Question@0:2861"`. The numeric `qid`/`uid`/`aid`/`tid` fields are more useful for constructing URLs and deduplication. Use `qid` and `aid` as stable identifiers.

- **`permaUrl` may be an absolute URL for Spaces answers** — Most answers have `permaUrl: "/Question-slug/answer/Author-Name"` (relative). Answers posted in a Quora Space have a full absolute URL like `"https://spacename.quora.com/Question-slug"`. Handle both forms.

- **No public REST or GraphQL API** — Quora's internal `graphql/gql_para_POST` endpoint requires a valid `quora-formkey` header derived from the session, making it inaccessible without a real authenticated session. The SSR push-payload approach is the only reliable unauthenticated path.

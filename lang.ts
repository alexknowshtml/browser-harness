// Python-snippet check for the runner (#1604). The harness runs TypeScript only. A Python snippet gets a clear
// redirect with the TS shape and exit 2, never a confusing SyntaxError or "print is not defined".
// The same line markers as the jfdi-guards harness-python rule, which caught 267/267 real Python snippets with
// 0 false positives on 641 TS doc snippets. // comment lines are skipped: TS prose like "rows[1:] = ..." is fine.
const PY_LINE = [
  /(^|[;\s])print\s*\(/,
  /^\s*(try|except\b[^:{]*|finally)\s*:/,
  /\[\s*-?\d*\s*:\s*-?\d*\s*\]/,
  /^\s*(import\s+[\w.]+(\s*,\s*[\w.]+)*|from\s+[\w.]+\s+import\s+.+)\s*$/,
  /^\s*(def|class)\s+\w+[^{]*:\s*(#.*)?$/,
  /^\s*with\s+.+\s+as\s+\w+\s*:\s*$/,
  /^\s*(for\s+\w+(\s*,\s*\w+)*\s+in\s+.+|while\s+.+|if\s+.+|elif\s+.+|else|try|except(\s+.+)?|finally)\s*:\s*(#.*)?$/,
  /\btime\.sleep\s*\(/,
  /\bjson\.(dumps|loads)\s*\(/,
];

export const looksPython = (code: string): boolean =>
  code.split("\n").some((l) => !/^\s*\/\//.test(l) && PY_LINE.some((re) => re.test(l)));

export const PYTHON_TEXT = `browser-harness runs TypeScript now (#1604). This snippet looks like Python, so it did not run.
Rewrite it in TypeScript:

  scripts/browser-harness <<'TS'
  await temp_tab("https://example.com", async (tid) => {
    await wait(3)
    console.log(JSON.stringify(await page_info()))
  })
  TS

print(x) -> console.log(x). time.sleep(n) -> await wait(n). json.dumps -> JSON.stringify.
with temp_tab(u) as tid: -> await temp_tab(u, async (tid) => {...}). cdp("M", a=1) -> await cdp("M", {a: 1}).
Helpers keep their snake_case names and are all async. Guide: SKILL.md`;

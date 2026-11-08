// Snippet language detection for the runner (#1604). Transitional: the runner still accepts Python
// snippets until the Python harness is deleted, and needs to tell the two apart with no flag.
// Parsers decide (compile(), since ast.parse accepts a top-level await), never keywords in raw text: Python snippets often carry JS inside js("...") strings
// (=>, await, const), so a text match would misfire.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(import.meta.path);
const PY = join(HERE, "venv/bin/python");

export function parsesAsPython(code: string): boolean {
  if (!existsSync(PY)) return false;
  const r = spawnSync(PY, ["-I", "-c", "import sys; compile(sys.stdin.read(), '<snippet>', 'exec')"], { input: code, encoding: "utf8" });
  return r.status === 0;
}

export function parsesAsTs(code: string): boolean {
  try {
    new Bun.Transpiler({ loader: "ts" }).transformSync(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * "py" | "ts". Python if only Python parses. TS if only TS parses (top-level await, const, arrow
 * functions outside strings). When both parse (call-only one-liners like `print(x)`), a JS global (console., Bun., JSON.) with
 * no print( means TS; anything else stays Python, which is what every caller sent before #1604.
 */
export function detect(code: string): "py" | "ts" {
  const py = parsesAsPython(code);
  if (!py) return "ts";
  if (!parsesAsTs(code)) return "py";
  // Strings are dropped first: Python snippets carry JS (JSON.stringify, console.log) inside js("...").
  const bare = code.replace(/"""[\s\S]*?"""|'\'\'[\s\S]*?'\'\'|`(?:[^`\\]|\\.)*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
  return /\b(console|Bun|JSON|Object|Array|Math|process)\.\w+/.test(bare) && !/\bprint\s*\(/.test(bare) ? "ts" : "py";
}

if (import.meta.main) console.log(detect(await Bun.stdin.text()));

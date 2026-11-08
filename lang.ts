// Snippet language detection for the runner (#1604). Transitional: the runner still accepts Python
// snippets until the Python harness is deleted, and needs to tell the two apart with no flag.
// Parsers decide, never keywords in raw text: Python snippets often carry JS inside js("...") strings
// (=>, await, const), so a text match would misfire.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";

const HERE = dirname(import.meta.path);
const PY = join(HERE, "venv/bin/python");

export function parsesAsPython(code: string): boolean {
  if (!existsSync(PY)) return false;
  const r = spawnSync(PY, ["-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: code, encoding: "utf8" });
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
 * functions outside strings). When both parse (call-only one-liners like `print(x)`), console.* with no
 * print( means TS; anything else stays Python, which is what every caller sent before #1604.
 */
export function detect(code: string): "py" | "ts" {
  const py = parsesAsPython(code);
  if (!py) return "ts";
  if (!parsesAsTs(code)) return "py";
  return /\bconsole\.\w+\s*\(/.test(code) && !/\bprint\s*\(/.test(code) ? "ts" : "py";
}

if (import.meta.main) console.log(detect(await Bun.stdin.text()));

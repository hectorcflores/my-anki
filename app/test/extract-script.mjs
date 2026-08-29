// Pulls the inline <script> (the plain one, not ./data.js and not the
// type="module" Firebase loader) out of index.html, either from disk (the
// working tree, i.e. whatever is currently being edited) or from a git ref
// (e.g. "HEAD", to run the same scenarios against the pre-fix code and
// confirm they're actually red there).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REL_PATH = "brain-gym/index.html";

function extractInlineScript(html) {
  const marker = "<script>";
  const start = html.indexOf(marker);
  if (start === -1) throw new Error("extract-script: no bare <script> tag found");
  const end = html.indexOf("</script>", start);
  if (end === -1) throw new Error("extract-script: unterminated <script>");
  return html.slice(start + marker.length, end);
}

export function getScriptSource(ref) {
  const html = ref
    ? execFileSync("git", ["show", `${ref}:${REL_PATH}`], { cwd: REPO_ROOT, encoding: "utf8" })
    : readFileSync(path.join(REPO_ROOT, REL_PATH), "utf8");
  return extractInlineScript(html);
}

import { jsonrepair } from "jsonrepair";

/**
 * Detect and parse JSON returned by agent / submodule APIs so the UI never dumps raw strings.
 */

function stripBomAndFences(s: string): string {
  let t = s.trim().replace(/^\uFEFF/, "");
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)```\s*$/im.exec(t);
  if (fenced) t = fenced[1].trim();
  else t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  return t;
}

/** Balanced `{...}` or `[...]` from startIdx (string-aware). */
export function extractBalancedJsonFrom(s: string, startIdx: number): string | null {
  const open = s[startIdx];
  if (open !== "{" && open !== "[") return null;

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = startIdx; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return s.slice(startIdx, i + 1);
    }
  }
  return null;
}

export function extractFirstJsonValue(s: string): string | null {
  const t = stripBomAndFences(s);
  const ob = t.indexOf("{");
  const arr = t.indexOf("[");
  let start = -1;
  if (ob >= 0 && arr >= 0) start = Math.min(ob, arr);
  else start = ob >= 0 ? ob : arr >= 0 ? arr : -1;
  if (start < 0) return null;
  return extractBalancedJsonFrom(t, start);
}

export function isLikelyJsonPayload(s: string): boolean {
  const t = s.trim();
  return (t.startsWith("{") || t.startsWith("[")) && t.length > 2;
}

/** Remove trailing commas before } or ] (common LLM mistake). */
function stripTrailingCommas(json: string): string {
  return json.replace(/,(\s*[}\]])/g, "$1");
}

export function parseLooseJson(content: string): unknown | null {
  const t = stripBomAndFences(content);
  if (!t.startsWith("{") && !t.startsWith("[")) return null;

  const candidates = [t, extractFirstJsonValue(t)].filter(
    (c): c is string => typeof c === "string" && c.length > 0,
  );
  const uniq = [...new Set(candidates)];

  for (const c of uniq) {
    try {
      return JSON.parse(c);
    } catch {
      /* continue */
    }
    try {
      return JSON.parse(stripTrailingCommas(c));
    } catch {
      /* continue */
    }
    try {
      return JSON.parse(jsonrepair(c));
    } catch {
      /* continue */
    }
  }
  return null;
}

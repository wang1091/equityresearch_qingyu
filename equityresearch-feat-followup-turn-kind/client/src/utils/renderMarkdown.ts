// Lightweight markdown → HTML converter for LLM-streamed answers.
//
// The agent's SIMPLE path streams plain markdown (e.g. **bold**, bullet lists,
// headings) which then renders via SafeHtmlContent. SafeHtmlContent only
// sanitizes — it does NOT translate markdown — so without this step the user
// sees literal asterisks. Card payloads from cardFormatter already contain
// HTML; we detect those and pass them through untouched so we don't disturb
// already-rendered structure.

const HTML_BLOCK_PATTERN = /<(div|p|table|ul|ol|h[1-6]|details|section|article|pre|code|span|strong|em|br)\b/i;

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderInline = (s: string): string => {
  let v = escapeHtml(s);
  v = v.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  v = v.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s.,!?)\]:;]|$)/g, "$1<em>$2</em>");
  v = v.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s.,!?)\]:;]|$)/g, "$1<em>$2</em>");
  v = v.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
  return v;
};

export function renderMarkdownToHtml(input: string): string {
  if (!input) return "";

  // If the content is already HTML (a card from cardFormatter), pass through.
  if (HTML_BLOCK_PATTERN.test(input)) return input;

  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraBuf: string[] = [];

  // Tailwind preflight resets heading sizes and list markers, and the answer
  // renders inside SafeHtmlContent (no prose styles), so we inline-style for
  // visual hierarchy. Inline style survives dompurify and needs no JIT scan.
  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push(`<p style="margin:8px 0;">${paraBuf.join("<br>")}</p>`);
    paraBuf = [];
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  // GFM table helpers: a separator row is all `:?-+:?` cells.
  const splitRow = (l: string): string[] =>
    l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const isSepRow = (l: string): boolean => {
    if (!l || !l.includes("|")) return false;
    const cells = splitRow(l);
    return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
  };
  const TBL = "border:1px solid #e5e7eb;padding:4px 8px;";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    // Table: a row of cells immediately followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      flushPara();
      closeList();
      const headers = splitRow(line);
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && lines[j].trim() && lines[j].includes("|")) {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      const head = headers
        .map((h) => `<th style="${TBL}text-align:left;background:#f9fafb;font-weight:600;">${renderInline(h)}</th>`)
        .join("");
      const body = rows
        .map(
          (r) =>
            `<tr>${headers.map((_, k) => `<td style="${TBL}">${renderInline(r[k] ?? "")}</td>`).join("")}</tr>`,
        )
        .join("");
      out.push(
        `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;font-size:13px;width:100%;">` +
          `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`,
      );
      i = j - 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const depth = heading[1].length; // 1..6 markdown levels
      const style =
        depth <= 1
          ? "font-size:17px;font-weight:700;margin:18px 0 8px;color:#111827;"
          : depth === 2
            ? "font-size:15px;font-weight:700;margin:16px 0 6px;color:#111827;border-bottom:1px solid #f0f0f0;padding-bottom:3px;"
            : depth === 3
              ? "font-size:13.5px;font-weight:600;margin:12px 0 4px;color:#374151;"
              : "font-size:12.5px;font-weight:600;margin:10px 0 4px;color:#4b5563;";
      const tag = `h${Math.min(depth + 1, 6)}`;
      out.push(`<${tag} style="${style}">${renderInline(heading[2])}</${tag}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        out.push('<ul style="margin:8px 0;padding-left:22px;list-style:disc;">');
        listType = "ul";
      }
      out.push(`<li style="margin:3px 0;">${renderInline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        out.push('<ol style="margin:8px 0;padding-left:22px;list-style:decimal;">');
        listType = "ol";
      }
      out.push(`<li style="margin:3px 0;">${renderInline(ol[1])}</li>`);
      continue;
    }
    closeList();
    paraBuf.push(renderInline(line));
  }
  flushPara();
  closeList();
  return out.join("");
}

/**
 * Replace the LLM's inline [S#] citation markers with clickable superscripts.
 * A marker links straight out to the article when `urlById` resolves the id to a
 * single external URL (single-source citation); otherwise it jumps to the
 * numbered citation in the footer (id="{anchorPrefix}-S#") — which is where
 * multi-source citations expand into their titled article list. Markers whose id
 * isn't in `validIds` are stripped (anti-fabrication). Run AFTER
 * renderMarkdownToHtml on the produced HTML.
 */
export function linkCitations(
  html: string,
  validIds: Set<string>,
  anchorPrefix: string,
  urlById?: Map<string, string>,
): string {
  return (
    html
      // Strip data-block headers the LLM sometimes echoes verbatim, in either
      // bracket style: 【NEWS | cite=S2】 or [TRENDING | cite=S1].
      .replace(/[[【][^\]】]*cite=S\d+[^\]】]*[\]】]/g, "")
      // Turn inline citation markers into clickable superscripts. Tolerate ASCII
      // [S2] and fullwidth 【S2】 (a zh model copies the 【】 it saw in the blocks).
      .replace(/[[【]\s*S(\d+)\s*[\]】]/g, (_m, digits) => {
        const id = `S${digits}`;
        if (!validIds.has(id)) return ""; // unknown/hallucinated id → strip
        // Small circular badge. Inline style (not Tailwind classes) so it survives
        // dompurify and renders without depending on the JIT content scan. <sup>
        // isn't in the sanitizer allowlist, so vertical-align:super does the lift.
        const style =
          "display:inline-flex;align-items:center;justify-content:center;" +
          "min-width:16px;height:16px;padding:0 4px;margin:0 2px;" +
          "border:1px solid #c7d2fe;border-radius:9999px;background:#eef2ff;" +
          "color:#4f46e5;font-size:10px;font-weight:600;line-height:1;" +
          "text-decoration:none;vertical-align:super;";
        // Single-source citation → link straight to the article (new tab).
        const url = urlById?.get(id);
        if (url) {
          return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="${style}">${digits}</a>`;
        }
        // Multi-source / card-backed citation → jump to the footer entry.
        return `<a href="#${anchorPrefix}-${id}" style="${style}">${digits}</a>`;
      })
  );
}

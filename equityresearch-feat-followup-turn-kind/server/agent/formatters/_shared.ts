// server/agent/formatters/_shared.ts
// Source-agnostic helpers shared by the per-source card formatters: locale &
// label localization, HTML escaping, markdown/citation rendering, the trend
// chart, and the generic error card. Extracted verbatim from cardFormatter.ts
// (step 1 of the formatter split) — no behavior change.

export function getLocale(language: string): string {
  return language === "zh" ? "zh-CN" : "en-US";
}

export function localizeMarketState(state: string, language: string): string {
  if (language !== "zh" || !state) {
    return state;
  }

  const normalized = state.toLowerCase();
  const marketStateMap: Record<string, string> = {
    pre: "盘前",
    premarket: "盘前",
    regular: "盘中",
    post: "盘后",
    postmarket: "盘后",
    closed: "已收盘",
    open: "开盘",
  };

  return marketStateMap[normalized] || state;
}

export function localizeMetricName(metric: string, language: string): string {
  const isZh = language === "zh";

  // Ratio rows are sourced from FMP /ratios-ttm in PeerComparison (v2.7),
  // so the label is annotated TTM in both languages — matches PeerComparison's
  // own UI and signals the time horizon to the reader.
  if (metric === "P/E Ratio") return isZh ? "市盈率 (TTM)" : "P/E Ratio (TTM)";
  if (metric === "Price/Sales") return isZh ? "市销率 (TTM)" : "Price/Sales (TTM)";

  if (!isZh) return metric;

  const metricMap: Record<string, string> = {
    "Total Revenue": "总营收",
    "Gross Margin %": "毛利率",
    "Operating Expense": "运营费用",
    EBIT: "息税前利润",
    "Net Income": "净利润",
    "Free Cash Flow": "自由现金流",
    "Market Cap": "市值",
  };

  return metricMap[metric] || metric;
}

export function localizeDirection(value: string | null | undefined, language: string): string {
  if (!value || language !== "zh") {
    return value || (language === "zh" ? "暂无" : "N/A");
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("bullish")) return "看多";
  if (normalized.includes("bearish")) return "看空";
  if (normalized.includes("neutral")) return "中性";
  if (normalized.includes("mixed")) return "分化";
  return value;
}

export function escapeHtmlCell(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAnswerMarkdown(input: string): string {
  if (!input) return "";

  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let paraBuf: string[] = [];

  const inline = (s: string): string => {
    let v = escapeHtml(s);
    v = v.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
    v = v.replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s.,!?)\]:;]|$)/g, "$1<em>$2</em>");
    v = v.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s.,!?)\]:;]|$)/g, "$1<em>$2</em>");
    v = v.replace(/`([^`\n]+?)`/g, "<code>$1</code>");
    return v;
  };

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push(`<p>${paraBuf.join("<br>")}</p>`);
    paraBuf = [];
  };
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  // GitHub-flavored-markdown table support. SmartNews answers (esp. multi-company
  // comparisons) come back as pipe tables; without this they render as literal
  // "| Metric | ... |" text.
  const splitRow = (s: string): string[] =>
    s.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const isTableSep = (s: string): boolean =>
    s.includes("-") && /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(s);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, "");

    // Table: a pipe-containing header row immediately followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      closeList();
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2; // consume header + separator
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      i--; // the for-loop will increment
      const th = header
        .map(
          (c) =>
            `<th style="border:1px solid #e5e7eb;padding:6px 10px;background:#f8fafc;text-align:left;font-weight:600;">${inline(c)}</th>`,
        )
        .join("");
      const trs = rows
        .map(
          (r) =>
            `<tr>${header
              .map(
                (_, ci) =>
                  `<td style="border:1px solid #e5e7eb;padding:6px 10px;vertical-align:top;">${inline(r[ci] ?? "")}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      out.push(
        `<div style="overflow-x:auto;margin:8px 0;"><table style="border-collapse:collapse;width:100%;font-size:13px;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`,
      );
      continue;
    }

    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      closeList();
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    closeList();
    paraBuf.push(inline(line));
  }
  flushPara();
  closeList();
  return out.join("");
}

export function renderTrendChart(
  allTickers: string[],
  metrics: Record<string, any>,
  isZh: boolean,
): string {
  const quarterSet = new Set<string>();
  for (const t of allTickers) {
    const rev = metrics?.[t]?.["Total Revenue"];
    if (rev && typeof rev === "object") {
      for (const q of Object.keys(rev)) if (q !== "Current") quarterSet.add(q);
    }
  }
  // Take 5 most-recent quarters across the union, then display oldest→newest left-to-right
  const chartQuarters = Array.from(quarterSet).sort().reverse().slice(0, 5).reverse();
  if (chartQuarters.length === 0) return "";

  let maxRev = 0;
  for (const t of allTickers) {
    for (const q of chartQuarters) {
      const v = metrics?.[t]?.["Total Revenue"]?.[q];
      if (typeof v === "number" && v > maxRev) maxRev = v;
    }
  }
  if (maxRev === 0) return "";

  // Round y-axis max up to a "nice" number
  const niceCeil = (n: number): number => {
    const exp = Math.pow(10, Math.floor(Math.log10(n)));
    const m = n / exp;
    const nm = m > 5 ? 10 : m > 2 ? 5 : m > 1 ? 2 : 1;
    return nm * exp;
  };
  const yMaxRev = niceCeil(maxRev);

  const W = 720, H = 280;
  const ML = 64, MR = 50, MT = 32, MB = 40;
  const pw = W - ML - MR;
  const ph = H - MT - MB;
  const colors = ["#6366f1", "#10b981", "#f59e0b", "#f97316", "#ef4444"];

  const groupW = pw / chartQuarters.length;
  const barsPerGroup = allTickers.length;
  const barW = (groupW * 0.7) / barsPerGroup;
  const groupPad = (groupW * 0.3) / 2;

  const fmtAxisRev = (v: number) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;

  let bars = "";
  let lines = "";
  let legend = "";

  chartQuarters.forEach((q, qi) => {
    allTickers.forEach((t, ti) => {
      const v = metrics?.[t]?.["Total Revenue"]?.[q];
      if (typeof v !== "number") return;
      const x = ML + qi * groupW + groupPad + ti * barW;
      const barH = (v / yMaxRev) * ph;
      const y = MT + ph - barH;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${barH.toFixed(1)}" fill="${colors[ti % colors.length]}" opacity="0.85"/>`;
    });
  });

  allTickers.forEach((t, ti) => {
    const points: string[] = [];
    chartQuarters.forEach((q, qi) => {
      const v = metrics?.[t]?.["Gross Margin %"]?.[q];
      if (typeof v !== "number") return;
      const cx = ML + qi * groupW + groupW / 2;
      const cy = MT + ph - (v / 100) * ph;
      points.push(`${cx.toFixed(1)},${cy.toFixed(1)}`);
    });
    if (points.length >= 1) {
      if (points.length >= 2) {
        lines += `<polyline points="${points.join(" ")}" fill="none" stroke="${colors[ti % colors.length]}" stroke-width="2"/>`;
      }
      for (const p of points) {
        const [cx, cy] = p.split(",");
        lines += `<circle cx="${cx}" cy="${cy}" r="3" fill="${colors[ti % colors.length]}"/>`;
      }
    }
  });

  let xLabels = "";
  chartQuarters.forEach((q, qi) => {
    const x = ML + qi * groupW + groupW / 2;
    xLabels += `<text x="${x.toFixed(1)}" y="${(MT + ph + 18).toFixed(1)}" text-anchor="middle" font-size="11" fill="#6b7280">${q}</text>`;
  });

  let grid = "";
  let yLeft = "";
  for (let i = 0; i <= 5; i++) {
    const v = (yMaxRev / 5) * i;
    const y = MT + ph - (i / 5) * ph;
    grid += `<line x1="${ML}" y1="${y.toFixed(1)}" x2="${(ML + pw).toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`;
    yLeft += `<text x="${(ML - 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#6b7280">${fmtAxisRev(v)}</text>`;
  }

  let yRight = "";
  for (let i = 0; i <= 5; i++) {
    const pct = 20 * i;
    const y = MT + ph - (pct / 100) * ph;
    yRight += `<text x="${(ML + pw + 8).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="start" font-size="10" fill="#6b7280">${pct}%</text>`;
  }

  allTickers.forEach((t, ti) => {
    const x = ML + ti * 90;
    legend += `<rect x="${x}" y="6" width="10" height="10" fill="${colors[ti % colors.length]}"/>`;
    legend += `<text x="${x + 14}" y="15" font-size="11" fill="#374151">${t}</text>`;
  });

  return `
      <div style="margin-bottom:16px;">
        <div style="font-weight:600; color:#374151; margin-bottom:8px;">📈 ${isZh ? "营收与毛利率趋势" : "Total Revenue & Gross Margin % Trend"}</div>
        <div style="background:white; border-radius:8px; padding:8px; overflow-x:auto;">
          <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
            ${grid}${bars}${lines}${xLabels}${yLeft}${yRight}${legend}
          </svg>
        </div>
      </div>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type InlineCitationRef = {
  index: number;
  url: string;
  label: string;
};

export function normalizeCitationUrl(value: string): string {
  const markdownUrl = value.match(/\((https?:\/\/[^)\s]+)\)/i)?.[1];
  const rawUrl = markdownUrl || value.match(/https?:\/\/[^\s)\]>"]+/i)?.[0] || value;
  return rawUrl.trim().replace(/[.,;]+$/, "");
}

export function getCitationLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }
}

export function isVertexGroundingUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase() === "vertexaisearch.cloud.google.com";
  } catch {
    return url.toLowerCase().includes("vertexaisearch.cloud.google.com");
  }
}

export function buildInlineCitationRefs(sources: string[]): InlineCitationRef[] {
  const seen = new Set<string>();
  const normalizedSources = sources
    .map((source) => normalizeCitationUrl(source))
    .filter(Boolean);
  const hasPublisherSources = normalizedSources.some((url) => !isVertexGroundingUrl(url));

  return normalizedSources
    .filter((url) => !hasPublisherSources || !isVertexGroundingUrl(url))
    .filter((url) => {
      const key = url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((url, index) => ({
      index: index + 1,
      url,
      label: getCitationLabel(url),
    }));
}

export function formatCitationPills(refs: InlineCitationRef[], indexes?: number[]): string {
  const wanted = indexes && indexes.length > 0
    ? refs.filter((ref) => indexes.includes(ref.index))
    : refs;

  return wanted
    .map((ref) => {
      const safeUrl = escapeHtml(ref.url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(ref.label)}" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;margin-left:4px;padding:0 5px;border-radius:999px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;text-decoration:none;font-size:11px;font-weight:700;line-height:18px;vertical-align:baseline;">${ref.index}</a>`;
    })
    .join("");
}

export function pickCitationIndexes(refs: InlineCitationRef[], position = 0, max = 1): number[] {
  if (refs.length === 0) return [];
  const start = position % refs.length;
  const indexes: number[] = [];

  for (let offset = 0; offset < Math.min(max, refs.length); offset += 1) {
    indexes.push(refs[(start + offset) % refs.length].index);
  }

  return indexes;
}

export function extractMarkdownField(markdown: string, label: string | string[]): string {
  const labels = Array.isArray(label) ? label : [label];
  for (const item of labels) {
    const escapedLabel = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = markdown.match(new RegExp(`\\*\\*${escapedLabel}\\*\\*[:：]\\s*(.+)`, "i"));
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return "";
}

export function extractMarkdownSection(markdown: string, section: string | string[]): string {
  const sections = Array.isArray(section) ? section : [section];
  for (const item of sections) {
    const escapedSection = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = markdown.match(
      new RegExp(`####\\s+${escapedSection}\\n([\\s\\S]*?)(?=\\n####\\s+|$)`, "i"),
    );
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return "";
}

export function extractPlainField(text: string, label: string | string[]): string {
  const labels = Array.isArray(label) ? label : [label];
  for (const item of labels) {
    const escapedLabel = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`(?:^|\\n)${escapedLabel}:\\s*(.+)`, "i"));
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return "";
}

export function extractPlainSection(text: string, section: string, allSections: string[]): string {
  const escapedSection = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nextSections = allSections
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = text.match(
    new RegExp(`(?:^|\\n)${escapedSection}\\n([\\s\\S]*?)(?=\\n(?:${nextSections})\\n|$)`, "i"),
  );
  return match?.[1]?.trim() || "";
}

export function formatParagraphs(text: string, citationRefs: InlineCitationRef[] = [], citationIndexes?: number[]): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph, index) => {
        const indexes = citationIndexes || pickCitationIndexes(citationRefs, index, citationRefs.length > 1 ? 2 : 1);
        return `<p style="margin:0 0 12px 0; color:#374151; line-height:1.7;">${escapeHtml(paragraph)}${formatCitationPills(citationRefs, indexes)}</p>`;
      },
    )
    .join("");
}

export function formatInlineText(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br>");
}

export function stripMarkdownSourcesSection(markdown: string): string {
  return markdown
    .replace(/\n####\s+(Sources|来源)\n[\s\S]*$/i, "")
    .trim();
}

export function formatErrorCard(dataSource: string, errorMessage: string): string {
  const sourceLabels: Record<string, string> = {
    VALUATION: "💰 Valuation Analysis",
    STOCK_PRICE: "📈 Stock Price",
    RATING: "⭐ Analyst Rating",
    COMPETITIVE: "🏭 Competitive Analysis",
    FDA: "💊 FDA Analysis",
    NEWS: "📰 News Analysis",
    EARNINGS: "📞 Earnings Analysis",
    PERFORMANCE: "📊 Performance Analysis",
    RUMOR: "🔍 Rumor Check",
  };

  const label = sourceLabels[dataSource] || dataSource;

  return `<div style="padding: 16px; background: #fef2f2; border-left: 4px solid #ef4444; border-radius: 8px;">
    <strong>${label}</strong><br><br>
    <div style="color: #991b1b; font-weight: 600;">❌ Analysis Unavailable</div>
    <div style="font-size: 0.9em; margin-top: 8px; color: #666;">${errorMessage}</div>
  </div>`;
}


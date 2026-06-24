// Source attribution for fused multi-module answers.
//
// The generator fuses several data sources into one Investment Brief; this module
// turns each retrieved source into typed, verifiable `Source` objects that ride
// along with the structured output (top-level `sources`) so the client can render
// real citations instead of the LLM's free-text guesses.
//
// MINIMAL PHASE (this file): only NEWS yields real clickable links; every other
// source falls back to `defaultProvenance` (a "PROVIDER · as-of" data chip).
// Mirrors the SIMPLIFY_REGISTRY pattern (simplify/index.ts): one registry + a
// default. To make another source clickable later, add one entry to PROVENANCE.
//
// Full design (typed link/model/data, per-(source,ticker) ids, LLM-emitted ids,
// chip→card): docs/FUSED_ANSWER_SOURCE_ATTRIBUTION_PLAN.md. Keep in sync.
//
// Per docs/.. and [[llm-ts-boundary-principle]]: the LLM never supplies sources or
// the as-of date — TS derives sources from the retrieved data and stamps `asOf`.
import type { DataSource } from "./intentSources";

/** A clickable external reference (news article, filing). The URL is the only
 *  field guaranteed to point where it says; `publisher` is kept only when it
 *  matches the URL host (see publisherMatchesHost). */
export interface LinkSource {
  type: "link";
  provider: string;
  ticker?: string | null;
  url: string;
  publisher?: string;
  title?: string;
  date?: string;
}

/** A non-linkable computed result (our own model/engine), cited by engine + as-of.
 *  `id` keys into the response's source_cards map so the chip can expand its card. */
export interface ModelSource {
  type: "model";
  id: string;
  provider: string;
  ticker?: string | null;
  engine: string; // what produced it, e.g. "Valuation model" / "Porter's Five Forces"
  method?: string; // optional sub-method, e.g. "DCF"
  asOf: string; // ISO timestamp, TS-stamped at build time
}

/** A non-linkable API/data origin — cited by provider + retrieval time.
 *  `id` keys into the response's source_cards map so the chip can expand its card. */
export interface DataSourceRef {
  type: "data";
  id: string;
  provider: string;
  ticker?: string | null;
  asOf: string; // ISO timestamp, TS-stamped at build time
}

export type Source = LinkSource | ModelSource | DataSourceRef;

/** Provenance fns produce sources without ids; buildSources assigns ids to the
 *  card-backed (non-link) ones so they stay stable per response. */
type SourceDraft = LinkSource | Omit<ModelSource, "id"> | Omit<DataSourceRef, "id">;

/** One simplified data element (already per-element for multi-ticker arrays) → its sources. */
type ProvenanceFn = (source: string, item: any) => SourceDraft[];

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/** Accept only well-formed http(s) URLs; trim trailing punctuation. */
function normalizeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/[)\].,;]+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

const tickerOf = (item: any): string | null =>
  item && typeof item === "object" && isStr(item.ticker) ? item.ticker : null;

/** Bare host (no `www.`) of a URL, or "" when unparseable. */
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Does `publisher` plausibly own `url`? Guards against the news adapter pairing
 * article publishers with index-matched (unrelated) search-result URLs
 * (newsResponseAdapter.ts ~L222), which would otherwise render a chip that lies
 * about where it links (e.g. "Bloomberg" → cnbc.com). When this returns false we
 * drop the label and let the client show the host instead — which cannot lie.
 */
function publisherMatchesHost(publisher: string, url: string): boolean {
  const host = hostname(url);
  if (!host) return false;
  const parts = host.split(".");
  const hostMain = (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) ?? "";
  const p = publisher.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!hostMain || !p) return false;
  return p.includes(hostMain) || hostMain.includes(p);
}

/**
 * NEWS → clickable links. The simplified NEWS payload (simplify/news.ts) carries
 * real article URLs in `items[]` (headline/publisher/date) and source links in
 * `sources[]`; both are folded in and deduped by URL.
 */
function newsProvenance(_source: string, item: any): SourceDraft[] {
  const out: LinkSource[] = [];
  const seen = new Set<string>();
  const add = (url: unknown, publisher?: unknown, title?: unknown, date?: unknown) => {
    const u = normalizeUrl(url);
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({
      type: "link",
      provider: "NEWS",
      url: u,
      // Only keep the publisher label when it matches the URL's host; otherwise
      // the chip would lie about its destination (see publisherMatchesHost).
      ...(isStr(publisher) && publisherMatchesHost(publisher, u) ? { publisher } : {}),
      // Title/date describe THIS url's own article (same object), so they can't
      // mislabel the destination — keep them for a richer citation list.
      ...(isStr(title) ? { title } : {}),
      ...(isStr(date) ? { date } : {}),
    });
  };

  if (item && typeof item === "object") {
    for (const it of Array.isArray(item.items) ? item.items : []) {
      add(it?.url, it?.publisher, it?.headline ?? it?.title, it?.date);
    }
    for (const s of Array.isArray(item.sources) ? item.sources : []) {
      add(s?.url, s?.publisher);
    }
  }
  return out;
}

/** VALUATION → our valuation model (DCF / relative). Cited by engine + method. */
function valuationProvenance(_source: string, item: any): SourceDraft[] {
  return [
    {
      type: "model",
      provider: "VALUATION",
      ticker: tickerOf(item),
      engine: "Valuation model",
      ...(isStr(item?.method) ? { method: item.method } : {}),
      asOf: new Date().toISOString(),
    },
  ];
}

/** COMPETITIVE → our Porter's Five Forces analysis. Ticker comes from `company`. */
function competitiveProvenance(_source: string, item: any): SourceDraft[] {
  const ticker = isStr(item?.company) ? item.company : tickerOf(item);
  return [
    {
      type: "model",
      provider: "COMPETITIVE",
      ticker,
      engine: "Porter's Five Forces",
      asOf: new Date().toISOString(),
    },
  ];
}

/**
 * Full article list from the RAW news payload's `search_results`. Each entry's
 * title / url / publisher live on the SAME object (search-engine aligned), so —
 * unlike the index-paired enriched items or the simplified link chips — title and
 * url can't drift. Used to enrich the NEWS citation in the unified answer (B2) so
 * it expands into a real article list, mirroring the single-intent news card.
 */
export function buildNewsArticleLinks(rawNews: any): LinkSource[] {
  const elements = Array.isArray(rawNews) ? rawNews : [rawNews];
  const out: LinkSource[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const sr = el && Array.isArray(el.search_results) ? el.search_results : [];
    for (const s of sr) {
      const u = normalizeUrl(s?.url);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push({
        type: "link",
        provider: "NEWS",
        url: u,
        ...(isStr(s?.title) ? { title: s.title } : {}),
        ...(isStr(s?.publisher) ? { publisher: s.publisher } : isStr(s?.source) ? { publisher: s.source } : {}),
        ...(isStr(s?.date) ? { date: s.date } : isStr(s?.last_updated) ? { date: s.last_updated } : {}),
      });
    }
  }
  return out;
}

/**
 * Upgrade each NEWS citation into a title-bearing article list WITHOUT changing
 * which URLs it cites. The footer/inline link must only ever show the articles
 * actually fed to the LLM (the simplified NEWS block = `citation.sources`), never
 * the wider raw `search_results` pool. We borrow title/date from the raw payload
 * keyed by the SAME url (a same-object enrichment, so it can't mislabel) and never
 * introduce a url the LLM didn't see. An item's own headline title is preserved.
 * Non-NEWS citations pass through untouched.
 */
export function enrichNewsCitations(citations: Citation[], rawNews: any): Citation[] {
  if (!rawNews) return citations;
  const rawByUrl = new Map(buildNewsArticleLinks(rawNews).map((a) => [a.url, a]));
  if (rawByUrl.size === 0) return citations;
  return citations.map((c) => {
    if (c.sources[0]?.provider !== "NEWS") return c;
    const sources = c.sources.map((s) => {
      if (s.type !== "link") return s;
      const raw = rawByUrl.get(s.url);
      if (!raw) return s;
      return {
        ...s,
        ...(s.title ? {} : raw.title ? { title: raw.title } : {}),
        ...(s.date ? {} : raw.date ? { date: raw.date } : {}),
      };
    });
    return { ...c, sources };
  });
}

/** Default: a single non-linkable data chip, cited by provider + retrieval time. */
function defaultProvenance(source: string, item: any): SourceDraft[] {
  return [{ type: "data", provider: source, ticker: tickerOf(item), asOf: new Date().toISOString() }];
}

const PROVENANCE: Partial<Record<DataSource, ProvenanceFn>> = {
  NEWS: newsProvenance,
  VALUATION: valuationProvenance,
  COMPETITIVE: competitiveProvenance,
  // EARNINGS intentionally falls back to `data`: its payloads (calendar / ask)
  // carry no reliable URL, so a `link` would be a dead/guessed link. Revisit if
  // the upstream starts returning a canonical Nasdaq/transcript URL.
};

/**
 * Build the deduped, typed source list for one fused answer from the SIMPLIFIED
 * data already prepared for the prompt. Multi-ticker arrays are expanded
 * element-wise. Links dedupe by URL; data chips dedupe by provider+ticker.
 */
export function buildSources(validData: Record<string, any>): Source[] {
  const result: Source[] = [];
  const seenLink = new Set<string>();
  const seenData = new Set<string>();

  let n = 0;
  for (const [source, data] of Object.entries(validData)) {
    const fn = PROVENANCE[source as DataSource] ?? defaultProvenance;
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      for (const s of fn(source, item)) {
        if (s.type === "link") {
          if (seenLink.has(s.url)) continue;
          seenLink.add(s.url);
          result.push(s);
        } else {
          const key = `${s.provider}:${s.ticker ?? ""}`;
          if (seenData.has(key)) continue;
          seenData.add(key);
          result.push({ ...s, id: `src${++n}` });
        }
      }
    }
  }
  return result;
}

/**
 * A numbered, citable block — one per (source, ticker) data block fed to the LLM.
 * The LLM cites it inline as `[S{n}]`; the client renders `[n]` superscripts that
 * link to the footer entry, which shows this block's resolved sources (chips/cards).
 * This is the granularity the LLM can actually attribute (it knows "from the NEWS
 * data", not which individual article URL).
 */
export interface Citation {
  id: string; // "S1" — the inline marker the LLM emits
  n: number; // 1-based display number
  label: string; // e.g. "NEWS" / "VALUATION (NVDA)"
  sources: Source[]; // resolved chips for this block (links / model / data)
}

/**
 * Build numbered citations AND the matching tagged prompt blocks in one pass, so
 * the `[S{n}]` markers the LLM is told to use line up exactly with the citations
 * the client renders. One citation per (source, ticker) block; card-backed
 * (non-link) sources get stable `src{n}` ids so source_cards stays keyed
 * consistently. Blocks with no citable source are still fed to the prompt (the
 * LLM needs their data) but carry no cite id.
 */
export function buildCitedData(validData: Record<string, any>): {
  citations: Citation[];
  promptBlocks: string;
} {
  const citations: Citation[] = [];
  let n = 0;
  let cardN = 0;
  let promptBlocks = "";
  for (const [source, data] of Object.entries(validData)) {
    const fn = PROVENANCE[source as DataSource] ?? defaultProvenance;
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      const drafts = fn(source, item);
      const ticker = isStr(item?.ticker) ? item.ticker : isStr(item?.company) ? item.company : null;
      const label = ticker ? `${source} (${ticker})` : source;
      let citeTag = "";
      if (drafts.length > 0) {
        const sources: Source[] = drafts.map((d) =>
          d.type === "link" ? d : { ...d, id: `src${++cardN}` },
        );
        n += 1;
        const id = `S${n}`;
        citations.push({ id, n, label, sources });
        citeTag = ` | cite=${id}`;
      }
      promptBlocks += `\n【${label}${citeTag}】\n${JSON.stringify(item, null, 2)}\n`;
    }
  }
  return { citations, promptBlocks };
}

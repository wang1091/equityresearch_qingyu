import { logger as moduleLogger } from "../../../logger";
import { elapsedMs, nowNs } from "../../../timing";
import type { SourceCitation } from "../../../types/domain";
import type {
  ResearchErrorKind,
  ResearchInput,
  ResearchOutcome,
  ResearchProvider,
} from "../../types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

const TIMEOUT_MS = 45000;

// Default research model. `sonar-reasoning-pro` is more thorough but ~7x
// slower (see COMPETITIVE_PERPLEXITY_MODEL_AB.md). `sonar` finishes in 5s
// with comparable extreme-case scoring; recommended for chat surface.
// Override via env: COMPETITIVE_RESEARCH_MODEL=sonar
const DEFAULT_MODEL = "sonar-reasoning-pro";
const ALLOWED_MODELS = ["sonar", "sonar-reasoning-pro"] as const;
type AllowedModel = (typeof ALLOWED_MODELS)[number];

function resolveModel(): AllowedModel {
  const raw = (process.env.COMPETITIVE_RESEARCH_MODEL || "").trim();
  if (!raw) return DEFAULT_MODEL;
  if ((ALLOWED_MODELS as readonly string[]).includes(raw)) {
    return raw as AllowedModel;
  }
  // Whitelist guard — Perplexity would otherwise return 400 on a typo,
  // and we'd only find out per-request. Fail loud at startup instead.
  console.warn(
    `[competitive/perplexity] COMPETITIVE_RESEARCH_MODEL="${raw}" is not one of [${ALLOWED_MODELS.join(
      ", ",
    )}] — falling back to ${DEFAULT_MODEL}`,
  );
  return DEFAULT_MODEL;
}

const MODEL: AllowedModel = resolveModel();

const SEARCH_DOMAIN_BLOCKLIST = [
  // Social / discussion platforms — speculation, not research
  "-reddit.com", "-quora.com", "-stocktwits.com",
  "-pinterest.com", "-tiktok.com", "-instagram.com", "-facebook.com",
  // How-to sites — irrelevant
  "-wikihow.com",
  // Video platforms — transcript citations are unreliable
  "-youtube.com",
  // SEO content farms / generic blogs
  "-pocketoption.com",
  "-matrixbcg.com",
  "-thestrategystory.com",
];

const SEARCH_CONTEXT_SIZE = "medium";

const logger = moduleLogger.child({ step: "research", provider: "perplexity" });

const getKey = () => process.env.PERPLEXITY_API_KEY;

function categorizeHttpStatus(status: number): ResearchErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "unknown";
}

function categorizeException(e: unknown): ResearchErrorKind {
  if (!(e instanceof Error)) return "unknown";
  const name = e.name || "";
  const msg = e.message || "";
  if (name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(msg)) {
    return "timeout";
  }
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(msg)) {
    return "transport";
  }
  return "unknown";
}

// High-severity kinds escalate to logger.error so monitoring alerts.
// Low-severity (config / unknown) stay at warn.
function isSeverityHigh(kind: ResearchErrorKind): boolean {
  return (
    kind === "auth" ||
    kind === "server" ||
    kind === "timeout" ||
    kind === "transport" ||
    kind === "malformed_response"
  );
}

function logFailure(kind: ResearchErrorKind, msg: string, ctx?: Record<string, unknown>) {
  if (isSeverityHigh(kind)) logger.error(msg, ctx);
  else logger.warn(msg, ctx);
}

function emptyOutcome(durationMs: number, errorKind: ResearchErrorKind): ResearchOutcome {
  return { status: "empty", errorKind, durationMs };
}

async function perform(input: ResearchInput): Promise<ResearchOutcome> {
  const start = nowNs();
  logger.info(`\n⏱️  Perplexity 情报搜集 - 开始...`);

  const apiKey = getKey();
  if (!apiKey) {
    logger.error(`Perplexity API key 未配置`, {
      hint: "Set PERPLEXITY_API_KEY in env",
    });
    return emptyOutcome(elapsedMs(start), "config");
  }

  // Narrow scope #1: fetch transport / abort errors only.
  let res: Response;
  try {
    res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input) },
        ],
        temperature: 0.2,
        search_domain_filter: SEARCH_DOMAIN_BLOCKLIST,
        web_search_options: { search_context_size: SEARCH_CONTEXT_SIZE },
      }),
    });
  } catch (e) {
    const kind = categorizeException(e);
    logFailure(kind, `Perplexity fetch failed (${kind})`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return emptyOutcome(elapsedMs(start), kind);
  }

  if (!res.ok) {
    const kind = categorizeHttpStatus(res.status);
    logFailure(kind, `Perplexity HTTP ${res.status} (${kind})`, { status: res.status });
    return emptyOutcome(elapsedMs(start), kind);
  }

  // Narrow scope #2: JSON parse failure (upstream schema drift), not local bug.
  let data: any;
  try {
    data = await res.json();
  } catch (e) {
    logger.error(`Perplexity returned non-JSON body`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return emptyOutcome(elapsedMs(start), "malformed_response");
  }

  if (data === null || typeof data !== "object") {
    logger.error(`Perplexity returned non-object JSON`, { receivedType: typeof data });
    return emptyOutcome(elapsedMs(start), "malformed_response");
  }

  // Below this point: extraction is safe via optional chaining + type
  // guards. Any thrown exception here is a programmer bug — let it
  // propagate so ops sees it.
  const content: string = data.choices?.[0]?.message?.content || "";
  const sources: SourceCitation[] = Array.isArray(data.search_results)
    ? data.search_results
        .filter((s: any) => s && typeof s.url === "string")
        .map((s: any) => ({
          url: s.url,
          ...(typeof s.title === "string" ? { title: s.title } : {}),
          ...(typeof s.date === "string" ? { date: s.date } : {}),
        }))
    : [];

  const durationMs = elapsedMs(start);
  logger.info(
    `✅ Perplexity 完成 - 获取 ${content.length} 字符, ${sources.length} 引用 (${durationMs.toFixed(1)}ms)`,
  );
  return { status: "ok", content, sources, durationMs };
}

export const perplexityProvider: ResearchProvider = {
  id: "perplexity",
  model: MODEL,
  perform,
};

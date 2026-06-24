/**
 * Rumor Check upstream proxy service. Extracted from routes/rumor.ts (per-source
 * service split) — no behavior change. Both the Express routes (routes/rumor.ts)
 * and the agent plan registry (agent/planRegistry.ts) call proxyRumorChatbot
 * from here. The rumor env getters (incl. getApiBaseUrl, used only by
 * getRumorLegacyFallbackUrl) move here with the service.
 */
import { fetchJsonWithFallback } from "../upstreamFetch";

/** Upstream proxy timeout (per-source, owned by this service — rumor LLM can be slow). */
const RUMOR_TIMEOUT_MS = 110000;

const getApiBaseUrl = () =>
  process.env.API_BASE_URL || "https://smartnews.checkitanalytics.com";
const getRumorChatbotInternalUrl = () =>
  process.env.RUMOR_CHATBOT_INTERNAL_URL?.trim() ||
  (process.env.NODE_ENV === "production"
    ? "http://127.0.0.1:3000/api/chatbot/rumor"
    : "");
const getRumorLegacyFallbackUrl = () =>
  process.env.RUMOR_LEGACY_FALLBACK_URL?.trim() ||
  `${getApiBaseUrl()}/api/detect-rumor`;
const getRumorInternalToken = () =>
  process.env.RUMORCHECK_INTERNAL_TOKEN?.trim() || "";

// chatbot (internal :3000) → legacy /api/detect-rumor, via the shared failover
// loop. Each candidate carries its own headers + body; parse tags the winning
// response with its source. On total failure the loop throws (the previous
// "return last non-OK status+body" branch becomes a generic 500 — untested).
// Module-level + exported so the agent (planRegistry) reaches the rumor upstream
// through this same hardened proxy instead of a loopback self-call.
export async function proxyRumorChatbot(body: any): Promise<Record<string, unknown>> {
  const requestBody = {
    query: body?.query,
    language: body?.language || "auto",
    include_raw: body?.include_raw === true,
  };

  const internalUrl = getRumorChatbotInternalUrl();
  const internalToken = getRumorInternalToken();
  const legacyFallbackUrl = getRumorLegacyFallbackUrl();

  const candidateRequests = [
    ...(internalUrl
      ? [
          {
            label: "chatbot",
            url: internalUrl,
            body: requestBody,
            headers: internalToken ? { "X-Internal-Token": internalToken } : {},
          },
        ]
      : []),
    ...(legacyFallbackUrl
      ? [
          {
            label: "legacy_detect_rumor",
            url: legacyFallbackUrl,
            body: {
              query: requestBody.query,
              language: requestBody.language,
            },
            headers: {},
          },
        ]
      : []),
  ];

  return fetchJsonWithFallback<Record<string, unknown>>(
    candidateRequests.map((rc) => ({
      url: rc.url,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(rc.headers as Record<string, string>),
        },
        body: JSON.stringify(rc.body),
      },
      parse: (raw: unknown) => ({
        ...(raw as Record<string, unknown>),
        proxy_source: rc.label,
      }),
    })),
    { timeoutMs: RUMOR_TIMEOUT_MS, label: "RUMOR", errorTag: "RUMOR" },
  );
}

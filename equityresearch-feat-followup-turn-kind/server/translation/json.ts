import { logger } from "../utils";
import { payloadNeedsTranslation, type TargetLanguage } from "./detect";
import { getDeepSeekApiKey } from "../llm/deepseek";
import { callChatWithFailover, deepSeekChatProvider } from "../llm/chat";
import {
  applyTranslations,
  bucketize,
  collectStringLeaves,
  runWithConcurrency,
} from "./chunk";

const BUCKET_CHAR_BUDGET = 3000;
const BUCKET_CONCURRENCY = 6;
const DEFAULT_BUCKET_MAX_TOKENS = 8000;

export async function translateJsonValuesToLanguage<T>(
  payload: T,
  description: string,
  targetLanguage: TargetLanguage,
  maxTokens: number = DEFAULT_BUCKET_MAX_TOKENS,
): Promise<T | null> {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey || !payloadNeedsTranslation(payload, targetLanguage)) {
    return null;
  }

  const leaves = collectStringLeaves(payload, targetLanguage);
  if (leaves.length === 0) return null;

  const buckets = bucketize(leaves, BUCKET_CHAR_BUDGET);
  logger.info(
    `🌐 chunked translate → ${leaves.length} leaves in ${buckets.length} buckets, target=${targetLanguage} (${description})`,
  );

  const startedAt = Date.now();
  const bucketResults = await runWithConcurrency(
    buckets,
    BUCKET_CONCURRENCY,
    (bucket, bucketIdx) =>
      translateBucket(
        apiKey,
        bucket.map((leaf) => leaf.value),
        targetLanguage,
        description,
        bucketIdx,
        maxTokens,
      ),
  );

  const translatedByLeaf: (string | null)[] = new Array(leaves.length).fill(null);
  let cursor = 0;
  let succeededLeaves = 0;
  let failedBuckets = 0;
  buckets.forEach((bucket, bucketIdx) => {
    const result = bucketResults[bucketIdx];
    if (result === null) {
      failedBuckets += 1;
      cursor += bucket.length;
      return;
    }
    bucket.forEach((_, i) => {
      const value = result[i];
      if (typeof value === "string" && value.length > 0) {
        translatedByLeaf[cursor + i] = value;
        succeededLeaves += 1;
      }
    });
    cursor += bucket.length;
  });

  if (succeededLeaves === 0) {
    logger.warn(
      `⚠️ 全部 bucket 翻译失败 (${targetLanguage}, ${description}) — 回退原 payload`,
    );
    return null;
  }

  const elapsedMs = Date.now() - startedAt;
  logger.success(
    `✅ translated ${succeededLeaves}/${leaves.length} leaves in ${elapsedMs}ms${
      failedBuckets > 0 ? ` (${failedBuckets}/${buckets.length} buckets failed)` : ""
    }`,
  );

  return applyTranslations(payload, leaves, translatedByLeaf);
}

async function translateBucket(
  apiKey: string,
  inputs: string[],
  targetLanguage: TargetLanguage,
  description: string,
  bucketIdx: number,
  maxTokens: number,
): Promise<string[] | null> {
  const languageLabel = targetLanguage === "zh" ? "Simplified Chinese" : "English";
  let rawContent = "";
  let finishReason: string | undefined;

  try {
    const { response } = await callChatWithFailover(
      [deepSeekChatProvider(apiKey, "deepseek-chat")],
      {
        temperature: 0.1,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              `Translate every string in input.strings into ${languageLabel}. ` +
              `Preserve URLs, ticker symbols, numbers, HTML tags, and company names. ` +
              `Return JSON of shape {"strings": [...]} with EXACTLY the same array length and order as the input.`,
          },
          { role: "user", content: JSON.stringify({ strings: inputs }) },
        ],
      },
    );

    rawContent = response.choices?.[0]?.message?.content || "";
    finishReason = response.choices?.[0]?.finish_reason;

    if (finishReason === "length") {
      throw new Error(`output truncated (len=${rawContent.length})`);
    }

    const jsonMatch =
      rawContent.match(/```json\n?([\s\S]*?)\n?```/) || rawContent.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
    const parsed = JSON.parse(jsonStr) as { strings?: unknown };

    if (!Array.isArray(parsed.strings) || parsed.strings.length !== inputs.length) {
      throw new Error(
        `bucket length mismatch (expected ${inputs.length}, got ${
          Array.isArray(parsed.strings) ? parsed.strings.length : "non-array"
        })`,
      );
    }

    return parsed.strings.map((entry) => (typeof entry === "string" ? entry : ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `⚠️ JSON 翻译失败 bucket #${bucketIdx} (${targetLanguage}, ${description}) — ${message} | finish=${
        finishReason ?? "n/a"
      } | rawHead=${rawContent.slice(0, 200)}`,
    );
    return null;
  }
}

import {
  callExternalTranscriptQa,
  ExternalTranscriptQaClientError,
  type ExternalTranscriptQaResult,
} from "./transcriptQaClient";
import { logger } from "../utils";
import { callChatWithFailover, perplexityChatProvider, httpStatusOf } from "../llm/chat";

export interface TranscriptQaWithFallbackInput {
  ticker: string;
  year: number;
  quarter: number;
  question: string;
  apiBase: string;
  apiKey?: string;
  perplexityKey?: string;
}

export type TranscriptQaSource = "transcript" | "perplexity_fallback";

export interface TranscriptQaWithFallbackResult {
  answer: string;
  question: string;
  hasAnswer: boolean;
  source: TranscriptQaSource;
  fallbackReason?: string;
  highlightPhrases: string[];
  citations: any[];
  references: string[];
  thinking: string;
  transcriptSource?: string;
  ticker: string;
  year: number;
  quarter: number | string;
}

export class TranscriptQaError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function transcriptQaWithFallback(
  input: TranscriptQaWithFallbackInput,
): Promise<TranscriptQaWithFallbackResult> {
  let transcriptResult: ExternalTranscriptQaResult | null = null;
  let fallbackReason = "";

  // Step 1: Try transcript QA
  try {
    transcriptResult = await callExternalTranscriptQa({
      ticker: input.ticker,
      year: input.year,
      quarter: input.quarter,
      question: input.question,
      apiBase: input.apiBase,
      apiKey: input.apiKey,
    });

    if (transcriptResult.hasAnswer) {
      return { ...transcriptResult, source: "transcript" };
    }

    fallbackReason = "no_answer_in_transcript";
  } catch (error) {
    if (error instanceof ExternalTranscriptQaClientError) {
      if (error.status === 404) {
        fallbackReason = "transcript_not_found";
      } else {
        throw new TranscriptQaError(error.status, error.message, error.code);
      }
    } else {
      throw error;
    }
  }

  // Step 2: Perplexity fallback
  logger.info(
    `🔄 transcript_qa fallback to Perplexity: ${fallbackReason} (${input.ticker} Q${input.quarter} ${input.year})`,
  );

  if (!input.perplexityKey) {
    throw new TranscriptQaError(
      404,
      fallbackReason === "transcript_not_found"
        ? `Q${input.quarter} ${input.year} earnings transcript not available`
        : `Could not find answer in transcript`,
      fallbackReason,
    );
  }

  // Routes through the shared LLM layer (per-attempt timeout + unified
  // cancellation). A Perplexity HTTP error is mapped back to a TranscriptQaError
  // so routes/earnings.ts keeps responding with the upstream status + code;
  // a timeout/transport/abort (no HTTP status) rethrows as before → 500.
  let pplxData;
  try {
    const { response } = await callChatWithFailover(
      [perplexityChatProvider(input.perplexityKey, "sonar-pro")],
      {
        messages: [
          {
            role: "system",
            content:
              "You are a financial research assistant. Answer questions about company earnings, financials, and guidance based on the latest available information. Be concise and factual. Cite sources when possible.",
          },
          {
            role: "user",
            content: `Regarding ${input.ticker} Q${input.quarter} ${input.year} earnings: ${input.question}`,
          },
        ],
        temperature: 0.2,
      },
      { timeoutMs: 30000 },
    );
    pplxData = response;
  } catch (err) {
    const status = httpStatusOf(err);
    if (status !== undefined) {
      logger.warn(`⚠️ Perplexity fallback failed: ${status}`);
      throw new TranscriptQaError(
        status >= 500 ? 502 : status,
        `Perplexity fallback error: ${status}`,
        `perplexity_${status}`,
      );
    }
    throw err;
  }

  const answer = pplxData.choices?.[0]?.message?.content || "";
  const rawCitations: any[] = pplxData.citations || [];
  const citations = rawCitations.map((c: any, i: number) => {
    if (typeof c === "string") {
      return { id: i + 1, quote: c };
    }
    return c;
  });

  logger.info(`✅ Perplexity fallback success (${answer.length} chars)`);

  return {
    answer,
    question: input.question,
    hasAnswer: !!answer,
    source: "perplexity_fallback",
    fallbackReason,
    highlightPhrases: [],
    citations,
    references: [],
    thinking: "",
    ticker: input.ticker,
    year: input.year,
    quarter: input.quarter,
  };
}

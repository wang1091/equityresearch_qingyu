export class ExternalTranscriptQaClientError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface CallExternalTranscriptQaInput {
  ticker: string;
  year: number;
  quarter: number;
  question: string;
  apiBase: string;
  apiKey?: string;
}

export interface ExternalTranscriptQaResult {
  answer: string;
  question: string;
  hasAnswer: boolean;
  highlightPhrases: string[];
  citations: any[];
  references: string[];
  thinking: string;
  transcriptSource?: string;
  ticker: string;
  year: number;
  quarter: number | string;
}

export async function callExternalTranscriptQa(
  input: CallExternalTranscriptQaInput
): Promise<ExternalTranscriptQaResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (input.apiKey) {
    headers["x-api-key"] = input.apiKey;
  }

  const response = await fetch(
    `${input.apiBase}/api/earnings/ask`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ticker: input.ticker,
        year: input.year,
        quarter: input.quarter,
        question: input.question,
      }),
      signal: AbortSignal.timeout(25000),
    }
  ).catch((error) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ExternalTranscriptQaClientError(
        504,
        "Transcript QA upstream request timed out",
        "transcript_qa_timeout"
      );
    }

    throw error;
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ExternalTranscriptQaClientError(
      response.status,
      result?.error || `transcript_qa upstream error (${response.status})`,
      result?.code
    );
  }

  // Support both the legacy `{ success: true }` envelope and
  // the newer direct payload response from `/api/earnings/ask`.
  if (result?.success === false) {
    throw new ExternalTranscriptQaClientError(
      404,
      result?.error || "Failed to fetch transcript QA",
      result?.code
    );
  }

  return {
    answer: result.answer || "",
    question: result.question || input.question,
    hasAnswer: result.hasAnswer !== false,
    highlightPhrases: Array.isArray(result.highlightPhrases)
      ? result.highlightPhrases
      : [],
    citations: Array.isArray(result.citations) ? result.citations : [],
    references: Array.isArray(result.references) ? result.references : [],
    thinking: result.thinking || "",
    transcriptSource: result.transcriptSource,
    ticker: result.ticker || input.ticker,
    year: result.year || input.year,
    quarter: result.quarter || input.quarter,
  };
}

import {
  isCancellationReason,
  type CancellationReason,
} from "../shared/cancellation";

export type { CancellationReason } from "../shared/cancellation";

interface CancellationMetadata {
  cancellationReason: CancellationReason;
}

export interface AbortScopeOptions {
  externalSignal?: AbortSignal;
  externalReason?: CancellationReason;
  timeoutMs?: number;
  timeoutReason?: CancellationReason;
}

export interface AbortScope {
  signal: AbortSignal;
  abort: (reason?: CancellationReason) => void;
  getCancellationReason: () => CancellationReason | null;
  cleanup: () => void;
}

function getMessageFromReason(reason?: unknown): string {
  if (typeof reason === "string" && reason.trim().length > 0) {
    return reason;
  }

  const resolved = resolveCancellationReason(reason);
  if (resolved) {
    return resolved;
  }

  return "The operation was aborted";
}

function asCancellationMetadata(reason: CancellationReason): CancellationMetadata {
  return { cancellationReason: reason };
}

function readObjectField<T extends string>(
  input: unknown,
  field: string,
): T | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const value = (input as Record<string, unknown>)[field];
  if (typeof value !== "string") {
    return null;
  }

  return value as T;
}

export function resolveCancellationReason(input: unknown): CancellationReason | null {
  if (isCancellationReason(input)) {
    return input;
  }

  const direct = readObjectField<string>(input, "cancellationReason");
  if (isCancellationReason(direct)) {
    return direct;
  }

  const nestedReason = readObjectField<string>(input, "reason");
  if (isCancellationReason(nestedReason)) {
    return nestedReason;
  }

  if (input instanceof Error) {
    const error = input as Error & { cause?: unknown };
    const fromCause = resolveCancellationReason(error.cause);
    if (fromCause) {
      return fromCause;
    }

    if (isCancellationReason(error.message)) {
      return error.message;
    }

    const lowered = error.message.toLowerCase();
    if (lowered.includes("timeout") || lowered.includes("timed out")) {
      return "upstream_timeout";
    }
  }

  return null;
}

export function createAbortError(reason?: unknown): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(
      getMessageFromReason(reason),
      "AbortError",
    );
  }

  const error = new Error(getMessageFromReason(reason));
  error.name = "AbortError";
  return error;
}

export function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal) {
    return;
  }

  if (typeof signal.throwIfAborted === "function") {
    signal.throwIfAborted();
    return;
  }

  if (signal.aborted) {
    throw createAbortError(signal.reason);
  }
}

export function createAbortScope(options: AbortScopeOptions = {}): AbortScope {
  const controller = new AbortController();
  const {
    externalSignal,
    externalReason = "unknown_abort",
    timeoutMs,
    timeoutReason = "upstream_timeout",
  } = options;
  let cancellationReason: CancellationReason | null = null;
  let timeoutId: NodeJS.Timeout | null = null;

  const setAndAbort = (reason: CancellationReason) => {
    if (controller.signal.aborted) {
      return;
    }

    cancellationReason = reason;
    controller.abort(asCancellationMetadata(reason));
  };

  const onExternalAbort = () => {
    const reason = resolveCancellationReason(externalSignal?.reason) ?? externalReason;
    setAndAbort(reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  if (typeof timeoutMs === "number" && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      setAndAbort(timeoutReason);
    }, timeoutMs);
  }

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    externalSignal?.removeEventListener("abort", onExternalAbort);
  };

  return {
    signal: controller.signal,
    abort: (reason = "unknown_abort") => {
      setAndAbort(reason);
    },
    getCancellationReason: () => {
      if (cancellationReason) {
        return cancellationReason;
      }
      return resolveCancellationReason(controller.signal.reason);
    },
    cleanup,
  };
}

export function mergeAbortSignals(
  primary?: AbortSignal,
  secondary?: AbortSignal,
): AbortSignal | undefined {
  if (!primary) {
    return secondary;
  }

  if (!secondary) {
    return primary;
  }

  const anySignal = (AbortSignal as unknown as {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;

  if (typeof anySignal === "function") {
    return anySignal([primary, secondary]);
  }

  const controller = new AbortController();
  const abort = () => controller.abort(primary.reason ?? secondary.reason);

  if (primary.aborted || secondary.aborted) {
    abort();
  } else {
    primary.addEventListener("abort", abort, { once: true });
    secondary.addEventListener("abort", abort, { once: true });
  }

  return controller.signal;
}

export async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal?.reason));
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

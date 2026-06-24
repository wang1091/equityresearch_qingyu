import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { once } from "node:events";

export interface LogSystemOptions {
  filePath?: string;
  maxFileSizeBytes?: number;
}

const DEFAULT_FILE_PATH = join(process.cwd(), "logs", "server.log.jsonl");
const DEFAULT_MAX_FILE_SIZE_BYTES = resolveMaxFileSizeBytes();

function resolveMaxFileSizeBytes(): number {
  const rawBytes = Number(process.env.LOG_MAX_FILE_SIZE_BYTES);
  if (Number.isFinite(rawBytes) && rawBytes > 0) {
    return Math.trunc(rawBytes);
  }

  const rawMb = Number(process.env.LOG_MAX_FILE_SIZE_MB);
  if (Number.isFinite(rawMb) && rawMb > 0) {
    return Math.trunc(rawMb * 1024 * 1024);
  }

  return 100 * 1024 * 1024;
}

function formatTimestampForFile(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

export class AsyncJsonLogSystem {
  private readonly filePath: string;

  private readonly maxFileSizeBytes: number;

  private stream: WriteStream | null = null;

  private initPromise: Promise<void> | null = null;

  private currentFileSizeBytes = 0;

  private queue: string[] = [];

  private flushing = false;

  constructor(options: LogSystemOptions = {}) {
    this.filePath = options.filePath || process.env.LOG_FILE_PATH || DEFAULT_FILE_PATH;
    this.maxFileSizeBytes = options.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES;
  }

  writeLine(line: string): void {
    this.queue.push(line.endsWith("\n") ? line : `${line}\n`);
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }

    this.flushing = true;
    try {
      await this.ensureStream();
      if (!this.stream) {
        return;
      }

      while (this.queue.length > 0) {
        const line = this.queue.shift();
        if (!line) {
          continue;
        }

        const lineSize = Buffer.byteLength(line, "utf8");
        await this.rotateIfNeeded(lineSize);
        if (!this.stream) {
          return;
        }

        const writable = this.stream.write(line);
        this.currentFileSizeBytes += lineSize;
        if (!writable) {
          await once(this.stream, "drain");
        }
      }
    } catch {
      // swallow sink failures to avoid impacting API flow
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  private scheduleFlush(): void {
    setImmediate(() => {
      void this.flush();
    });
  }

  private async ensureStream(): Promise<void> {
    if (this.stream) {
      return;
    }

    if (!this.initPromise) {
      this.initPromise = (async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        this.currentFileSizeBytes = await this.readCurrentFileSizeBytes();
        this.stream = createWriteStream(this.filePath, { flags: "a", encoding: "utf8" });
      })();
    }

    await this.initPromise;
  }

  private async readCurrentFileSizeBytes(): Promise<number> {
    try {
      const info = await stat(this.filePath);
      return info.size;
    } catch {
      return 0;
    }
  }

  private async rotateIfNeeded(nextWriteSizeBytes: number): Promise<void> {
    if (!this.stream || this.maxFileSizeBytes <= 0) {
      return;
    }

    // If a single log burst is larger than the threshold, write it to the current/new file directly.
    if (this.currentFileSizeBytes === 0 && nextWriteSizeBytes >= this.maxFileSizeBytes) {
      return;
    }

    if (this.currentFileSizeBytes + nextWriteSizeBytes <= this.maxFileSizeBytes) {
      return;
    }

    await this.rotateNow();
  }

  private buildRotatedFilePath(attempt: number): string {
    const dir = dirname(this.filePath);
    const extension = extname(this.filePath);
    const name = basename(this.filePath, extension);
    const timestamp = formatTimestampForFile(new Date());
    const suffix = attempt === 0 ? "" : `.${attempt}`;
    return join(dir, `${name}.${timestamp}${suffix}${extension}`);
  }

  private async rotateNow(): Promise<void> {
    if (!this.stream) {
      return;
    }

    const oldStream = this.stream;
    await new Promise<void>((resolve) => {
      oldStream.end(() => resolve());
    });

    this.stream = null;
    this.initPromise = null;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const rotatedPath = this.buildRotatedFilePath(attempt);
      try {
        await rename(this.filePath, rotatedPath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") {
          break;
        }
        if (code === "EEXIST") {
          continue;
        }
        break;
      }
    }

    this.currentFileSizeBytes = 0;
    await this.ensureStream();
  }
}

export const logSystem = new AsyncJsonLogSystem();

process.on("beforeExit", () => {
  void logSystem.flush();
});

process.on("SIGINT", () => {
  void logSystem.flush().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void logSystem.flush().finally(() => process.exit(0));
});

import { needsTranslationForLanguage, type TargetLanguage } from "./detect";

export type StringPath = (string | number)[];
export type StringLeaf = { path: StringPath; value: string };

const URL_RE = /^https?:\/\//i;

export function collectStringLeaves(
  value: unknown,
  targetLanguage: TargetLanguage,
  path: StringPath = [],
): StringLeaf[] {
  if (typeof value === "string") {
    if (!value || URL_RE.test(value)) return [];
    if (!needsTranslationForLanguage(value, targetLanguage)) return [];
    return [{ path, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectStringLeaves(entry, targetLanguage, [...path, index]),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) =>
      collectStringLeaves(entry, targetLanguage, [...path, key]),
    );
  }
  return [];
}

export function bucketize<T extends { value: string }>(
  leaves: T[],
  charBudgetPerBucket: number,
): T[][] {
  const buckets: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;

  for (const leaf of leaves) {
    const size = leaf.value.length;
    if (current.length > 0 && currentSize + size > charBudgetPerBucket) {
      buckets.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(leaf);
    currentSize += size;
  }
  if (current.length > 0) buckets.push(current);
  return buckets;
}

export function applyTranslations<T>(
  payload: T,
  leaves: StringLeaf[],
  translated: (string | null)[],
): T {
  let cloned: T;
  try {
    cloned = structuredClone(payload);
  } catch {
    cloned = JSON.parse(JSON.stringify(payload)) as T;
  }
  leaves.forEach((leaf, idx) => {
    const value = translated[idx];
    if (value === null || value === undefined) return;
    setByPath(cloned as unknown, leaf.path, value);
  });
  return cloned;
}

function setByPath(target: unknown, path: StringPath, value: string): void {
  if (path.length === 0 || target == null) return;
  let cursor: any = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    cursor = cursor?.[path[i]];
    if (cursor == null) return;
  }
  cursor[path[path.length - 1]] = value;
}

export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(limit, 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

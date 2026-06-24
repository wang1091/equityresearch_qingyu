/**
 * The intent classifier's whitelist view of the data-source catalog. The single
 * source of truth is shared/sourceCatalog.ts (SUPPORTED_DATA_SOURCES) — this file
 * re-exports it and adds the classifier-only guards below.
 *
 * The classifier (/api/classify-intents-multi) is LLM-driven, so its raw output
 * is untrusted: routes.ts filters `required_data` against this whitelist and
 * falls back to GENERAL for anything unrecognized. Adding a source is done ONCE
 * in sourceCatalog.ts (member + timeout) — the deterministic half of "teach the
 * classifier a new intent"; the prompt change is the other half. Keep the
 * routing-guide table in the classifier system prompt in sync with that catalog.
 */
import { SUPPORTED_DATA_SOURCES, type SupportedDataSource } from "../../shared/sourceCatalog";

export const VALID_DATA_SOURCES = SUPPORTED_DATA_SOURCES;
export type DataSource = SupportedDataSource;

const VALID_SET: ReadonlySet<string> = new Set(VALID_DATA_SOURCES);

export const isValidDataSource = (source: unknown): source is DataSource =>
  typeof source === "string" && VALID_SET.has(source);

/** Filter an arbitrary classifier value down to recognized sources, preserving order. */
export const filterValidDataSources = (sources: unknown): DataSource[] =>
  Array.isArray(sources) ? sources.filter(isValidDataSource) : [];

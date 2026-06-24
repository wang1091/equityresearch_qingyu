/**
 * Bump this version to invalidate every cached translation across all sessions.
 * The version is folded into both the source fingerprint and the translationMeta
 * ledger, so any mismatch forces a re-translation on the next render.
 */
export const TRANSLATION_SOURCE_SCHEMA_VERSION = 1;

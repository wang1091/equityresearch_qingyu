import { normalizeRumorPayload, type RumorCardData } from "@shared/rumor";
import type { UILanguage } from "@/utils/i18n";

/**
 * Frontend renderer for the RUMOR-check card — structured replacement for
 * server/agent/formatters/rumor.ts. The raw payload is semi-structured, so it's
 * run through the shared normalizeRumorPayload (same parsing the old formatter did
 * inline) to get RumorCardData, then rendered: verdict line, bottom-line, summary,
 * key facts (with inline citation pills), analysis, and a numbered sources list.
 * Generic source_card channel (docs/CARD_RENDER_MIGRATION_PLAN.md).
 */
export const RumorCard = ({
  payload,
  uiLanguage,
}: {
  payload: unknown;
  uiLanguage: UILanguage;
}) => {
  const isZh = uiLanguage === "zh";
  const d: RumorCardData = normalizeRumorPayload(payload, isZh);

  const t = {
    title: isZh ? "谣言核实" : "Rumor Check",
    fallback: isZh ? "未能获取完整的核实报告。" : "Unable to retrieve full verification report.",
    verdict: isZh ? "结论" : "Verdict",
    confidence: isZh ? "置信度" : "Confidence",
    bottomLine: isZh ? "最终判断" : "Bottom Line",
    crossVal: isZh ? "交叉验证" : "Cross-Validation",
    summary: isZh ? "摘要" : "Summary",
    keyFacts: isZh ? "关键事实" : "Key Facts",
    analysis: isZh ? "分析" : "Analysis",
    sources: isZh ? "来源" : "Sources",
  };

  const hasContent = d.verdictLabel || d.summary || d.analysis || d.fallbackMarkdown || d.facts.length > 0 || d.conclusion;
  if (!hasContent) {
    return (
      <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3.5 text-sm">
        <div className="font-bold text-gray-800">🔍 {t.title}</div>
        <div className="mt-2 text-amber-800">{t.fallback}</div>
      </div>
    );
  }

  const verdictTone = (() => {
    const v = d.verdictLabel.toLowerCase();
    if (/debunk|false|not true|辟谣|不实|虚假/.test(v)) return "text-emerald-600";
    if (/verified|true|confirmed|属实|证实|确认/.test(v)) return "text-red-600";
    return "text-amber-600";
  })();
  const showConfidence = d.confidence && d.confidence !== "Unknown" && d.confidence !== "未知";

  // Map source URLs → numbered refs; a fact at index i cites source i (mirrors the
  // old pickCitationIndexes positional pairing, simplified to one pill per fact).
  const refs = d.sources.map((url, i) => ({ index: i + 1, url, label: hostOf(url) }));

  return (
    <div className="overflow-hidden rounded-xl bg-white p-5 text-gray-800 shadow-sm">
      <h3 className="mb-3.5 text-[1.35em] font-bold text-gray-900">{d.title}</h3>

      {d.verdictLabel && (
        <p className="mb-3 leading-relaxed">
          <span className="font-bold">{t.verdict}:</span>{" "}
          <span className={`font-bold ${verdictTone}`}>{d.verdictLabel}</span>
          {showConfidence && <span className="text-gray-500"> ({t.confidence}: {d.confidence})</span>}
        </p>
      )}

      <Section title={t.bottomLine} body={d.conclusion} refs={refs} />
      {d.crossValidation && (
        <p className="mb-3.5 leading-relaxed text-gray-500">
          <span className="font-bold">{t.crossVal}:</span> {d.crossValidation}
        </p>
      )}
      <Section title={t.summary} body={d.summary} refs={refs} />

      {d.facts.length > 0 && (
        <div className="mb-4">
          <SectionHeading>{t.keyFacts}</SectionHeading>
          <ul className="ml-5 list-disc space-y-1.5">
            {d.facts.map((fact, i) => (
              <li key={i} className="leading-relaxed text-gray-700">
                {fact}
                {refs[i] && <CitationPill ref={refs[i]} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Section title={t.analysis} body={d.analysis} refs={refs} />

      {d.fallbackMarkdown && (
        <div className="mb-4 whitespace-pre-wrap leading-relaxed text-gray-700">{d.fallbackMarkdown}</div>
      )}

      {refs.length > 0 && (
        <div>
          <SectionHeading>{t.sources}</SectionHeading>
          <ul className="ml-5 list-disc space-y-1.5">
            {refs.map((r) => (
              <li key={r.index}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="break-words text-blue-600 underline">
                  [{r.index}] {r.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

type Ref = { index: number; url: string; label: string };

const SectionHeading = ({ children }: { children: React.ReactNode }) => (
  <h3 className="mb-2 mt-4 text-[1.05em] font-bold text-gray-900">{children}</h3>
);

const Section = ({ title, body, refs }: { title: string; body: string; refs: Ref[] }) => {
  if (!body) return null;
  const paras = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="mb-4">
      <SectionHeading>{title}</SectionHeading>
      {paras.map((p, i) => (
        <p key={i} className="mb-3 leading-relaxed text-gray-700">
          {p}
          {i === 0 && refs[0] && <CitationPill ref={refs[0]} />}
        </p>
      ))}
    </div>
  );
};

const CitationPill = ({ ref }: { ref: Ref }) => (
  <a
    href={ref.url}
    target="_blank"
    rel="noopener noreferrer"
    className="ml-1 inline-flex items-center rounded bg-slate-100 px-1.5 align-middle text-[11px] font-semibold text-slate-600 no-underline hover:bg-slate-200"
    title={ref.label}
  >
    {ref.index}
  </a>
);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

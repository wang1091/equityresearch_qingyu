import React from "react";
import { SafeHtmlContent } from "./SafeHtmlContent";
import type { UILanguage } from "@/utils/i18n";

const LABELS: Record<UILanguage, { title: string; hint: string }> = {
  en: {
    title: "Structured analysis",
    hint: "The model returned JSON that is not the standard research layout; showing a readable view.",
  },
  zh: {
    title: "结构化分析",
    hint: "模型返回了非标准研究布局的 JSON，以下为可读展示。",
  },
};

function titleCaseKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksLikeHtmlFragment(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s) && /<\/?(strong|em|br|div|span|p|ul|ol|li)\b/i.test(s);
}

function JsonScalar({ value }: { value: string | number | boolean | null }) {
  if (value === null) return <span className="text-gray-400">null</span>;
  if (typeof value === "boolean") return <span className="text-amber-700">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-blue-800 font-mono">{value}</span>;
  if (typeof value === "string" && looksLikeHtmlFragment(value)) {
    return <SafeHtmlContent html={value} className="text-gray-800 leading-relaxed text-sm" />;
  }
  return (
    <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap break-words font-sans">
      {String(value)}
    </p>
  );
}

function JsonTree({
  data,
  depth,
  maxDepth,
}: {
  data: unknown;
  depth: number;
  maxDepth: number;
}) {
  if (depth > maxDepth) {
    return <span className="text-xs text-gray-400">…</span>;
  }

  if (data === null || typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return <JsonScalar value={data as string | number | boolean | null} />;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-xs text-gray-400">[]</span>;
    }
    return (
      <ol className="list-decimal pl-5 space-y-3 text-sm">
        {data.map((item, i) => (
          <li key={i} className="text-gray-800">
            <JsonTree data={item} depth={depth + 1} maxDepth={maxDepth} />
          </li>
        ))}
      </ol>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-xs text-gray-400">{"{}"}</span>;
    }
    return (
      <div className={`space-y-3 ${depth > 0 ? "pl-2 border-l border-gray-200" : ""}`}>
        {entries.map(([key, val]) => (
          <div key={key} className="rounded-lg border border-gray-100 bg-gray-50/80 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              {titleCaseKey(key)}
            </div>
            <JsonTree data={val} depth={depth + 1} maxDepth={maxDepth} />
          </div>
        ))}
      </div>
    );
  }

  return <span className="text-xs text-gray-500">{String(data)}</span>;
}

interface StructuredJsonFallbackProps {
  data: unknown;
  language: UILanguage;
}

/**
 * Readable layout for arbitrary JSON from agent / submodule APIs when it is not ResearchData.
 */
export const StructuredJsonFallback: React.FC<StructuredJsonFallbackProps> = ({ data, language }) => {
  const copy = LABELS[language] ?? LABELS.en;

  return (
    <div className="structured-json-fallback space-y-3 text-sm w-full rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-700">{copy.title}</h3>
        <p className="text-[11px] text-indigo-600/80 mt-0.5">{copy.hint}</p>
      </div>
      <div className="rounded-lg border border-white bg-white p-3 shadow-sm">
        <JsonTree data={data} depth={0} maxDepth={8} />
      </div>
    </div>
  );
};

export default StructuredJsonFallback;

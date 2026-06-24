import { SectionLabel } from "./ui";
import type { SourceCitation } from "@/lib/competitive/types";

type Props = {
  title: string;
  sources: SourceCitation[];
};

export const ResearchSourcesPanel = ({ title, sources }: Props) => {
  if (sources.length === 0) return null;
  return (
    <div className="mt-8 border-t border-[#e5e7eb] pt-6">
      <SectionLabel>{title}</SectionLabel>
      <ol className="ml-5 list-decimal space-y-1.5 text-sm">
        {sources.map((src, i) => (
          <li key={`${src.url}-${i}`}>
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#1a4d7a] underline-offset-2 hover:text-[#00d4aa] hover:underline"
            >
              {src.title || src.url}
            </a>
            {src.date && (
              <span className="ml-2 text-xs text-[#6b7280]">{src.date}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
};

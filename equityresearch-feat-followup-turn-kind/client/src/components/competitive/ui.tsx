import type { ReactNode } from "react";

// Layout primitives shared across the competitive-analysis page.
// All visual constants (palette, fonts) inlined here so a future refactor
// to Tailwind theme tokens has a single touchpoint.

const MONO = "'JetBrains Mono', monospace";

export const inputClass =
  "w-full rounded-lg border-2 border-[#e5e7eb] bg-[#f8fafb] px-4 py-3.5 text-base text-[#1a1a1a] transition-all focus:border-[#00d4aa] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/20";

export const Card = ({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={`rounded-2xl border border-[#e5e7eb] bg-white p-5 shadow-md transition-all hover:-translate-y-1 hover:shadow-xl md:p-8 ${className}`}
  >
    {children}
  </div>
);

export const CardHeader = ({
  icon,
  title,
}: {
  icon: string;
  title: string;
}) => (
  <div className="mb-6 flex items-center gap-3 border-b-2 border-[#00d4aa] pb-4">
    <div
      className="flex h-8 w-8 items-center justify-center rounded-lg text-xl"
      style={{ background: "linear-gradient(135deg, #00d4aa, #1a4d7a)" }}
    >
      {icon}
    </div>
    <h2 className="text-xl font-semibold text-[#0a2540] md:text-2xl">
      {title}
    </h2>
  </div>
);

export const FormField = ({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) => (
  <div>
    <label
      className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[#6b7280]"
      style={{ fontFamily: MONO }}
    >
      {label}
    </label>
    {children}
  </div>
);

export const Spinner = () => (
  <span
    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
    role="status"
    aria-label="loading"
  />
);

// Reusable mono-typography label (used by overall-assessment, sources, etc.)
export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div
    className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#1a4d7a]"
    style={{ fontFamily: MONO }}
  >
    {children}
  </div>
);

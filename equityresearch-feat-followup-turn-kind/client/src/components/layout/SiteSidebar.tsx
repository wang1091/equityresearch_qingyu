import type { ReactNode } from "react";
import logoImage from "@assets/logo_1756531121148.png";
import type { NavItem } from "@/features/chat/homeConfig";

interface SiteSidebarProps {
  navItems: NavItem[];
  onNavigate: (url: string) => void;
  /** The chat-history panel, wired by the caller. */
  children: ReactNode;
}

/** Desktop-only left sidebar: brand, module nav, and the chat-history panel. */
export const SiteSidebar = ({ navItems, onNavigate, children }: SiteSidebarProps) => (
  <aside className="hidden lg:flex w-52 bg-white border-r border-gray-100 flex-col h-[100dvh] flex-shrink-0">
    <div className="flex items-center px-2.5 py-2 border-b border-gray-100">
      <button onClick={() => window.open("https://checkitanalytics.com/", "_blank")} className="flex items-center gap-1.5" title="Checkit Analytics">
        <img src={logoImage} alt="Checkit" className="h-6 w-6 rounded-md object-contain" />
        <span className="text-lg font-semibold text-gray-800">Checkit</span>
      </button>
    </div>

    <nav className="px-1 py-1 space-y-0.5">
      {navItems.map(({ label, icon, url, testId }) => (
        <button key={testId} onClick={() => onNavigate(url)} data-testid={testId} title={label}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors text-left"
        >
          <span className="shrink-0 text-sm">{icon}</span>
          <span className="leading-tight">{label}</span>
        </button>
      ))}
    </nav>

    <div className="mx-2 border-t border-gray-100 my-0.5" />

    <div className="flex-1 overflow-y-auto px-1 py-0.5">{children}</div>
  </aside>
);

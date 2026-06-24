import type { ReactNode } from "react";
import { X } from "lucide-react";
import logoImage from "@assets/logo_1756531121148.png";
import type { NavItem } from "@/features/chat/homeConfig";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  navItems: NavItem[];
  onNavigate: (url: string) => void;
  /** The chat-history panel, wired by the caller. */
  children: ReactNode;
}

/** Mobile-only slide-in nav drawer: brand, module nav, chat-history panel. */
export const MobileDrawer = ({ open, onClose, navItems, onNavigate, children }: MobileDrawerProps) => {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 lg:hidden" onClick={onClose} data-testid="mobile-nav-overlay" />
      <div className="fixed left-0 top-0 h-full w-48 bg-white shadow-xl z-50 lg:hidden flex flex-col">
        <div className="flex items-center justify-between px-2.5 py-2 border-b border-gray-100">
          <button onClick={() => window.open("https://checkitanalytics.com/", "_blank")} className="flex items-center gap-1.5" title="Checkit Analytics">
            <img src={logoImage} alt="Checkit" className="h-5 w-5 rounded-md object-contain" />
            <span className="text-sm font-semibold text-gray-800">Checkit</span>
          </button>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 text-gray-400" data-testid="close-left-nav-button">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <nav className="px-1 py-1 space-y-0.5 flex-1 overflow-y-auto">
          {navItems.map(({ label, icon, url, testId }) => (
            <button key={`${testId}-mobile`} onClick={() => { onNavigate(url); onClose(); }}
              data-testid={`${testId}-mobile`} title={label}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors touch-manipulation"
            >
              <span className="text-sm shrink-0">{icon}</span>
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>
        <div className="border-t border-gray-100 px-1 py-1">{children}</div>
      </div>
    </>
  );
};

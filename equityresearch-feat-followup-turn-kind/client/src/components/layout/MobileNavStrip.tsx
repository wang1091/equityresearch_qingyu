import type { NavItem } from "@/features/chat/homeConfig";

interface MobileNavStripProps {
  navItems: NavItem[];
  onNavigate: (url: string) => void;
}

/** Mobile-only 4-column quick-nav strip under the topbar. */
export const MobileNavStrip = ({ navItems, onNavigate }: MobileNavStripProps) => (
  <div className="lg:hidden flex-shrink-0 w-full bg-white border-b border-gray-100">
    <div className="grid grid-cols-4 gap-1 px-2 py-1.5">
      {navItems.map(({ label, icon, url, testId }) => (
        <button
          key={`${testId}-strip`}
          onClick={() => onNavigate(url)}
          className="flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-900 active:scale-95 transition-all touch-manipulation min-h-[44px]"
        >
          <span className="text-base leading-none">{icon}</span>
          <span className="text-[10px] font-medium text-center leading-tight">{label}</span>
        </button>
      ))}
    </div>
  </div>
);

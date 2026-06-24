import { Menu, Languages } from "lucide-react";
import logoImage from "@assets/logo_1756531121148.png";
import { UI_TEXTS, type UILanguage } from "@/utils/i18n";

interface TopbarProps {
  isHome: boolean;
  uiLanguage: UILanguage;
  isTranslating: boolean;
  onOpenNav: () => void;
  onStartOver: () => void;
  onToggleLanguage: () => void;
}

const NewThreadIcon = ({ strokeWidth = 2 }: { strokeWidth?: number }) => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}>
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

/** Top bar: mobile hamburger + brand, new-thread, and the language toggle. */
export const Topbar = ({ isHome, uiLanguage, isTranslating, onOpenNav, onStartOver, onToggleLanguage }: TopbarProps) => (
  <header className="h-9 flex items-center justify-between px-3 sm:px-4 flex-shrink-0 border-b border-gray-100 bg-[#f7f7f8]">
    <div className="flex items-center gap-2">
      <button onClick={onOpenNav} className="p-1.5 rounded-lg hover:bg-gray-200 lg:hidden touch-manipulation" data-testid="open-left-nav-button">
        <Menu className="w-4 h-4 text-gray-500" />
      </button>
      {!isHome && (
        <div className="flex items-center gap-1.5 lg:hidden">
          <img src={logoImage} alt="Checkit" className="h-6 w-6 rounded-md object-contain" />
          <span className="text-sm font-semibold text-gray-800">Checkit</span>
        </div>
      )}
    </div>
    <div className="flex items-center gap-1.5">
      {!isHome && (
        <button onClick={onStartOver} className="p-1.5 rounded-lg hover:bg-gray-200 lg:hidden touch-manipulation text-gray-500" title={UI_TEXTS[uiLanguage].newThread}>
          <NewThreadIcon />
        </button>
      )}
      <button onClick={onStartOver} className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg hover:bg-gray-200 transition-colors text-gray-500 hover:text-gray-900" title={UI_TEXTS[uiLanguage].newThread}>
        <NewThreadIcon strokeWidth={2.5} />
      </button>
      <button
        onClick={onToggleLanguage}
        disabled={isTranslating}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-sm text-gray-500 hover:bg-gray-200 transition-colors touch-manipulation disabled:opacity-60 disabled:cursor-not-allowed"
        title={isTranslating ? UI_TEXTS[uiLanguage].translating : UI_TEXTS[uiLanguage].switchLanguage}
      >
        {isTranslating ? (
          <>
            <div className="loading-spinner w-3.5 h-3.5" />
            <span>{UI_TEXTS[uiLanguage].translating}</span>
          </>
        ) : (
          <>
            <Languages className="w-3.5 h-3.5" />
            <span>{uiLanguage === "zh" ? "EN" : "中文"}</span>
          </>
        )}
      </button>
    </div>
  </header>
);

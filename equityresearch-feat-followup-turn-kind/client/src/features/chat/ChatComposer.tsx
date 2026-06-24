interface ChatComposerProps {
  /** "hero" = centered empty-state box; "bottom" = sticky in-thread bar. */
  variant: "hero" | "bottom";
  value: string;
  onChange: (value: string) => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  onSend: () => void;
  onStop: () => void;
  isGenerating: boolean;
  isLoading: boolean;
  placeholder: string;
}

/**
 * The query input + send/stop button, shared by the home hero and the in-thread
 * sticky bar. The only differences between the two surfaces are sizing classes,
 * the `bottom` variant also disabling while `isLoading`, and the data-testids.
 */
export const ChatComposer = ({
  variant,
  value,
  onChange,
  onKeyPress,
  onSend,
  onStop,
  isGenerating,
  isLoading,
  placeholder,
}: ChatComposerProps) => {
  const isHero = variant === "hero";
  // Hero enables as soon as there's text; the bottom bar also waits out isLoading.
  const disabled = isHero
    ? !isGenerating && !value.trim()
    : !isGenerating && (!value.trim() || isLoading);
  const active = isHero ? value.trim() || isGenerating : (value.trim() && !isLoading) || isGenerating;

  return (
    <div className="relative flex items-center bg-white rounded-xl border border-gray-200 shadow-sm focus-within:shadow-md focus-within:border-gray-300 transition-all">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyPress={onKeyPress}
        placeholder={placeholder}
        className={`flex-1 bg-transparent px-3 sm:px-4 text-sm text-gray-900 placeholder-gray-400 focus:outline-none ${
          isHero ? "py-2 sm:py-3 rounded-xl" : "py-2.5 sm:py-3"
        }`}
        data-testid={isHero ? "input-message" : "input-message-bottom"}
        autoFocus={isHero}
      />
      <button
        onClick={isGenerating ? onStop : onSend}
        disabled={disabled}
        className={`mr-1.5 flex items-center justify-center rounded-lg transition-colors touch-manipulation ${
          isHero ? "w-7 h-7" : "w-8 h-8"
        } ${active ? "bg-gray-900 hover:bg-gray-700 text-white" : "bg-gray-100 text-gray-300 cursor-not-allowed"}`}
        data-testid={isHero ? "button-send" : "button-send-bottom"}
      >
        {isGenerating ? (
          <span className={`bg-white rounded-sm ${isHero ? "w-2 h-2" : "w-2.5 h-2.5"}`} />
        ) : (
          <svg className={isHero ? "w-3 h-3" : "w-3.5 h-3.5"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    </div>
  );
};

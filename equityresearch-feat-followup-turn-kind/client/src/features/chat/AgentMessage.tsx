import type { Message } from "@/types";
import { MODULE_META } from "@/utils/constants";
import { UI_TEXTS, type UILanguage } from "@/utils/i18n";
import { isActionPhraseIntentInfo } from "@/utils/loadingPhrases";
import { NewsPreview, NewsBriefCard, CitationsFooter } from "@/components";
import { AnswerBody } from "./AnswerBody";
import { MessageActionBar } from "./MessageActionBar";
import { SourceCard } from "./renderers/registry";
import type { ChatMessageActions } from "./types";

interface AgentMessageProps {
  message: Message;
  /** Full list — needed for the brief-CTA dedupe + refine prev-user lookup. */
  messages: Message[];
  uiLanguage: UILanguage;
  isGenerating: boolean;
  getActionLoadingPhrase: (intentInfo?: Message["intentInfo"]) => string;
  actions: ChatMessageActions;
}

/** A full agent turn: intent chip, structured cards, answer body, sidecar, CTAs,
 *  follow-ups, and the action bar. Block-level render gates match the original
 *  home.tsx message map verbatim. */
export const AgentMessage = ({
  message,
  messages,
  uiLanguage,
  isGenerating,
  getActionLoadingPhrase,
  actions,
}: AgentMessageProps) => (
  <div className="space-y-3">

    {/* Intent chip — only while still generating with no rendered content yet */}
    {message.intentInfo && isGenerating && !message.content && !message.newsData && !message.briefData && !message.cardData && (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {isActionPhraseIntentInfo(message.intentInfo) ? (
          <>
            <span className="relative flex h-3.5 w-3.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-30 animate-ping" />
              <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-indigo-500 animate-pulse" />
            </span>
            <span className="font-medium text-indigo-500">
              {getActionLoadingPhrase(message.intentInfo)}
              <span className="inline-flex w-5 justify-between ml-1 align-middle">
                <span className="animate-bounce [animation-delay:-0.3s]">.</span>
                <span className="animate-bounce [animation-delay:-0.15s]">.</span>
                <span className="animate-bounce">.</span>
              </span>
            </span>
          </>
        ) : (
          <>
            {!message.content && isGenerating && <div className="loading-spinner w-3.5 h-3.5" />}
            <span>
              {message.intentInfo.intents.join(", ") || UI_TEXTS[uiLanguage].analyzing}
              {message.intentInfo.tickers.length > 0 && (
                <span className="text-indigo-500 font-medium"> · {message.intentInfo.tickers.join(", ")}</span>
              )}
            </span>
          </>
        )}
      </div>
    )}

    {/* News v2 structured preview (single-NEWS path) */}
    {message.newsData && (
      <NewsPreview
        data={message.newsData}
        language={uiLanguage}
        timestamp={message.timestamp.toLocaleString()}
      />
    )}

    {/* News Brief */}
    {message.briefData && (
      <NewsBriefCard language={uiLanguage} brief={message.briefData} />
    )}

    {/* Generic structured card (RATING / COMPETITIVE / … on the source_card channel).
        COMPETITIVE renders the same <CompetitiveResultCard> the /competitive page uses. */}
    {message.cardData && (
      <SourceCard cardData={message.cardData} uiLanguage={uiLanguage} />
    )}

    {/* Degraded-answer notice (unified path: a requested source failed) */}
    {message.unifiedData?.notice && (
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {message.unifiedData.notice}
      </div>
    )}

    {/* Main content */}
    <AnswerBody message={message} uiLanguage={uiLanguage} isGenerating={isGenerating} />

    {/* Unified-answer sidecar: verdict + verifiable sources */}
    {message.unifiedData && (
      <div className="mt-4 space-y-4">
        {message.unifiedData.verdict?.stance && (
          <div className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
            <span className="font-bold text-indigo-800">{message.unifiedData.verdict.stance}</span>
            {message.unifiedData.verdict.conviction && (
              <span className="text-indigo-600">· {message.unifiedData.verdict.conviction}</span>
            )}
            {message.unifiedData.verdict.priceTarget && (
              <span className="text-indigo-600">· {message.unifiedData.verdict.priceTarget}</span>
            )}
          </div>
        )}
        {message.unifiedData.citations && message.unifiedData.citations.length > 0 && (
          <CitationsFooter
            citations={message.unifiedData.citations}
            cards={message.unifiedData.source_cards}
            anchorPrefix={`cite-${message.id}`}
            label={uiLanguage === "zh" ? "来源" : "Sources"}
            language={uiLanguage}
          />
        )}
      </div>
    )}

    {/* Follow-up module card */}
    {message.modules && message.modules.length === 1 && (
      <div className="space-y-2">
        {message.modules
          .filter((m) => MODULE_META[m as keyof typeof MODULE_META])
          .map((moduleKey) => {
            const meta = MODULE_META[moduleKey as keyof typeof MODULE_META];
            const label = uiLanguage === "zh" ? meta.labelZh : meta.label;
            return (
              <div key={moduleKey} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 bg-white" data-testid={`follow-up-${moduleKey}`}>
                <span className="text-base">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-gray-500">{UI_TEXTS[uiLanguage].goDeeperWith}</p>
                  <p className="text-xs font-medium text-gray-800 truncate">{label}</p>
                </div>
                <button
                  onClick={() => window.open(meta.url, "_blank")}
                  className="shrink-0 px-2.5 py-1 bg-gray-900 hover:bg-gray-700 text-white text-[10px] rounded-md transition-colors"
                  data-testid={`button-open-${moduleKey}`}
                >
                  {UI_TEXTS[uiLanguage].open}
                </button>
              </div>
            );
          })}
      </div>
    )}

    {/* News brief CTA */}
    {message.intentInfo?.intents.length === 1 && message.intentInfo.intents[0] === "NEWS" && (message.content || message.newsData) && (
      <button
        onClick={() => actions.onGenerateNewsBrief(message)}
        disabled={isGenerating || !!messages.find((m) => m.briefData && m.id > message.id)}
        className="flex items-center gap-2 text-xs text-indigo-600 hover:text-indigo-800 font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        data-testid="button-generate-news-brief"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        {UI_TEXTS[uiLanguage].newsGenerateBrief}
      </button>
    )}

    {/* Structured follow-ups from Follow-Up Engine */}
    {message.structuredFollowups && message.structuredFollowups.length > 0 && !isGenerating && (
      <div className="pt-2">
        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
          {UI_TEXTS[uiLanguage].followUpTitle}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {message.structuredFollowups.map((fu, i) =>
            fu.type === "user_input" ? (
              <button
                key={i}
                onClick={() => actions.onFollowUpPick(fu.text)}
                title={UI_TEXTS[uiLanguage].followUpAsk}
                className="px-2.5 py-1 text-[11px] rounded-full border border-purple-200 text-purple-600 hover:bg-purple-50 hover:border-purple-400 transition-colors text-left italic"
              >
                ✏️ {fu.text}
              </button>
            ) : (
              <button
                key={i}
                onClick={() => actions.onFollowUpSend(fu.text)}
                className="px-2.5 py-1 text-[11px] rounded-full border border-indigo-200 text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 transition-colors text-left"
              >
                {fu.text}
              </button>
            )
          )}
        </div>
      </div>
    )}

    {/* Feedback + action bar — only on real responses, not welcome message */}
    {(message.content || message.newsData || message.briefData) && message.id !== 1 && !isGenerating && (
      <MessageActionBar message={message} messages={messages} uiLanguage={uiLanguage} actions={actions} />
    )}

  </div>
);

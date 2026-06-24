import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Message } from "@/types";
import type { UILanguage } from "@/utils/i18n";
import { localizeMessageForLanguage } from "./localizer";
import {
  computeSourceFingerprint,
  isAgentTranslatable,
  isAlreadyTranslated,
  sourceLanguageOf,
} from "./fingerprint";
import { TRANSLATION_SOURCE_SCHEMA_VERSION } from "./schema";

export interface UseTranslationOrchestratorOptions {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  uiLanguage: UILanguage;
  isGenerating: boolean;
}

export interface TranslationOrchestrator {
  isTranslating: boolean;
  /** Manual trigger — used by the language toggle button. */
  requestTranslation: (target: UILanguage, source: UILanguage) => void;
  /** Mark a target language to be applied once generation finishes. */
  deferTranslation: (target: UILanguage) => void;
  /** Apply any deferred toggle. Call after a generation completes / before send. */
  flushPendingTranslation: (source: UILanguage) => Promise<void>;
}

export function useTranslationOrchestrator(
  opts: UseTranslationOrchestratorOptions,
): TranslationOrchestrator {
  const { messages, setMessages, uiLanguage, isGenerating } = opts;

  const [isTranslating, setIsTranslating] = useState(false);

  const messagesRef = useRef<Message[]>(messages);
  const uiLanguageRef = useRef<UILanguage>(uiLanguage);
  const pendingTranslationLanguageRef = useRef<UILanguage | null>(null);
  const autoTranslationAttemptRef = useRef("");
  const translationRunCountRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    uiLanguageRef.current = uiLanguage;
  }, [uiLanguage]);

  const translateVisibleMessages = useCallback(
    async (targetLanguage: UILanguage, sourceLanguage: UILanguage) => {
      const sourceMessages = messagesRef.current;
      const shouldShowTranslationState = sourceMessages.some(
        (message) =>
          isAgentTranslatable(message) &&
          sourceLanguageOf(message) !== targetLanguage &&
          !isAlreadyTranslated(message, targetLanguage),
      );
      console.log("[i18n] translateVisibleMessages start", {
        targetLanguage,
        sourceLanguage,
        sourceMessages: sourceMessages.length,
        shouldShowTranslationState,
        candidates: sourceMessages
          .filter(isAgentTranslatable)
          .map((m) => ({
            id: m.id,
            displayLanguage: m.displayLanguage,
            sourceLanguage: sourceLanguageOf(m),
            contentLen: m.content?.length,
            hasNewsData: !!m.newsData,
            hasBriefData: !!m.briefData,
            alreadyTranslated: isAlreadyTranslated(m, targetLanguage),
          })),
      });

      if (shouldShowTranslationState) {
        translationRunCountRef.current += 1;
        setIsTranslating(true);
      }

      try {
        const translatedMessages = await Promise.all(
          sourceMessages.map((message) =>
            localizeMessageForLanguage(message, targetLanguage, sourceLanguage).catch((error) => {
              console.warn("[i18n] Failed to translate visible message:", error, message);
              return message;
            }),
          ),
        );

        const translatedById = new Map(translatedMessages.map((message) => [message.id, message]));
        console.log("[i18n] translateVisibleMessages done", {
          translatedCount: translatedMessages.length,
          sample: translatedMessages
            .filter((m) => m.sender === "agent" && m.id !== 1)
            .map((m) => ({
              id: m.id,
              displayLanguage: m.displayLanguage,
              contentPreview: m.content?.slice(0, 80),
            })),
        });
        setMessages((prev) => prev.map((message) => translatedById.get(message.id) || message));
      } finally {
        if (shouldShowTranslationState) {
          translationRunCountRef.current = Math.max(translationRunCountRef.current - 1, 0);
          if (translationRunCountRef.current === 0) {
            setIsTranslating(false);
          }
        }
      }
    },
    [setMessages],
  );

  const flushPendingTranslation = useCallback(
    async (sourceLanguage: UILanguage) => {
      const targetLanguage = pendingTranslationLanguageRef.current || uiLanguageRef.current;
      const hasMismatchedAgentMessage = messagesRef.current.some(
        (message) =>
          isAgentTranslatable(message) && !isAlreadyTranslated(message, targetLanguage),
      );

      pendingTranslationLanguageRef.current = null;

      if (hasMismatchedAgentMessage) {
        await translateVisibleMessages(targetLanguage, sourceLanguage);
      }
    },
    [translateVisibleMessages],
  );

  const requestTranslation = useCallback(
    (target: UILanguage, source: UILanguage) => {
      void translateVisibleMessages(target, source);
    },
    [translateVisibleMessages],
  );

  const deferTranslation = useCallback((target: UILanguage) => {
    pendingTranslationLanguageRef.current = target;
  }, []);

  useEffect(() => {
    if (isGenerating) {
      return;
    }

    const mismatchedMessages = messagesRef.current.filter(
      (message) =>
        isAgentTranslatable(message) && !isAlreadyTranslated(message, uiLanguage),
    );

    if (mismatchedMessages.length === 0) {
      return;
    }

    const attemptKey = `${uiLanguage}:v${TRANSLATION_SOURCE_SCHEMA_VERSION}:${mismatchedMessages
      .map((message) => `${message.id}:${computeSourceFingerprint(message)}`)
      .join("|")}`;

    if (autoTranslationAttemptRef.current === attemptKey) {
      return;
    }

    autoTranslationAttemptRef.current = attemptKey;
    void translateVisibleMessages(uiLanguage, uiLanguage === "zh" ? "en" : "zh");
  }, [uiLanguage, isGenerating, messages, translateVisibleMessages]);

  return {
    isTranslating,
    requestTranslation,
    deferTranslation,
    flushPendingTranslation,
  };
}

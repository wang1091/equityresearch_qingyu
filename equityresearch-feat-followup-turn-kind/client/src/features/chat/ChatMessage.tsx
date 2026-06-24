import type { Message } from "@/types";
import type { UILanguage } from "@/utils/i18n";
import { UserBubble } from "./UserBubble";
import { AgentMessage } from "./AgentMessage";
import type { ChatMessageActions } from "./types";

interface ChatMessageProps {
  message: Message;
  messages: Message[];
  uiLanguage: UILanguage;
  isGenerating: boolean;
  getActionLoadingPhrase: (intentInfo?: Message["intentInfo"]) => string;
  actions: ChatMessageActions;
}

/** Dispatches a single chat message to the right renderer by sender. */
export const ChatMessage = (props: ChatMessageProps) =>
  props.message.sender === "user" ? (
    <UserBubble message={props.message} />
  ) : (
    <AgentMessage
      message={props.message}
      messages={props.messages}
      uiLanguage={props.uiLanguage}
      isGenerating={props.isGenerating}
      getActionLoadingPhrase={props.getActionLoadingPhrase}
      actions={props.actions}
    />
  );

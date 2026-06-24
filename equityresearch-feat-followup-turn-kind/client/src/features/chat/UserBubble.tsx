import type { Message } from "@/types";

/** Right-aligned user message bubble. */
export const UserBubble = ({ message }: { message: Message }) =>
  message.content ? (
    <div className="flex justify-end">
      <div className="max-w-[85%] sm:max-w-[75%] bg-gray-900 text-white px-3 py-2 rounded-2xl text-sm leading-relaxed break-words">
        {message.content}
      </div>
    </div>
  ) : null;

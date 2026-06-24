import { logger } from "../utils";
import { needsTranslationForLanguage, type TargetLanguage } from "./detect";
import { getDeepSeekApiKey } from "../llm/deepseek";
import { callChatWithFailover, deepSeekChatProvider } from "../llm/chat";
import { getTranslationInstructions } from "./prompts";

export async function translateTextToLanguage(
  text: string,
  targetLanguage: TargetLanguage,
  mode: "plain" | "markdown" | "html" = "plain",
): Promise<string> {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey || !needsTranslationForLanguage(text, targetLanguage)) {
    return text;
  }

  try {
    const { response } = await callChatWithFailover(
      [deepSeekChatProvider(apiKey, "deepseek-chat")],
      {
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          { role: "system", content: getTranslationInstructions(targetLanguage, mode) },
          { role: "user", content: text },
        ],
      },
    );
    return response.choices?.[0]?.message?.content?.trim() || text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`⚠️ 文本翻译失败 (${targetLanguage}, ${mode}) — ${message}`);
    return text;
  }
}

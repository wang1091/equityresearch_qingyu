import type { NextFunction, Request, Response, Router } from "express";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { chatConversations, chatMessages } from "@shared/schema";
import { projectToClassifierHistory } from "@shared/turnHistory";
import { getErrorMessage, logger } from "./utils";

const { Pool } = pg;

interface AuthUser {
  id: string;
  email: string | null;
}

interface ChatHistoryMessageInput {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

interface ChatHistoryListItem {
  conversationId: string;
  title: string;
  lastUserMessage: string;
  updatedAt: Date;
  deletedAt: Date | null;
}

interface ChatHistoryDetail {
  conversationId: string;
  updatedAt: Date;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  }>;
}

const USER_HEADER = "x-auth-user";
const EMAIL_HEADER = "x-auth-email";
const CHAT_HISTORY_LOG_PREFIX = "[ChatHistory][Server]";

let cachedDb: any = null;
let cachedDbUrl: string | null = null;
let cachedPool: InstanceType<typeof Pool> | null = null;

function logInfo(event: string, data?: Record<string, unknown>) {
  logger.info(`${CHAT_HISTORY_LOG_PREFIX} ${event}`, data);
}

function logWarn(event: string, data?: Record<string, unknown>) {
  logger.warn(`${CHAT_HISTORY_LOG_PREFIX} ${event}`, data);
}

function logError(event: string, data?: Record<string, unknown>) {
  logger.error(`${CHAT_HISTORY_LOG_PREFIX} ${event}`, data);
}

function createDb(databaseUrl: string) {
  const parsed = new URL(databaseUrl);
  const host = parsed.hostname.toLowerCase();
  const isNeonHost = host.includes("neon.tech");

  if (isNeonHost) {
    logInfo("db.driver.neon_http", { host });
    return drizzleNeon(neon(databaseUrl), { schema });
  }

  const sslMode = parsed.searchParams.get("sslmode");
  const useSsl =
    sslMode === "require" ||
    sslMode === "verify-ca" ||
    sslMode === "verify-full";

  cachedPool = new Pool({
    connectionString: databaseUrl,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });

  logInfo("db.driver.pg", { host, ssl: useSsl });
  return drizzlePg(cachedPool, { schema });
}

function ensureDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logError("db.not_configured");
    throw new Error("CHAT_HISTORY_DB_NOT_CONFIGURED");
  }

  if (!cachedDb || cachedDbUrl !== databaseUrl) {
    if (cachedPool && cachedDbUrl && cachedDbUrl !== databaseUrl) {
      void cachedPool.end().catch((error: unknown) => {
        logWarn("db.pool_close_failed", { error: getErrorMessage(error) });
      });
      cachedPool = null;
    }

    cachedDb = createDb(databaseUrl);
    cachedDbUrl = databaseUrl;
    logInfo("db.initialized");
  }

  return cachedDb;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const requestPath = req.originalUrl || req.path;
  const userId = req.header(USER_HEADER)?.trim();
  const email = req.header(EMAIL_HEADER)?.trim();

  if (!userId) {
    logWarn("auth.failed.missing_user_header", { path: requestPath });
    return res.status(401).json({
      success: false,
      error: "Unauthorized: missing x-auth-user header",
    });
  }

  res.locals.authUser = {
    id: userId,
    email: email || null,
  } satisfies AuthUser;
  logInfo("auth.success", {
    path: requestPath,
    userId,
    hasEmail: Boolean(email),
  });

  next();
}

function getAuthUser(res: Response): AuthUser {
  return res.locals.authUser as AuthUser;
}

function getChatHistoryErrorStatus(error: unknown): number {
  const message = getErrorMessage(error);
  if (message === "CHAT_HISTORY_DB_NOT_CONFIGURED") {
    return 503;
  }
  if (message === "CHAT_HISTORY_USER_MESSAGE_REQUIRED") {
    return 400;
  }
  return 500;
}

function toChatHistoryErrorResponse(error: unknown) {
  const message = getErrorMessage(error);
  if (message === "CHAT_HISTORY_DB_NOT_CONFIGURED") {
    return {
      success: false,
      error: "Chat history database is not configured",
    };
  }

  if (message === "CHAT_HISTORY_USER_MESSAGE_REQUIRED") {
    return {
      success: false,
      error: "At least one user message is required",
    };
  }

  return {
    success: false,
    error: "Failed to process chat history request",
    details: message,
  };
}

function toConversationTitle(userMessages: ChatHistoryMessageInput[]): string {
  const title = userMessages[0]?.content?.trim() || "New conversation";
  return title.slice(0, 120);
}

function toLastUserMessage(userMessages: ChatHistoryMessageInput[]): string {
  const latest = userMessages[userMessages.length - 1]?.content?.trim() || "";
  return latest.slice(0, 500);
}

// Project a persisted message into the compact text the intent classifier reads as
// history. Delegates to the shared registry (shared/turnHistory.ts) so live + reload
// + client all share one projection. Bare strings pass through as their own text.
function toAgentHistoryContent(content: string): string {
  return projectToClassifierHistory(content);
}

function normalizeMessages(messages: ChatHistoryMessageInput[]) {
  return messages
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.timestamp ? new Date(message.timestamp) : new Date(),
    }))
    .filter((message) => !Number.isNaN(message.createdAt.getTime()));
}

async function listConversations(
  userId: string,
  limit: number,
): Promise<ChatHistoryListItem[]> {
  const database = ensureDb();
  logInfo("db.list.start", { userId, limit });

  const rows = await database
    .select({
      conversationId: chatConversations.conversationId,
      title: chatConversations.title,
      lastUserMessage: chatConversations.lastUserMessage,
      updatedAt: chatConversations.updatedAt,
      deletedAt: chatConversations.deletedAt,
    })
    .from(chatConversations)
    .where(
      and(eq(chatConversations.userId, userId), isNull(chatConversations.deletedAt)),
    )
    .orderBy(desc(chatConversations.updatedAt))
    .limit(limit);

  logInfo("db.list.success", { userId, limit, count: rows.length });
  return rows;
}

async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ChatHistoryDetail | null> {
  const database = ensureDb();
  logInfo("db.get.start", { userId, conversationId });

  const [conversation] = await database
    .select({
      conversationId: chatConversations.conversationId,
      updatedAt: chatConversations.updatedAt,
    })
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.userId, userId),
        eq(chatConversations.conversationId, conversationId),
        isNull(chatConversations.deletedAt),
      ),
    )
    .limit(1);

  if (!conversation) {
    logWarn("db.get.not_found", { userId, conversationId });
    return null;
  }

  const messages = await database
    .select({
      role: chatMessages.role,
      content: chatMessages.content,
      timestamp: chatMessages.createdAt,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.userId, userId),
        eq(chatMessages.conversationId, conversationId),
      ),
    )
    .orderBy(asc(chatMessages.createdAt));

  return {
    conversationId: conversation.conversationId,
    updatedAt: conversation.updatedAt,
    messages: messages
      .filter(
        (message: any) =>
          (message.role === "user" || message.role === "assistant") &&
          message.timestamp !== null,
      )
      .map((message: any) => ({
        role: message.role as "user" | "assistant",
        content: message.content,
        timestamp: message.timestamp as Date,
      })),
  };
}

async function upsertConversation(
  userId: string,
  conversationId: string,
  rawMessages: ChatHistoryMessageInput[],
): Promise<void> {
  const database = ensureDb();
  logInfo("db.upsert.start", {
    userId,
    conversationId,
    rawMessageCount: rawMessages.length,
  });
  const messages = normalizeMessages(rawMessages);
  const userMessages = messages.filter((message) => message.role === "user");

  if (userMessages.length === 0) {
    logWarn("db.upsert.rejected.no_user_messages", {
      userId,
      conversationId,
      normalizedMessageCount: messages.length,
    });
    throw new Error("CHAT_HISTORY_USER_MESSAGE_REQUIRED");
  }

  const title = toConversationTitle(
    userMessages.map((message: any) => ({
      role: "user",
      content: message.content,
      timestamp: message.createdAt.toISOString(),
    })),
  );
  const lastUserMessage = toLastUserMessage(
    userMessages.map((message: any) => ({
      role: "user",
      content: message.content,
      timestamp: message.createdAt.toISOString(),
    })),
  );

  await database.transaction(async (tx: any) => {
    await tx
      .insert(chatConversations)
      .values({
        userId,
        conversationId,
        title,
        lastUserMessage,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })
      .onConflictDoUpdate({
        target: [chatConversations.userId, chatConversations.conversationId],
        set: {
          title,
          lastUserMessage,
          updatedAt: new Date(),
          deletedAt: null,
        },
      });

    await tx
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.conversationId, conversationId),
        ),
      );

    if (messages.length > 0) {
      await tx.insert(chatMessages).values(
        messages.map((message) => ({
          userId,
          conversationId,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        })),
      );
    }
  });
  logInfo("db.upsert.success", {
    userId,
    conversationId,
    normalizedMessageCount: messages.length,
    userMessageCount: userMessages.length,
  });
}

async function softDeleteConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const database = ensureDb();
  logInfo("db.soft_delete.start", { userId, conversationId });

  const rows = await database
    .update(chatConversations)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatConversations.userId, userId),
        eq(chatConversations.conversationId, conversationId),
        isNull(chatConversations.deletedAt),
      ),
    )
    .returning({
      conversationId: chatConversations.conversationId,
    });

  logInfo("db.soft_delete.finish", {
    userId,
    conversationId,
    deleted: rows.length > 0,
  });
  return rows.length > 0;
}

export function registerChatHistoryRoutes(apiRouter: Router) {
  logInfo("routes.registered");
  apiRouter.get("/me", requireAuth, (req, res) => {
    const authUser = getAuthUser(res);
    logInfo("route.me.success", { userId: authUser.id });
    res.json({
      userId: authUser.id,
      email: authUser.email,
    });
  });

  apiRouter.get("/chat-history", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(res);
      const requestedLimit = Number(req.query.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), 100)
        : 30;
      logInfo("route.list.start", { userId: authUser.id, requestedLimit, limit });

      const items = await listConversations(authUser.id, limit);
      res.json({
        items: items.map((item) => ({
          conversationId: item.conversationId,
          title: item.title,
          lastUserMessage: item.lastUserMessage,
          updatedAt: item.updatedAt.toISOString(),
          deletedAt: item.deletedAt ? item.deletedAt.toISOString() : null,
        })),
      });
      logInfo("route.list.success", { userId: authUser.id, count: items.length });
    } catch (error) {
      logError("route.list.failed", {
        error: getErrorMessage(error),
      });
      res
        .status(getChatHistoryErrorStatus(error))
        .json(toChatHistoryErrorResponse(error));
    }
  });

  apiRouter.get("/chat-history/:conversationId", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(res);
      const { conversationId } = req.params;
      logInfo("route.detail.start", { userId: authUser.id, conversationId });

      if (!conversationId) {
        logWarn("route.detail.bad_request.missing_conversation_id", {
          userId: authUser.id,
        });
        return res.status(400).json({
          success: false,
          error: "conversationId is required",
        });
      }

      const conversation = await getConversation(authUser.id, conversationId);
      if (!conversation) {
        logWarn("route.detail.not_found", { userId: authUser.id, conversationId });
        return res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }

      const { replaceConversationMessages } = await import("./agent/conversation");
      replaceConversationMessages(
        conversationId,
        conversation.messages.map((message) => ({
          role: message.role,
          content: toAgentHistoryContent(message.content),
          timestamp: message.timestamp,
        })),
      );

      res.json({
        conversationId,
        updatedAt: conversation.updatedAt.toISOString(),
        messages: conversation.messages.map((message) => ({
          role: message.role,
          content: message.content,
          timestamp: message.timestamp.toISOString(),
        })),
      });
      logInfo("route.detail.success", {
        userId: authUser.id,
        conversationId,
        messageCount: conversation.messages.length,
      });
    } catch (error) {
      logError("route.detail.failed", {
        error: getErrorMessage(error),
      });
      res
        .status(getChatHistoryErrorStatus(error))
        .json(toChatHistoryErrorResponse(error));
    }
  });

  apiRouter.post("/chat-history", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(res);
      const { conversationId, messages } = req.body;
      logInfo("route.upsert.start", {
        userId: authUser.id,
        conversationId,
        messageCount: Array.isArray(messages) ? messages.length : null,
      });

      if (!conversationId || typeof conversationId !== "string") {
        logWarn("route.upsert.bad_request.invalid_conversation_id", {
          userId: authUser.id,
        });
        return res.status(400).json({
          success: false,
          error: "conversationId is required",
        });
      }

      if (!Array.isArray(messages)) {
        logWarn("route.upsert.bad_request.messages_not_array", {
          userId: authUser.id,
          conversationId,
        });
        return res.status(400).json({
          success: false,
          error: "messages must be an array",
        });
      }

      await upsertConversation(authUser.id, conversationId, messages);

      res.json({
        success: true,
      });
      logInfo("route.upsert.success", { userId: authUser.id, conversationId });
    } catch (error) {
      logError("route.upsert.failed", {
        error: getErrorMessage(error),
      });
      res
        .status(getChatHistoryErrorStatus(error))
        .json(toChatHistoryErrorResponse(error));
    }
  });

  apiRouter.delete("/chat-history/:conversationId", requireAuth, async (req, res) => {
    try {
      const authUser = getAuthUser(res);
      const { conversationId } = req.params;
      logInfo("route.delete.start", { userId: authUser.id, conversationId });

      if (!conversationId) {
        logWarn("route.delete.bad_request.missing_conversation_id", {
          userId: authUser.id,
        });
        return res.status(400).json({
          success: false,
          error: "conversationId is required",
        });
      }

      const deleted = await softDeleteConversation(authUser.id, conversationId);
      if (!deleted) {
        logWarn("route.delete.not_found", { userId: authUser.id, conversationId });
        return res.status(404).json({
          success: false,
          error: "Conversation not found",
        });
      }

      res.json({
        success: true,
      });
      logInfo("route.delete.success", { userId: authUser.id, conversationId });
    } catch (error) {
      logError("route.delete.failed", {
        error: getErrorMessage(error),
      });
      res
        .status(getChatHistoryErrorStatus(error))
        .json(toChatHistoryErrorResponse(error));
    }
  });
}

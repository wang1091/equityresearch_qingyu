import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  index,
  primaryKey,
  foreignKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const queryLogs = pgTable("query_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  query: text("query").notNull(),
  intent: varchar("intent").notNull(),
  confidence: text("confidence"),
  ticker: varchar("ticker"),
  industry: varchar("industry"),
  language: varchar("language").default("en"),
  isChineseQuery: text("is_chinese_query").default("false"),
  timestamp: timestamp("timestamp").default(sql`CURRENT_TIMESTAMP`),
  metadata: jsonb("metadata"),
});

export const chatConversations = pgTable(
  "chat_conversations",
  {
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    title: text("title").notNull(),
    lastUserMessage: text("last_user_message").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.userId, table.conversationId],
    }),
    userUpdatedAtIdx: index("chat_conversations_user_updated_at_idx").on(
      table.userId,
      table.updatedAt,
    ),
  }),
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    conversationFk: foreignKey({
      columns: [table.userId, table.conversationId],
      foreignColumns: [chatConversations.userId, chatConversations.conversationId],
      name: "chat_messages_conversation_fk",
    }).onDelete("cascade"),
    userConversationCreatedAtIdx: index(
      "chat_messages_user_conversation_created_at_idx",
    ).on(table.userId, table.conversationId, table.createdAt),
  }),
);

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertQueryLogSchema = createInsertSchema(queryLogs).omit({
  id: true,
  timestamp: true,
});

export const insertChatConversationSchema = createInsertSchema(
  chatConversations,
).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertQueryLog = z.infer<typeof insertQueryLogSchema>;
export type QueryLog = typeof queryLogs.$inferSelect;
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type ChatConversation = typeof chatConversations.$inferSelect;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

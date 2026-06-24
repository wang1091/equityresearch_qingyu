import { type User, type InsertUser, type QueryLog, type InsertQueryLog } from "@shared/schema";
import { randomUUID } from "node:crypto";

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  logQuery(log: InsertQueryLog): Promise<QueryLog>;
  getQueryLogs(limit?: number): Promise<QueryLog[]>;
  getQueryLogsByIntent(intent: string, limit?: number): Promise<QueryLog[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private queryLogs: QueryLog[];

  constructor() {
    this.users = new Map();
    this.queryLogs = [];
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async logQuery(log: InsertQueryLog): Promise<QueryLog> {
    const id = randomUUID();
    const queryLog: QueryLog = {
      ...log,
      id,
      timestamp: new Date(),
    } as QueryLog;
    this.queryLogs.push(queryLog);
    console.log(`📊 Query logged: ${log.query.substring(0, 50)}... - Intent: ${log.intent}`);
    return queryLog;
  }

  async getQueryLogs(limit: number = 100): Promise<QueryLog[]> {
    return this.queryLogs.slice(-limit).reverse();
  }

  async getQueryLogsByIntent(intent: string, limit: number = 50): Promise<QueryLog[]> {
    return this.queryLogs.filter(log => log.intent === intent).slice(-limit).reverse();
  }
}

export const storage = new MemStorage();

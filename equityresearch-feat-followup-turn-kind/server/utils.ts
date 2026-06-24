// server/utils.ts - 服务器工具函数

import type { Request, Response, NextFunction } from "express";

/**
 * 获取错误消息的安全方式
 * 处理 unknown 类型的 catch 块
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error occurred";
}

/**
 * 清理 JSON 响应中的 markdown 代码块
 * 处理 ```json ``` 或 ``` ``` 格式的包装
 */
export function cleanJsonResponse(content: string): string {
  let cleaned = content.trim();

  // 移除推理模型的思考块 (Qwen3 / gpt-oss 等): <think>…</think> 包住推理过程,
  // 会让后续 JSON.parse 失败 → 静默降级。取最后一个 </think> 之后的内容;再清掉
  // 任何残留(含被截断的孤立标签)。对所有 caller 都安全(它们都期望纯 JSON)。
  if (cleaned.includes("</think>")) {
    cleaned = cleaned.slice(cleaned.lastIndexOf("</think>") + "</think>".length).trim();
  }
  cleaned = cleaned.replace(/<\/?think>/gi, "").trim();

  // 移除 ```json 和 ``` 包装
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/```json\s*/g, "").replace(/```\s*$/g, "");
  }
  // 移除普通 ``` 包装
  else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/```\s*/g, "");
  }

  return cleaned.trim();
}

/**
 * 服务器配置常量
 */
export const SERVER_CONFIG = {
  // API 超时时间 (毫秒)
  VALUATION_TIMEOUT: 40000,
  CLASSIFICATION_TIMEOUT: 15000,
  OPENAI_TIMEOUT: 30000,
  DEEPSEEK_TIMEOUT: 20000,
  PERPLEXITY_TIMEOUT: 30000,
  // 各 route 模块上游调用超时(值即原硬编码,集中于此便于调参)
  GEMINI_TIMEOUT: 20000,
  PERFORMANCE_PROXY_TIMEOUT: 120000,
  PERFORMANCE_HEALTH_TIMEOUT: 15000,
  // TRENDING / RUMOR timeouts now live in their own services
  // (server/{trending,rumor}/service.ts) — per-source ownership, matching FDA/STOCK_PICKER.
  EARNINGS_CALENDAR_TIMEOUT: 15000,
  FOLLOWUPS_TIMEOUT: 15000,

  // API 限制
  DEFAULT_MAX_TOKENS: 1000,
  CLASSIFICATION_MAX_TOKENS: 200,
  ANALYSIS_MAX_TOKENS: 2000,

  // 验证规则
  MIN_QUERY_LENGTH: 1,
  MAX_QUERY_LENGTH: 1000,
  MIN_NEWS_CONTENT_LENGTH: 50,

  // 数据显示限制
  MAX_PEER_COMPANIES: 3,
  MAX_QA_ITEMS_DISPLAY: 10,
  MAX_RECOMMENDATIONS: 5,
} as const;

/**
 * 验证必需的请求字段
 */
export function validateRequired(
  body: any,
  fields: string[]
): { valid: true } | { valid: false; error: string } {
  for (const field of fields) {
    if (!body[field]) {
      return {
        valid: false,
        error: `Missing required field: ${field}`,
      };
    }
  }
  return { valid: true };
}

/**
 * 统一的日志工具
 */
export const logger = {
  info: (msg: string, data?: any) => {
    console.log(`ℹ️  ${msg}`, data ? JSON.stringify(data, null, 2) : "");
  },
  success: (msg: string, data?: any) => {
    console.log(`✅ ${msg}`, data ? JSON.stringify(data, null, 2) : "");
  },
  warn: (msg: string, data?: any) => {
    console.warn(`⚠️  ${msg}`, data ? JSON.stringify(data, null, 2) : "");
  },
  error: (msg: string, data?: any) => {
    console.error(`❌ ${msg}`, data ? JSON.stringify(data, null, 2) : "");
  },
  debug: (msg: string, data?: any) => {
    if (process.env.NODE_ENV === "development") {
      console.log(`🔍 ${msg}`, data ? JSON.stringify(data, null, 2) : "");
    }
  },
};

/**
 * 检查必需的环境变量
 */
export function validateEnvironmentVariables(
  requiredKeys: string[]
): { valid: true } | { valid: false; missing: string[] } {
  const missing: string[] = [];
  for (const key of requiredKeys) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }
  return missing.length > 0 ? { valid: false, missing } : { valid: true };
}

/**
 * Express 请求验证中间件
 * 检查必需的请求体字段
 */
export function validateRequestFields(requiredFields: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const validation = validateRequired(req.body, requiredFields);

    if (!validation.valid) {
      logger.warn("Request validation failed:", validation.error);
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    next();
  };
}

/**
 * API 响应的标准格式
 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp?: string;
}

/**
 * 创建成功响应
 */
export function successResponse<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 创建错误响应
 */
export function errorResponse(error: string): ApiResponse {
  return {
    success: false,
    error,
    timestamp: new Date().toISOString(),
  };
}


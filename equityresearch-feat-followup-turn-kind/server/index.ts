// server/index.ts
// ✅ 必须最先加载环境变量（在任何其他导入之前）
import * as fs from "fs";
import * as path from "path";

function loadEnvFile(fileName: string): boolean {
  const filePath = path.join(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const envContent = fs.readFileSync(filePath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith("#")) {
      const [key, ...valueParts] = trimmedLine.split("=");
      if (key) {
        let value = valueParts.join("=").trim();
        // Strip inline comments. .env.example documents every var with a trailing
        // "  # ..." note; copied verbatim into .env, an unstripped comment becomes
        // part of the value (e.g. URL = "http://...:5000   # SmartNews" → unparseable).
        // A "#" preceded by whitespace starts a comment; "#" inside a value (none
        // of ours have one) is kept. Quoted values keep their contents as-is.
        if (value[0] === '"' || value[0] === "'") {
          value = value.replace(/^(['"])([\s\S]*)\1\s*$/, "$2");
        } else {
          const commentIdx = value.search(/\s#/);
          if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
        }
        process.env[key.trim()] = value;
      }
    }
  });

  console.log(`✅ Loaded ${fileName}`);
  return true;
}

// Single machine-local env file — one file, one read, no layered precedence to
// reason about. Per-machine and gitignored; copy .env.example -> .env. The
// process manager (pm2) still injects NODE_ENV/PORT; anything not in .env falls
// back to the documented defaults in server/upstreamConfig.ts.
const loadedAnyEnv = loadEnvFile(".env");
if (!loadedAnyEnv) {
  console.log("⚠️ No .env file found (copy .env.example -> .env)");
}

// ✅ 现在才导入其他模块（这时环境变量已经加载）
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { probeUpstreams, summarizeHealth, formatHealthLines } from "./health";
import cors from "cors";
import { DEFAULT_PORT, parseConfiguredPort } from "./localApi";
import { requestIdMiddleware } from "./requestContext";

const app = express();
const DEVELOPMENT_HOST = "0.0.0.0";
const PRODUCTION_HOST = "127.0.0.1";

async function listenOnPort(server: import("http").Server, port: number, host: string) {
  return await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(error);
    };

    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function startServer(
  server: import("http").Server,
  isDevelopment: boolean,
) {
  const configuredPort = parseConfiguredPort();
  const startingPort = configuredPort ?? DEFAULT_PORT;
  const host = isDevelopment ? DEVELOPMENT_HOST : PRODUCTION_HOST;

  if (!isDevelopment) {
    await listenOnPort(server, startingPort, host);
    process.env.PORT = String(startingPort);
    return { port: startingPort, host };
  }

  for (let port = startingPort; port < startingPort + 20; port += 1) {
    try {
      await listenOnPort(server, port, host);
      process.env.PORT = String(port);

      if (port !== startingPort) {
        log(`port ${startingPort} is in use, falling back to ${port}`, "express");
      }

      return { port, host };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "EADDRINUSE") {
        continue;
      }

      throw err;
    }
  }

  throw new Error(
    `No available development port found between ${startingPort} and ${startingPort + 19}`,
  );
}

// ✅ 0. CORS 配置（必须放最前面）
app.use(
  cors({
    origin: [
      "https://equityresearch.checkitanalytics.com",
      "http://localhost:5173",
      /\.replit\.dev$/,
    ],
    credentials: true,
  }),
);

// ✅ 1. 基础中间件
// Bumped from default 100KB: agent chat sends up to 10 prior messages of
// conversation history, and each assistant message can be a multi-paragraph
// earnings ask card (answer + references) easily 10KB+. 100KB was tripping
// 413 PayloadTooLarge on /api/classify-intents-multi after 5–6 turns.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: false }));

// Request-scoped context (reqId, etc.) — must come BEFORE any handler
// that emits logs, so AsyncLocalStorage is populated when pino's mixin
// reads it. See server/requestContext.ts.
app.use(requestIdMiddleware);

// ✅ 2. 日志中间件(放在最前面)
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }
      log(logLine);
    }
  });

  next();
});

(async () => {
  // ✅ 3. 注册所有 API 路由(在 routes.ts 中定义)
  const server = await registerRoutes(app);

  // ✅ 4. 错误处理中间件
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("❌ Error:", err); // 记录错误
    res.status(status).json({ message });
    // ❌ 不要 throw err
  });

  // ✅ 5. Vite/静态文件(最后)
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const { port, host } = await startServer(server, app.get("env") === "development");
  log(`✅ Server listening on ${host}:${port}`);

  // Probe upstream APIs once at boot (non-blocking — never crash/hang the server
  // over a transient upstream blip). Logs a ✅/❌ table; GET /api/health re-runs it.
  void probeUpstreams()
    .then((results) => {
      log("🩺 Upstream health check:");
      for (const line of formatHealthLines(results)) log(line);
      const { criticalDown } = summarizeHealth(results);
      if (criticalDown) log("⚠️  A CRITICAL upstream is down/unconfigured — core features may fail.");
    })
    .catch((e) => log(`🩺 Upstream health check failed to run: ${e instanceof Error ? e.message : String(e)}`));
})();

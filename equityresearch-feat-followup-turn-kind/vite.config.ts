import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const config = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});

// Vitest reads `test`; vite ignores it. Attached post-hoc (not inside defineConfig)
// so the exported config keeps vite's UserConfig type — server/vite.ts passes it to
// vite.createServer, which rejects vitest's extended type.
// SmartNews/ and valuation-api/ are self-contained subprojects with their own
// deps/config — tested in their own flow, not the root `npm test`. Run from root
// they collect 0 tests and error on resolution, so exclude them here.
(config as unknown as { test?: Record<string, unknown> }).test = {
  exclude: [...configDefaults.exclude, "SmartNews/**", "valuation-api/**"],
};

export default config;

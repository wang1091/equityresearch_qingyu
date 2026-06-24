Read README.md in full, then produce a concise actionable implementation guide in this exact structure:

---

## 1. Prerequisites checklist
List every hard requirement (runtime, API keys, ports) as checkboxes. Mark which are mandatory vs optional.

## 2. Environment variables
Table: variable name | provider | model/purpose | required?
Pull from the "LLM 模型配置" and "环境变量说明" sections. Include the exact variable names as they appear in server/routes.ts and server/agent/generator.ts.

## 3. Local dev — start order
Numbered steps, one command per step, with the expected output or URL to verify each step worked. No prose.

## 4. Production deploy (EC2 / VPS)
Numbered steps for: git pull → build → pm2 restart. Call out the `--update-env` flag rule and when it is/isn't needed (the server loads .env itself via server/index.ts loadEnvFile, so a plain restart picks up .env changes).

## 5. Service map
Table: service name | pm2 daemon (root vs ubuntu) | port | nginx domain | restart command
Derived from the VPS service map in memory and the README deploy section.

## 6. LLM fallback chain
For each user query, show the exact priority order the app tries:
  classify → DeepSeek → [keyword fallback if 401/402/timeout]
  generate → DeepSeek → Gemini 2.5-flash → throw
  news     → SmartNews v2 → SmartNews v1 → [Gemini if key present]

## 7. Common failure modes & fixes
Table: symptom | root cause | fix command
Cover: DeepSeek 401, Gemini 404 model retired, pm2 not loading new .env, port conflict, SmartNews v2 timeout.

## 8. Adding a new analysis module
Exact file paths and code snippets (not prose) for each of the 4 steps:
  a. Register intent in buildKeywordFallback (server/routes.ts)
  b. Add API call case in callSingleApi (server/agent/apiCaller.ts)
  c. Add card formatter (server/agent/cardFormatter.ts)
  d. Add nav item if sidebar button needed (client/src/pages/home.tsx navItems)

Keep the output under 400 lines. No marketing language. Use tables and code blocks, not paragraphs.

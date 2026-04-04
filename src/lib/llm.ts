import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { ChatOpenAI } from "@langchain/openai";

export type ChatModelKind = "gemini" | "groq" | "openai";

function geminiModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

function groqModelId(): string {
  return process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
}

function openaiModelId(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function createGeminiModel(): BaseChatModel {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local");
  const id = geminiModelId();
  console.log(`[LLM] Creating Gemini model: ${id} | key ends: ...${key.slice(-6)}`);
  return new ChatGoogleGenerativeAI({
    model: id,
    apiKey: key,
    apiVersion: "v1beta",
    maxOutputTokens: 2048,
    temperature: 0.4,
  }) as BaseChatModel;
}

export function createGroqModel(): BaseChatModel {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY is not set in .env.local");
  const id = groqModelId();
  console.log(`[LLM] Creating Groq model: ${id} | key ends: ...${key.slice(-6)}`);
  const base = {
    apiKey: key,
    model: id,
    temperature: 0.4,
    maxTokens: 3000,
    topP: 0.95,
  };
  return new ChatGroq(base) as BaseChatModel;
}

function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

function hasGroq(): boolean {
  return !!process.env.GROQ_API_KEY?.trim();
}

function hasOpenAI(): boolean {
  return !!process.env.OPENAI_API_KEY?.trim();
}

export function createOpenAIModel(): BaseChatModel {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not set in .env.local");
  const id = openaiModelId();
  console.log(`[LLM] Creating OpenAI model: ${id} | key ends: ...${key.slice(-6)}`);
  return new ChatOpenAI({
    modelName: id,
    openAIApiKey: key,
    temperature: 0.4,
    maxTokens: 3000,
  }) as BaseChatModel;
}

export function resolveProviderOrder(opts?: { extractionUsed?: ChatModelKind }): ChatModelKind[] {
  const g = hasGemini();
  const q = hasGroq();
  const o = hasOpenAI();

  console.log(`[LLM] Key check -> GEMINI_API_KEY: ${g ? "SET" : "MISSING"} | GROQ_API_KEY: ${q ? "SET" : "MISSING"} | OPENAI_API_KEY: ${o ? "SET" : "MISSING"}`);

  if (!g && !q && !o) {
    throw new Error("[LLM] FATAL: No API keys found. Set GEMINI_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY in .env.local");
  }

  const primaryEnv = process.env.PRIMARY_LLM?.trim().toLowerCase() || "groq";
  console.log(`[LLM] PRIMARY_LLM env: ${primaryEnv}`);

  let order: ChatModelKind[] = [];
  
  // Build dynamic priority list to ensure all 3 APIs are used as backups
  const available: ChatModelKind[] = [];
  if (q) available.push("groq");
  if (g) available.push("gemini");
  if (o) available.push("openai");

  if (primaryEnv === "groq" && q) {
    order = ["groq", ...available.filter(k => k !== "groq")];
  } else if (primaryEnv === "gemini" && g) {
    order = ["gemini", ...available.filter(k => k !== "gemini")];
  } else if (primaryEnv === "openai" && o) {
    order = ["openai", ...available.filter(k => k !== "openai")];
  } else {
    order = [...available]; // Fallback to just what's available
  }

  // If extraction used a specific key and we aren't strict on primary, maybe shift it
  if (opts?.extractionUsed && order.includes(opts.extractionUsed)) {
    // Put unused ones first to avoid rate limiting the same provider
    const unused = order.filter(k => k !== opts.extractionUsed);
    order = [...unused, opts.extractionUsed];
  }

  console.log(`[LLM] Provider fallback order: [${order.join(" -> ")}]`);
  return order;
}

export type LlmRunResult<T> = { data: T; provider: ChatModelKind };

export async function withPrimaryLlmFallback<T>(
  run: (model: BaseChatModel) => Promise<T>,
  order?: ChatModelKind[]
): Promise<LlmRunResult<T>> {
  const chain = order ?? resolveProviderOrder();
  let lastErr: unknown;

  for (const kind of chain) {
    const start = Date.now();
    try {
      console.log(`[LLM] Attempting provider: ${kind.toUpperCase()} ...`);
      let model: BaseChatModel;
      if (kind === "gemini") model = createGeminiModel();
      else if (kind === "groq") model = createGroqModel();
      else model = createOpenAIModel();

      const data = await run(model);
      const ms = Date.now() - start;
      console.log(`[LLM] ${kind.toUpperCase()} succeeded in ${ms}ms`);
      return { data, provider: kind };
    } catch (err) {
      const ms = Date.now() - start;
      lastErr = err;
      const next = chain[chain.indexOf(kind) + 1];
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : "";
      console.error(`[LLM] ${kind.toUpperCase()} FAILED after ${ms}ms`);
      console.error(`[LLM] Error message: ${errMsg}`);
      if (errStack) console.error(`[LLM] Stack trace:\n${errStack}`);
      if (next) {
        console.warn(`[LLM] Falling back to: ${next.toUpperCase()}`);
      } else {
        console.error(`[LLM] All providers exhausted. No fallback available.`);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";

export type ChatModelKind = "gemini" | "groq";

function geminiModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-1.5-flash";
}

function groqModelId(): string {
  return process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
}

export function createGeminiModel(): BaseChatModel {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set in .env.local");
  const id = geminiModelId();
  console.log(`[LLM] Creating Gemini model: ${id} | key ends: ...${key.slice(-6)}`);
  return new ChatGoogleGenerativeAI({
    model: id,
    apiKey: key,
    apiVersion: "v1",
    maxOutputTokens: 4096,
    temperature: 0.1,
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
    temperature: 0.15,
    maxTokens: 8192,
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

export function resolveProviderOrder(opts?: { extractionUsed?: ChatModelKind }): ChatModelKind[] {
  const g = hasGemini();
  const q = hasGroq();

  console.log(`[LLM] Key check -> GEMINI_API_KEY: ${g ? "SET" : "MISSING"} | GROQ_API_KEY: ${q ? "SET" : "MISSING"}`);

  if (!g && !q) {
    throw new Error("[LLM] FATAL: No API keys found. Set GEMINI_API_KEY and/or GROQ_API_KEY in .env.local");
  }
  const primaryEnv = process.env.PRIMARY_LLM?.trim().toLowerCase();
  console.log(`[LLM] PRIMARY_LLM env: ${primaryEnv || "(not set, defaulting to gemini-first)"}`);

  const groqFirst =
    primaryEnv === "groq" ||
    (primaryEnv !== "gemini" && opts?.extractionUsed === "groq" && q);

  let order: ChatModelKind[];
  if (groqFirst && q) {
    order = g ? ["groq", "gemini"] : ["groq"];
  } else if (g) {
    order = q ? ["gemini", "groq"] : ["gemini"];
  } else {
    order = ["groq"];
  }

  console.log(`[LLM] Provider order: [${order.join(" -> ")}]`);
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
      const model = kind === "gemini" ? createGeminiModel() : createGroqModel();
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

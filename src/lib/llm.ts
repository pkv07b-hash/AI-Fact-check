import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";

export type ChatModelKind = "gemini" | "groq";

function geminiModelId(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

function groqModelId(): string {
  return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
}

export function createGeminiModel(): BaseChatModel {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const id = geminiModelId();
  console.log(`[LLM] Using Gemini model: ${id}`);
  return new ChatGoogleGenerativeAI({
    model: id,
    apiKey: key,
    maxOutputTokens: 4096,
    temperature: 0.1,
  }) as BaseChatModel;
}

export function createGroqModel(): BaseChatModel {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new Error("GROQ_API_KEY is not set");
  const id = groqModelId();
  console.log(`[LLM] Using Groq model: ${id}`);
  const base = {
    apiKey: key,
    model: id,
    temperature: 0.15,
    maxTokens: 8192,
    topP: 0.95,
  };
  return new ChatGroq(
    id.includes("gpt-oss")
      ? { ...base, reasoningEffort: "medium" as const }
      : base
  ) as BaseChatModel;
}

function hasGemini(): boolean {
  return !!process.env.GEMINI_API_KEY?.trim();
}

function hasGroq(): boolean {
  return !!process.env.GROQ_API_KEY?.trim();
}

/**
 * Which providers to try, in order. Use PRIMARY_LLM=groq when Gemini quota is exhausted.
 * If extraction already used Groq, verification prefers Groq next unless PRIMARY_LLM=gemini.
 */
export function resolveProviderOrder(opts?: { extractionUsed?: ChatModelKind }): ChatModelKind[] {
  const g = hasGemini();
  const q = hasGroq();
  if (!g && !q) {
    throw new Error("Set GEMINI_API_KEY and/or GROQ_API_KEY in .env.local");
  }
  const primaryEnv = process.env.PRIMARY_LLM?.trim().toLowerCase();

  const groqFirst =
    primaryEnv === "groq" ||
    (primaryEnv !== "gemini" && opts?.extractionUsed === "groq" && q);

  if (groqFirst && q) {
    return g ? ["groq", "gemini"] : ["groq"];
  }
  if (g) {
    return q ? ["gemini", "groq"] : ["gemini"];
  }
  return ["groq"];
}

export type LlmRunResult<T> = { data: T; provider: ChatModelKind };

/**
 * Try providers in order until one succeeds. Fixes the “Gemini 429 → retry same Gemini N times” slowdown.
 */
export async function withPrimaryLlmFallback<T>(
  run: (model: BaseChatModel) => Promise<T>,
  order?: ChatModelKind[]
): Promise<LlmRunResult<T>> {
  const chain = order ?? resolveProviderOrder();
  let lastErr: unknown;
  for (const kind of chain) {
    try {
      const model = kind === "gemini" ? createGeminiModel() : createGroqModel();
      const data = await run(model);
      return { data, provider: kind };
    } catch (err) {
      lastErr = err;
      const next = chain[chain.indexOf(kind) + 1];
      if (next) {
        console.warn(`[LLM] ${kind} failed; switching to ${next}.`, err instanceof Error ? err.message : err);
      } else {
        console.warn(`[LLM] ${kind} failed; no further providers.`, err);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

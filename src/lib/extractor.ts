import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import type { ChatModelKind } from "./llm";
import { withPrimaryLlmFallback } from "./llm";

export interface ExtractedClaim {
  id: string;
  claim: string;
}

export type ExtractionResult = {
  claims: ExtractedClaim[];
  provider: ChatModelKind;
};

export async function extractClaims(input: string, mode: 'quick' | 'deep' = 'deep'): Promise<ExtractionResult> {
  console.log("\n[EXTRACTOR] ── Starting Claim Extraction ──");
  console.log(`[EXTRACTOR] Input text (${input.length} chars): "${input.substring(0, 200)}${input.length > 200 ? "..." : ""}"`);

  const parser = StructuredOutputParser.fromZodSchema(
    z
      .array(
        z.object({
          id: z.string().describe("A unique identifier for the claim (e.g., 'c1', 'c2')"),
          claim: z.string().describe("The distinct, verifiable claim extracted from the text"),
        })
      )
      .describe("An array of extracted claims.")
  );

  const prompt = new PromptTemplate({
    template: `You are an expert fact-checker. Extract distinct, verifiable factual claims from the provided text.
    Only extract statements that can be objectively proven true or false using public sources.
    If the input is a question, extract the underlying factual assertion or the primary subject whose status needs verification (e.g. "Who is the Prime Minister of India?" should be converted to a claim like "Identify the current Prime Minister of India and verify their identity").
    Do NOT extract opinions, predictions, or subjective statements.
    Preserve numbers, dates, and places. For famous people, you may normalize obvious spelling errors in names (e.g. Dipika Padukon → Deepika Padukone) so searches find the right topic.
    ${mode === 'quick' ? 'Strictly limit to a maximum of 1-2 CORE claims for a high-speed verification scan.' : 'Limit to a maximum of 3 core claims even if the text is long (speed and quality).'}
    
    Text:
    {input}
    
    {format_instructions}
    `,
    inputVariables: ["input"],
    partialVariables: { format_instructions: parser.getFormatInstructions() },
  });

  try {
    const { data: response, provider } = await withPrimaryLlmFallback(async (model) => {
      const chain = prompt.pipe(model).pipe(parser);
      return chain.invoke({ input });
    });
    const maxClaims = mode === 'quick' ? 1 : 3;
    const claims = (response as ExtractedClaim[]).slice(0, maxClaims);
    console.log(`[EXTRACTOR] ✓ Extracted ${claims.length} claim(s) via ${provider}:`);
    claims.forEach((c) => {
      console.log(`  [${c.id}] "${c.claim}"`);
    });
    return { claims, provider };
  } catch (error) {
    console.error("[EXTRACTOR] ✗ ERROR extracting claims:", error);
    throw new Error("Failed to extract claims.");
  }
}

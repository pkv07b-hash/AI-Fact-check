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

  // Detect if this is a short user query vs a fetched article body
  const isArticle = input.length > 300;

  const prompt = new PromptTemplate({
    template: isArticle
      ? `You are an expert fact-checker analyzing content.
    The input might contain a [CONTEXT/QUESTION] followed by [ARTICLE CONTENT TO VERIFY].
    
    TASK: Extract the ${mode === 'quick' ? '1 MOST IMPORTANT' : '2-3 most important'} distinct, verifiable factual claims from the article.
    If a [CONTEXT/QUESTION] is provided, prioritize extracting claims that directly help answer or verify that specific question.
    
    Article Text / Context:
    {input}
    
    {format_instructions}`
      : `You are an expert fact-checker. The user has submitted a short query or statement to verify.
    CRITICAL: Preserve the user's exact wording. Do NOT rephrase, reword, or convert questions into statements.
    If it is a single question or statement, return it EXACTLY as written as one claim.
    Only split into multiple claims if there are clearly multiple INDEPENDENT and UNRELATED facts to check.
    If the questions are related to the same subject (e.g., 'When was WW2 and who won?'), KEEP THEM TOGETHER as one claim.
    ${mode === 'quick' ? 'Return at most 1 claim.' : 'Return at most 3 claims.'}
    
    User Input:
    {input}
    
    {format_instructions}`,
    inputVariables: ["input"],
    partialVariables: { format_instructions: parser.getFormatInstructions() },
  });

  try {
    const { data: response, provider } = await withPrimaryLlmFallback(async (model) => {
      const chain = prompt.pipe(model).pipe(parser);
      return chain.invoke({ input });
    });
    const maxClaims = isArticle ? 5 : 3; // URLs get up to 5 claims, short queries get up to 3
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

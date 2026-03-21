import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { StructuredOutputParser } from "langchain/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { ExtractedClaim } from "./extractor";
import { ClaimEvidence } from "./search";

export type VerificationStatus = "True" | "False" | "Partially True" | "Unverifiable";

export interface VerifiedClaim {
  id: string;
  claim: string;
  status: VerificationStatus;
  confidenceScore: number;
  reasoning: string;
  evidence: ClaimEvidence;
}

export interface AccuracyReport {
  overallTrustScore: number;
  totalClaims: number;
  verifiedClaims: VerifiedClaim[];
}

export async function verifyClaims(claims: ExtractedClaim[], evidenceList: ClaimEvidence[]): Promise<AccuracyReport> {
  const model = new ChatGoogleGenerativeAI({
    modelName: "gemini-1.5-flash",
    apiKey: process.env.GEMINI_API_KEY,
    maxOutputTokens: 2048,
    temperature: 0.1,
  });

  // Verify each claim individually
  const verificationPromises = claims.map(async (claim) => {
    const evidence = evidenceList.find(e => e.claimId === claim.id)!;
    
    // Prepare evidence string
    const evidenceStr = evidence.results.map((r, i) => `[Source ${i+1}] ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.url}`).join("\n\n");

    const parser = StructuredOutputParser.fromZodSchema(
      z.object({
        status: z.enum(["True", "False", "Partially True", "Unverifiable"]),
        confidenceScore: z.number().min(0).max(100).describe("Confidence in the verification from 0 to 100"),
        reasoning: z.string().describe("A concise explanation of why the claim is true, false, or partially true based solely on the evidence provided."),
      })
    );

    const prompt = new PromptTemplate({
      template: `You are an expert fact-checker. Determine the truthfulness of the following claim using ONLY the provided web search evidence.

      Claim: {claim}

      Evidence:
      {evidenceStr}

      {format_instructions}
      `,
      inputVariables: ["claim", "evidenceStr"],
      partialVariables: { format_instructions: parser.getFormatInstructions() },
    });

    try {
      const chain = prompt.pipe(model).pipe(parser);
      const result = await chain.invoke({ claim: claim.claim, evidenceStr });

      return {
        id: claim.id,
        claim: claim.claim,
        status: result.status as VerificationStatus,
        confidenceScore: result.confidenceScore,
        reasoning: result.reasoning,
        evidence
      };
    } catch (error) {
      console.error(`Error verifying claim ${claim.id}:`, error);
      return {
        id: claim.id,
        claim: claim.claim,
        status: "Unverifiable",
        confidenceScore: 0,
        reasoning: "The AI failed to parse or verify the claim against the provided evidence.",
        evidence
      };
    }
  });

  const verifiedClaims = await Promise.all(verificationPromises);

  // Calculate overall score (weighted average of True/Partially True)
  let scoreSum = 0;
  verifiedClaims.forEach(vc => {
    if (vc.status === "True") scoreSum += 100;
    else if (vc.status === "Partially True") scoreSum += 50;
    else if (vc.status === "False") scoreSum += 0;
    else scoreSum += 25; // Unverifiable penalty
  });

  const overallTrustScore = verifiedClaims.length > 0 ? Math.round(scoreSum / claims.length) : 0;

  return {
    overallTrustScore,
    totalClaims: claims.length,
    verifiedClaims
  };
}

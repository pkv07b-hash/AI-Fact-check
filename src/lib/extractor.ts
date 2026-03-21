import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import { StructuredOutputParser } from "langchain/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";

export interface ExtractedClaim {
  id: string;
  claim: string;
}

export async function extractClaims(input: string): Promise<ExtractedClaim[]> {
  const model = new ChatGoogleGenerativeAI({
    modelName: "gemini-1.5-flash",
    apiKey: process.env.GEMINI_API_KEY, // Assumes key is provided in .env
    maxOutputTokens: 2048,
    temperature: 0.1,
  });

  const parser = StructuredOutputParser.fromZodSchema(
    z.array(
      z.object({
        id: z.string().describe("A unique identifier for the claim (e.g., 'c1', 'c2')"),
        claim: z.string().describe("The distinct, verifiable claim extracted from the text"),
      })
    ).describe("An array of extracted claims.")
  );

  const formatInstructions = parser.getFormatInstructions();

  const prompt = new PromptTemplate({
    template: `You are an expert fact-checker. Extract distinct, verifiable claims from the provided text.
    Only extract factual statements that can be verified and proven either true or false. Do not extract opinions or subjective statements.
    Limit to a maximum of 5 core claims if the text is long.
    
    Text:
    {input}
    
    {format_instructions}
    `,
    inputVariables: ["input"],
    partialVariables: { format_instructions: formatInstructions },
  });

  const chain = prompt.pipe(model).pipe(parser);

  try {
    const response = await chain.invoke({ input });
    return response as ExtractedClaim[];
  } catch (error) {
    console.error("Error extracting claims with Gemini:", error);
    throw new Error("Failed to extract claims.");
  }
}

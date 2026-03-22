import { NextResponse } from "next/server";
import { extractClaims } from "@/lib/extractor";
import { retrieveEvidence } from "@/lib/search";
import { relatedReferencesForErrorFallback, verifyClaims } from "@/lib/verifier";
import { looksLikeUrl, fetchArticleFromUrl } from "@/lib/urlFetcher";

export async function POST(request: Request) {
  let targetInput = "Unknown Claim";

  try {
    const { input } = await request.json();
    targetInput = input;

    if (!input || typeof input !== "string") {
      return NextResponse.json({ error: "Valid text or URL input is required." }, { status: 400 });
    }

    // ── URL Detection: if the input looks like a URL, fetch the full article ──
    let pipelineInput = input;
    let articleMeta: { url: string; title: string; wordCount: number } | null = null;

    if (looksLikeUrl(input)) {
      console.log(`[ROUTE] URL detected: "${input}" — fetching article content...`);
      try {
        const article = await fetchArticleFromUrl(input);
        pipelineInput = `Article Title: ${article.title}\n\nArticle Content:\n${article.text}`;
        articleMeta = { url: article.url, title: article.title, wordCount: article.wordCount };
        console.log(`[ROUTE] Article fetched: "${article.title}" (${article.wordCount} words)`);
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : "Could not load article.";
        console.warn(`[ROUTE] URL fetch failed: ${msg}. Falling back to plain text pipeline.`);
        // Instead of aborting with 422, let the LLM pipeline handle the bare URL string.
        // If Tavily is enabled, it may even scrape it for us.
        pipelineInput = `Fact check the claims in this link: ${input}`;
      }
    }

    console.log("Starting Step 1: Extracting claims...");
    const { claims, provider: extractionProvider } = await extractClaims(pipelineInput);

    console.log("Starting Step 2: Retrieving evidence...");
    const evidenceList = await retrieveEvidence(claims);

    console.log("Starting Step 3: Verifying claims...");
    const report = await verifyClaims(claims, evidenceList, pipelineInput, extractionProvider);

    return NextResponse.json({
      ...report,
      extractionProvider,
      // Extra metadata for URL mode
      articleMeta,
    });
  } catch (error) {
    console.error("Fact Check Pipeline Error:", error);

    return NextResponse.json({
      overallTrustScore: 0,
      sourceReliabilityScore: 0,
      totalClaims: 1,
      extractionProvider: undefined,
      verificationProvider: undefined,
      articleMeta: null,
      verifiedClaims: [
        {
          id: "CLAIM_FB_001",
          claim: targetInput.length > 100 ? targetInput.substring(0, 100) + "..." : targetInput,
          status: "Unverifiable",
          confidenceScore: 0,
          reasoning:
            "⚠️ PIPELINE ERROR: The fact-check service could not complete. Check GEMINI_API_KEY / GROQ_API_KEY in .env.local, restart `npm run dev`, and watch the terminal for errors.",
          evidence: {
            claimId: "CLAIM_FB_001",
            queryUsed: targetInput,
            results: [
              {
                url: "https://ai.google.dev/gemini-api/docs/rate-limits",
                title: "Gemini API — rate limits & errors",
                snippet: "Verify your API key, quota, and billing. Add GROQ_API_KEY for automatic fallback when Gemini errors.",
              },
            ],
          },
        },
      ],
      relatedReferences: relatedReferencesForErrorFallback(targetInput),
    });
  }
}

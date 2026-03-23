import { NextResponse } from "next/server";
import { extractClaims } from "@/lib/extractor";
import { retrieveEvidence } from "@/lib/search";
import { relatedReferencesForErrorFallback, verifyClaims } from "@/lib/verifier";
import { looksLikeUrl, fetchArticleFromUrl } from "@/lib/urlFetcher";
import { globalCache } from "@/lib/cache";

export async function POST(request: Request) {
  let targetInput = "Unknown Claim";

  try {
    const startTime = Date.now();
    const { input, mode = 'deep' } = await request.json();
    targetInput = input;

    console.log(`\n[ROUTE] 📥 New Request: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}" (mode: ${mode})`);

    if (!input || typeof input !== "string") {
      console.error("[ROUTE] ❌ Invalid input: Input is missing or not a string.");
      return NextResponse.json({ error: "Valid text or URL input is required." }, { status: 400 });
    }

    // ── 0. Cache Intercept ───────────────────────────────────
    const cachedResult = globalCache.get(input);
    if (cachedResult) {
      console.log(`[ROUTE] ⚡ CACHE HIT for query: "${input.substring(0, 30)}..."`);
      return NextResponse.json({
        ...cachedResult,
        cached: true
      });
    }
    console.log(`[ROUTE] 🔍 CACHE MISS for query: "${input.substring(0, 30)}..."`);


    // ── URL Detection: if the input looks like a URL, fetch the full article ──
    let pipelineInput = input;
    let articleMeta: { url: string; title: string; wordCount: number } | null = null;

    if (looksLikeUrl(input)) {
      console.log(`[ROUTE] 🌐 URL detected: "${input}" — fetching article content...`);
      try {
        const article = await fetchArticleFromUrl(input);
        pipelineInput = `Article Title: ${article.title}\n\nArticle Content:\n${article.text}`;
        articleMeta = { url: article.url, title: article.title, wordCount: article.wordCount };
        console.log(`[ROUTE] ✅ Article fetched: "${article.title}" (${article.wordCount} words)`);
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : "Could not load article.";
        console.warn(`[ROUTE] ⚠️ URL fetch failed: ${msg}. Falling back to plain text pipeline.`);
        pipelineInput = `Fact check the claims in this link: ${input}`;
      }
    }

    console.log(`[ROUTE] 🚀 Starting Step 1: Extracting claims...`);
    const extractStart = Date.now();
    const { claims, provider: extractionProvider } = await extractClaims(pipelineInput, mode);
    console.log(`[ROUTE] ✅ Step 1 Complete: extracted ${claims.length} claims via ${extractionProvider} in ${Date.now() - extractStart}ms`);

    console.log(`[ROUTE] 🚀 Starting Step 2: Retrieving evidence...`);
    const searchStart = Date.now();
    const evidenceList = await retrieveEvidence(claims, mode);
    console.log(`[ROUTE] ✅ Step 2 Complete: retrieved evidence for ${evidenceList.length} claims in ${Date.now() - searchStart}ms`);

    console.log(`[ROUTE] 🚀 Starting Step 3: Verifying claims...`);
    const verifyStart = Date.now();
    const report = await verifyClaims(claims, evidenceList, pipelineInput, extractionProvider, mode);
    console.log(`[ROUTE] ✅ Step 3 Complete: verified ${claims.length} claims in ${Date.now() - verifyStart}ms`);

    // ── 4. Save to Cache ─────────────────────────────────────
    globalCache.set(input, report);

    const totalTime = Date.now() - startTime;
    console.log(`[ROUTE] 🏁 Pipeline Finished Successfully in ${totalTime}ms\n`);

    return NextResponse.json({
      ...report,
      extractionProvider,
      articleMeta,
    });
  } catch (error) {
    console.error("\n[ROUTE] ❌ FATAL PIPELINE ERROR:", error);
    if (error instanceof Error) {
      console.error("[ROUTE] Error Message:", error.message);
      console.error("[ROUTE] Stack Trace:", error.stack);
    }

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
            `⚠️ PIPELINE ERROR: ${error instanceof Error ? error.message : 'Unknown error'}. Check server logs for details.`,
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

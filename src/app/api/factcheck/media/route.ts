import { NextResponse } from "next/server";
import { extractClaimsFromMedia, validateMedia } from "@/lib/mediaExtractor";
import { extractClaims } from "@/lib/extractor";
import { retrieveEvidence } from "@/lib/search";
import { relatedReferencesForErrorFallback, verifyClaims } from "@/lib/verifier";

export const maxDuration = 60; // allow up to 60s for large media

export async function POST(request: Request) {
  let mediaDescription = "Uploaded media";

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const prompt = (formData.get("prompt") as string) || "";

    if (!file) {
      return NextResponse.json({ error: "No file provided. Send a 'file' field in multipart/form-data." }, { status: 400 });
    }

    const mimeType = file.type;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate size and type
    const validation = validateMedia(mimeType, buffer.byteLength);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.reason }, { status: 400 });
    }

    const base64Data = buffer.toString("base64");
    mediaDescription = `${file.name} (${mimeType})`;
    if (prompt) mediaDescription = `"${prompt}" — ${mediaDescription}`;

    console.log(`[MEDIA ROUTE] Processing: ${file.name} | ${mimeType} | ${(buffer.byteLength / 1024).toFixed(1)}KB`);

    // Step 1: Extract text/claims from the media via Gemini Vision
    console.log("[MEDIA ROUTE] Step 1: Extracting content from media...");
    const mediaResult = await extractClaimsFromMedia(base64Data, mimeType);

    console.log(`[MEDIA ROUTE] Extracted text: "${mediaResult.extractedText.substring(0, 200)}"`);
    console.log(`[MEDIA ROUTE] Summary: "${mediaResult.mediaSummary}"`);
    if (mediaResult.hasManipulationSignals) {
      console.warn(`[MEDIA ROUTE] ⚠️ Manipulation signals detected: ${mediaResult.manipulationDetails}`);
    }

    // Build the input text for the fact-check pipeline
    const pipelineInput = [
      prompt ? `User Prompt: ${prompt}` : "",
      mediaResult.mediaSummary,
      mediaResult.extractedText ? `Visible text: ${mediaResult.extractedText}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Step 2: Run standard fact-check pipeline on the extracted content
    console.log("[MEDIA ROUTE] Step 2: Extracting verifiable claims...");
    const { claims, provider: extractionProvider } = await extractClaims(pipelineInput);

    console.log("[MEDIA ROUTE] Step 3: Retrieving evidence...");
    const evidenceList = await retrieveEvidence(claims);

    console.log("[MEDIA ROUTE] Step 4: Verifying claims...");
    const report = await verifyClaims(claims, evidenceList, pipelineInput, extractionProvider);

    return NextResponse.json({
      ...report,
      extractionProvider,
      // Extra metadata specific to media analysis
      mediaAnalysis: {
        fileName: file.name,
        mimeType,
        fileSizeKb: Math.round(buffer.byteLength / 1024),
        mediaSummary: mediaResult.mediaSummary,
        extractedText: mediaResult.extractedText,
        hasManipulationSignals: mediaResult.hasManipulationSignals,
        manipulationDetails: mediaResult.manipulationDetails,
        detections: mediaResult.detections,
        isAiGenerated: mediaResult.isAiGenerated,
        aiGeneratedConfidence: mediaResult.aiGeneratedConfidence,
        aiGeneratedAnalysis: mediaResult.aiGeneratedAnalysis,
        syntheticType: mediaResult.syntheticType,
      },
    });
  } catch (error) {
    console.error("[MEDIA ROUTE] Pipeline error:", error);

    return NextResponse.json({
      overallTrustScore: 0,
      sourceReliabilityScore: 0,
      totalClaims: 1,
      extractionProvider: undefined,
      verificationProvider: undefined,
      verifiedClaims: [
        {
          id: "MEDIA_FB_001",
          claim: mediaDescription,
          status: "Unverifiable",
          confidenceScore: 0,
          reasoning:
            "⚠️ PIPELINE ERROR: Could not process the uploaded media. Ensure your GEMINI_API_KEY supports Vision (Gemini 2.0 Flash). Check the terminal for details.",
          evidence: {
            claimId: "MEDIA_FB_001",
            queryUsed: mediaDescription,
            results: [
              {
                url: "https://ai.google.dev/gemini-api/docs/vision",
                title: "Gemini Vision API",
                snippet: "Ensure you are using a Gemini model that supports multimodal/vision inputs.",
              },
            ],
          },
        },
      ],
      relatedReferences: relatedReferencesForErrorFallback(mediaDescription),
    });
  }
}

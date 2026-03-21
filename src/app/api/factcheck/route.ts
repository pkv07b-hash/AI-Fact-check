import { NextResponse } from 'next/server';
import { extractClaims } from '@/lib/extractor';
import { retrieveEvidence } from '@/lib/search';
import { verifyClaims } from '@/lib/verifier';

export async function POST(request: Request) {
  try {
    const { input } = await request.json();

    if (!input || typeof input !== "string") {
      return NextResponse.json({ error: "Valid text or URL input is required." }, { status: 400 });
    }

    // Step 1: Extract Claims
    console.log("Starting Step 1: Extracting claims...");
    const claims = await extractClaims(input);

    // Step 2: Retrieve Evidence
    console.log("Starting Step 2: Retrieving evidence...");
    const evidenceList = await retrieveEvidence(claims);

    // Step 3: Verify Claims
    console.log("Starting Step 3: Verifying claims...");
    const report = await verifyClaims(claims, evidenceList);

    return NextResponse.json(report);
  } catch (error) {
    console.error("Fact Check Pipeline Error:", error);
    return NextResponse.json({ error: "An error occurred during during the pipeline execution." }, { status: 500 });
  }
}

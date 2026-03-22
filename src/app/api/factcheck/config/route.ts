import { NextResponse } from "next/server";

/** Which env vars are set (never returns actual keys). */
export function GET() {
  return NextResponse.json({
    geminiConfigured: !!process.env.GEMINI_API_KEY?.trim(),
    groqConfigured: !!process.env.GROQ_API_KEY?.trim(),
  });
}

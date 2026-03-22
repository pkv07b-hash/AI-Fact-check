/**
 * mediaExtractor.ts
 * Extracts verifiable text claims from images and videos
 * using Gemini's multimodal vision capabilities.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export type MediaKind = "image" | "video";

export interface MediaExtractionResult {
  /** Raw text/transcript extracted from the media */
  extractedText: string;
  /** Short summary of what the media shows */
  mediaSummary: string;
  /** Whether this media appears to contain misinformation signals */
  hasManipulationSignals: boolean;
  /** Manipulation signal details if detected */
  manipulationDetails?: string;
}

/** Max file size: 20 MB for images, 50 MB for short videos */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const SUPPORTED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/mpeg",
]);

export function validateMedia(
  mimeType: string,
  byteLength: number
): { ok: true } | { ok: false; reason: string } {
  const isImage = SUPPORTED_IMAGE_TYPES.has(mimeType);
  const isVideo = SUPPORTED_VIDEO_TYPES.has(mimeType);

  if (!isImage && !isVideo) {
    return {
      ok: false,
      reason: `Unsupported file type "${mimeType}". Supported: JPEG, PNG, WebP, GIF, HEIC (images) and MP4, WebM, MOV, OGG (videos).`,
    };
  }

  if (isImage && byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "Image exceeds 20 MB limit." };
  }

  if (isVideo && byteLength > MAX_VIDEO_BYTES) {
    return { ok: false, reason: "Video exceeds 50 MB limit." };
  }

  return { ok: true };
}

export function getMediaKind(mimeType: string): MediaKind {
  return SUPPORTED_VIDEO_TYPES.has(mimeType) ? "video" : "image";
}

/**
 * Send media (image or short video) to Gemini Vision and extract:
 *  - All text visible in the media (captions, headlines, subtitles)
 *  - A brief summary of what the media depicts
 *  - Whether manipulation signals are present (deepfake, overlay text contradicting video, etc.)
 */
export async function extractClaimsFromMedia(
  base64Data: string,
  mimeType: string
): Promise<MediaExtractionResult> {
  const kind = getMediaKind(mimeType);
  const mediaLabel = kind === "video" ? "video" : "image";

  const prompt = `You are an expert media analyst and fact-checker.

Analyze this ${mediaLabel} and respond with a JSON object (no markdown, no backticks) with exactly these keys:

{
  "extractedText": "<all visible text, captions, headlines, subtitles, or spoken words you can identify — preserve them exactly>",
  "mediaSummary": "<1–2 sentences describing what this ${mediaLabel} shows, who/what is depicted>",
  "hasManipulationSignals": <true or false>,
  "manipulationDetails": "<if hasManipulationSignals is true, describe the signals: e.g. inconsistent lighting, deepfake artifacts, overlaid text contradicting context, etc. Otherwise empty string>"
}

If no text is visible or audible, set extractedText to a description of the key visual claims (e.g. "Image shows a chart claiming X grew by 300%").
Be thorough with text extraction — every headline, caption, and on-screen statistic matters for fact-checking.`;

  let raw = "";

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  try {
    console.log(`[MEDIA] Processing ${mediaLabel} with Gemini Vision (gemini-2.5-flash)...`);
    const genAI = new GoogleGenerativeAI(key);
    // User requested gemini-2.5-flash explicitly
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64Data } },
      prompt,
    ]);
    raw = result.response.text().trim();
    console.log(`[MEDIA] Gemini Vision succeeded.`);
  } catch (e: any) {
    console.warn(`[MEDIA] Gemini Vision error: ${e?.message || e}`);
    
    // Fallback to Groq Vision if Gemini fails (e.g. 404 or 429 Quota Exceeded)
    if (kind === "image" && process.env.GROQ_API_KEY) {
      console.log(`[MEDIA] Falling back to Groq Vision (llama-3.2-11b-vision-preview)...`);
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY.trim()}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.2-11b-vision-preview",
            temperature: 0.1,
            messages: [{
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Data}` } }
              ]
            }]
          })
        });

        if (res.ok) {
          const data = await res.json();
          raw = data.choices[0]?.message?.content?.trim() || "";
          console.log(`[MEDIA] Groq Vision Fallback succeeded.`);
        } else {
          const errText = await res.text();
          throw new Error(`Groq HTTP ${res.status}: ${errText}`);
        }
      } catch (fallbackErr: any) {
        console.error(`[MEDIA] Groq Fallback also failed:`, fallbackErr?.message || fallbackErr);
        throw new Error(`Both Gemini and Groq Vision failed. Gemini Error: ${e?.message}`);
      }
    } else {
      // If it's a video or no Groq key, we can't fall back
      throw new Error(`Gemini Vision Error: ${e?.message || "Check server logs."}`);
    }
  }

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<MediaExtractionResult>;
    return {
      extractedText: parsed.extractedText ?? "",
      mediaSummary: parsed.mediaSummary ?? "No summary available.",
      hasManipulationSignals: parsed.hasManipulationSignals ?? false,
      manipulationDetails: parsed.manipulationDetails || undefined,
    };
  } catch {
    console.error("[MEDIA] Failed to parse JSON, using raw text as extractedText");
    return {
      extractedText: raw,
      mediaSummary: `AI extracted content from ${mediaLabel}.`,
      hasManipulationSignals: false,
    };
  }
}

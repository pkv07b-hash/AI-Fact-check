/**
 * mediaExtractor.ts
 * Extracts verifiable text claims from images and videos
 * using Gemini's multimodal vision capabilities.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";

export type MediaKind = "image" | "video" | "document";

export interface Detection {
  label: string;
  /** [ymin, xmin, ymax, xmax] normalized 0-1000 */
  box_2d: [number, number, number, number];
}

export interface MediaExtractionResult {
  /** Raw text/transcript extracted from the media */
  extractedText: string;
  /** Short summary of what the media shows */
  mediaSummary: string;
  /** Whether this media appears to contain misinformation signals */
  hasManipulationSignals: boolean;
  /** Manipulation signal details if detected */
  manipulationDetails?: string;
  /** List of prominent objects detected in the scene */
  detections?: Detection[];
  /** Whether the media appears to be AI-generated or synthetically created */
  isAiGenerated: boolean;
  /** Confidence score (0-100) for AI-generation detection */
  aiGeneratedConfidence: number;
  /** Detailed analysis of AI-generation indicators */
  aiGeneratedAnalysis?: string;
  /** Type of synthetic manipulation detected */
  syntheticType?: 'deepfake' | 'ai_generated_image' | 'ai_generated_audio' | 'photoshopped' | 'none';
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

const SUPPORTED_DOCUMENT_TYPES = new Set([
  "application/pdf"
]);

export function validateMedia(
  mimeType: string,
  byteLength: number
): { ok: true } | { ok: false; reason: string } {
  const isImage = SUPPORTED_IMAGE_TYPES.has(mimeType);
  const isVideo = SUPPORTED_VIDEO_TYPES.has(mimeType);
  const isDocument = SUPPORTED_DOCUMENT_TYPES.has(mimeType);

  if (!isImage && !isVideo && !isDocument) {
    return {
      ok: false,
      reason: `Unsupported file type "${mimeType}". Supported: Images, Videos, and PDF.`,
    };
  }

  if (isImage && byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "Image exceeds 20 MB limit." };
  }

  if (isVideo && byteLength > MAX_VIDEO_BYTES) {
    return { ok: false, reason: "Video exceeds 50 MB limit." };
  }

  if (isDocument && byteLength > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "Document exceeds 20 MB limit." };
  }

  return { ok: true };
}

export function getMediaKind(mimeType: string): MediaKind {
  if (SUPPORTED_VIDEO_TYPES.has(mimeType)) return "video";
  if (SUPPORTED_DOCUMENT_TYPES.has(mimeType)) return "document";
  return "image";
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
  const mediaLabel = kind === "video" ? "video" : kind === "document" ? "document" : "image";

  const prompt = `You are an expert media forensic analyst and deepfake detector.

Analyze this ${mediaLabel} and respond with a JSON object (no markdown, no backticks) with exactly these keys:

{
  "extractedText": "<all visible text, captions, headlines, subtitles, or spoken words you can identify — preserve them exactly>",
  "mediaSummary": "<1–2 sentences describing what this ${mediaLabel} shows, who/what is depicted>",
  "hasManipulationSignals": <true or false>,
  "manipulationDetails": "<if hasManipulationSignals is true, describe the signals in detail>",
  "isAiGenerated": <true or false>,
  "aiGeneratedConfidence": <0 to 100>,
  "aiGeneratedAnalysis": "<Your forensic reasoning explaining why you believe this is real or AI-generated. Be specific about what you observed.>",
  "syntheticType": "<one of: deepfake, ai_generated_image, ai_generated_audio, photoshopped, none>",
  "detections": [
    { "label": "object name", "box_2d": [ymin, xmin, ymax, xmax] },
    ...
  ]
}

CRITICAL — DO NOT FALSE-POSITIVE ON REAL PHOTOS:
The following are NORMAL photography features and must NOT be treated as AI indicators:
- Bokeh / shallow depth of field (common in DSLR and phone portrait modes)
- Color grading, warm tones, saturation boosts (Instagram filters, Lightroom editing)
- Lens flare, sun glare, light leaks (natural optics)
- Smooth skin from beauty mode or phone camera processing
- Background blur from phone portrait mode
- HDR effects, vignetting, grain (normal post-processing)
- Professional studio lighting or golden hour lighting

ONLY flag as AI-generated if you see STRONG evidence like:
- Extra or missing fingers, merged/deformed hands
- Text that is gibberish or nonsensical
- Warped/melted background objects or impossible geometry
- Asymmetric earrings, jewelry, or accessories
- Teeth that look fused or unnaturally uniform
- Hair that merges into skin or clothing unnaturally
- Eyes with different pupil shapes or mismatched reflections
- Clothing patterns that break/warp illogically
- Perfectly symmetrical face (humans are naturally asymmetric)

For DEEPFAKE VIDEOS specifically:
- Flickering face edges between frames
- Lip movement that doesn't match audio
- Unnatural blinking patterns
- Face boundary that shifts or wobbles

SCORING RULES:
- Default assumption: the image is REAL (start at confidence 0)
- Only increase confidence if you find STRONG AI artifacts listed above
- Set isAiGenerated to true ONLY if aiGeneratedConfidence > 80
- Most real-world photos should score between 0-20

Note: box_2d values normalized to 0-1000.`;


  let raw = "";

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  try {
    if (kind === "video") {
      // ── VIDEO: Use Gemini Files API for proper frame-by-frame analysis ──
      console.log(`[MEDIA] Uploading video via Gemini Files API (gemini-2.5-flash)...`);
      const { GoogleAIFileManager, FileState } = await import("@google/generative-ai/server");
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");

      // Write base64 to a temp file (Files API requires a file path)
      const ext = mimeType.split("/")[1] || "mp4";
      const tmpPath = path.join(os.tmpdir(), `axiom_video_${Date.now()}.${ext}`);
      fs.writeFileSync(tmpPath, Buffer.from(base64Data, "base64"));

      const fileManager = new GoogleAIFileManager(key);
      const uploadResult = await fileManager.uploadFile(tmpPath, {
        mimeType,
        displayName: `axiom_upload_${Date.now()}`,
      });

      console.log(`[MEDIA] Upload complete: ${uploadResult.file.name} | State: ${uploadResult.file.state}`);

      // Poll until the video is fully processed by Gemini
      let file = uploadResult.file;
      let attempts = 0;
      while (file.state === FileState.PROCESSING && attempts < 30) {
        await new Promise((r) => setTimeout(r, 2000));
        const resp = await fileManager.getFile(file.name);
        file = resp;
        attempts++;
        console.log(`[MEDIA] Processing... attempt ${attempts}, state: ${file.state}`);
      }

      if (file.state === FileState.FAILED) {
        throw new Error("Video processing failed on Gemini servers.");
      }

      // Now send the processed file reference to the model
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const result = await model.generateContent([
        {
          fileData: {
            mimeType: file.mimeType,
            fileUri: file.uri,
          },
        },
        prompt,
      ]);
      raw = result.response.text().trim();
      console.log(`[MEDIA] Gemini Video analysis succeeded.`);

      // Cleanup temp file
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }

    } else {
      // ── IMAGE & DOCUMENT: Use fast inline base64 (no upload needed) ──
      console.log(`[MEDIA] Processing ${kind} with Gemini Vision (gemini-2.5-flash)...`);
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const result = await model.generateContent([
        { inlineData: { mimeType, data: base64Data } },
        prompt,
      ]);
      raw = result.response.text().trim();
      console.log(`[MEDIA] Gemini Image analysis succeeded.`);
    }
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
        
        // Final tier fallback to OpenAI Vision if Groq also fails
        if (process.env.OPENAI_API_KEY) {
          console.log(`[MEDIA] Falling back to OpenAI Vision (gpt-4o-mini)...`);
          try {
            const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
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

            if (openaiRes.ok) {
              const data = await openaiRes.json();
              raw = data.choices[0]?.message?.content?.trim() || "";
              console.log(`[MEDIA] OpenAI Vision Fallback succeeded.`);
            } else {
              const errText = await openaiRes.text();
              throw new Error(`OpenAI HTTP ${openaiRes.status}: ${errText}`);
            }
          } catch (openaiErr: any) {
             console.error(`[MEDIA] OpenAI Fallback also failed:`, openaiErr?.message || openaiErr);
             throw new Error(`All Vision API tiers failed (Gemini, Groq, OpenAI). Final Error: ${openaiErr?.message}`);
          }
        } else {
          throw new Error(`Both Gemini and Groq Vision failed (No OpenAI key set). Error: ${e?.message}`);
        }
      }
    } else {
      // If it's a video/document or no Groq key, we can't fall back safely to Vision APIs
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
      detections: parsed.detections || [],
      isAiGenerated: parsed.isAiGenerated ?? false,
      aiGeneratedConfidence: parsed.aiGeneratedConfidence ?? 0,
      aiGeneratedAnalysis: parsed.aiGeneratedAnalysis || undefined,
      syntheticType: parsed.syntheticType || 'none',
    };
  } catch {
    console.error("[MEDIA] Failed to parse JSON, using raw text as extractedText");
    return {
      extractedText: raw,
      mediaSummary: `AI extracted content from ${mediaLabel}.`,
      hasManipulationSignals: false,
      isAiGenerated: false,
      aiGeneratedConfidence: 0,
      syntheticType: 'none',
    };
  }
}

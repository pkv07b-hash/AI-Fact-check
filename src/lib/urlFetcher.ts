/**
 * urlFetcher.ts
 * Server-side utility to fetch a URL and extract the main readable article text.
 * Uses native fetch + regex-based HTML stripping (no extra dependencies).
 */

export interface FetchedArticle {
  url: string;
  title: string;
  text: string;
  /** Approximate word count of extracted text */
  wordCount: number;
  /** Images extracted from the page */
  images: PageImage[];
}

/** Domains that are likely to block server-side fetching */
const KNOWN_BLOCKED = [
  "twitter.com", "x.com", "facebook.com", "instagram.com",
  "linkedin.com", "tiktok.com", "reddit.com/login",
];

/** Regex to strip HTML tags and collapse whitespace */
function htmlToText(html: string): string {
  return html
    // Remove <script>, <style>, <nav>, <header>, <footer>, <aside>, <form> blocks entirely
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    // Preserve paragraph/heading breaks as newlines
    .replace(/<\/(p|h[1-6]|li|div|article|section|blockquote)>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    // Collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(html: string): string {
  // Try <title> tag first, then og:title meta
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogTitle) return ogTitle.trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  return title ? title.replace(/\s+/g, " ").trim() : "Untitled Article";
}

import * as cheerio from "cheerio";

function extractMainContent(html: string): string {
  const $ = cheerio.load(html);
  
  // Remove noise elements
  $("script, style, noscript, nav, header, footer, aside, .sidebar, .menu, .ad, .advertisement, iframe, .social-share, .comments").remove();
  
  // Try to find article content areas (in priority order)
  const selectors = [
    "article",           // Standard article tags
    "[role='main']",     // Main content role
    "main",              // Main tag
    ".article-body",     // Common article body class
    ".story-body",       // BBC style
    ".post-content",     // Blog style
    ".entry-content",    // WordPress style
    "#article-body",     // ID-based
    ".content",          // Generic content
  ];
  
  let contentBlocks: string[] = [];
  
  for (const selector of selectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, el) => {
        const paragraphs = $(el).find("p, h1, h2, h3, h4, li, blockquote, figcaption")
          .map((__, p) => $(p).text().trim())
          .get()
          .filter(t => t.length > 20); // Filter out tiny UI strings
        contentBlocks.push(...paragraphs);
      });
      if (contentBlocks.length > 3) break; // Found enough content, stop
    }
  }
  
  // Fallback: grab all paragraphs and headings from body
  if (contentBlocks.length < 3) {
    contentBlocks = $("body p, body h1, body h2, body h3, body li")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(t => t.length > 20);
  }
  
  return contentBlocks.join("\n\n").replace(/\s+/g, " ").trim();
}

/**
 * Fetch a URL and extract its readable article text.
 * Throws an error if the URL is unreachable or returns non-HTML content.
 */
export async function fetchArticleFromUrl(rawUrl: string): Promise<FetchedArticle> {
  // Normalize URL
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const hostname = new URL(url).hostname.replace(/^www\./, "");
  if (KNOWN_BLOCKED.some((b) => hostname.includes(b))) {
    throw new Error(
      `Cannot fetch content from ${hostname} — this site blocks server-side requests. Try pasting the article text directly.`
    );
  }

  console.log(`[URL FETCHER] Fetching: ${url}`);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `Could not load the page (HTTP ${response.status}). The site may require login or block automated access.`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error(
      `The URL points to a non-HTML file (${contentType}). Please provide a news article or web page URL.`
    );
  }

  const html = await response.text();
  const title = extractTitle(html);
  const rawText = extractMainContent(html);

  // Increased limit for better multi-article scraping
  const text = rawText.length > 8000 ? rawText.substring(0, 8000) + "\n...[truncated]" : rawText;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  console.log(`[URL FETCHER] ✓ "${title}" — ${wordCount} words extracted`);

  if (wordCount < 10) {
    throw new Error(
      "Very little text was extracted from this page. The site may be behind a paywall or use JavaScript rendering."
    );
  }

  return { url, title, text, wordCount, images: extractPageImages(html, url) };
}

/** Returns true if the string looks like a URL */
export function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  return /^(https?:\/\/|www\.)\S+\.\S+/.test(t) || /^\S+\.(com|org|net|in|io|co|gov|edu|news|info)(\/\S*)?$/.test(t);
}

/** Extracts the first URL found in a string (even if surrounded by text) */
export function extractFirstUrl(s: string): string | null {
  const match = s.match(/(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+)/i);
  if (!match) return null;
  let url = match[0];
  if (url.toLowerCase().startsWith('www.')) url = 'https://' + url;
  return url;
}

/** Extracted image info from a webpage */
export interface PageImage {
  url: string;
  alt: string;
  caption: string;
}

/** Extract main content images from HTML (skip icons, ads, tiny images) */
function extractPageImages(html: string, baseUrl: string): PageImage[] {
  const $ = cheerio.load(html);
  const images: PageImage[] = [];
  const seen = new Set<string>();

  // Remove nav, footer, sidebar images
  $("nav img, footer img, aside img, .sidebar img, .ad img, .advertisement img").remove();

  $("article img, main img, .article-body img, .story-body img, .content img, [role='main'] img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (!src || src.startsWith("data:")) return;

    // Resolve relative URLs
    let fullUrl = src;
    try {
      fullUrl = new URL(src, baseUrl).href;
    } catch { return; }

    // Skip tiny icons/avatars (usually < 100px referenced in filename)
    if (/icon|logo|avatar|sprite|favicon|badge|button/i.test(src)) return;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    const alt = $(el).attr("alt") || "";
    const caption = $(el).closest("figure").find("figcaption").text().trim() || "";

    images.push({ url: fullUrl, alt, caption });
  });

  // If no article images found, try body images
  if (images.length === 0) {
    $("body img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (!src || src.startsWith("data:")) return;
      let fullUrl = src;
      try { fullUrl = new URL(src, baseUrl).href; } catch { return; }
      if (/icon|logo|avatar|sprite|favicon|badge|button/i.test(src)) return;
      if (seen.has(fullUrl)) return;
      seen.add(fullUrl);
      images.push({ url: fullUrl, alt: $(el).attr("alt") || "", caption: "" });
    });
  }

  return images.slice(0, 5); // Max 5 images
}

/** AI detection result for a single image */
export interface ImageAiDetection {
  image_url: string;
  ai_generated_probability: number;
  verdict: "AI-generated" | "Likely AI-generated" | "Real" | "Uncertain";
  reasoning: string;
  indicators: string[];
}

/** Analyze extracted page images for AI-generation using Gemini Vision */
export async function analyzePageImages(images: PageImage[]): Promise<ImageAiDetection[]> {
  if (images.length === 0) return [];

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return [];

  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  // Analyze up to 3 images in parallel for speed
  const toAnalyze = images.slice(0, 3);
  console.log(`[IMAGE AI] Analyzing ${toAnalyze.length} image(s) from webpage...`);

  const results = await Promise.allSettled(
    toAnalyze.map(async (img): Promise<ImageAiDetection> => {
      try {
        // Fetch the image as base64
        const res = await fetch(img.url, {
          signal: AbortSignal.timeout(4000),
          headers: { "User-Agent": "Mozilla/5.0 Chrome/124.0" },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") || "image/jpeg";
        const b64 = buf.toString("base64");

        const prompt = `Analyze this image and determine if it is AI-generated or real.
Context: alt="${img.alt}" caption="${img.caption}"

Check for: extra/missing fingers, gibberish text, warped geometry, fused teeth, unnatural hair-skin boundaries, mismatched eye reflections, broken clothing patterns. 
Do NOT flag normal photography (bokeh, color grading, lens flare, portrait mode) as AI.
Check metadata keywords: midjourney, dalle, stable diffusion, ai art.

Return ONLY a JSON object (no markdown):
{"ai_generated_probability": 0-100, "verdict": "AI-generated / Likely AI-generated / Real / Uncertain", "reasoning": "brief explanation", "indicators": ["list of clues"]}`;

        let raw = "";
        try {
          const result = await model.generateContent([
            { inlineData: { mimeType: mime, data: b64 } },
            prompt,
          ]);
          raw = result.response.text().trim();
        } catch (geminiErr: any) {
          console.warn(`[IMAGE AI] Gemini failed for ${img.url}: ${geminiErr?.message}. Trying Groq...`);
          
          if (process.env.GROQ_API_KEY) {
            try {
              const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${process.env.GROQ_API_KEY.trim()}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "llama-3.2-11b-vision-preview",
                  temperature: 0.1,
                  messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }]
                })
              });
              if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
              const data = await res.json();
              raw = data.choices[0]?.message?.content?.trim() || "";
            } catch (groqErr: any) {
              console.warn(`[IMAGE AI] Groq failed for ${img.url}: ${groqErr?.message}. Trying OpenAI...`);
              if (process.env.OPENAI_API_KEY) {
                const oRes = await fetch("https://api.openai.com/v1/chat/completions", {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY.trim()}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model: "gpt-4o-mini",
                    temperature: 0.1,
                    messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }]
                  })
                });
                if (!oRes.ok) throw new Error(`OpenAI HTTP ${oRes.status}`);
                const data = await oRes.json();
                raw = data.choices[0]?.message?.content?.trim() || "";
              } else {
                throw new Error("No OpenAI key available for final fallback.");
              }
            }
          } else if (process.env.OPENAI_API_KEY) {
             console.warn(`[IMAGE AI] No Groq key, trying OpenAI...`);
             const oRes = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY.trim()}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                  model: "gpt-4o-mini",
                  temperature: 0.1,
                  messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }] }]
                })
              });
              if (!oRes.ok) throw new Error(`OpenAI HTTP ${oRes.status}`);
              const data = await oRes.json();
              raw = data.choices[0]?.message?.content?.trim() || "";
          } else {
             throw new Error("No Groq or OpenAI key available for fallback.");
          }
        }

        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const parsed = JSON.parse(raw);

        return {
          image_url: img.url,
          ai_generated_probability: parsed.ai_generated_probability ?? 0,
          verdict: parsed.verdict || "Uncertain",
          reasoning: parsed.reasoning || "",
          indicators: parsed.indicators || [],
        };
      } catch (err) {
        console.warn(`[IMAGE AI] Failed for ${img.url}:`, err instanceof Error ? err.message : err);
        return {
          image_url: img.url,
          ai_generated_probability: 0,
          verdict: "Uncertain",
          reasoning: "Could not analyze this image.",
          indicators: [],
        };
      }
    })
  );

  const detections = results
    .filter((r): r is PromiseFulfilledResult<ImageAiDetection> => r.status === "fulfilled")
    .map(r => r.value);

  console.log(`[IMAGE AI] Completed: ${detections.length} image(s) analyzed`);
  return detections;
}

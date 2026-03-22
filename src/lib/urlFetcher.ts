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

function extractMainContent(html: string): string {
  // Try to isolate <article>, <main>, or common content div patterns
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return htmlToText(articleMatch[1]);

  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return htmlToText(mainMatch[1]);

  // Common CMS patterns: .post-content, .entry-content, .article-body, etc.
  const contentDivMatch = html.match(
    /<div[^>]+class=["'][^"']*(?:post-content|entry-content|article-body|article-content|story-body|td-post-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );
  if (contentDivMatch) return htmlToText(contentDivMatch[1]);

  // Fallback: strip full body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return htmlToText(bodyMatch ? bodyMatch[1] : html);
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
    signal: AbortSignal.timeout(15_000),
    headers: {
      // Mimic a browser to avoid bot-detection 403s
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

  // Trim to ~8000 chars to stay within LLM token limits
  const text = rawText.length > 8000 ? rawText.substring(0, 8000) + "\n...[truncated]" : rawText;
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  console.log(`[URL FETCHER] ✓ "${title}" — ${wordCount} words extracted`);

  if (wordCount < 20) {
    throw new Error(
      "Very little text was extracted from this page. The site may be behind a paywall or use JavaScript rendering."
    );
  }

  return { url, title, text, wordCount };
}

/** Returns true if the string looks like a URL */
export function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  return /^(https?:\/\/|www\.)\S+\.\S+/.test(t) || /^\S+\.(com|org|net|in|io|co|gov|edu|news|info)(\/\S*)?$/.test(t);
}

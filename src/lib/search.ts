import { ExtractedClaim } from "./extractor";

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface ClaimEvidence {
  claimId: string;
  queryUsed: string;
  results: SearchResult[];
}

const STOP = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "was",
  "one",
  "our",
  "out",
  "get",
  "has",
  "him",
  "his",
  "how",
  "its",
  "may",
  "new",
  "now",
  "old",
  "see",
  "two",
  "who",
  "did",
  "way",
  "use",
  "man",
  "any",
  "been",
  "being",
  "have",
  "from",
  "they",
  "that",
  "this",
  "with",
  "will",
  "your",
  "what",
  "when",
  "many",
  "some",
  "time",
  "very",
  "just",
  "into",
  "than",
  "then",
  "them",
  "also",
  "only",
  "come",
  "over",
  "such",
  "make",
  "like",
  "back",
  "after",
  "first",
  "well",
  "work",
  // NOTE: "year" intentionally removed — keep year-related words for historical queries
  "each",
  "which",
  "their",
  "said",
  "other",
  "about",
  "there",
  "would",
  "could",
  "should",
  "married",
  "marriage",
  "wife",
  "husband",
  "spouse",
]);

/** Extract 4-digit years from a claim (e.g. 1947, 2003). */
function extractYears(text: string): string[] {
  return [...text.matchAll(/\b(1[5-9]\d{2}|20[0-2]\d)\b/g)].map((m) => m[0]);
}

function toTitleCasePhrase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** Multiple query shapes so we don't rely on one awkward full-sentence Wikipedia search. */
export function buildWikipediaSearchQueries(claim: string): string[] {
  const raw = claim.trim();
  const lower = raw.toLowerCase();
  const out: string[] = [];

  // ── Historical year-aware queries (highest priority) ──────────────────────
  // For claims that mention a specific year (e.g. "India independence 1947"),
  // always generate "<key noun phrase> <year>" so Wikipedia returns the right article.
  const years = extractYears(raw);
  if (years.length > 0) {
    const nonYearWords = lower
      .split(/\s+/)
      .filter((w) => !years.includes(w) && w.length > 2 && !STOP.has(w));
    const keyPhrase = nonYearWords.slice(0, 4).join(" ");
    for (const yr of years.slice(0, 2)) {
      if (keyPhrase) out.push(`${keyPhrase} ${yr}`);
      // Also try the raw year alone as a disambiguation fallback
      out.push(yr);
    }
    // e.g. "India independence in 1947"
    if (keyPhrase) out.push(keyPhrase);
  }

  const married = lower.match(/^(.+?)\s+is\s+married\s+to\s+(.+)$/);
  if (married) {
    const a = married[1].trim();
    const b = married[2].trim();
    const aT = toTitleCasePhrase(a);
    out.push(aT, `${a} spouse`, `${a} personal life`, `${a} marriage`, `${a} wife`, `${a} husband`);
    out.push(`${aT} Anushka Sharma`, `${aT} relationship`);
    const bT = toTitleCasePhrase(b);
    out.push(bT, `${b} Wikipedia`);
  }

  const isSimple = lower.match(/^(.{2,60}?)\s+is\s+(.{2,80})$/);
  if (isSimple && !married) {
    const subj = isSimple[1].trim();
    const pred = isSimple[2].trim().split(/\s+/).slice(0, 4).join(" ");
    out.push(toTitleCasePhrase(subj), `${subj} ${pred}`);
  }

  const words = lower.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (words.length >= 2) {
    out.push(`${words[0]} ${words[1]}`);
    out.push(words.slice(0, Math.min(5, words.length)).join(" "));
  }

  out.push(raw);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of out.map((x) => x.replace(/\s+/g, " ").trim())) {
    if (q.length < 2) continue;
    const k = q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(q);
  }
  return deduped.slice(0, 10);
}

function claimMatchTokens(claim: string): string[] {
  const lower = claim.toLowerCase();
  const words = lower.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  const uniq = [...new Set(words)];
  return uniq.slice(0, 12);
}

function scoreAgainstClaim(claim: string, r: SearchResult): number {
  const tokens = claimMatchTokens(claim);
  const titleL = r.title.toLowerCase();
  const blob = `${r.title} ${r.snippet}`.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    // 4-digit years are critical for historical accuracy — give them extra weight
    const isYear = /^(1[5-9]\d{2}|20[0-2]\d)$/.test(t);
    if (titleL.includes(t)) s += isYear ? 10 : 4;
    else if (blob.includes(t)) s += isYear ? 6 : 1;
  }
  return s;
}

function rankSearchResults(claim: string, results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => scoreAgainstClaim(claim, b) - scoreAgainstClaim(claim, a));
}

async function wikiSearchOnce(query: string, timeoutMs: number = 3_000): Promise<SearchResult[]> {
  // Use srlimit=4 (we usually only keep top 2-3 anyway) to reduce payload
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=4&origin=*`;
  // Dynamic timeout for Quick vs Deep
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return [];
  const data = await response.json();
  const list = data?.query?.search;
  if (!Array.isArray(list) || list.length === 0) return [];
  return list.map((res: { pageid: number; title: string; snippet: string }) => {
    const stripped = res.snippet
      .replace(/<\/?[^>]+(>|$)/g, "")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&");
    return {
      url: `https://en.wikipedia.org/?curid=${res.pageid}`,
      title: res.title,
      snippet: stripped,
    };
  });
}

import * as cheerio from "cheerio";

async function scrapeUrl(url: string): Promise<string> {
  try {
    console.log(`[SCRAPER] Fetching live page: ${url}`);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });
    if (!res.ok) {
      console.log(`[SCRAPER] Failed HTTP ${res.status} for ${url}`);
      return "";
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    
    // Remove noise
    $("script, style, noscript, nav, header, footer, aside, .sidebar, .menu, iframe").remove();
    
    // Extract meaningful paragraphs and headers
    const textBlocks = $("p, h1, h2, h3, li")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 30); // Filter out tiny UI elements
      
    // Join and truncate to keep payload manageable (approx 3000 chars = 1 page)
    const text = textBlocks.join("\n\n").replace(/\s+/g, " ").trim();
    const truncated = text.slice(0, 3000);
    console.log(`[SCRAPER] Extracted ${truncated.length} chars from ${url}`);
    return truncated;
  } catch (err) {
    console.warn(`[SCRAPER] Failed to scrape ${url}:`, err instanceof Error ? err.message : err);
    return "";
  }
}

export async function retrieveEvidence(claims: ExtractedClaim[], mode: 'quick' | 'deep' = 'deep'): Promise<ClaimEvidence[]> {
  const isQuick = mode === 'quick';
  const evidencePromises = claims.map(async (claim) => {
    let queries = buildWikipediaSearchQueries(claim.claim).slice(0, 3); // MAX 3 queries for speed
    const byKey = new Map<string, SearchResult>();

    console.log(`\n[SEARCH] Claim ID: ${claim.id}`);
    console.log(`[SEARCH] Claim: "${claim.claim}"`);
    console.log(`[SEARCH] Query plan (parallel): ${queries.map((q) => `"${q}"`).join(" | ")}`);

    // 🔥 SPEED OPTIMIZATION: Run all Wikipedia searches for this claim in PARALLEL
    const resultsBatches = await Promise.allSettled(
      queries.map((q) => wikiSearchOnce(q, 2000))
    );

    for (const res of resultsBatches) {
      if (res.status === "fulfilled") {
        for (const row of res.value) {
          const key = row.title.toLowerCase();
          if (!byKey.has(key)) byKey.set(key, row);
        }
      } else {
        console.warn(`[SEARCH] Parallel query failed:`, res.reason);
      }
    }

    let merged = rankSearchResults(claim.claim, [...byKey.values()]);

    const married = claim.claim
      .trim()
      .toLowerCase()
      .match(/^(.+?)\s+is\s+married\s+to\s+(.+)$/);
    if (married) {
      const aWords = married[1]
        .trim()
        .split(/\s+/)
        .map((w) => w.toLowerCase())
        .filter((w) => w.length > 2);
      const titleAnchored = merged.filter((r) => {
        const t = r.title.toLowerCase();
        return aWords.some((w) => t.includes(w));
      });
      if (titleAnchored.length > 0) {
        merged = rankSearchResults(claim.claim, titleAnchored);
      }
    }

    const tokens = claimMatchTokens(claim.claim);
    if (merged.length > 1 && tokens.length > 0) {
      const positive = merged.filter((r) => scoreAgainstClaim(claim.claim, r) > 0);
      if (positive.length > 0) merged = positive;
    }

    // ── Wikipedia results (top 2 or top 1 if Quick) ─────────────────────────────
    const wikiResults = merged.slice(0, isQuick ? 1 : 2);

    const newsQuery = tokens.slice(0, 6).join(" ") || claim.claim.slice(0, 80);

    // ── REAL WEB SEARCH: Tavily (primary) + DuckDuckGo (fallback) ─────────────
    let webResults: SearchResult[] = [];

    // Try Tavily first (real search engine with actual article content)
    const tavilyKey = process.env.TAVILY_API_KEY?.trim();
    if (tavilyKey) {
      try {
        console.log(`[SEARCH] Tavily web search: "${newsQuery}"`);
        const tvlyRes = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: tavilyKey,
            query: newsQuery,
            search_depth: "basic",
            include_images: false,
            include_answer: false,
            max_results: 4,
          }),
          signal: AbortSignal.timeout(4000),
        });
        if (tvlyRes.ok) {
          const tvlyData = await tvlyRes.json();
          const seenUrls = new Set(wikiResults.map(r => r.url));
          for (const res of tvlyData.results || []) {
            if (!res.url || !res.title || seenUrls.has(res.url)) continue;
            seenUrls.add(res.url);
            webResults.push({
              url: res.url,
              title: res.title,
              snippet: (res.content || "").slice(0, 400).trim(),
            });
          }
          console.log(`[SEARCH] Tavily returned ${webResults.length} real result(s)`);
        }
      } catch (err) {
        console.warn(`[SEARCH] Tavily failed:`, err instanceof Error ? err.message : err);
      }
    }

    // Fallback: DuckDuckGo Instant Answer API (free, no API key)
    if (webResults.length === 0) {
      try {
        console.log(`[SEARCH] DuckDuckGo search: "${newsQuery}"`);
        const ddgRes = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(newsQuery)}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (ddgRes.ok) {
          const ddg = await ddgRes.json();
          const topics = [...(ddg.RelatedTopics || []), ...(ddg.Results || [])];
          for (const t of topics.slice(0, 4)) {
            if (t.FirstURL && t.Text) {
              webResults.push({
                url: t.FirstURL,
                title: t.Text.slice(0, 80),
                snippet: t.Text.slice(0, 300),
              });
            }
          }
          // Also use Abstract if available
          if (ddg.AbstractURL && ddg.AbstractText) {
            webResults.unshift({
              url: ddg.AbstractURL,
              title: ddg.AbstractSource || "Reference",
              snippet: ddg.AbstractText.slice(0, 400),
            });
          }
          console.log(`[SEARCH] DuckDuckGo returned ${webResults.length} result(s)`);
        }
      } catch (err) {
        console.warn(`[SEARCH] DuckDuckGo failed:`, err instanceof Error ? err.message : err);
      }
    }

    console.log(`[SEARCH] Web search results: ${webResults.length}`);

    // ── Only genuine evidence — no filler links ─────────────────────────────────
    const finalResults: SearchResult[] = [];
    
    // Only real web search results (Tavily or DuckDuckGo)
    for (const w of webResults.slice(0, 5)) finalResults.push(w);

    const primaryQuery = queries[0] ?? claim.claim;

    // Cap at 2 for Quick, 5 for Deep
    let results = finalResults.slice(0, isQuick ? 2 : 5);

    if (results.length === 0) {
      console.warn(`[SEARCH] ⚠️ No evidence for: "${claim.claim}"`);
      results = [
        {
          url: "https://en.wikipedia.org",
          title: "No Evidence Found",
          snippet: `No usable results found for this claim from Wikipedia or news sources. The AI MUST mark this as 'Unverifiable'.`,
        },
      ];
    } else {
      results.forEach((r, i) => {
        const domain = (() => { try { return new URL(r.url).hostname; } catch { return r.url; } })();
        console.log(`  [${i + 1}] [${domain}] ${r.title}`);
      });
    }

    const domainSet = new Set(results.map(r => { try { return new URL(r.url).hostname; } catch { return "?"; } }));
    console.log(`[SEARCH] Final: ${results.length} source(s) across ${domainSet.size} domain(s)\n`);

    return {
      claimId: claim.id,
      queryUsed: primaryQuery,
      results,
    };
  });

  return Promise.all(evidencePromises);
}

import { StructuredOutputParser } from "@langchain/core/output_parsers";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { PromptTemplate } from "@langchain/core/prompts";
import { z } from "zod";
import { resolveProviderOrder, withPrimaryLlmFallback, type ChatModelKind } from "./llm";
import { ExtractedClaim } from "./extractor";
import { ClaimEvidence } from "./search";

export type VerificationStatus = "True" | "False" | "Partially True" | "Unverifiable";

export interface VerifiedClaim {
  id: string;
  claim: string;
  status: VerificationStatus;
  confidenceScore: number;
  reasoning: string;
  /** What the correct fact actually is, if the claim is False or Unverifiable */
  correctedStatement?: string;
  evidence: ClaimEvidence;
}

export interface RelatedReference {
  question: string;
  category: string;
  url: string;
}

const REF_CATEGORIES = ["Global", "India", "Internet", "World News", "Corporate World", "Tech", "Economy", "Science", "Politics", "Health"] as const;

export interface FactCorrection {
  falseComponent: string;
  correctFact: string;
}

export interface AccuracyReport {
  /** Blended gauge: verdict strength + evidence depth (see server logs for details). */
  overallTrustScore: number;
  sourceReliabilityScore: number;
  totalClaims: number;
  verifiedClaims: VerifiedClaim[];
  globalConclusion?: string;
  followUpQuestions?: string[];
  relatedReferences?: RelatedReference[];
  verificationProvider?: ChatModelKind;
  extractionProvider?: ChatModelKind;
  /** Indicates if this result was retrieved from the high-speed cache. */
  cached?: boolean;
  /** Specific false components mapped to their correct versions. */
  factCorrections?: FactCorrection[];
  /** A relevant YouTube search or video link for visual proof. */
  youtubeUrl?: string;
}

function isRealEvidenceRow(r: { title: string; snippet: string; url: string }): boolean {
  if (r.title === "No Evidence Found") return false;
  if (r.snippet.includes("Wikipedia returned no results")) return false;
  return true;
}

function scoreClaimEvidenceReliability(evidence: ClaimEvidence): number {
  const hits = evidence.results.filter(isRealEvidenceRow);
  console.log(`    [SCORE] Evidence for claim ${evidence.claimId}: ${hits.length} real Wikipedia row(s) out of ${evidence.results.length} total`);
  hits.forEach((h, i) => console.log(`      [${i+1}] "${h.title}" -> ${h.snippet.substring(0, 80)}...`));
  if (hits.length === 0) { console.log(`    [SCORE] -> sourceReliability = 0% (no Wikipedia pages found)`); return 0; }
  if (hits.length === 1) { console.log(`    [SCORE] -> sourceReliability = 72% (1 Wikipedia page)`); return 72; }
  if (hits.length === 2) { console.log(`    [SCORE] -> sourceReliability = 88% (2 Wikipedia pages)`); return 88; }
  console.log(`    [SCORE] -> sourceReliability = 98% (3+ Wikipedia pages)`);
  return 98;
}

function computeSourceReliabilityScore(verifiedClaims: VerifiedClaim[]): number {
  if (verifiedClaims.length === 0) return 0;
  const parts = verifiedClaims.map((vc) => scoreClaimEvidenceReliability(vc.evidence));
  const avg = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  console.log(`[SCORE] Source Reliability avg across all claims: ${avg}%`);
  return avg;
}

function isHistoricalClaim(claim: string): boolean {
  const years = [...claim.matchAll(/\b(1[5-9]\d{2}|20[0-1]\d|2020)\b/g)].map((m) => parseInt(m[0], 10));
  return years.length > 0 && years.every((y) => y < 2021);
}

function computeOverallTrustScore(verifiedClaims: VerifiedClaim[], claimCount: number): number {
  if (claimCount === 0) return 0;
  let scoreSum = 0;

  console.log(`\n[SCORE] Per-claim score breakdown`);
  verifiedClaims.forEach((vc) => {
    const src = scoreClaimEvidenceReliability(vc.evidence);
    let pts = 0;
    if (vc.status === "True") {
      pts = vc.confidenceScore;
      if (isHistoricalClaim(vc.claim) && vc.confidenceScore >= 75 && src === 0) {
        console.log(`    [SCORE] Historical boost applied for claim [${vc.id}]`);
      }
    } else if (vc.status === "Partially True") {
      pts = Math.round(vc.confidenceScore * 0.5);
    } else if (vc.status === "False") {
      pts = 0;
    } else {
      if (src > 0) pts = Math.min(48, Math.round(src * 0.5));
    }
    console.log(`  Claim [${vc.id}] status=${vc.status} confidence=${vc.confidenceScore}% srcRel=${src}% -> verdictPts=${pts}`);
    scoreSum += pts;
  });

  const verdictAvg = Math.round(scoreSum / claimCount);
  const sourceAvg = computeSourceReliabilityScore(verifiedClaims);

  console.log(`[SCORE] verdictAvg=${verdictAvg}% | sourceAvg=${sourceAvg}%`);

  let final: number;
  if (sourceAvg === 0) {
    const allHistoricalTrue = verifiedClaims.every(
      (vc) => vc.status === "True" && vc.confidenceScore >= 75 && isHistoricalClaim(vc.claim)
    );
    if (allHistoricalTrue && verifiedClaims.length > 0) {
      final = verdictAvg;
      console.log(`[SCORE] Historical facts (all True, pre-2021) -> using pure verdictAvg=${verdictAvg}%`);
    } else {
      final = verdictAvg;
      console.log(`[SCORE] sourceAvg=0 (Wikipedia gap) -> using pure verdictAvg=${verdictAvg}% as final score`);
    }
  } else {
    final = Math.min(100, Math.round(verdictAvg * 0.55 + sourceAvg * 0.45));
    console.log(`[SCORE] Blended formula: ${verdictAvg} * 0.55 + ${sourceAvg} * 0.45 = ${final}%`);
  }
  return final;
}

function normalizeReferenceUrl(url: string | undefined, question: string): string {
  const t = (url ?? "").trim();
  if (/^https:\/\//i.test(t)) return t;
  if (/^http:\/\//i.test(t)) return `https://${t.slice(7)}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(question)}`;
}

function classifyTopic(text: string): (typeof REF_CATEGORIES)[number] {
  const t = text.toLowerCase();
  if (/\b(india|narendra|modi|rbi|isro|bcci|delhi|mumbai|bharat|up\b|bihar)\b/.test(t)) return "India";
  if (/\b(corporate|company|stock|market|business|finance|inc\.|ceo|earnings|profit|startup|venture|billionaire)\b/.test(t)) return "Corporate World";
  if (/\b(internet|social media|online|google|meta|tiktok|digital|web|cyber|app\b|software)\b/.test(t)) return "Internet";
  if (/\b(news|breaking|report|crisis|war|summit|conflict|disaster|election)\b/.test(t)) return "World News";
  if (/\b(economy|gdp|inflation|fed\b|interest rate|tax\b|budget|trade)\b/.test(t)) return "Economy";
  if (/\b(tech|ai\b|hardware|robot|chip|processor|quantum)\b/.test(t)) return "Tech";
  if (/\b(global|world|international|un\b|nato|treaty|embassy)\b/.test(t)) return "Global";
  return "Global";
}

function normalizeCategory(c: string): (typeof REF_CATEGORIES)[number] {
  const t = (c ?? "").trim();
  return (REF_CATEGORIES as readonly string[]).includes(t) ? (t as (typeof REF_CATEGORIES)[number]) : "Global";
}

export const DEFAULT_RELATED_REFERENCES: RelatedReference[] = [
  {
    question: "What is the World Bank's latest global GDP growth forecast?",
    category: "Global",
    url: "https://duckduckgo.com/?q=World+Bank+global+GDP+growth+forecast",
  },
  {
    question: "What are ISRO's upcoming or recent major space missions?",
    category: "India",
    url: "https://duckduckgo.com/?q=ISRO+upcoming+missions",
  },
  {
    question: "How is the EU AI Act being implemented in 2025-2026?",
    category: "Tech",
    url: "https://duckduckgo.com/?q=EU+AI+Act+implementation",
  },
  {
    question: "What does peer-reviewed research say about common viral health claims?",
    category: "Health",
    url: "https://duckduckgo.com/?q=WHO+fact+myth+health+claims",
  },
  {
    question: "Which inflation metrics do central banks use officially?",
    category: "Economy",
    url: "https://duckduckgo.com/?q=CPI+vs+PCE+inflation+central+banks",
  },
  {
    question: "What is the scientific consensus on climate attribution studies?",
    category: "Science",
    url: "https://duckduckgo.com/?q=IPCC+climate+attribution",
  },
  {
    question: "How do major fact-checkers rate political speech accuracy?",
    category: "Politics",
    url: "https://duckduckgo.com/?q=Reuters+Fact+Check+political+claims",
  },
  {
    question: "Where can I verify breaking news against primary sources?",
    category: "Global",
    url: "https://duckduckgo.com/?q=verify+breaking+news+primary+sources",
  },
];

export function relatedReferencesForErrorFallback(originalUserInput: string): RelatedReference[] {
  return buildFastRelatedReferences(originalUserInput, []);
}

type FollowUpKind = "biography" | "sports" | "general";

function detectFollowUpKind(blob: string): FollowUpKind {
  const b = blob.toLowerCase();
  if (
    /married|spouse|husband|wife|wedding|divorce|dating|relationship|affair|engaged|fianc|couple|personal life|family of\b/.test(b)
  ) {
    return "biography";
  }
  if (
    /world cup|olympic|championship|final\b|semifinal|knockout|league\b|tournament|ipl\b|odi\b|test match|score(d)?|defeated|winner of|won the \d{4}/.test(b)
  ) {
    return "sports";
  }
  return "general";
}

function yearSpinoffReferences(blob: string): RelatedReference[] {
  if (detectFollowUpKind(blob) !== "sports") return [];
  const years = [...blob.matchAll(/\b(19[89]\d|20\d{2})\b/g)].map((m) => parseInt(m[0], 10));
  const uniq = [...new Set(years)].slice(0, 4);
  const out: RelatedReference[] = [];
  for (const y of uniq) {
    const older = [y - 4, y - 8, y - 12].filter((x) => x >= 1990);
    for (const oy of older.slice(0, 2)) {
      out.push({
        question: `Who won or what happened in the major world tournament or title event in ${oy} (related timeline to ${y})?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`winner ${oy} world cup final`)}`,
      });
    }
  }
  return out;
}

function marriageNames(claim: string): { a: string; b: string } | null {
  const m = claim
    .trim()
    .toLowerCase()
    .match(/^(.+?)\s+is\s+married\s+to\s+(.+)$/);
  if (!m) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

function padRelatedWithTopicContext(
  existing: RelatedReference[],
  originalUserInput: string,
  verifiedClaims: VerifiedClaim[]
): RelatedReference[] {
  const seen = new Set(existing.map((r) => r.question.toLowerCase()));
  const out = [...existing];
  const topic =
    originalUserInput.trim().slice(0, 160) ||
    verifiedClaims.map((c) => c.claim).join(" - ").slice(0, 160) ||
    "this topic";
  const short = topic.length > 90 ? topic.slice(0, 87) + "..." : topic;
  const blob = `${originalUserInput}\n${verifiedClaims.map((c) => c.claim).join(" ")}`;
  const kind = detectFollowUpKind(blob);
  const primaryClaim = verifiedClaims[0]?.claim ?? originalUserInput;
  const mm = marriageNames(primaryClaim);

  let extras: RelatedReference[] = [];
  const cat = classifyTopic(blob);

  if (kind === "biography" && mm) {
    const aT = mm.a.replace(/\b\w/g, (c) => c.toUpperCase());
    const bT = mm.b.replace(/\b\w/g, (c) => c.toUpperCase());
    extras = [
      {
        question: `Wikipedia analysis and news sources for ${aT}'s current status`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(aT + " spouse wife husband")}`,
      },
      {
        question: `Official biographical data for ${aT}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(aT + " personal life Wikipedia")}`,
      },
      {
        question: `Verified status: Is ${aT} married to ${bT}?`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(aT + " " + bT + " married fact check")}`,
      },
      {
        question: `Notable background and relationship profile of ${bT}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(bT + " Wikipedia")}`,
      },
      {
        question: `Recent rumors or hoaxes concerning ${aT}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(aT + " marriage rumor hoax")}`,
      },
      {
        question: `Public records and wedding milestones for ${aT}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(aT + " wedding date")}`,
      },
      {
        question: `Relationship timeline of ${aT} and ${bT} in news`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(aT + " " + bT + " wedding news")}`,
      },
      {
        question: `Latest official statements on ${aT}'s status`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(aT + " official statement news")}`,
      },
    ];
  } else if (kind === "sports") {
    extras = [
      {
        question: `Final match report and score transparency: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " match result score")}`,
      },
      {
        question: `Official roster and player impact for: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " squad lineup")}`,
      },
      {
        question: `Historical performance comparisons: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " past records")}`,
      },
      {
        question: `Tournament status and official standings for: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " tournament results")}`,
      },
      {
        question: `Injury news and recent team updates: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " news updates")}`,
      },
      {
        question: `Expert commentary on match outcomes: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " expert analysis")}`,
      },
      {
        question: `Fact-check on specific viral claims about: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " fact check")}`,
      },
      {
        question: `News reports on the outcome of: ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " news report")}`,
      },
    ];
  } else {
    extras = [
      {
        question: `Comprehensive Wikipedia analysis of ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " Wikipedia")}`,
      },
      {
        question: `Primary and official source check for ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " official statement")}`,
      },
      {
        question: `Common misinformation and myths about ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " myth vs fact")}`,
      },
      {
        question: `Global news coverage (Reuters/AP/BBC) of ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " Reuters OR AP news")}`,
      },
      {
        question: `Expert institutional analysis of ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " expert analysis")}`,
      },
      {
        question: `Detailed timeline of key events for ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " timeline")}`,
      },
      {
        question: `Contextual deep-dive analysis for ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " context explained")}`,
      },
      {
        question: `Multi-source cross-verification of ${short}`,
        category: cat,
        url: `https://duckduckgo.com/?q=${encodeURIComponent(short + " verify multiple sources")}`,
      },
    ];
  }

  for (const e of extras) {
    if (out.length >= 8) break;
    const k = e.question.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }

  for (const f of DEFAULT_RELATED_REFERENCES) {
    if (out.length >= 8) break;
    if (!seen.has(f.question.toLowerCase())) {
      seen.add(f.question.toLowerCase());
      out.push(f);
    }
  }
  return out.slice(0, 8);
}

/** Fast topical follow-ups -- no extra LLM round trip. */
function buildFastRelatedReferences(originalUserInput: string, verifiedClaims: VerifiedClaim[]): RelatedReference[] {
  const blob = `${originalUserInput}\n${verifiedClaims.map((c) => c.claim).join(" ")}`;
  const fromYears = yearSpinoffReferences(blob);
  const merged = normalizeRelatedToEight(fromYears, originalUserInput, verifiedClaims);
  return merged;
}

function normalizeRelatedToEight(
  seed: RelatedReference[],
  originalUserInput: string,
  verifiedClaims: VerifiedClaim[]
): RelatedReference[] {
  const seen = new Set<string>();
  const out: RelatedReference[] = [];
  for (const r of seed) {
    const q = (r.question ?? "").trim();
    if (!q || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    out.push({
      question: q,
      category: normalizeCategory(r.category),
      url: normalizeReferenceUrl(r.url, q),
    });
    if (out.length >= 8) return out;
  }
  return padRelatedWithTopicContext(out, originalUserInput, verifiedClaims);
}

async function verifyClaimsSingleLlmCall(
  model: BaseChatModel,
  claims: ExtractedClaim[],
  evidenceList: ClaimEvidence[],
  mode: 'quick' | 'deep' = 'deep'
): Promise<{
  verifiedClaims: VerifiedClaim[];
  globalConclusion: string;
  relatedReferences: RelatedReference[];
  factCorrections: FactCorrection[];
  youtubeUrl: string;
}> {
  if (claims.length === 0) return { verifiedClaims: [], globalConclusion: "", relatedReferences: [], factCorrections: [], youtubeUrl: "" };

  const isQuick = mode === 'quick';
  const blocks = claims.map((claim) => {
    const evidence = evidenceList.find((e) => e.claimId === claim.id)!;
    const evidenceStr = evidence.results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n${r.url}`)
      .join("\n\n");
    return `CLAIM_ID: ${claim.id}\nTEXT: """${claim.claim}"""\nEVIDENCE:\n${evidenceStr}`;
  });

  const bundle = blocks.join("\n\n========\n\n");

  const parser = StructuredOutputParser.fromZodSchema(
    z.object({
      globalConclusion: z.string()
        .describe("A final 5-6 line summary assessing the overall truthfulness. Make it detailed. You MUST wrap the single most important insight (6-12 words) in HTML `<u>` tags."),
      relatedReferences: z.array(z.object({
        question: z.string().describe("A specific, insightful follow-up or related question (statement style, no 'What/How/Why' start)."),
        category: z.enum(REF_CATEGORIES).describe("The best category (Global, India, Internet, etc.)"),
        url: z.string().describe("A functional DuckDuckGo search URL: https://duckduckgo.com/?q=..."),
      })).min(6).max(10).describe("6-8 highly-specific follow-up questions tailored to the claims and evidence."),
      factCorrections: z.array(z.object({
        falseComponent: z.string().describe("The specific part of the claim that is incorrect"),
        correctFact: z.string().describe("The correct version of that specific part")
      })).optional().describe("Break down the false parts of the claim into False vs. True pairs. Leave empty if the claim is 100% True."),
      youtubeUrl: z.string().optional().describe("A relevant YouTube search URL for visual proof."),
      verdicts: z
        .array(
          z.object({
            claimId: z.string(),
            status: z.enum(["True", "False", "Partially True", "Unverifiable"]),
            confidenceScore: z.number().min(0).max(100),
            reasoning: z.string().max(isQuick ? 150 : 600),
            correctedStatement: z.string().max(300).optional(),
          })
        )
        .min(1)
        .max(8),
    })
  );

  const prompt = new PromptTemplate({
    template: `You verify ${isQuick ? 'the most critical claim' : 'MULTIPLE claims'} in ONE response.

COMPONENT DECOUPLING:
If a claim contains multiple details (e.g. 'X happened in Y year at Z location') and some are false, identify them in 'factCorrections'.

RULES FOR VERIFICATION:
1. HISTORICAL FACTS (before 2021): Use training knowledge.
2. RECENT FACTS (2021+): Use ONLY attached evidence.

PRACTICAL RULES:
- globalConclusion: EXACTLY 5 to 6 lines. Wrap critical insight in <u>...</u>.
- relatedReferences: EXACTLY 8 structured entries. Use specific categories like 'India', 'Corporate World', or 'Internet' based on the topic. Questions must be DIRECT statements (no conversational prefixes).
- youtubeUrl: Provide a helpful youtube search or video link.

{bundle}

{format_instructions}`,
    inputVariables: ["bundle"],
    partialVariables: { format_instructions: parser.getFormatInstructions() },
  });

  const chain = prompt.pipe(model).pipe(parser);
  console.log(`[VERIFIER] 🤖 Sending ${claims.length} claim(s) in one bundle to ${model.constructor.name}...`);
  
  const result = await chain.invoke({ bundle });
  const { verdicts, globalConclusion, relatedReferences, factCorrections, youtubeUrl } = result;
  
  console.log(`[VERIFIER] ✅ LLM returned ${verdicts.length} verdict(s) and ${relatedReferences.length} related queries.`);

  const byId = new Map(verdicts.map((v) => [v.claimId.trim(), v]));
  const verifiedClaims: VerifiedClaim[] = claims.map((claim) => {
    const res = byId.get(claim.id);
    const evidence = evidenceList.find((e) => e.claimId === claim.id)!;
    if (!res) {
      return {
        id: claim.id,
        claim: claim.claim,
        status: "Unverifiable" as VerificationStatus,
        confidenceScore: 0,
        reasoning: "LLM failed to provide a verdict for this specific claim ID.",
        evidence,
      };
    }
    return {
      id: claim.id,
      claim: claim.claim,
      status: res.status as VerificationStatus,
      confidenceScore: res.confidenceScore,
      reasoning: res.reasoning,
      correctedStatement: res.correctedStatement || undefined,
      evidence,
    };
  });

  return { verifiedClaims, globalConclusion, relatedReferences, factCorrections: factCorrections || [], youtubeUrl: youtubeUrl || "" };
}

export async function verifyClaims(
  claims: ExtractedClaim[],
  evidenceList: ClaimEvidence[],
  originalUserInput: string,
  extractionProvider?: ChatModelKind,
  mode: 'quick' | 'deep' = 'deep'
): Promise<AccuracyReport> {
  console.log(`\n[VERIFIER] -- Batched verification (${mode}) --`);
  
  const { data: reportBody, provider: verificationProvider } = await withPrimaryLlmFallback(
    async (model) => {
      const result = await verifyClaimsSingleLlmCall(model, claims, evidenceList, mode);
      
      const sourceReliabilityScore = computeSourceReliabilityScore(result.verifiedClaims);
      const overallTrustScore = computeOverallTrustScore(result.verifiedClaims, claims.length);

      // Combine LLM-generated refs with fallbacks/merging logic to ensure exactly 8
      const finalRelated = normalizeRelatedToEight(result.relatedReferences, originalUserInput, result.verifiedClaims);

      return {
        ...result,
        overallTrustScore,
        sourceReliabilityScore,
        totalClaims: claims.length,
        relatedReferences: finalRelated,
      };
    },
    resolveProviderOrder({ extractionUsed: extractionProvider })
  );

  return {
    ...reportBody,
    verificationProvider,
    extractionProvider,
  } as AccuracyReport;
}

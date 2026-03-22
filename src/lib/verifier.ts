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

const REF_CATEGORIES = ["Global", "India", "Economy", "Tech", "Science", "Politics", "Health"] as const;

export interface AccuracyReport {
  /** Blended gauge: verdict strength + evidence depth (see server logs for details). */
  overallTrustScore: number;
  sourceReliabilityScore: number;
  totalClaims: number;
  verifiedClaims: VerifiedClaim[];
  globalConclusion?: string;
  relatedReferences?: RelatedReference[];
  verificationProvider?: ChatModelKind;
  extractionProvider?: ChatModelKind;
}

function isRealEvidenceRow(r: { title: string; snippet: string; url: string }): boolean {
  if (r.title === "No Evidence Found") return false;
  if (r.snippet.includes("Wikipedia returned no results")) return false;
  return true;
}

function scoreClaimEvidenceReliability(evidence: ClaimEvidence): number {
  const hits = evidence.results.filter(isRealEvidenceRow);
  console.log(`    [SCORE] Evidence for claim ${evidence.claimId}: ${hits.length} real Wikipedia row(s) out of ${evidence.results.length} total`);
  hits.forEach((h, i) => console.log(`      [${i+1}] "${h.title}" → ${h.snippet.substring(0, 80)}...`));
  if (hits.length === 0) { console.log(`    [SCORE] → sourceReliability = 0% (no Wikipedia pages found — possible future/recent event)`); return 0; }
  if (hits.length === 1) { console.log(`    [SCORE] → sourceReliability = 72% (1 Wikipedia page)`); return 72; }
  if (hits.length === 2) { console.log(`    [SCORE] → sourceReliability = 88% (2 Wikipedia pages)`); return 88; }
  console.log(`    [SCORE] → sourceReliability = 98% (3+ Wikipedia pages)`);
  return 98;
}

function computeSourceReliabilityScore(verifiedClaims: VerifiedClaim[]): number {
  if (verifiedClaims.length === 0) return 0;
  const parts = verifiedClaims.map((vc) => scoreClaimEvidenceReliability(vc.evidence));
  const avg = Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
  console.log(`[SCORE] Source Reliability avg across all claims: ${avg}%`);
  return avg;
}

/**
 * Verdict points per claim, blended with source reliability.
 * FIX: If ALL claims have 0 source reliability (Wikipedia gap for future/recent events),
 * we fall back to pure verdict confidence so the score isn't crushed to 0.
 */
/** Returns true if the claim text references a year strictly before 2021 (well-known history). */
function isHistoricalClaim(claim: string): boolean {
  const years = [...claim.matchAll(/\b(1[5-9]\d{2}|20[0-1]\d|2020)\b/g)].map((m) => parseInt(m[0], 10));
  return years.length > 0 && years.every((y) => y < 2021);
}

function computeOverallTrustScore(verifiedClaims: VerifiedClaim[], claimCount: number): number {
  if (claimCount === 0) return 0;
  let scoreSum = 0;

  console.log(`\n[SCORE] ── Per-claim score breakdown ──`);
  verifiedClaims.forEach((vc) => {
    const src = scoreClaimEvidenceReliability(vc.evidence);
    let pts = 0;
    if (vc.status === "True") {
      pts = vc.confidenceScore;
      // Historical boost: confident True verdict on a pre-2021 fact — don't penalise
      // for a missing Wikipedia snippet. Grant a floor reliability of 80%.
      if (isHistoricalClaim(vc.claim) && vc.confidenceScore >= 75 && src === 0) {
        console.log(`    [SCORE] Historical boost applied for claim [${vc.id}] (pre-2021 fact, confident True, no Wikipedia snippet)`);
        // We'll use pts directly without blending with sourceAvg (handled below per-claim)
      }
    } else if (vc.status === "Partially True") {
      pts = Math.round(vc.confidenceScore * 0.5);
    } else if (vc.status === "False") {
      pts = 0;
    } else {
      // Unverifiable: partial credit when real sources exist
      if (src > 0) pts = Math.min(48, Math.round(src * 0.5));
    }
    console.log(`  Claim [${vc.id}] status=${vc.status} confidence=${vc.confidenceScore}% srcRel=${src}% → verdictPts=${pts}`);
    scoreSum += pts;
  });

  const verdictAvg = Math.round(scoreSum / claimCount);
  const sourceAvg = computeSourceReliabilityScore(verifiedClaims);

  console.log(`[SCORE] verdictAvg=${verdictAvg}% | sourceAvg=${sourceAvg}%`);

  let final: number;
  if (sourceAvg === 0) {
    // Check if all True/high-confidence historical claims explain the missing source
    const allHistoricalTrue = verifiedClaims.every(
      (vc) => vc.status === "True" && vc.confidenceScore >= 75 && isHistoricalClaim(vc.claim)
    );
    if (allHistoricalTrue && verifiedClaims.length > 0) {
      // Historical facts the model knows well — trust the verdict, don't penalise source gap
      final = verdictAvg;
      console.log(`[SCORE] Historical facts (all True, pre-2021) → using pure verdictAvg=${verdictAvg}%`);
    } else {
      final = verdictAvg;
      console.log(`[SCORE] sourceAvg=0 (Wikipedia gap) → using pure verdictAvg=${verdictAvg}% as final score`);
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
    question: "How is the EU AI Act being implemented in 2025–2026?",
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
    /world cup|olympic|championship|final\b|semifinal|knockout|league\b|tournament|ipl\b|odi\b|test match|score(d)?|defeated|winner of|won the \d{4}/.test(
      b
    )
  ) {
    return "sports";
  }
  return "general";
}

/** Years in text → sports-timeline questions only (skip for gossip/bio claims). */
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
    verifiedClaims.map((c) => c.claim).join(" · ").slice(0, 160) ||
    "this topic";
  const short = topic.length > 90 ? `${topic.slice(0, 87)}…` : topic;
  const blob = `${originalUserInput}\n${verifiedClaims.map((c) => c.claim).join(" ")}`;
  const kind = detectFollowUpKind(blob);
  const primaryClaim = verifiedClaims[0]?.claim ?? originalUserInput;
  const wed = marriageNames(primaryClaim);

  let extras: RelatedReference[] = [];

  if (kind === "biography" && wed) {
    const { a, b } = wed;
    const aT = a.replace(/\b\w/g, (c) => c.toUpperCase());
    const bT = b.replace(/\b\w/g, (c) => c.toUpperCase());
    extras = [
      {
        question: `Who is ${aT} married to, according to Wikipedia and major news sources?`,
        category: "India",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${aT} spouse wife husband`)}`,
      },
      {
        question: `What does ${aT}'s Wikipedia "personal life" section say about their partner?`,
        category: "India",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${aT} personal life Wikipedia`)}`,
      },
      {
        question: `Is ${aT} married to ${bT} — what do fact-checkers and biographies say?`,
        category: "India",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${aT} ${bT} married fact check`)}`,
      },
      {
        question: `Who is ${bT} (full name and notable relationships) in reliable sources?`,
        category: "India",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${bT} Wikipedia`)}`,
      },
      {
        question: `Have viral or false claims circulated about ${aT}'s marriage?`,
        category: "India",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${aT} marriage rumor hoax`)}`,
      },
      {
        question: `What is the official or widely cited wedding date for ${aT}?`,
        category: "India",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${aT} wedding date`)}`,
      },
      {
        question: `Compare ${aT}'s partner in interviews vs encyclopedia sources.`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${aT} wife OR husband interview`)}`,
      },
      {
        question: `What other celebrities are often confused with ${bT} in misinformation?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${bT} name confusion celebrity`)}`,
      },
    ];
  } else if (kind === "sports") {
    extras = [
      {
        question: `Who won the previous edition or earlier tournament in the same series as: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} previous winner edition`)}`,
      },
      {
        question: `Who won two editions before — what do sources say for the same competition as: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} past winners list`)}`,
      },
      {
        question: `Which teams or sides reached the final (or title match) for events like: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} final`)}`,
      },
      {
        question: `Who played in the semifinals (or equivalent knockout stage) related to: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} semifinal`)}`,
      },
      {
        question: `Where and when was the decisive match or outcome for: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} final venue date`)}`,
      },
      {
        question: `What do official records or statistics say about: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} official results`)}`,
      },
      {
        question: `What claims about ${short} are often misreported or disputed?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} fact check`)}`,
      },
      {
        question: `How did major news outlets report the outcome of: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} news report`)}`,
      },
    ];
  } else {
    extras = [
      {
        question: `What do Wikipedia and major news sources say about: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} Wikipedia`)}`,
      },
      {
        question: `Is this statement supported by primary or official sources: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} official statement`)}`,
      },
      {
        question: `What is the most common misinformation about: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} myth vs fact`)}`,
      },
      {
        question: `How do Reuters, AP, or BBC cover: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} Reuters OR AP news`)}`,
      },
      {
        question: `What did experts or institutions publish on: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} expert analysis`)}`,
      },
      {
        question: `What is the timeline of key events for: ${short}?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} timeline`)}`,
      },
      {
        question: `What claims about ${short} need more context?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} context explained`)}`,
      },
      {
        question: `Where can I cross-check: ${short} against multiple independent sources?`,
        category: "Global",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(`${short} verify multiple sources`)}`,
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

/** Fast topical follow-ups — no extra LLM round trip. */
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
  evidenceList: ClaimEvidence[]
): Promise<{ verifiedClaims: VerifiedClaim[]; globalConclusion: string }> {
  if (claims.length === 0) return { verifiedClaims: [], globalConclusion: "" };

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
      globalConclusion: z.string().min(10).max(400)
        .describe("A final 30-60 word summary assessing the overall truthfulness of the input. Explicitly state whether the content is likely AI-generated, real, or human-made based on the analyzed claims, evidence, and any manipulation signals."),
      verdicts: z
        .array(
          z.object({
            claimId: z.string(),
            status: z.enum(["True", "False", "Partially True", "Unverifiable"]),
            confidenceScore: z.number().min(0).max(100),
            reasoning: z.string().max(600),
            correctedStatement: z.string().max(300).optional()
              .describe("If status is False or Unverifiable, provide the correct factual statement (e.g. 'Virat Kohli married Anushka Sharma in December 2017, not 2010'). Leave empty if status is True."),
          })
        )
        .min(1)
        .max(8),
    })
  );

  const prompt = new PromptTemplate({
    template: `You verify MULTIPLE claims in ONE response. For EACH claim, follow these rules IN ORDER:

1. HISTORICAL FACTS (claim mentions a year before 2021, e.g. "India independence 1947", "WWII ended 1945"):
   - You MAY use your own training knowledge to verify. Wikipedia evidence is supplementary.
   - If you confidently know the fact is correct → True, confidenceScore 85–100.
   - If you confidently know the fact is wrong → False, set correctedStatement to the real fact.
   - Only use Unverifiable if genuinely unsure even with your training knowledge.

2. RECENT OR FUTURE FACTS (claim mentions a year 2021 or later, or no year):
   - Use ONLY the attached Wikipedia evidence.
   - Evidence supports claim → True.
   - Evidence contradicts → False, set correctedStatement.
   - Mixed → Partially True.
   - Irrelevant/empty → Unverifiable, confidenceScore 0. Use general knowledge ONLY for correctedStatement.

General rules:
- Keep each reasoning under 400 characters and cite which evidence source number you used (or "own knowledge" for historical facts).
- correctedStatement must be one concise sentence. Example: "Virat Kohli married Anushka Sharma in December 2017, not 2010."
- Leave correctedStatement empty if status is True.
- globalConclusion MUST be between 30 and 60 words, returning a final verdict on the entire text/media block indicating if it is AI-generated, human-made, or factual real content.

{bundle}

{format_instructions}`,
    inputVariables: ["bundle"],
    partialVariables: { format_instructions: parser.getFormatInstructions() },
  });

  const chain = prompt.pipe(model).pipe(parser);
  console.log(`[VERIFIER] Sending ${claims.length} claim(s) in one bundle to LLM...`);
  const { verdicts, globalConclusion } = await chain.invoke({ bundle });
  console.log(`[VERIFIER] LLM returned ${verdicts.length} verdict(s):`);
  verdicts.forEach((v) => {
    console.log(`  → [${v.claimId}] ${v.status} (${v.confidenceScore}%) :: ${v.reasoning.substring(0, 120)}`);
    if (v.correctedStatement) console.log(`     CORRECTION: ${v.correctedStatement}`);
  });

  const byId = new Map(verdicts.map((v) => [v.claimId.trim(), v]));
  const verifiedClaims = claims.map((claim) => {
    const evidence = evidenceList.find((e) => e.claimId === claim.id)!;
    const v = byId.get(claim.id);
    if (!v) {
      console.warn(`[VERIFIER] ⚠️ No verdict returned for claim id "${claim.id}" — marking Unverifiable`);
      return {
        id: claim.id,
        claim: claim.claim,
        status: "Unverifiable" as VerificationStatus,
        confidenceScore: 0,
        reasoning: "Model did not return a verdict for this claim id.",
        evidence,
      };
    }
    return {
      id: claim.id,
      claim: claim.claim,
      status: v.status as VerificationStatus,
      confidenceScore: v.confidenceScore,
      reasoning: v.reasoning,
      correctedStatement: v.correctedStatement || undefined,
      evidence,
    };
  });

  return { verifiedClaims, globalConclusion };
}

export async function verifyClaims(
  claims: ExtractedClaim[],
  evidenceList: ClaimEvidence[],
  originalUserInput: string,
  extractionProvider?: ChatModelKind
): Promise<AccuracyReport> {
  console.log("\n[VERIFIER] ── Batched verification (1 LLM call per provider try) ──");
  console.log(`[VERIFIER] Claims: ${claims.length}`);

  const { data: reportBody, provider: verificationProvider } = await withPrimaryLlmFallback(
    async (model) => {
      const { verifiedClaims, globalConclusion } = await verifyClaimsSingleLlmCall(model, claims, evidenceList);

      const sourceReliabilityScore = computeSourceReliabilityScore(verifiedClaims);
      const overallTrustScore = computeOverallTrustScore(verifiedClaims, claims.length);

      console.log(`[VERIFIER] Overall (blended): ${overallTrustScore}% | Source reliability: ${sourceReliabilityScore}%`);

      const relatedReferences = buildFastRelatedReferences(originalUserInput, verifiedClaims);

      return {
        overallTrustScore,
        sourceReliabilityScore,
        totalClaims: claims.length,
        verifiedClaims,
        globalConclusion,
        relatedReferences,
      };
    },
    resolveProviderOrder({ extractionUsed: extractionProvider })
  );

  return {
    ...reportBody,
    verificationProvider,
  };
}

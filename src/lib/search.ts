import { ExtractedClaim } from "./extractor";
import { search } from "duck-duck-scrape";

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

export async function retrieveEvidence(claims: ExtractedClaim[]): Promise<ClaimEvidence[]> {
  const evidencePromises = claims.map(async (claim) => {
    // We formulate a simple fact-check query
    const queryUsed = `"${claim.claim}" fact check truth`;
    
    let results: SearchResult[] = [];
    try {
      // Fetch top 3 results from DuckDuckGo
      const searchResults = await search(queryUsed, { safeSearch: "off" });
      
      results = searchResults.results.slice(0, 3).map(res => ({
        url: res.url,
        title: res.title,
        snippet: res.description
      }));
    } catch (error) {
      console.error(`Error searching DuckDuckGo for query: ${queryUsed}`, error);
    }
    
    return {
      claimId: claim.id,
      queryUsed,
      results
    };
  });

  return Promise.all(evidencePromises);
}

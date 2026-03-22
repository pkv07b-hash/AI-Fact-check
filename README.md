# AI Fact-Checking Engine

An AI-driven fact-checking engine that extracts verifiable claims from text or URLs, autonomously searches the web for evidence using DuckDuckGo, and verifies the claims utilizing Google Gemini 1.5.

## Architecture & Tech Stack

- **Frontend & Backend**: Next.js (App Router), React, TypeScript
- **Styling**: Vanilla CSS (Premium, Glassmorphism Aesthetics)
- **AI Orchestration**: LangChain, initialized heavily across pipelines.
- **LLM**: Google Gemini (`@langchain/google-genai`)
- **Web Search API**: DuckDuckGo (`duck-duck-scrape`)
- **Schema Validation**: Zod

## Getting Started

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment Variables**
   Rename or create a `.env.local` file in the root directory and add your Google Gemini API key (primary). Optionally add a Groq key so the pipeline can fall back if Gemini fails or hits limits:
   ```env
   GEMINI_API_KEY=your_actual_key_here
   GROQ_API_KEY=your_groq_key_optional

   # Optional (defaults shown):
   # GEMINI_MODEL=gemini-2.5-flash
   # GROQ_MODEL=openai/gpt-oss-120b
   # PRIMARY_LLM=groq
   ```
   Get a Groq API key at [https://console.groq.com](https://console.groq.com).

   If Gemini returns **429 / quota exceeded**, set **`PRIMARY_LLM=groq`** so the app tries Groq first and skips the slow failing Gemini attempts. After extraction uses Groq, verification also prefers Groq automatically unless you set **`PRIMARY_LLM=gemini`**.

3. **Run the Development Server**
   ```bash
   npm run dev
   ```

4. **Open the Application**
   Navigate to [http://localhost:3000](http://localhost:3000)

## How It Works

1. **Claim Extraction**: The `extractor.ts` module parses the input and uses Gemini alongside a LangChain structured output parser to strictly identify individual, verifiable claims.
2. **Evidence Retrieval**: The `search.ts` module uses `duck-duck-scrape` to scrape search results related to each identified claim.
3. **Verification**: The `verifier.ts` module evaluates the initial claim against the retrieved search evidence, providing a True/False/Partially True verdict, a Confidence Score, and concise reasoning.

# AXIOM.AI — Forensic Truth Verification

A high-performance, resilient AI fact-checking engine designed for deep forensic analysis of text, URLs, and **PDF Documents**. Axiom identifies verifiable claims and cross-references them against real-time web evidence using a tiered API fallback system.

## 🚀 Key Features

- **Multimodal Forensics**: Scan Text, News Links, and **Native PDF Documents**.
- **3-Tier API Fallback**: Resilient pipeline that cascades between **Google Gemini 2.5 Flash**, **Groq (Llama 3.3)**, and **OpenAI (GPT-4o-mini)**.
- **Strict Verification Rules**: Enforces 6 forensic rules prioritizing **Relevance over Popularity** and requiring multiple reputable sources.
- **Deep Research Mode**: Uses **Tavily AI** for advanced, real-time web scraping and evidence gathering.
- **History Search & Ledger**: Real-time searchable history of all local fact-checks.
- **Report Export**: Download professional, standalone HTML verification reports with clickable links.

## 🛠 Architecture & Tech Stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Vanilla CSS (Premium Glassmorphism & Neon Aesthetics)
- **AI Orchestration**: LangChain Multi-Provider System
- **Intelligence**: 
  - **Primary**: Google Gemini 2.5 Flash
  - **Secondary**: Groq (Llama 3.3)
  - **Tertiary**: OpenAI (GPT-4o-mini)
- **Search Engine**: Tavily AI + DuckDuckScrape + Cheerio
- **Validation**: Zod (Type-safe forensic schemas)

## 🏁 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env.local` file in the root directory and add your API keys:
```env
# Required for primary verification
GEMINI_API_KEY=your_gemini_key

# Required for 3-tier fallback & high-speed extraction
GROQ_API_KEY=your_groq_key
OPENAI_API_KEY=your_openai_key

# Required for deep web research
TAVILY_API_KEY=your_tavily_key
```

### 3. Run Development Server
```bash
npm run dev
```

## 🧠 How It Works

1. **Smart Extraction**: The `extractor.ts` module uses Gemini 2.5 Flash (or Groq) to split inputs into distinct, verifiable claims while preserving original user context.
2. **Multi-Source Retrieval**: Use **Tavily** and **DuckDuckGo** to gather high-fidelity evidence directly related to the extracted subjects.
3. **Forensic Verification**: `verifier.ts` evaluates the claims against evidence shards using strict relevance filters, resulting in a **True**, **False**, **Misleading**, or **Unverifiable** verdict.

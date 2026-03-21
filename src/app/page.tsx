"use client";

import React, { useState } from 'react';
import Report from '@/components/Report';

type PipelineStep = 'idle' | 'extracting' | 'searching' | 'verifying' | 'complete' | 'error';

export default function Home() {
  const [input, setInput] = useState("");
  const [step, setStep] = useState<PipelineStep>("idle");
  const [reportData, setReportData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Reset state
    setReportData(null);
    setErrorMsg("");
    setStep("extracting");

    try {
      // We will mock the pipeline transition delays on the frontend just to ensure the UI feels dynamic
      // since our backend API currently does all steps sequentially and then returns.
      // In a real WebSocket or SSE setup, the backend would stream these state changes.
      
      // Fire API call
      const apiCall = fetch("/api/factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input })
      });

      // Optimistic UI updates to fake the pipeline process
      setTimeout(() => setStep(prev => prev === 'extracting' ? 'searching' : prev), 2500);
      setTimeout(() => setStep(prev => prev === 'searching' ? 'verifying' : prev), 5500);

      const res = await apiCall;
      if (!res.ok) {
        throw new Error("Failed to process request.");
      }
      
      const data = await res.json();
      setReportData(data);
      setStep("complete");
    } catch (err: any) {
      setErrorMsg(err.message || "Something went wrong.");
      setStep("error");
    }
  };

  return (
    <main className="main-container">
      <header className="hero">
        <div className="hero-badge">AI Fact-Checking Engine</div>
        <h1>
          Verify content with <span className="gradient-text">Absolute Certainty</span>.
        </h1>
        <p className="hero-subtitle">
          Paste an article, a viral social media post, or a URL to instantly extract claims, 
          retrieve real-world evidence, and generate a transparent accuracy report.
        </p>
      </header>

      <section className="input-section">
        <form onSubmit={handleAnalyze} className={`search-form glass-panel ${step !== 'idle' && step !== 'complete' && step !== 'error' ? 'processing' : ''}`}>
          <div className="input-wrapper">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <input 
              type="text" 
              placeholder="Paste text or URL here..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={step !== 'idle' && step !== 'complete' && step !== 'error'}
            />
          </div>
          <button 
            type="submit" 
            className="analyze-btn" 
            disabled={!input.trim() || (step !== 'idle' && step !== 'complete' && step !== 'error')}
          >
            {(step !== 'idle' && step !== 'complete' && step !== 'error') ? (
              <span className="spinner"></span>
            ) : "Analyze"}
          </button>
        </form>

        <div className="pipeline-indicator">
          <div className={`step ${step === 'extracting' || step === 'searching' || step === 'verifying' || step === 'complete' ? 'active' : ''}`}>
            <div className="step-icon">1</div>
            <span>Extract Claims</span>
          </div>
          <div className="step-connector"></div>
          <div className={`step ${step === 'searching' || step === 'verifying' || step === 'complete' ? 'active' : ''}`}>
            <div className="step-icon">2</div>
            <span>Find Evidence</span>
          </div>
          <div className="step-connector"></div>
          <div className={`step ${step === 'verifying' || step === 'complete' ? 'active' : ''}`}>
            <div className="step-icon">3</div>
            <span>Verify & Score</span>
          </div>
        </div>
      </section>

      {errorMsg && (
        <div className="error-message">
          <p>{errorMsg}</p>
        </div>
      )}

      {reportData && step === 'complete' && (
        <section className="results-section">
          <Report report={reportData} />
        </section>
      )}
    </main>
  );
}

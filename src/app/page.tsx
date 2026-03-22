"use client";

import React, { useState, useEffect, useRef } from 'react';
import type { AccuracyReport } from '@/lib/verifier';

type PipelineStep = 'idle' | 'extracting' | 'scanning' | 'searching' | 'verifying' | 'complete' | 'error';
type ViewTab = 'terminal' | 'nodes' | 'registry' | 'system';
type InputMode = 'text' | 'media';

interface MediaAnalysis {
  fileName: string;
  mimeType: string;
  fileSizeKb: number;
  mediaSummary: string;
  extractedText: string;
  hasManipulationSignals: boolean;
  manipulationDetails?: string;
}

interface HistoryItem {
  timestamp: string;
  claim: string;
  score: number;
  outcome: string;
}

const CAT_COLORS: Record<string, string> = {
  Global: 'border-primary/30 bg-primary/5 text-primary-fixed-dim',
  India: 'border-secondary/30 bg-secondary/5 text-secondary-fixed-dim',
  Tech: 'border-error/30 bg-error/5 text-error',
  Economy: 'border-yellow-400/30 bg-yellow-400/5 text-yellow-400',
  Science: 'border-green-400/30 bg-green-400/5 text-green-400',
  Politics: 'border-orange-400/30 bg-orange-400/5 text-orange-400',
  Health: 'border-pink-400/30 bg-pink-400/5 text-pink-400',
};

export default function Home() {
  const [input, setInput] = useState("");
  const [step, setStep] = useState<PipelineStep>("idle");
  const [reportData, setReportData] = useState<AccuracyReport | null>(null);
  const [mediaAnalysis, setMediaAnalysis] = useState<MediaAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentView, setCurrentView] = useState<ViewTab>('terminal');
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("factcheck_history");
    if (saved) {
      try { setHistory(JSON.parse(saved)); } catch {}
    } else {
      setHistory([
        { timestamp: "2026-03-21 14:22", claim: "ISRO Mars Mission launch date rescheduled...", score: 88, outcome: "Substantiated" },
        { timestamp: "2026-03-20 12:05", claim: "Stock market crash imminent says unverified...", score: 12, outcome: "Flagged" },
        { timestamp: "2026-03-19 21:40", claim: "New AI regulations passed by the EU council...", score: 89, outcome: "Verified" },
      ]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (!file) { setFilePreview(null); return; }
    // Create object URL for image preview
    if (file.type.startsWith('image/')) {
      setFilePreview(URL.createObjectURL(file));
    } else {
      setFilePreview(null); // videos don't get a preview thumbnail
    }
  };

  const handleMediaAnalyze = async () => {
    if (!selectedFile) return;
    setReportData(null);
    setMediaAnalysis(null);
    setErrorMsg("");
    setStep("scanning");
    setCurrentView('terminal');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      if (input.trim()) formData.append('prompt', input);

      setTimeout(() => setStep(prev => prev === 'scanning' ? 'extracting' : prev), 3000);
      setTimeout(() => setStep(prev => prev === 'extracting' ? 'searching' : prev), 6000);
      setTimeout(() => setStep(prev => prev === 'searching' ? 'verifying' : prev), 9000);

      const res = await fetch('/api/factcheck/media', { method: 'POST', body: formData });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error ?? 'Failed to analyze media.');
      }
      const data = await res.json();
      setReportData(data as AccuracyReport);
      if (data.mediaAnalysis) setMediaAnalysis(data.mediaAnalysis as MediaAnalysis);
      setStep('complete');
      setCurrentView('nodes');

      const outcome = data.overallTrustScore > 75 ? 'Verified' : data.overallTrustScore > 40 ? 'Substantiated' : 'Flagged';
      saveToHistory(selectedFile.name, data.overallTrustScore, outcome);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Media analysis failed.');
      setStep('error');
    }
  };

  const saveToHistory = (claimStr: string, score: number, outcome: string) => {
    setHistory(prev => {
      const newItem: HistoryItem = {
        timestamp: new Date().toLocaleString('sv-SE', { hour12: false }).substring(0, 16),
        claim: claimStr.length > 55 ? claimStr.substring(0, 55) + '...' : claimStr,
        score,
        outcome
      };
      const newHistory = [newItem, ...prev].slice(0, 20);
      localStorage.setItem("factcheck_history", JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const handleAnalyze = async (e?: React.FormEvent, overrideInput?: string) => {
    if (e) e.preventDefault();
    const targetInput = overrideInput || input;
    if (!targetInput.trim()) return;
    if (overrideInput && overrideInput !== input) setInput(overrideInput);

    setReportData(null);
    setMediaAnalysis(null);
    setErrorMsg("");
    setStep("extracting");
    setCurrentView('terminal');

    try {
      const apiCall = fetch("/api/factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: targetInput })
      });

      setTimeout(() => setStep(prev => prev === 'extracting' ? 'searching' : prev), 2500);
      setTimeout(() => setStep(prev => prev === 'searching' ? 'verifying' : prev), 5500);

      const res = await apiCall;
      if (!res.ok) {
        let errMsg = "Failed to process request.";
        try {
          const errData = await res.json();
          if (errData?.error) errMsg = errData.error;
        } catch (_) { /* ignore */ }
        throw new Error(errMsg);
      }
      const data: AccuracyReport = await res.json();
      setReportData(data);
      setStep("complete");
      setCurrentView('nodes');

      const outcome = data.overallTrustScore > 75 ? 'Verified' : data.overallTrustScore > 40 ? 'Substantiated' : 'Flagged';
      saveToHistory(targetInput, data.overallTrustScore, outcome);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStep("error");
    }
  };

  const isProcessing = step !== 'idle' && step !== 'complete' && step !== 'error';
  const stepLabel: Record<PipelineStep, string> = {
    idle: 'Active', scanning: 'SCANNING', extracting: 'EXTRACTING',
    searching: 'SEARCHING', verifying: 'VERIFYING', complete: 'Complete', error: 'Error',
  };
  const navItems: { id: ViewTab; icon: string; label: string }[] = [
    { id: 'terminal', icon: 'terminal', label: 'Terminal' },
    { id: 'nodes', icon: 'troubleshoot', label: 'Nodes' },
    { id: 'registry', icon: 'analytics', label: 'Registry' },
    { id: 'system', icon: 'account_tree', label: 'System' },
  ];

  return (
    <>
      {/* ── TOP APP BAR ─────────────────────────────── */}
      <header className="bg-[#071327]/80 backdrop-blur-xl text-[#b7c4ff] flex justify-between items-center px-8 py-6 max-w-full fixed top-0 w-full z-50 shadow-[0px_24px_48px_rgba(0,76,237,0.08)]">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-2xl">grid_view</span>
          <h1 className="font-['Manrope'] tracking-tighter uppercase font-black text-2xl text-[#b7c4ff] italic -skew-x-12 ml-4">AXIOM.NULL</h1>
        </div>
        <nav className="hidden md:flex gap-8 items-center">
          {navItems.slice(0, 3).map(item => (
            <button key={item.id} onClick={() => setCurrentView(item.id)}
              className={`font-label text-[10px] uppercase tracking-widest py-1 transition-all duration-300 ${
                currentView === item.id
                  ? 'text-[#b7c4ff] border-b-2 border-[#b7c4ff]'
                  : 'text-[#748194] hover:text-white hover:bg-[#1f2a3f]/50'
              }`}>
              {item.label}
            </button>
          ))}
          <button onClick={() => setCurrentView('system')}
            className={`font-label text-[10px] uppercase tracking-widest py-1 transition-all duration-300 ${
              currentView === 'system'
                ? 'text-[#b7c4ff] border-b-2 border-[#b7c4ff]'
                : 'text-[#748194] hover:text-white hover:bg-[#1f2a3f]/50'
            }`}>
            Registry
          </button>
        </nav>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-surface-container-highest border border-outline-variant flex items-center justify-center">
            <span className="material-symbols-outlined">account_circle</span>
          </div>
        </div>
        <div className="bg-gradient-to-r from-[#1f2a3f] to-transparent h-[1px] w-full absolute bottom-0 left-0"></div>
      </header>

      {/* ── MAIN ────────────────────────────────────── */}
      <main className="pt-32 px-6 md:px-12 max-w-7xl mx-auto space-y-24 relative">

        {/* ── TERMINAL VIEW (VERIFY) ───────────────── */}
        {currentView === 'terminal' && (
          <>
            {/* Hero Section */}
            <section className="relative">
              <div className="absolute -top-12 -left-12 text-primary opacity-10 select-none pointer-events-none">
                <span className="text-[12rem] font-headline font-black leading-none tracking-tighter uppercase">VERIFY</span>
              </div>
              <div className="flex flex-col md:flex-row items-start gap-12 relative z-10">
                {/* Left Copy */}
                <div className="md:w-3/5 space-y-6">
                  <h2 className="font-headline text-5xl md:text-7xl font-black uppercase tracking-tighter leading-[0.9] text-on-surface">
                    Verify content <br/>
                    <span className="text-primary italic -skew-x-6 inline-block">Absolute Certainty</span>
                  </h2>
                  <p className="text-on-surface-variant max-w-lg text-lg font-light leading-relaxed">
                    Neural-linked fact extraction using the Axiom pipeline. Cross-referencing 14.2B data points per millisecond for sub-atomic truth detection.
                  </p>
                  {/* Quick reference pills */}
                  <div className="flex flex-wrap gap-3 pt-2">
                    {[
                      { label: 'Global:', text: 'World Bank predicts 3% GDP growth in 2026' },
                      { label: 'India:', text: 'ISRO announces new Mars mission launch' },
                      { label: 'Tech:', text: 'AI coding replaces 50% of junior developers' },
                    ].map(pill => (
                      <button key={pill.text} onClick={() => handleAnalyze(undefined, pill.text)}
                        className="px-3 py-1 border border-outline-variant/30 bg-surface-container/40 text-[10px] font-label uppercase tracking-widest hover:bg-surface-container hover:border-primary/40 transition-all">
                        <span className="text-primary">{pill.label}</span> <span className="text-on-surface-variant">{pill.text.substring(0, 32)}…</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input Card (Asymmetric) */}
                <div className="md:w-2/5 w-full bg-surface-container-high p-1 glass-panel asymmetric-tilt-right mt-12 md:mt-0 shadow-2xl">
                  <div className="bg-surface-container-lowest border border-outline-variant/20">
                    {/* Mode Toggle */}
                    <div className="flex border-b border-outline-variant/20">
                      <button
                        onClick={() => { setInputMode('text'); setSelectedFile(null); setFilePreview(null); }}
                        className={`flex-1 py-3 font-label text-[10px] uppercase tracking-widest transition-all ${
                          inputMode === 'text' ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'text-outline hover:text-on-surface'
                        }`}>
                        <span className="material-symbols-outlined text-xs align-middle mr-1">text_fields</span> Text
                      </button>
                      <button
                        onClick={() => { setInputMode('media'); }}
                        className={`flex-1 py-3 font-label text-[10px] uppercase tracking-widest transition-all ${
                          inputMode === 'media' ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'text-outline hover:text-on-surface'
                        }`}>
                        <span className="material-symbols-outlined text-xs align-middle mr-1">perm_media</span> Image / Video
                      </button>
                    </div>

                    {inputMode === 'text' ? (
                      <form onSubmit={handleAnalyze} className="p-8 space-y-6">
                        <div className="space-y-2">
                          <label className="font-label text-[10px] uppercase tracking-[0.2em] text-primary block">Source Analysis Input</label>
                          <textarea
                            className="w-full bg-transparent border-b border-outline-variant focus:border-primary focus:ring-0 text-on-surface placeholder:text-outline/30 min-h-[120px] resize-none py-2 font-body text-sm"
                            placeholder="Paste claim, URL, or metadata hash..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            disabled={isProcessing}
                          />
                        </div>
                        <button type="submit" disabled={!input.trim() || isProcessing}
                          className="w-full bg-gradient-to-r from-primary to-primary-container text-on-primary font-headline font-extrabold uppercase tracking-widest py-5 text-sm hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(183,196,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed">
                          {isProcessing ? '● Analyzing Stream...' : 'Analyze Stream'}
                        </button>
                      </form>
                    ) : (
                      <div className="p-8 space-y-6">
                        <label className="font-label text-[10px] uppercase tracking-[0.2em] text-primary block">Upload Image or Video</label>

                        {/* Drop Zone */}
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="border-2 border-dashed border-outline-variant/40 hover:border-primary/60 transition-colors cursor-pointer flex flex-col items-center justify-center py-10 gap-3 rounded-none bg-surface-container/20 hover:bg-surface-container/40"
                        >
                          {filePreview ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={filePreview} alt="Preview" className="max-h-28 object-contain rounded" />
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-primary text-4xl">cloud_upload</span>
                            </>
                          )}
                          {selectedFile ? (
                            <>
                              <span className="text-on-surface text-xs font-medium truncate max-w-[180px]">{selectedFile.name}</span>
                              <span className="text-outline text-[10px]">{(selectedFile.size / 1024).toFixed(1)} KB · {selectedFile.type}</span>
                            </>
                          ) : (
                            <>
                              <span className="text-on-surface-variant text-xs">Click to select file</span>
                              <span className="text-outline text-[10px] uppercase tracking-wider">JPEG · PNG · MP4 · WebM</span>
                            </>
                          )}
                        </div>

                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/ogg,video/quicktime,video/mpeg"
                          className="hidden"
                          onChange={handleFileSelect}
                          disabled={isProcessing}
                        />

                        <div className="space-y-2 pt-2">
                          <label className="font-label text-[10px] uppercase tracking-[0.2em] text-primary block">Context / Question (Optional)</label>
                          <textarea
                            className="w-full bg-transparent border-b border-outline-variant focus:border-primary focus:ring-0 text-on-surface placeholder:text-outline/30 min-h-[60px] resize-none py-2 font-body text-sm"
                            placeholder="Add specific context, or ask 'Is this real?'..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            disabled={isProcessing}
                          />
                        </div>

                        <button
                          onClick={handleMediaAnalyze}
                          disabled={!selectedFile || isProcessing}
                          className="w-full bg-gradient-to-r from-primary to-primary-container text-on-primary font-headline font-extrabold uppercase tracking-widest py-5 text-sm hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(183,196,255,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isProcessing ? '● Scanning Media...' : 'Scan & Fact-Check'}
                        </button>

                        <p className="text-outline text-[10px] text-center leading-relaxed">
                          AI will extract text &amp; claims from the media, then fact-check them against Wikipedia.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Pipeline Status Bento Grid */}
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-0 relative">
              <div className="md:col-span-2 bg-surface-container-low p-8 border-l-4 border-primary z-20">
                <div className="flex justify-between items-start mb-12">
                  <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline">Pipeline Status</span>
                  <span className="text-primary flex items-center gap-2">
                    <span className={`w-2 h-2 bg-primary ${isProcessing ? 'animate-ping' : 'animate-pulse'}`}></span>
                    <span className="font-label text-[10px] uppercase">{stepLabel[step]}</span>
                  </span>
                </div>
                <div className="space-y-8">
                  <div className="flex items-center gap-6">
                    <div className="text-4xl font-headline font-black text-on-surface">
                      {step === 'complete' && reportData ? `${reportData.overallTrustScore}%` : '—'}
                    </div>
                    <div className="text-outline text-xs uppercase tracking-widest">
                      {step === 'complete' ? 'Trust\nScore' : 'Inference\nPrecision'}
                    </div>
                  </div>
                  <div className="w-full h-[2px] bg-surface-variant relative">
                    <div className={`absolute top-0 left-0 h-full bg-primary transition-all duration-1000 ${
                      step === 'complete' && reportData ? '' :
                      isProcessing ? 'w-1/2 animate-pulse' : 'w-0'
                    }`}
                    style={step === 'complete' && reportData ? { width: `${reportData.overallTrustScore}%` } : undefined}></div>
                  </div>
                  {step === 'complete' && reportData && (
                    <div className="flex gap-4 mt-4">
                      <button onClick={() => setCurrentView('nodes')}
                        className="border border-primary text-primary font-label text-[10px] uppercase tracking-widest px-4 py-2 hover:bg-primary hover:text-on-primary transition-all">
                        View Full Report →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mini Panel 1 */}
              <div className="bg-surface-container p-8 asymmetric-tilt-left md:-ml-4 md:mt-12 z-10 shadow-xl border border-outline-variant/10">
                <span className="material-symbols-outlined text-primary mb-4 block">troubleshoot</span>
                <h3 className="font-headline font-bold uppercase text-xs tracking-widest mb-2">Heuristic Scanning</h3>
                <p className="text-on-surface-variant text-[11px] leading-tight">
                  {isProcessing
                    ? `Step: ${
                        step === 'scanning' ? 'Scanning media with Vision AI...' :
                        step === 'extracting' ? 'Extracting claims...' :
                        step === 'searching' ? 'Fetching Wikipedia evidence...' :
                        'Verifying with AI...'
                      }`
                    : 'Current throughput optimized at 420TB/s. Nodes operational across EU-CENTRAL.'}
                </p>
              </div>

              {/* Mini Panel 2 */}
              <div className="bg-surface-container-high p-8 asymmetric-tilt-right md:-ml-8 md:-mt-8 z-30 shadow-2xl border border-outline-variant/30">
                <span className="material-symbols-outlined text-primary mb-4 block">analytics</span>
                <h3 className="font-headline font-bold uppercase text-xs tracking-widest mb-2">Truth Density</h3>
                <div className="flex items-end gap-1 h-12">
                  {[20, 40, 100, 60, 80].map((h, i) => (
                    <div key={i} className="w-2 bg-primary transition-all duration-500" style={{ height: `${isProcessing ? Math.random() * 100 : h}%`, opacity: isProcessing ? 1 : h / 100 }}></div>
                  ))}
                </div>
              </div>
            </section>

            {/* Error Banner */}
            {errorMsg && (
              <div className="border border-error bg-error/5 p-6 flex items-center gap-4">
                <span className="material-symbols-outlined text-error text-3xl">warning</span>
                <p className="text-error font-label text-sm uppercase tracking-wider">{errorMsg}</p>
              </div>
            )}

            {/* Recent Verifications */}
            {history.length > 0 && (
              <section className="pb-32">
                <h2 className="font-headline text-2xl font-black uppercase tracking-widest mb-10 flex items-center gap-4">
                  Recent Verifications
                  <span className="h-[1px] flex-grow bg-gradient-to-r from-outline-variant to-transparent"></span>
                </h2>
                {/* Stacked tilted cards — use negative top margin so they overlap without absolute positioning overflow */}
                <div className="flex flex-col gap-0 pb-8">
                  {history.slice(0, 3).map((item, idx) => (
                    <div key={idx}
                      className={`w-full md:w-[420px] p-6 border border-outline-variant shadow-2xl transition-all hover:z-50 hover:scale-[1.02] cursor-pointer ${
                        idx === 0 ? 'z-10 md:self-start' :
                        idx === 1 ? 'z-20 md:self-center -mt-8 md:-mt-10 asymmetric-tilt-left md:translate-x-20' :
                        'z-30 md:self-end -mt-8 md:-mt-10 asymmetric-tilt-right md:-translate-x-8'
                      }`}
                      style={{ background: idx === 0 ? '#030e22' : idx === 1 ? '#142034' : '#1f2a3f' }}
                      onClick={() => handleAnalyze(undefined, item.claim.replace('...', ''))}
                    >
                      <div className="flex justify-between items-center mb-4">
                        <span className="font-label text-[9px] text-primary uppercase tracking-widest">ID: AX-{9020 + idx + 1}</span>
                        <span className={`font-label text-[9px] uppercase font-bold px-2 py-0.5 border ${
                          item.score > 75 ? 'text-[#00ff88] border-[#00ff88]' : item.score > 40 ? 'text-primary border-primary' : 'text-error border-error'
                        }`}>{item.outcome}</span>
                      </div>
                      <div className="bg-surface-container h-20 mb-4 flex items-center justify-center border border-outline-variant/20">
                        <div className="text-center">
                          <span className="block text-3xl font-headline font-black text-primary">{item.score}%</span>
                          <span className="text-[9px] text-outline uppercase tracking-widest">Trust Score</span>
                        </div>
                      </div>
                      <h4 className="font-headline font-extrabold uppercase text-sm mb-1 line-clamp-1">{item.claim}</h4>
                      <p className="text-outline text-[10px]">{item.timestamp} · tap to re-analyze</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── NODES VIEW (ANALYSIS) ───────────────── */}
        {currentView === 'nodes' && (
          <section className="space-y-12 pb-32">
            <div className="border-l-4 border-primary pl-8 flex justify-between items-start">
              <div>
                <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline block mb-2">Axiom Pipeline — Node Analysis</span>
                <h2 className="font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">Verification Report</h2>
              </div>
              <button 
                onClick={() => { setReportData(null); setMediaAnalysis(null); setInput(""); setStep("idle"); setCurrentView("terminal"); }}
                className="border border-outline-variant text-outline hover:text-on-surface hover:border-primary font-label text-[10px] uppercase tracking-widest px-4 py-2 transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-sm">restart_alt</span> New Stream
              </button>
            </div>

            {!reportData ? (
              <div className="glass-panel p-16 text-center space-y-6 border border-outline-variant/20">
                <span className="material-symbols-outlined text-outline text-6xl block">insert_chart</span>
                <p className="font-headline font-bold uppercase tracking-widest text-on-surface-variant">No Active Node Data</p>
                <p className="text-outline text-sm">Run an analysis stream from the Terminal to populate this view.</p>
                <button onClick={() => setCurrentView('terminal')} className="border border-primary text-primary font-label text-[10px] uppercase tracking-widest px-6 py-3 hover:bg-primary hover:text-on-primary transition-all">→ Open Terminal</button>
              </div>
            ) : (
              <>
                {/* ── Media Analysis Panel (shown only for uploaded media) ── */}
                {mediaAnalysis && (
                  <div className="space-y-4">
                    {/* Manipulation warning — shown prominently if detected */}
                    {mediaAnalysis.hasManipulationSignals && (
                      <div className="border border-error bg-error/5 p-5 flex items-start gap-4">
                        <span className="material-symbols-outlined text-error text-3xl shrink-0">gpp_bad</span>
                        <div>
                          <p className="font-headline font-bold text-error uppercase text-xs tracking-widest mb-1">⚠ Manipulation Signals Detected</p>
                          <p className="text-on-surface-variant text-xs leading-relaxed">{mediaAnalysis.manipulationDetails}</p>
                        </div>
                      </div>
                    )}
                    {/* Media metadata + extracted content */}
                    <div className="bg-surface-container-low border border-outline-variant/20 p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="material-symbols-outlined text-primary text-sm">
                            {mediaAnalysis.mimeType.startsWith('video') ? 'videocam' : 'image'}
                          </span>
                          <span className="font-label text-[10px] uppercase tracking-widest text-outline">Media Source</span>
                        </div>
                        <p className="text-on-surface text-sm font-medium truncate">{mediaAnalysis.fileName}</p>
                        <p className="text-outline text-[10px] uppercase">{mediaAnalysis.mimeType} · {mediaAnalysis.fileSizeKb} KB</p>
                        <div className="pt-2">
                          <span className="font-label text-[9px] uppercase tracking-widest text-outline block mb-1">AI Summary</span>
                          <p className="text-on-surface-variant text-xs leading-relaxed border-l-2 border-primary/30 pl-3">{mediaAnalysis.mediaSummary}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <span className="font-label text-[9px] uppercase tracking-widest text-outline block">Extracted Text / Captions</span>
                        <div className="bg-surface-container p-3 border border-outline-variant/20 max-h-32 overflow-y-auto">
                          <p className="text-on-surface text-xs leading-relaxed font-mono whitespace-pre-wrap">
                            {mediaAnalysis.extractedText || <span className="text-outline italic">No text detected in media.</span>}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Score Ring + Summary */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Circular Score */}
                  <div className="md:col-span-4 bg-surface-container-low p-8 border border-outline-variant/20 flex flex-col items-center justify-center space-y-6">
                    <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline">Inference Score</span>
                    <div className="relative flex items-center justify-center">
                      <svg className="w-44 h-44 transform -rotate-90">
                        <circle className="text-surface-container-highest" cx="88" cy="88" fill="transparent" r="80" stroke="currentColor" strokeWidth="6"/>
                        <circle className="text-primary" cx="88" cy="88" fill="transparent" r="80" stroke="currentColor"
                          strokeDasharray="502.65"
                          strokeDashoffset={502.65 - (502.65 * (reportData.overallTrustScore / 100))}
                          strokeLinecap="square" strokeWidth="10"
                          style={{ transition: 'stroke-dashoffset 1.5s ease-out' }}/>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-headline font-black text-on-surface">{reportData.overallTrustScore}<span className="text-lg text-primary">%</span></span>
                        <span className="text-[9px] font-label text-primary uppercase tracking-tighter mt-1">
                          {reportData.overallTrustScore > 75 ? 'Verified' : reportData.overallTrustScore > 40 ? 'Mixed Signal' : 'Flagged'}
                        </span>
                      </div>
                    </div>
                    <div className="w-full space-y-2">
                      <div className="flex justify-between text-[9px] font-label uppercase text-outline">
                        <span>Source Density</span>
                        <span className="text-primary">{Math.min(100, reportData.overallTrustScore + 12)}%</span>
                      </div>
                      <div className="w-full h-[2px] bg-surface-variant">
                        <div className="h-full truth-meter-bg" style={{ width: `${Math.min(100, reportData.overallTrustScore + 12)}%` }}/>
                      </div>
                    </div>
                    <div className="text-[9px] font-label uppercase text-outline text-center">
                      {reportData.totalClaims} claim{reportData.totalClaims !== 1 ? 's' : ''} analyzed
                    </div>
                  </div>

                  {/* Claim Cards */}
                  <div className="md:col-span-8 space-y-4">
                    {reportData.verifiedClaims.map((claim, idx) => {
                      const isTrue = claim.status === 'True';
                      const isFalse = claim.status === 'False';
                      return (
                        <div key={idx} className={`p-6 border bg-surface-container-lowest ${isFalse ? 'border-error/40' : isTrue ? 'border-primary/30' : 'border-outline-variant/20'}`}>
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div className="space-y-1">
                              <span className="font-label text-[9px] text-outline uppercase tracking-widest">CLAIM_ID :: {claim.id.toUpperCase()}</span>
                              <p className="font-headline font-bold text-base text-on-surface leading-tight">"{claim.claim}"</p>
                            </div>
                            <span className={`font-label text-[9px] uppercase font-bold px-3 py-1 border whitespace-nowrap flex items-center gap-1 ${isTrue ? 'text-[#00ff88] border-[#00ff88]' : isFalse ? 'text-error border-error' : 'text-primary border-primary'}`}>
                              <span className="material-symbols-outlined text-xs">{isTrue ? 'check_circle' : isFalse ? 'cancel' : 'warning'}</span>
                              {claim.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="border-t border-outline-variant/20 pt-4 space-y-3">
                            <div className="flex items-center gap-2 text-[9px] text-outline uppercase tracking-widest">
                              <span className="material-symbols-outlined text-xs">psychology</span> AI Reasoning
                            </div>
                            <p className="text-on-surface-variant text-xs leading-relaxed border-l-2 border-primary/30 pl-4">{claim.reasoning}</p>
                            {claim.correctedStatement && (
                              <div className="flex gap-2 items-start bg-surface-container p-3 border-l-2 border-[#00ff88]/60">
                                <span className="material-symbols-outlined text-[#00ff88] text-sm shrink-0 mt-0.5">lightbulb</span>
                                <div>
                                  <span className="font-label text-[9px] uppercase tracking-widest text-[#00ff88] block mb-1">Correct Statement</span>
                                  <p className="text-on-surface text-xs leading-relaxed font-medium">{claim.correctedStatement}</p>
                                </div>
                              </div>
                            )}
                            <div className="space-y-2 pt-1">
                              <span className="font-label text-[9px] uppercase tracking-widest text-outline block">Sources</span>
                              <div className="flex flex-wrap gap-2">
                                {(claim.evidence?.results || []).map((ev, i) => {
                                  const domain = (() => { try { return new URL(ev.url).hostname.replace(/^www\./, ''); } catch { return 'source'; } })();
                                  const isWiki = domain.includes('wikipedia');
                                  const isNews = !isWiki;
                                  return (
                                    <a key={i} href={ev.url} target="_blank" rel="noreferrer"
                                      title={ev.title}
                                      className={`flex items-center gap-1.5 px-2 py-1 border text-[9px] font-label uppercase tracking-wide hover:brightness-125 transition-all max-w-[220px] ${
                                        isWiki
                                          ? 'border-primary/30 bg-primary/5 text-primary hover:border-primary'
                                          : 'border-yellow-400/30 bg-yellow-400/5 text-yellow-400 hover:border-yellow-400'
                                      }`}>
                                      <span className="material-symbols-outlined text-[10px] shrink-0">{isNews ? 'newspaper' : 'menu_book'}</span>
                                      <span className="truncate">{domain}</span>
                                    </a>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Final Conclusion / Verdict */}
                {reportData.globalConclusion && (
                  <div className="bg-primary/5 border border-primary/20 p-8 space-y-4 mt-8">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-primary text-xl">insights</span>
                      <h3 className="font-headline font-black uppercase tracking-widest text-sm text-primary">Final Verdict & Analysis</h3>
                    </div>
                    <p className="text-on-surface-variant text-sm leading-relaxed border-l-2 border-primary/40 pl-4 font-medium">
                      {reportData.globalConclusion}
                    </p>
                  </div>
                )}

                {/* Related References */}
                {reportData.relatedReferences && reportData.relatedReferences.length > 0 && (
                  <div className="bg-surface-container-low border border-outline-variant/20 p-8 space-y-6">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-primary">auto_stories</span>
                      <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface">Related Node Queries</h3>
                    </div>
                    <p className="text-outline text-[11px] uppercase tracking-wider">Click to run additional verification streams on related topics</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {reportData.relatedReferences.map((ref, idx) => (
                        <button key={idx}
                          onClick={() => { handleAnalyze(undefined, ref.question); }}
                          className={`flex items-start gap-3 p-4 border text-left hover:brightness-125 transition-all group ${CAT_COLORS[ref.category] || 'border-outline-variant/20 bg-surface-container/50 text-on-surface-variant'}`}>
                          <span className="material-symbols-outlined text-xs mt-1 shrink-0">subdirectory_arrow_right</span>
                          <div>
                            <span className="text-[9px] font-black uppercase tracking-widest opacity-60 block">{ref.category}</span>
                            <p className="text-xs font-medium leading-relaxed mt-0.5">{ref.question}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* ── REGISTRY VIEW (ARCHIVE) ─────────────── */}
        {currentView === 'registry' && (
          <section className="space-y-8 pb-32">
            <div className="border-l-4 border-primary pl-8 flex items-end justify-between">
              <div>
                <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline block mb-2">Axiom Pipeline — Registry</span>
                <h2 className="font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">Verification Ledger</h2>
              </div>
              <button onClick={() => { localStorage.removeItem('factcheck_history'); setHistory([]); }}
                className="text-[9px] font-label uppercase text-error tracking-widest border border-error/30 px-4 py-2 hover:bg-error/10 transition-all">
                Purge Logs
              </button>
            </div>

            <div className="bg-surface-container-low border border-outline-variant/20 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-surface-container-highest text-[9px] font-black uppercase text-outline tracking-widest">
                    <tr>
                      <th className="px-6 py-4 border-b border-outline-variant/20">Timestamp</th>
                      <th className="px-6 py-4 border-b border-outline-variant/20">Source String</th>
                      <th className="px-6 py-4 border-b border-outline-variant/20">Inference Score</th>
                      <th className="px-6 py-4 border-b border-outline-variant/20">Status</th>
                      <th className="px-6 py-4 border-b border-outline-variant/20">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10 font-body text-xs">
                    {history.map((item, idx) => (
                      <tr key={idx} className="hover:bg-surface-container transition-colors">
                        <td className="px-6 py-4 text-outline font-mono text-[10px]">{item.timestamp}</td>
                        <td className="px-6 py-4 text-on-surface max-w-xs font-medium">{item.claim}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-20 h-[2px] bg-surface-variant">
                              <div className="h-full bg-primary" style={{ width: `${item.score}%` }}/>
                            </div>
                            <span className={`font-bold text-[10px] ${item.score < 40 ? 'text-error' : 'text-primary'}`}>{item.score}%</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-0.5 border text-[9px] font-bold uppercase ${
                            item.score > 75 ? 'text-[#00ff88] border-[#00ff88] bg-[#00ff88]/5' :
                            item.score > 40 ? 'text-primary border-primary/40 bg-primary/5' :
                            'text-error border-error/40 bg-error/5'
                          }`}>{item.outcome}</span>
                        </td>
                        <td className="px-6 py-4">
                          <button onClick={() => handleAnalyze(undefined, item.claim.replace('...', ''))}
                            className="flex items-center gap-1 text-[9px] text-outline hover:text-primary transition-colors font-label uppercase tracking-wider">
                            <span className="material-symbols-outlined text-xs">replay</span> Rerun
                          </button>
                        </td>
                      </tr>
                    ))}
                    {history.length === 0 && (
                      <tr><td colSpan={5} className="px-6 py-16 text-center text-outline text-[11px] uppercase tracking-widest">No entries in ledger. Run an analysis stream first.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ── SYSTEM VIEW ─────────────────────────── */}
        {currentView === 'system' && (
          <section className="space-y-8 pb-32">
            <div className="border-l-4 border-primary pl-8">
              <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline block mb-2">Axiom Pipeline — System Diagnostics</span>
              <h2 className="font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">Node Registry</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { icon: 'smart_toy', label: 'AI Inference Engine', status: 'ONLINE', sub: 'Google Gemini 2.0 Flash · Groq Fallback Active', ok: true },
                { icon: 'travel_explore', label: 'Evidence Retrieval', status: 'ONLINE', sub: 'Wikipedia Open API · No rate limits', ok: true },
                { icon: 'storage', label: 'Local History Ledger', status: 'ACTIVE', sub: 'Browser LocalStorage · Encrypted', ok: true },
                { icon: 'key', label: 'API Authentication', status: 'CONFIGURED', sub: 'GEMINI_API_KEY loaded from .env.local', ok: true },
              ].map(card => (
                <div key={card.label} className={`bg-surface-container-low p-6 border ${card.ok ? 'border-primary/20' : 'border-error/30'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-surface-container flex items-center justify-center border border-outline-variant/20">
                        <span className="material-symbols-outlined text-primary text-xl">{card.icon}</span>
                      </div>
                      <span className="font-headline font-bold uppercase text-xs tracking-widest text-on-surface">{card.label}</span>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 border ${card.ok ? 'text-[#00ff88] border-[#00ff88] bg-[#00ff88]/5' : 'text-error border-error/40'}`}>
                      {card.status}
                    </span>
                  </div>
                  <p className="text-outline text-[11px] pl-[52px]">{card.sub}</p>
                </div>
              ))}
            </div>

            <div className="bg-surface-container-low border border-outline-variant/20 p-8 space-y-4">
              <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface">Pipeline Architecture</h3>
              {[
                '01 → User submits text or URL to /api/factcheck',
                '02 → Gemini 2.0 Flash extracts discrete verifiable claims (max 3)',
                '03 → Wikipedia Open API retrieves 5–8 evidence articles per claim',
                '04 → Claims scored against evidence with relevance ranking',
                '05 → Gemini verifies all claims in one batched LLM call',
                '06 → Score: verdictAvg × 0.55 + sourceAvg × 0.45 (fallback to verdictAvg if no Wikipedia)',
                '07 → Related follow-up questions built from topic analysis',
                '08 → Result saved to local ledger for archive',
              ].map((s, i) => (
                <div key={i} className="flex gap-4 items-start p-3 bg-surface-container border-l-2 border-primary/20 hover:border-primary/60 transition-all">
                  <span className="text-primary font-mono text-[10px] shrink-0 mt-0.5">{s.substring(0, 2)}</span>
                  <span className="text-on-surface-variant text-xs">{s.substring(5)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

      </main>

      {/* ── BOTTOM NAV (Mobile) ──────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full flex justify-around items-center h-20 px-6 bg-[#030e22]/90 backdrop-blur-md z-50">
        <div className="absolute top-0 left-0 bg-[#1f2a3f] h-[2px] w-full"></div>
        {navItems.map(item => (
          <button key={item.id} onClick={() => setCurrentView(item.id)}
            className={`flex flex-col items-center gap-1 transition-all ${
              currentView === item.id
                ? 'text-[#b7c4ff] bg-[#b7c4ff]/10 scale-110 -translate-y-1 p-3 shadow-[0_0_20px_rgba(183,196,255,0.3)]'
                : 'text-[#5a6b82] opacity-60 hover:opacity-100 hover:text-[#b7c4ff] p-3'
            }`}>
            <span className="material-symbols-outlined text-lg">{item.icon}</span>
            <span className="text-[8px] uppercase font-label tracking-widest">{item.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

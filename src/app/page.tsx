"use client";

import React, { useState, useEffect, useRef } from 'react';
import type { AccuracyReport } from '@/lib/verifier';

type PipelineStep = 'idle' | 'extracting' | 'scanning' | 'searching' | 'verifying' | 'complete' | 'error';
type ViewTab = 'terminal' | 'nodes' | 'registry' | 'system' | 'profile';
type InputMode = 'text' | 'media';

interface Detection {
  label: string;
  box_2d: [number, number, number, number];
}

interface MediaAnalysis {
  fileName: string;
  mimeType: string;
  fileSizeKb: number;
  mediaSummary: string;
  extractedText: string;
  hasManipulationSignals: boolean;
  manipulationDetails?: string;
  detections?: Detection[];
}

interface HistoryItem {
  timestamp: string;
  claim: string;
  score: number;
  outcome: string;
}

// Using a unified neutral theme for all categories
const CAT_COLORS: Record<string, string> = {}; 

const SUGGESTIONS = {
  iran: [
    { label: 'Conflict:', text: 'Iran and Israel tensions escalate following border skirmishes' },
    { label: 'Middle East:', text: 'UN Security Council votes on new Iran-Israel ceasefire resolution' }
  ],
  india: [
    { label: 'India:', text: 'ISRO successfully launches new Mars orbital probe' },
    { label: 'India:', text: 'RBI projects 7.2% economic growth for the upcoming fiscal year' }
  ],
  global: [
    { label: 'Global:', text: 'World Bank predicts 3% global GDP growth in 2026' },
    { label: 'Global:', text: 'WHO declares new guidelines for pandemic preparedness' }
  ],
  it: [
    { label: 'Tech:', text: 'AI coding tools shown to increase developer productivity by 50%' },
    { label: 'Tech:', text: 'Major IT hubs see 20% surge in tech job openings this quarter' }
  ],
  digital: [
    { label: 'Market:', text: 'Digital markets act forces tech giants to open their ecosystems' },
    { label: 'Finance:', text: 'Cryptocurrency regulations tighten across major European markets' }
  ],
  ipl: [
    { label: 'Sports:', text: 'CSK secures dramatic victory in the IPL season finale' },
    { label: 'Web:', text: 'Global internet outage affects millions of users for 4 hours' }
  ]
};

export default function Home() {
  const [input, setInput] = useState("");
  const [step, setStep] = useState<PipelineStep>("idle");
  const [reportData, setReportData] = useState<AccuracyReport | null>(null);
  const [mediaAnalysis, setMediaAnalysis] = useState<MediaAnalysis | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [currentView, setCurrentView] = useState<ViewTab>('terminal');
  const [inputMode, setInputMode] = useState<InputMode>('text');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<'Dark' | 'Light'>('Dark');
  const [seed, setSeed] = useState<number>(0);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [cachedReports, setCachedReports] = useState<{query: string, report: AccuracyReport}[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(true);
  const [userReports, setUserReports] = useState<{topic?: string, timestamp: string, text: string}[]>([]);
  const [isReporting, setIsReporting] = useState(false);
  const [reportText, setReportText] = useState("");
  const [expandedReport, setExpandedReport] = useState<number | null>(null);
  const recognitionRef = useRef<any>(null);

  const isProcessing = step !== 'idle' && step !== 'complete' && step !== 'error';
  const stepLabel: Record<PipelineStep, string> = {
    idle: 'Active', scanning: 'SCANNING', extracting: 'EXTRACTING',
    searching: 'SEARCHING', verifying: 'VERIFYING', complete: 'Complete', error: 'Error',
  };
  const navItems: { id: ViewTab; icon: string; label: string }[] = [
    { id: 'terminal', icon: 'terminal', label: 'Terminal' },
    { id: 'nodes', icon: 'troubleshoot', label: 'Nodes' },
    { id: 'registry', icon: 'analytics', label: 'History' },
    { id: 'system', icon: 'settings_suggest', label: 'System' },
  ];
  
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (step === 'complete' && reportData) {
      setPipelineProgress(reportData.overallTrustScore);
    } else if (isProcessing) {
      if (pipelineProgress === 0) setPipelineProgress(5);
      interval = setInterval(() => {
        setPipelineProgress(prev => {
          if (prev >= 98) return 98;
          // Frequent small jumps for smoothness
          const next = prev + (Math.random() * 2 + 0.5);
          return next > 98 ? 98 : next;
        });
      }, 400); // More frequent updates
    } else if (step === 'idle' || step === 'error') {
      setPipelineProgress(0);
    }
    return () => clearInterval(interval);
  }, [isProcessing, step === 'complete', reportData]);
  
  useEffect(() => {
    setSeed(Math.floor(Math.random() * 2));
  }, []);

  const fetchCache = async () => {
    try {
      const res = await fetch("/api/factcheck/cache");
      if (res.ok) {
        const data = await res.json();
        setCachedReports(data.entries || []);
      }
    } catch (e) {
      console.warn("Failed to fetch cache", e);
    }
  };

  useEffect(() => {
    if (currentView === 'system') {
      fetchCache();
    }
  }, [currentView]);

  const currentPills = React.useMemo(() => {
    const idx = inputMode === 'text' ? seed : (seed + 1) % 2;
    const all = [
      SUGGESTIONS.iran[idx],
      SUGGESTIONS.india[idx],
      SUGGESTIONS.global[idx],
      SUGGESTIONS.it[idx],
      SUGGESTIONS.digital[idx],
      SUGGESTIONS.ipl[idx],
    ];
    return inputMode === 'text' ? all.slice(0, 5) : all;
  }, [inputMode, seed]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync theme with body class
  useEffect(() => {
    if (themeMode === 'Light') {
      document.body.classList.add('light');
    } else {
      document.body.classList.remove('light');
    }
  }, [themeMode]);

  useEffect(() => {
    const saved = localStorage.getItem("user_reports");
    if (saved) {
      try { setUserReports(JSON.parse(saved)); } catch {}
    }
  }, []);

  useEffect(() => {
    const key = isLoggedIn ? "factcheck_history" : "factcheck_history_guest";
    const saved = localStorage.getItem(key);
    if (saved) {
      try { setHistory(JSON.parse(saved)); } catch {}
    } else {
      if (isLoggedIn) {
        setHistory([
          { timestamp: "2026-03-21 14:22", claim: "ISRO Mars Mission launch date rescheduled...", score: 88, outcome: "Substantiated" },
          { timestamp: "2026-03-20 12:05", claim: "Stock market crash imminent says unverified...", score: 12, outcome: "Flagged" },
          { timestamp: "2026-03-19 21:40", claim: "New AI regulations passed by the EU council...", score: 89, outcome: "Verified" },
        ]);
      } else {
        setHistory([
          { timestamp: "2026-03-24 10:00", claim: "Global stock markets reach record highs...", score: 65, outcome: "Substantiated" },
        ]);
      }
    }
  }, [isLoggedIn]);

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
      const key = isLoggedIn ? "factcheck_history" : "factcheck_history_guest";
      localStorage.setItem(key, JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg("Your browser does not support speech recognition.");
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      
      recognition.onresult = (event: any) => {
        let newFinalText = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
             newFinalText += event.results[i][0].transcript;
          }
        }
        if (newFinalText) {
           setInput(prev => (prev ? prev + " " : "") + newFinalText.trim());
        }
      };

      recognition.onerror = (event: any) => {
        console.error(event.error);
        if (event.error === 'not-allowed') setErrorMsg('Microphone access denied. Please allow it in the browser.');
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleShare = async () => {
    if (!reportData) return;
    const shareUrl = window.location.href;
    const shareTitle = `Axiom Analysis :: ${reportData.totalClaims} Claims Verified`;
    const shareText = `Check out this fact-check report on Axiom: "${reportData.globalConclusion?.replace(/<\/?[^>]+(>|$)/g, "").slice(0, 100)}..."`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error("Error sharing:", err);
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        setSuccessMsg("Link copied to clipboard!");
        setTimeout(() => setSuccessMsg(""), 3000);
      } catch (err) {
        console.error("Error copying:", err);
      }
    }
  };

  const handleAnalyze = async (e?: React.FormEvent, overrideInput?: string, mode: 'quick' | 'deep' = 'deep') => {
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
        body: JSON.stringify({ input: targetInput, mode })
      });

      const isQuick = mode === 'quick';
      setTimeout(() => setStep(prev => prev === 'extracting' ? 'searching' : prev), isQuick ? 800 : 2500);
      setTimeout(() => setStep(prev => prev === 'searching' ? 'verifying' : prev), isQuick ? 1800 : 5500);

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
      
      if (data.cached) {
        // INSTANT HIT: Skip all simulated delays
        setStep("complete");
        setCurrentView('nodes');
      } else {
        // NORMAL PATH: Wait for the simulated pipeline to reach the natural finish
        setTimeout(() => {
          setStep("complete");
          setCurrentView('nodes');
        }, isQuick ? 2500 : 7000);
      }

      const outcome = data.overallTrustScore > 75 ? 'Verified' : data.overallTrustScore > 40 ? 'Substantiated' : 'Flagged';
      saveToHistory(targetInput, data.overallTrustScore, outcome);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
      setStep("error");
    }
  };

  return (
    <>
      {/* ── TOP APP BAR ─────────────────────────────── */}
      <header className="bg-surface/80 backdrop-blur-xl text-primary flex justify-between items-center px-4 md:px-8 py-4 md:py-6 max-w-full fixed top-0 w-full z-50 shadow-panel">
        <div className="flex items-center gap-3 relative transition-transform hover:scale-[1.05] duration-300">
          <div className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-surface-container-high/60 flex items-center justify-center overflow-hidden border border-outline-variant/30 flex-shrink-0 shadow-panel">
            <img 
              src="/logo.png" 
              alt="Logo" 
              className="w-5 h-5 md:w-7 md:h-7 object-contain mix-blend-screen" 
            />
          </div>
          <h1 className="font-['Manrope'] tracking-tighter uppercase font-black text-xl md:text-2xl text-primary italic -skew-x-12">AXIOM.NULL</h1>
        </div>
        <nav className="hidden md:flex gap-8 items-center">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setCurrentView(item.id)}
              className={`font-label text-[10px] uppercase tracking-widest py-1 transition-all duration-300 ${
                currentView === item.id
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-outline hover:text-on-surface'
              }`}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-3 md:gap-6 pr-1 md:pr-4">
          {/* Theme Toggle */}
          <button 
            onClick={() => setThemeMode(themeMode === 'Dark' ? 'Light' : 'Dark')}
            className={`w-8 h-8 md:w-10 md:h-10 rounded-full transition-all flex items-center justify-center border hover:border-primary/50 ${
              themeMode === 'Light' 
                ? 'bg-[#f5deb3] border-[#f5deb3] text-black shadow-glow scale-105' 
                : 'border-outline-variant/30 text-outline hover:text-on-surface'
            }`}
            title="Toggle Theme"
          >
            <span className="material-symbols-outlined text-lg transition-transform hover:rotate-12">
              {themeMode === 'Dark' ? 'light_mode' : 'dark_mode'}
            </span>
          </button>

          <button 
            onClick={() => setCurrentView('profile')}
            className={`w-10 h-10 rounded-full transition-all flex items-center justify-center overflow-hidden border-2 ${
              currentView === 'profile' 
                ? 'border-primary shadow-glow scale-105' 
                : 'border-outline-variant hover:border-primary/50'
            }`}
          >
            <img 
              src={isLoggedIn ? "/profile_pravin.jpg" : "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y"} 
              alt="Profile" 
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.src = "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y";
              }}
            />
          </button>
        </div>
        <div className="bg-gradient-to-r from-surface-container-highest to-transparent h-[1px] w-full absolute bottom-0 left-0"></div>
      </header>

      {/* ── MAIN ────────────────────────────────────── */}
      <main className="pt-24 md:pt-32 px-4 md:px-12 max-w-7xl mx-auto space-y-12 md:space-y-24 relative">

        {/* ── TERMINAL VIEW (VERIFY) ───────────────── */}
        {currentView === 'terminal' && (
          <>
            {/* Hero Section */}
            <section className="relative">
              <div className="absolute -top-4 md:-top-12 -left-4 md:-left-12 text-primary opacity-20 select-none pointer-events-none hidden sm:block mix-blend-screen">
                <span className="text-7xl md:text-[12rem] font-headline font-black leading-none tracking-tighter uppercase animate-pulse-glow">VERIFY</span>
              </div>
              <div className="flex flex-col md:flex-row items-start gap-8 md:gap-12 relative z-10">
                {/* Left Copy */}
                <div className="md:w-3/5 space-y-4 md:space-y-6 mt-4 md:mt-0">
                  <h2 className="font-headline text-4xl md:text-7xl font-black tracking-tighter leading-[0.9] text-on-surface">
                    Intelligence for <br/>
                    <div className="ml-16 md:ml-48">
                      <span className="text-primary inline-block">Truth&nbsp;&nbsp;Verification</span>
                    </div>
                  </h2>
                  <p className="text-on-surface/90 max-w-2xl text-lg font-extralight leading-relaxed">
                    Our AI-powered system verifies claims in real time <br/>
                    by cross-referencing them with reliable, real-world evidence <br/>
                    <br/>
                    It handles ambiguity and conflicting information with transparent reasoning, <br/>
                    delivering clear, accurate, and highly trustworthy insights!
                  </p>
                  {/* Quick reference pills */}
                  <div className="flex flex-wrap gap-3 pt-2">
                    {currentPills.map(pill => (
                      <button key={pill.text} onClick={() => handleAnalyze(undefined, pill.text)}
                        className="px-4 py-1.5 border border-outline-variant/30 bg-surface-container/40 text-[10px] font-label uppercase tracking-widest hover:bg-surface-container hover:border-primary/40 transition-all rounded-full">
                        <span className="text-primary">{pill.label}</span> <span className="text-on-surface-variant">{pill.text.substring(0, 32)}…</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Input Card (Asymmetric) */}
                <div className="md:w-2/5 w-full bg-surface-container-high p-1 glass-panel asymmetric-tilt-right mt-12 md:mt-0 shadow-panel rounded-3xl border-l-4 border-primary shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.5)] animate-float">
                  <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-[1.3rem] overflow-hidden">
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
                      <div className="p-8 space-y-6">
                        <div className="space-y-2 relative">
                          <label className="font-label text-[10px] uppercase tracking-[0.2em] text-primary block">Source Analysis Input</label>
                          <textarea
                            className="w-full border border-outline-variant/40 focus:border-primary focus:ring-1 focus:ring-primary/20 placeholder:text-outline/30 min-h-[120px] resize-none p-4 font-body text-sm rounded-xl transition-all"
                            style={{ backgroundColor: 'transparent', color: 'inherit' }}
                            placeholder="Paste claim, URL, or metadata hash..."
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            spellCheck="true"
                            autoCorrect="on"
                            autoComplete="on"
                            disabled={isProcessing}
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            type="button"
                            onClick={toggleListening}
                            disabled={isProcessing}
                            className={`relative w-16 md:w-20 flex-shrink-0 flex items-center justify-center rounded-xl transition-all border ${
                              isListening 
                                ? 'bg-error text-white border-error shadow-[0_0_20px_rgba(239,68,68,0.5)] animate-pulse' 
                                : 'bg-surface-container border-outline-variant/30 text-primary hover:border-primary/50 hover:bg-surface-container-high'
                            }`}
                            title={isListening ? 'Stop listening' : 'Start voice input'}
                          >
                            <span className="material-symbols-outlined text-2xl">
                              {isListening ? 'mic' : 'mic_none'}
                            </span>
                            {isListening && (
                              <span className="absolute top-2 right-2 w-2 h-2 bg-white rounded-full animate-ping"></span>
                            )}
                          </button>

                          <button 
                            type="button" 
                            onClick={(e) => handleAnalyze(undefined, undefined, 'deep')}
                            disabled={!input.trim() || isProcessing}
                            className="flex-1 w-full bg-[linear-gradient(110deg,#0a0a0c,#1f2a3f,#2a3b5c,#1f2a3f,#0a0a0c)] text-white font-headline font-black tracking-widest py-4 text-xl md:text-2xl hover:brightness-125 active:scale-95 transition-all shadow-[0_4px_20px_rgba(0,0,0,0.5)] border border-outline-variant/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 rounded-xl animate-water-sweep h-[60px]"
                          >
                            <span className="material-symbols-outlined text-[1.2em]">travel_explore</span>
                            {isProcessing ? 'Verifying...' : 'VerifyNow!!!'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="p-8 space-y-6">
                        <label className="font-label text-[10px] uppercase tracking-[0.2em] text-primary block">Upload Image or Video</label>

                        {/* Drop Zone */}
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          className="border-2 border-dashed border-outline-variant/40 hover:border-primary/60 transition-colors cursor-pointer flex flex-col items-center justify-center py-10 gap-3 bg-surface-container/20 hover:bg-surface-container/40 rounded-2xl"
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
                          className="w-full bg-gradient-to-r from-primary to-primary-container text-[#030e22] font-headline font-black uppercase tracking-[0.2em] py-5 text-sm hover:brightness-125 active:scale-95 transition-all shadow-glow hover:shadow-glow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isProcessing ? '● Scanning Media...' : 'Scan & Fact-Check'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Pipeline Status Bento Grid */}
            <section className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-0 relative">
              <div className="md:col-span-2 bg-surface-container-low p-8 border-l-4 border-primary z-20 rounded-2xl shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.5)]">
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
                      {step === 'complete' && reportData ? `${reportData.overallTrustScore}%` : isProcessing ? `${Math.floor(pipelineProgress)}%` : '—'}
                    </div>
                    <div className="text-outline text-xs uppercase tracking-widest">
                      {step === 'complete' ? 'Trust\nScore' : 'Inference\nPrecision'}
                    </div>
                  </div>
                  <div className="w-full h-[2px] bg-surface-variant relative">
                    <div className={`absolute top-0 left-0 h-full bg-primary transition-all duration-1000 ${
                      step === 'complete' && reportData ? '' :
                      isProcessing ? 'animate-pulse' : 'w-0'
                    }`}
                    style={{ width: step === 'complete' && reportData ? `${reportData.overallTrustScore}%` : isProcessing ? `${pipelineProgress}%` : '0%' }}></div>
                  </div>
                  {step === 'complete' && reportData && (
                    <div className="flex gap-4 mt-4">
                      <button onClick={() => setCurrentView('nodes')}
                        className="border border-primary text-primary font-label text-[10px] uppercase tracking-widest px-4 py-2 hover:bg-primary hover:text-on-primary transition-all rounded-lg">
                        View Full Report →
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Mini Panel 1 */}
              <div className="bg-surface-container p-8 asymmetric-tilt-left md:-ml-4 md:mt-12 z-10 shadow-xl border border-outline-variant/10 rounded-2xl border-l-4 border-primary shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.5)]">
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
              <div className="bg-surface-container-high p-8 asymmetric-tilt-right md:-ml-8 md:-mt-8 z-30 shadow-panel border border-outline-variant/30 rounded-2xl border-l-4 border-primary shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.5)]">
                <style>{`
                  @keyframes eq {
                    0%, 100% { height: 15%; }
                    50% { height: 100%; }
                  }
                  .animate-eq { animation: eq 8s ease-in-out infinite; }
                `}</style>
                <span className="material-symbols-outlined text-primary mb-4 block">analytics</span>
                <h3 className="font-headline font-bold uppercase text-xs tracking-widest mb-2">Truth Density</h3>
                <div className="flex items-end gap-[5px] h-20 w-full overflow-hidden">
                  {Array.from({ length: 14 }).map((_, i) => {
                    const maxScore = reportData?.overallTrustScore || 0;
                    return (
                      <div key={i} 
                        className={`w-3 bg-primary transition-all duration-1000 rounded-t-[1px] ${isProcessing ? 'animate-eq' : ''}`} 
                        style={{ 
                          height: isProcessing ? '15%' : `${Math.max(2, (15 + (i * 6.5)) * (maxScore / 100))}%`,
                          opacity: isProcessing ? 0.5 : 0.1 + (i * 0.04),
                          animationDelay: isProcessing ? `${i * 200}ms` : '0ms'
                        }}>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Notification Banners */}
            {errorMsg && (
              <div className="border border-error bg-error/5 p-6 flex items-center gap-4 rounded-xl animate-in fade-in slide-in-from-top-4 duration-300">
                <span className="material-symbols-outlined text-error text-3xl">warning</span>
                <p className="text-error font-label text-sm uppercase tracking-wider">{errorMsg}</p>
              </div>
            )}

            {successMsg && (
              <div className="border border-[#00ff88]/30 bg-[#00ff88]/5 p-6 flex items-center gap-4 rounded-xl animate-in fade-in slide-in-from-top-4 duration-300">
                <span className="material-symbols-outlined text-[#00ff88] text-3xl">check_circle</span>
                <p className="text-[#00ff88] font-label text-sm uppercase tracking-wider">{successMsg}</p>
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
                      className={`w-full md:w-[420px] p-6 border border-outline-variant shadow-panel transition-all hover:z-50 hover:scale-[1.02] cursor-pointer rounded-2xl border-l-4 border-primary shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.5)] ${
                        idx === 0 ? 'z-10 md:self-start' :
                        idx === 1 ? 'z-20 md:self-center -mt-8 md:-mt-10 asymmetric-tilt-left md:translate-x-20' :
                        'z-30 md:self-end -mt-8 md:-mt-10 asymmetric-tilt-right md:-translate-x-8'
                      }`}
                      style={{ background: idx === 0 ? '#030e22' : idx === 1 ? '#142034' : '#1f2a3f' }}
                      onClick={() => handleAnalyze(undefined, item.claim.replace('...', ''))}
                    >
                      <div className="flex justify-between items-center mb-4">
                        <span className="font-label text-[9px] text-primary uppercase tracking-widest">ID: AX-{9020 + idx + 1}</span>
                        <span className={`font-label text-[9px] uppercase font-bold px-2 py-0.5 border rounded-full ${
                          item.score > 75 ? 'text-[#00ff88] border-[#00ff88]' : item.score > 40 ? 'text-primary border-primary' : 'text-error border-error'
                        }`}>{item.outcome}</span>
                      </div>
                      <div className="bg-surface-container h-20 mb-4 flex items-center justify-center border border-outline-variant/20 rounded-xl">
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
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleShare}
                  disabled={!reportData}
                  title="Share Analysis"
                  className="w-10 h-10 rounded-full border border-primary/30 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:shadow-[0_0_15px_rgba(183,196,255,0.3)] transition-all flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed group"
                >
                  <span className="material-symbols-outlined text-sm group-hover:scale-110 transition-transform">share</span>
                </button>
                <button 
                  onClick={() => { setReportData(null); setMediaAnalysis(null); setInput(""); setStep("idle"); setCurrentView("terminal"); }}
                  className="border border-outline-variant text-outline hover:text-on-surface hover:border-primary font-label text-[10px] uppercase tracking-widest px-4 py-2 transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">restart_alt</span> New Stream
                </button>
              </div>
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
                    <div className="bg-surface-container-low border border-outline-variant/20 p-6 grid grid-cols-1 md:grid-cols-2 gap-6 rounded-2xl">
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

                      {/* Right Col: Forensic Detections & Data */}
                      <div className="space-y-6">
                        {/* Spatial Detections */}
                        {mediaAnalysis?.detections && mediaAnalysis.detections.length > 0 && (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-primary text-sm">filter_center_focus</span>
                              <span className="font-label text-[10px] uppercase tracking-widest text-on-surface">Spatial Detections (ROI)</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {mediaAnalysis.detections.map((det, idx) => (
                                <div key={idx} className="bg-surface-container border border-outline-variant/30 p-3 flex flex-col gap-1 rounded-xl">
                                  <span className="text-[10px] font-black uppercase tracking-wider text-primary">{det.label}</span>
                                  <span className="text-[9px] font-mono text-outline">ROI: [{det.box_2d.join(', ')}]</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Extracted Text/Captions */}
                        <div className="space-y-4">
                          <span className="font-label text-[9px] uppercase tracking-widest text-outline block">Extracted Text / Captions</span>
                          <div className="bg-surface-container p-3 border border-outline-variant/20 max-h-32 overflow-y-auto rounded-xl">
                            <p className="text-on-surface text-xs leading-relaxed font-mono whitespace-pre-wrap">
                              {mediaAnalysis.extractedText || <span className="text-outline italic">No text detected in media.</span>}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Score Ring + Summary */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                  {/* Circular Score */}
                  <div className="md:col-span-4 bg-surface-container-low p-8 border border-outline-variant/20 flex flex-col items-center justify-center space-y-6 rounded-2xl relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
                    <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline relative z-10">Inference Score</span>
                    <div className="relative flex items-center justify-center w-48 h-48 rounded-full animate-pulse-glow bg-surface-container-highest/50">
                      <svg className="w-44 h-44 transform -rotate-90 filter drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]">
                        <circle className="text-surface-container-highest" cx="88" cy="88" fill="transparent" r="80" stroke="currentColor" strokeWidth="6"/>
                        <circle className="text-primary" cx="88" cy="88" fill="transparent" r="80" stroke="currentColor"
                          strokeDasharray="502.65"
                          strokeDashoffset={502.65 - (502.65 * (reportData.overallTrustScore / 100))}
                          strokeLinecap="round" strokeWidth="10"
                          style={{ transition: 'stroke-dashoffset 1.5s ease-out' }}/>
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-4xl font-headline font-black text-on-surface">{reportData.overallTrustScore}<span className="text-lg text-primary">%</span></span>
                        <span className="text-[9px] font-label text-primary uppercase tracking-tighter mt-1 drop-shadow-[0_0_5px_rgba(59,130,246,0.8)]">
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
                        <div key={idx} className={`p-6 border bg-surface-container-lowest rounded-2xl border-l-4 shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.3)] hover:-translate-y-1 transition-all duration-300 ${
                          isFalse ? 'border-l-error border-error/40 hover:shadow-[0_4px_20px_rgba(239,68,68,0.15)]' : isTrue ? 'border-l-primary border-primary/30 hover:shadow-[0_4px_20px_rgba(59,130,246,0.15)]' : 'border-l-outline-variant border-outline-variant/20 hover:shadow-[0_4px_20px_rgba(255,255,255,0.05)]'
                        }`}>
                          <div className="flex items-start justify-between gap-4 mb-4">
                            <div className="space-y-1">
                              <span className="font-label text-[9px] text-outline uppercase tracking-widest">CLAIM_ID :: {claim.id.toUpperCase()}</span>
                              <p className="font-headline font-bold text-base text-on-surface leading-tight">"{claim.claim}"</p>
                            </div>
                            <span className={`font-label text-[9px] uppercase font-bold px-3 py-1 border rounded-full whitespace-nowrap flex items-center gap-1 ${isTrue ? 'text-[#00ff88] border-[#00ff88]' : isFalse ? 'text-error border-error' : 'text-primary border-primary'}`}>
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
                              <div className="flex gap-2 items-start bg-surface-container p-3 border-l-2 border-[#00ff88]/60 rounded-xl">
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
                                      className="flex items-center gap-1.5 px-2 py-1 border border-primary/30 bg-primary/5 text-primary hover:border-primary text-[9px] font-label uppercase tracking-wide hover:brightness-125 transition-all max-w-[220px] rounded-lg">
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
                  <div className="bg-primary/5 border border-primary/20 p-8 space-y-4 mt-8 rounded-2xl border-l-4 border-primary shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.5)]">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-primary text-xl">insights</span>
                      <h3 className="font-headline font-black uppercase tracking-widest text-sm text-primary">Final Verdict & Analysis</h3>
                    </div>
                    <div 
                      className="text-on-surface-variant text-sm leading-relaxed border-l-2 border-primary/40 pl-4 font-medium [&_u]:text-on-surface [&_u]:decoration-primary [&_u]:underline-offset-4 [&_u]:decoration-2 [&_u]:transition-all [&_u]:duration-500 hover:[&_u]:text-primary hover:[&_u]:decoration-[#00ff88]"
                      dangerouslySetInnerHTML={{ __html: reportData.globalConclusion }}
                    />
                  </div>
                )}

                {/* Fact vs. Fiction Ledger (Triangulation) */}
                {reportData.factCorrections && reportData.factCorrections.length > 0 && (
                  <div className="bg-surface-container-highest/30 border-l-4 border-error p-8 space-y-4 rounded-2xl shadow-[inset_6px_0_15px_-6px_rgba(255,180,171,0.3)]">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-error">gavel</span>
                      <h3 className="font-headline font-black uppercase tracking-widest text-sm text-error">Fact Decoupling (Corrections)</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      {reportData.factCorrections.map((corr, i) => (
                        <div key={i} className="flex flex-col md:flex-row md:items-center gap-4 p-4 bg-surface-container/50 border border-outline-variant/10 hover:border-error/30 transition-all rounded-xl">
                          <div className="flex-1">
                            <span className="text-[9px] font-black uppercase text-error/60 block mb-1">False Component</span>
                            <p className="text-sm line-through decoration-error/50 text-on-surface-variant font-medium">{corr.falseComponent}</p>
                          </div>
                          <div className="hidden md:block text-outline opacity-30 text-center">
                            <span className="material-symbols-outlined">arrow_forward</span>
                          </div>
                          <div className="flex-1">
                            <span className="text-[9px] font-black uppercase text-primary/60 block mb-1">Correct Fact</span>
                            <p className="text-sm text-primary font-bold">{corr.correctFact}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* YouTube Evidence Link */}
                {reportData.youtubeUrl && (
                  <div className="space-y-4 pt-4">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-red-500/50 text-xl">video_library</span>
                      <h3 className="font-headline font-black uppercase tracking-widest text-xs text-outline">Multimedia Evidence</h3>
                    </div>
                    <a 
                      href={reportData.youtubeUrl} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="flex items-center justify-between p-5 bg-surface-container-high/60 border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface hover:border-outline-variant/60 active:scale-[0.99] transition-all group rounded-xl"
                    >
                      <span className="font-label uppercase text-[10px] tracking-[0.2em] font-black">
                        Watch Related Fact-Check Resources on YouTube
                      </span>
                      <div className="transition-transform group-hover:scale-110">
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-[#FF0000]/80">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                      </div>
                    </a>
                  </div>
                )}

                {/* Related References */}
                {reportData.relatedReferences && reportData.relatedReferences.length > 0 && (
                  <div className="space-y-6 pt-4">
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-primary">auto_stories</span>
                      <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface">Related Node Queries</h3>
                    </div>
                    <p className="text-outline text-[11px] uppercase tracking-wider">Click to run additional verification streams on related topics</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {reportData.relatedReferences.map((ref, idx) => (
                        <button key={idx}
                          onClick={() => { handleAnalyze(undefined, ref.question); }}
                          className="flex items-start gap-4 p-5 border border-outline-variant/20 bg-surface-container/40 text-on-surface-variant hover:bg-surface-container-high hover:border-outline-variant/40 hover:brightness-110 transition-all group rounded-xl active:scale-[0.98]">
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

                {/* All Sources / Bibliography */}
                {reportData.verifiedClaims && reportData.verifiedClaims.length > 0 && (() => {
                  const allSources = reportData.verifiedClaims.flatMap(c => c.evidence?.results || []);
                  const uniqueSources = Array.from(new Map(allSources.map(s => [s.url, s])).values());
                  
                  if (uniqueSources.length === 0) return null;

                  return (
                    <div className="space-y-6 pt-8 mt-4 border-t border-outline-variant/20">
                      <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-outline">link</span>
                        <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface">Source Bibliography</h3>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {uniqueSources.map((ev, idx) => {
                          const domain = (() => { try { return new URL(ev.url).hostname.replace(/^www\./, ''); } catch { return 'source'; } })();
                          const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                          return (
                            <a key={idx} href={ev.url} target="_blank" rel="noreferrer"
                              title={ev.title}
                              className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant/30 text-outline hover:text-primary hover:border-primary/50 transition-all rounded-xl text-xs font-medium group">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={faviconUrl}
                                alt={domain}
                                width={16}
                                height={16}
                                className="w-4 h-4 rounded-sm opacity-80 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                              />
                              <span className="truncate max-w-[120px]">{domain}</span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* ── REPORT BUTTON / FORM ──────────────── */}
                <div className="flex justify-end pt-8 mt-4 border-t border-outline-variant/10">
                  {!isReporting ? (
                    <button 
                      onClick={() => setIsReporting(true)}
                      className="flex items-center gap-2 px-4 py-2 border border-error/40 text-error hover:bg-error/10 hover:border-error transition-all rounded-xl text-xs font-bold uppercase tracking-widest"
                    >
                      <span className="material-symbols-outlined text-sm">flag</span>
                      Report Feedback
                    </button>
                  ) : (
                    <div className="w-full md:w-1/2 bg-surface-container-low border border-error/20 p-4 rounded-2xl flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2">
                      <div className="flex flex-col gap-1 relative">
                        <label className="text-[10px] uppercase tracking-widest font-bold text-error">Submit Feedback</label>
                        <textarea 
                          value={reportText}
                          onChange={(e) => setReportText(e.target.value)}
                          spellCheck="true"
                          autoCorrect="on"
                          autoComplete="on"
                          placeholder="Type your review or report about the result..."
                          className="w-full bg-surface-container-highest border border-outline-variant/30 rounded-xl p-3 text-sm text-on-surface placeholder:text-outline focus:outline-none focus:border-error/50 min-h-[100px] resize-y"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button 
                          onClick={() => { setIsReporting(false); setReportText(""); }}
                          className="px-4 py-2 text-xs font-bold uppercase tracking-widest text-outline hover:text-on-surface transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => {
                            if (!reportText.trim()) return;
                            const newReport = {
                              topic: input.trim() || selectedFile?.name || "General Feedback",
                              timestamp: new Date().toLocaleString('sv-SE', { hour12: false }).substring(0, 16),
                              text: reportText.trim()
                            };
                            const updated = [newReport, ...userReports];
                            setUserReports(updated);
                            localStorage.setItem("user_reports", JSON.stringify(updated));
                            setIsReporting(false);
                            setReportText("");
                          }}
                          className="px-4 py-2 text-xs font-bold uppercase tracking-widest bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white transition-colors rounded-lg"
                        >
                          Submit Report
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
              <button onClick={() => { localStorage.removeItem(isLoggedIn ? 'factcheck_history' : 'factcheck_history_guest'); setHistory([]); }}
                className="text-[9px] font-label uppercase text-error tracking-widest border border-error/30 px-4 py-2 hover:bg-error/10 transition-all">
                Purge Logs
              </button>
            </div>

            <div className="bg-surface-container-low border border-outline-variant/20 overflow-hidden rounded-2xl border-l-4 border-primary shadow-[inset_6px_0_15px_-6px_rgba(183,196,255,0.5)]">
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

        {/* ── PROFILE VIEW ─────────────────────────── */}
        {currentView === 'profile' && (() => {
          const avgScore = history.length > 0 
            ? Math.round(history.reduce((acc, h) => acc + h.score, 0) / history.length) 
            : 0;
          const agentRank = avgScore > 85 ? 'ORACLE' : avgScore > 65 ? 'FACT-CHECKER' : avgScore > 40 ? 'SKEPTIC' : 'APPRENTICE';
          
          return (
            <section className="space-y-12 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="relative h-48 md:h-64 bg-surface-container-high overflow-hidden border border-outline-variant/20 rounded-2xl">
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-transparent"></div>
                <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none" 
                  style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, var(--primary) 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
                <div className="absolute bottom-8 left-8 md:left-12 flex items-end gap-6">
                  <div className="w-32 h-32 md:w-44 md:h-44 bg-surface-container-lowest border-4 border-surface ring-1 ring-primary/20 shadow-glow rounded-full overflow-hidden flex items-center justify-center">
                    <img 
                      src={isLoggedIn ? "/profile_pravin.jpg" : "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=mp&f=y"} 
                      alt={isLoggedIn ? "Pravin Kumar" : "Guest User"} 
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="pb-4">
                    <div className="flex flex-col mb-1">
                      <span className="font-headline text-2xl font-black uppercase tracking-[0.3em] text-primary">{isLoggedIn ? "NEWCOMERS" : "UNREGISTERED"}</span>
                      <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline font-bold">{isLoggedIn ? "College: HIT Kolkata" : "Visitor"}</span>
                    </div>
                    <h2 className="font-headline text-4xl md:text-6xl font-black uppercase tracking-tighter text-on-surface leading-none">{isLoggedIn ? "Pravin Kumar" : "Guest User"}</h2>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { label: 'Total Verifications', val: history.length, sub: 'Claims processed in current ledger', icon: 'database' },
                  { label: 'Mean Reliability', val: `${avgScore}%`, sub: 'Average trust score across all nodes', icon: 'analytics' },
                  { label: 'Intelligence Rank', val: agentRank, sub: 'Ranked based on truth-to-noise ratio', icon: 'verified' },
                ].map(stat => (
                  <div key={stat.label} className="bg-surface-container-low p-8 border border-outline-variant/20 shadow-panel hover:border-primary/40 transition-all group rounded-2xl">
                    <div className="flex justify-between items-start mb-6">
                      <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline">{stat.label}</span>
                      <span className="material-symbols-outlined text-primary group-hover:scale-110 transition-transform">{stat.icon}</span>
                    </div>
                    <div className="text-4xl font-headline font-black text-on-surface mb-2">{stat.val}</div>
                    <div className="text-[10px] uppercase tracking-widest text-outline">{stat.sub}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-surface-container-low border border-outline-variant/30 p-8 space-y-6 rounded-2xl">
                  <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-sm">history</span>
                    Recent Activity Pulse
                  </h3>
                  <div className="space-y-4">
                    {history.slice(0, 5).map((item, i) => (
                      <div key={i} className="flex justify-between items-center p-4 border-b border-outline-variant/20 hover:bg-surface-container-high/30 transition-colors">
                        <div className="space-y-1">
                          <div className="text-[11px] text-on-surface font-medium truncate max-w-[200px] md:max-w-xs">{item.claim}</div>
                          <div className="text-[9px] text-outline uppercase tracking-wider">{item.timestamp}</div>
                        </div>
                        <div className="text-[10px] font-black text-primary">{item.score}%</div>
                      </div>
                    ))}
                    {history.length === 0 && (
                      <div className="py-12 text-center text-outline text-[10px] uppercase tracking-widest italic">No pulses detected.</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div className="bg-surface-container-low border border-outline-variant/30 p-8 space-y-6 rounded-2xl">
                  <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-sm">groups</span>
                    Squad Registry — Newcomers
                  </h3>
                  <div className="space-y-4">
                    <div className="bg-primary/5 border border-primary/20 p-4 flex items-center gap-4 group hover:bg-primary/10 transition-all rounded-xl">
                      <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center text-primary">
                        <span className="material-symbols-outlined text-sm">star</span>
                      </div>
                      <div>
                        <span className="font-label text-[9px] uppercase tracking-widest text-primary block">Team Leader</span>
                        <div className="text-sm font-bold text-on-surface">Devraj Mandel</div>
                      </div>
                    </div>
                    <div className="bg-surface-container border border-outline-variant/20 p-4 flex items-center gap-4 group hover:bg-surface-container-high transition-all rounded-xl">
                      <div className="w-10 h-10 bg-outline/10 rounded-full flex items-center justify-center text-outline">
                        <span className="material-symbols-outlined text-sm">person</span>
                      </div>
                      <div>
                        <span className="font-label text-[9px] uppercase tracking-widest text-outline block">Active Member</span>
                        <div className="text-sm font-bold text-on-surface">Ansh Kumar</div>
                      </div>
                    </div>
                    <div className="bg-surface-container border border-outline-variant/20 p-4 flex items-center gap-4 group hover:bg-surface-container-high transition-all rounded-xl">
                      <div className="w-10 h-10 bg-outline/10 rounded-full flex items-center justify-center text-outline">
                        <span className="material-symbols-outlined text-sm">person</span>
                      </div>
                      <div>
                        <span className="font-label text-[9px] uppercase tracking-widest text-outline block">Active Member</span>
                        <div className="text-sm font-bold text-on-surface">Pravin Kumar (You)</div>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* User Reports */}
                <div className="bg-surface-container-low border border-outline-variant/30 p-8 space-y-6 rounded-2xl flex flex-col h-full">
                  <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-sm">forum</span>
                    User Reports
                  </h3>
                  <div className="space-y-4 flex-1 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                    {userReports.length > 0 ? userReports.map((r, i) => (
                      <div 
                        key={i} 
                        onClick={() => setExpandedReport(expandedReport === i ? null : i)}
                        className="bg-surface-container border border-error/20 p-4 rounded-xl space-y-3 group hover:border-error/40 transition-all cursor-pointer"
                      >
                        <div className="flex justify-between items-center">
                          <div className="text-[9px] text-outline uppercase tracking-wider font-mono">
                            {r.topic ? <span className="text-primary font-bold">{r.topic}</span> : 'Report'}
                            <span className="opacity-50"> • {r.timestamp}</span>
                          </div>
                          <span 
                            className="material-symbols-outlined text-outline text-sm transition-transform duration-300" 
                            style={{ transform: expandedReport === i ? 'rotate(180deg)' : 'rotate(0deg)' }}
                          >
                            expand_more
                          </span>
                        </div>
                        {expandedReport === i && (
                          <div className="pt-3 border-t border-error/10 animate-in fade-in slide-in-from-top-1">
                            <p className="text-xs text-on-surface leading-relaxed">{r.text}</p>
                          </div>
                        )}
                      </div>
                    )) : (
                      <div className="py-12 text-center text-outline text-[10px] uppercase tracking-widest italic border border-dashed border-outline-variant/20 rounded-xl">No reports submitted.</div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                    <button 
                      onClick={() => setIsLoggedIn(!isLoggedIn)}
                      className={`font-headline font-bold uppercase tracking-[0.1em] py-2 px-6 text-xs transition-all flex items-center justify-center gap-2 rounded-lg border ${
                        isLoggedIn 
                          ? "bg-error/10 text-error border-error/30 hover:bg-error hover:text-white" 
                          : "bg-[#00ff88]/10 text-[#00ff88] border-[#00ff88]/30 hover:bg-[#00ff88] hover:text-black"
                      }`}
                    >
                      <span className="material-symbols-outlined text-sm">{isLoggedIn ? 'logout' : 'login'}</span>
                      {isLoggedIn ? 'Log Out' : 'Log In'}
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  {isLoggedIn && (
                    <div className="bg-primary/5 border border-primary/20 p-8 space-y-4 rounded-2xl">
                      <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-primary">System Credentials</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-outline">Access Tier:</span>
                          <span className="text-primary font-black uppercase">Root Intelligence</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-outline">Verification Mode:</span>
                          <span className="text-primary font-black uppercase">Multi-Agent Hybrid</span>
                        </div>
                        <div className="flex justify-between text-[11px]">
                          <span className="text-outline">Encryption Status:</span>
                          <span className="text-[#00ff88] font-black uppercase">Active AES-256</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  <button 
                    onClick={() => setCurrentView('terminal')}
                    className="w-full bg-surface-container-highest border border-outline-variant text-on-surface font-headline font-black uppercase tracking-[0.2em] py-5 text-sm hover:border-primary transition-all flex items-center justify-center gap-2 rounded-xl"
                  >
                    <span className="material-symbols-outlined text-sm">arrow_back</span>
                    Return to Terminal
                  </button>
                </div>



              </div>
            </section>
          );
        })()}

        {/* ── SYSTEM VIEW ─────────────────────────── */}
        {currentView === 'system' && (
          <section className="space-y-8 pb-32">
            <div className="border-l-4 border-primary pl-8 flex items-end justify-between">
              <div>
                <span className="font-label text-[10px] uppercase tracking-[0.2em] text-outline block mb-2">Axiom Pipeline — System Diagnostics</span>
                <h2 className="font-headline text-4xl font-black uppercase tracking-tighter text-on-surface">Node Registry</h2>
              </div>
              <button 
                onClick={fetchCache}
                className="text-[9px] font-label uppercase text-primary tracking-widest border border-primary/30 px-4 py-2 hover:bg-primary/10 transition-all flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-xs">sync</span> Refresh Cache
              </button>
            </div>

            {/* ── AXIOM INTELLIGENCE (CACHE MONITOR) ── */}
            <div className="bg-surface-container-low border border-outline-variant/30 p-8 space-y-8 shadow-panel rounded-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 flex items-center justify-center border border-primary/20">
                    <span className="material-symbols-outlined text-primary text-xl">psychology</span>
                  </div>
                  <div>
                    <h3 className="font-headline font-bold uppercase tracking-widest text-xs text-on-surface">Axiom Intelligence</h3>
                    <p className="text-outline text-[10px] uppercase tracking-wider">Top 5 Instant-Response Latency Profiles</p>
                  </div>
                </div>
                <span className="text-[9px] font-black uppercase tracking-widest px-3 py-1 border text-primary border-primary/40 bg-primary/5">
                  LRU ACTIVE
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {cachedReports.map((entry, idx) => (
                  <div key={idx} className="bg-surface-container border border-outline-variant/20 p-6 flex flex-col justify-between group hover:border-primary/40 transition-all rounded-2xl">
                    <div className="space-y-4">
                      <div className="flex justify-between items-start">
                        <span className="text-[9px] font-mono text-outline uppercase tracking-tighter">Report ID :: {entry.report.totalClaims}C-{Math.floor(entry.report.overallTrustScore)}</span>
                        <div className="w-2 h-2 bg-[#00ff88] rounded-full shadow-[0_0_8px_#00ff88]"></div>
                      </div>
                      <p className="text-xs font-medium text-on-surface leading-normal line-clamp-3 italic">"{entry.query}"</p>
                      
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-1 bg-surface-container-highest">
                          <div className="h-full bg-primary" style={{ width: `${entry.report.overallTrustScore}%` }}></div>
                        </div>
                        <span className="text-[10px] font-black text-primary">{Math.round(entry.report.overallTrustScore)}%</span>
                      </div>
                    </div>

                    <button 
                      onClick={() => {
                        setReportData(entry.report);
                        setStep('complete');
                        setCurrentView('nodes');
                      }}
                      className="mt-6 w-full py-2 bg-primary/5 border border-primary/20 text-primary text-[10px] font-black uppercase tracking-[0.2em] hover:bg-primary hover:text-white transition-all"
                    >
                      Instant Load
                    </button>
                  </div>
                ))}
                {cachedReports.length === 0 && (
                  <div className="col-span-full py-12 text-center border border-dashed border-outline-variant/30 text-outline text-[11px] uppercase tracking-widest">
                    Intelligence memory empty. Perform searches to populate cache.
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {[
                { icon: 'smart_toy', label: 'AI Inference Engine', status: 'ONLINE', sub: 'Google Gemini 2.0 Flash · Groq Fallback Active', ok: true },
                { icon: 'travel_explore', label: 'Evidence Retrieval', status: 'ONLINE', sub: 'Wikipedia Open API · No rate limits', ok: true },
                { icon: 'storage', label: 'Local History Ledger', status: 'ACTIVE', sub: 'Browser LocalStorage · Encrypted', ok: true },
                { icon: 'key', label: 'API Authentication', status: 'CONFIGURED', sub: 'GEMINI_API_KEY loaded from .env.local', ok: true },
              ].map(card => (
                <div key={card.label} className={`bg-surface-container-low p-6 border rounded-2xl ${card.ok ? 'border-primary/20' : 'border-error/30'}`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-surface-container flex items-center justify-center border border-outline-variant/20 rounded-xl">
                        <span className="material-symbols-outlined text-primary text-xl">{card.icon}</span>
                      </div>
                      <span className="font-headline font-bold uppercase text-xs tracking-widest text-on-surface">{card.label}</span>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 border rounded-full ${card.ok ? 'text-[#00ff88] border-[#00ff88] bg-[#00ff88]/5' : 'text-error border-error/40'}`}>
                      {card.status}
                    </span>
                  </div>
                  <p className="text-outline text-[11px] pl-[52px]">{card.sub}</p>
                </div>
              ))}
            </div>

            <div className="bg-surface-container-low border border-outline-variant/20 p-8 space-y-4 rounded-2xl">
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
                <div key={i} className="flex gap-4 items-start p-3 bg-surface-container border-l-2 border-primary/20 hover:border-primary/60 transition-all rounded-xl">
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

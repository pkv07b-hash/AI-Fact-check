"use client";

import React, { useState } from 'react';
import { AccuracyReport, VerifiedClaim } from '@/lib/verifier';
import './Report.css'; // We'll create a local CSS for styling details

interface ReportProps {
  report: AccuracyReport;
}

function StatusBadge({ status }: { status: string }) {
  let colorClass = "status-unverifiable-badge";
  if (status === "True") colorClass = "status-true-badge";
  if (status === "False") colorClass = "status-false-badge";
  if (status === "Partially True") colorClass = "status-partial-badge";

  return <span className={`status-badge ${colorClass}`}>{status}</span>;
}

function ClaimCard({ claim, index }: { claim: VerifiedClaim; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="claim-card glass-panel" style={{ animationDelay: `${index * 0.1}s` }}>
      <div className="claim-header" onClick={() => setExpanded(!expanded)}>
        <div className="claim-title">
          <h4>"{claim.claim}"</h4>
          <div className="claim-meta">
            <StatusBadge status={claim.status} />
            <span className="confidence-score">Confidence: {claim.confidenceScore}%</span>
          </div>
        </div>
        <button className="expand-btn">
          {expanded ? "−" : "+"}
        </button>
      </div>

      {expanded && (
        <div className="claim-details">
          <div className="reasoning-box">
             <h5>AI Reasoning</h5>
             <p>{claim.reasoning}</p>
          </div>
          
          <div className="evidence-section">
            <h5>Sources Found ({claim.evidence.results.length})</h5>
            <ul className="source-list">
              {claim.evidence.results.map((res, idx) => (
                <li key={idx} className="source-item">
                  <a href={res.url} target="_blank" rel="noopener noreferrer" className="source-link">
                    {res.title}
                  </a>
                  <p className="source-snippet">"...{res.snippet}..."</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Report({ report }: ReportProps) {
  // Determine overall status color based on trust score
  let scoreColor = "var(--text-secondary)";
  if (report.overallTrustScore >= 80) scoreColor = "var(--accent-green)";
  else if (report.overallTrustScore >= 50) scoreColor = "var(--accent-yellow)";
  else scoreColor = "var(--accent-red)";

  return (
    <div className="report-container animate-fade-in">
      <div className="report-overview glass-panel">
        <div className="score-circle" style={{ borderColor: scoreColor, boxShadow: `0 0 20px ${scoreColor}40` }}>
          <span className="score-value" style={{ color: scoreColor }}>{report.overallTrustScore}%</span>
          <span className="score-label">Trust Score</span>
        </div>
        <div className="overview-stats">
          <h3>Accuracy Report</h3>
          <p>Verified <strong className="highlight">{report.totalClaims}</strong> individual claims across the source.</p>
          <div className="stat-summary">
            <div className="stat-item"><span className="dot dot-green"></span> {report.verifiedClaims.filter(c => c.status === "True").length} True</div>
            <div className="stat-item"><span className="dot dot-yellow"></span> {report.verifiedClaims.filter(c => c.status === "Partially True").length} Partial</div>
            <div className="stat-item"><span className="dot dot-red"></span> {report.verifiedClaims.filter(c => c.status === "False").length} False</div>
          </div>
        </div>
      </div>

      <div className="claims-list">
        <h3>Extracted Claims Breakdown</h3>
        {report.verifiedClaims.map((claim, idx) => (
          <ClaimCard key={claim.id} claim={claim} index={idx} />
        ))}
      </div>
    </div>
  );
}

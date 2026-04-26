/**
 * FORENSIC DEBUG PANEL
 * 
 * Panel de debug forense para mostrar métricas de rechazo del LivePpgEvidenceGate.
 * Este panel es FAIL-CLOSED: muestra explícitamente por qué se rechazó una señal PPG.
 * 
 * Solo visible en modo debug (development).
 */

import React from 'react';
import type { LivePpgEvidenceResult } from '@/modules/signal-processing/LivePpgEvidenceGate';

interface ForensicDebugPanelProps {
  evidenceResult: LivePpgEvidenceResult | null;
  visible: boolean;
  onClose: () => void;
}

export function ForensicDebugPanel({ evidenceResult, visible, onClose }: ForensicDebugPanelProps) {
  if (!visible || !evidenceResult) {
    return null;
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'VALID_LIVE_PPG': return 'text-green-500';
      case 'PROBABLE_PPG': return 'text-yellow-500';
      case 'WEAK': return 'text-orange-500';
      case 'INVALID': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.78) return 'text-green-500';
    if (score >= 0.60) return 'text-yellow-500';
    if (score >= 0.40) return 'text-orange-500';
    return 'text-red-500';
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">FORENSIC DEBUG PANEL - PPG EVIDENCE</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Result Summary */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-3">RESULT SUMMARY</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-gray-400 text-sm">Passed:</span>
                <span className={`ml-2 font-bold ${evidenceResult.passed ? 'text-green-500' : 'text-red-500'}`}>
                  {evidenceResult.passed ? 'YES' : 'NO'}
                </span>
              </div>
              <div>
                <span className="text-gray-400 text-sm">Hard Fail:</span>
                <span className={`ml-2 font-bold ${evidenceResult.hardFail ? 'text-red-500' : 'text-gray-500'}`}>
                  {evidenceResult.hardFail ? 'YES' : 'NO'}
                </span>
              </div>
              <div>
                <span className="text-gray-400 text-sm">Tier:</span>
                <span className={`ml-2 font-bold ${getTierColor(evidenceResult.tier)}`}>
                  {evidenceResult.tier}
                </span>
              </div>
              <div>
                <span className="text-gray-400 text-sm">Score:</span>
                <span className={`ml-2 font-bold ${getScoreColor(evidenceResult.score)}`}>
                  {evidenceResult.score.toFixed(3)}
                </span>
              </div>
            </div>
          </div>

          {/* Rejection Reasons */}
          {evidenceResult.reasons.length > 0 && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold text-white mb-3">REJECTION REASONS</h3>
              <ul className="space-y-2">
                {evidenceResult.reasons.map((reason, index) => (
                  <li key={index} className="text-red-400 text-sm font-mono">
                    • {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Metrics */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-white mb-3">METRICS</h3>
            <div className="space-y-2">
              {Object.entries(evidenceResult.metrics).map(([key, value]) => (
                <div key={key} className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">{key}:</span>
                  <span className="font-mono text-gray-300">
                    {typeof value === 'number' ? value.toFixed(3) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ForensicDebugPanel;

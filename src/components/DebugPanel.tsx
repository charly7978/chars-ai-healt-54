import React from 'react';
import { X } from 'lucide-react';
import type { VitalSignsResult } from '@/modules/vital-signs/VitalSignsProcessor';
import type { ProcessedSignal } from '@/types/signal';

interface DebugPanelProps {
  open: boolean;
  onClose: () => void;
  lastSignal: ProcessedSignal | null;
  vitalSigns: VitalSignsResult;
  positionQuality: { locked: boolean; drifting: boolean; spatialUniformity: number; centerCoverage: number; positionDrift: number; guidance: string; qualityScore: number };
  realFps?: number;
  processingTimeMs?: number;
  cameraDriftScore?: number;
}

const Row: React.FC<{ k: string; v: string | number; tone?: 'ok' | 'warn' | 'bad' | 'info' }> = ({ k, v, tone = 'info' }) => {
  const color =
    tone === 'ok' ? 'text-emerald-400' :
    tone === 'warn' ? 'text-amber-400' :
    tone === 'bad' ? 'text-red-400' :
    'text-slate-300';
  return (
    <div className="flex justify-between items-center text-[11px] px-2 py-1 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-400">{k}</span>
      <span className={color + ' font-mono tabular-nums'}>{v}</span>
    </div>
  );
};

/**
 * DebugPanel (Phase 16) — surfaces the live telemetry that powers the
 * pipeline: contact, pressure, source ranker, FPS, exposure drift, OD,
 * source SQI, HRV/stress/resp/hemo. Read-only; intended for power users
 * and clinicians inspecting why a value was emitted/withheld.
 */
const DebugPanel: React.FC<DebugPanelProps> = ({
  open,
  onClose,
  lastSignal,
  vitalSigns,
  positionQuality,
  realFps,
  processingTimeMs,
  cameraDriftScore,
}) => {
  if (!open) return null;

  const tel: any = lastSignal?.telemetry ?? {};
  const sourceSQI = tel.allSourceSQI ?? {};
  const sourceEntries = Object.keys(sourceSQI).sort((a, b) => (sourceSQI[b] ?? 0) - (sourceSQI[a] ?? 0));

  const hrv = vitalSigns.hrv;
  const stress = vitalSigns.stress;
  const resp = vitalSigns.respiration;
  const hb = vitalSigns.hemoglobin;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-950 border border-slate-700/60 rounded-2xl w-[96%] max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-white text-sm font-bold">Debug Panel</div>
            <div className="text-slate-500 text-[10px]">Live cPPG telemetry</div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="overflow-y-auto px-2 py-2">
          {/* Camera */}
          <div className="text-slate-500 text-[10px] uppercase tracking-wide px-2 mt-2">Camera</div>
          <Row k="Real FPS" v={realFps !== undefined ? realFps.toFixed(1) : '—'} tone={realFps && realFps >= 24 ? 'ok' : 'warn'} />
          <Row k="Processing (ms/frame)" v={processingTimeMs !== undefined ? processingTimeMs.toFixed(2) : '—'} tone={processingTimeMs !== undefined && processingTimeMs < 8 ? 'ok' : 'warn'} />
          <Row k="Exposure drift" v={cameraDriftScore !== undefined ? cameraDriftScore.toFixed(2) : '—'} tone={cameraDriftScore !== undefined && cameraDriftScore > 0.2 ? 'bad' : 'ok'} />

          {/* Contact + position */}
          <div className="text-slate-500 text-[10px] uppercase tracking-wide px-2 mt-3">Contact / Position</div>
          <Row k="Contact state" v={lastSignal?.contactState ?? 'NO_CONTACT'}
               tone={lastSignal?.contactState === 'STABLE_CONTACT' ? 'ok' : lastSignal?.contactState === 'UNSTABLE_CONTACT' ? 'warn' : 'bad'} />
          <Row k="Position locked" v={positionQuality.locked ? 'YES' : 'NO'} tone={positionQuality.locked ? 'ok' : 'warn'} />
          <Row k="Position drift" v={positionQuality.positionDrift.toFixed(3)} tone={positionQuality.drifting ? 'bad' : 'ok'} />
          <Row k="Coverage" v={tel.coverageRatio !== undefined ? `${(tel.coverageRatio * 100).toFixed(0)}%` : '—'} />
          <Row k="Spatial uniformity" v={tel.spatialUniformity !== undefined ? tel.spatialUniformity.toFixed(2) : '—'} />
          <Row k="Pressure" v={tel.pressureState ?? '—'}
               tone={tel.pressureState === 'OPTIMAL_PRESSURE' ? 'ok' : 'warn'} />
          <Row k="Motion score" v={tel.motionScore !== undefined ? tel.motionScore.toFixed(2) : '—'}
               tone={(tel.motionScore ?? 0) > 0.6 ? 'bad' : 'ok'} />
          <Row k="Clip high" v={tel.clipHighRatio !== undefined ? `${(tel.clipHighRatio * 100).toFixed(1)}%` : '—'}
               tone={(tel.clipHighRatio ?? 0) > 0.1 ? 'bad' : 'ok'} />

          {/* Sources */}
          <div className="text-slate-500 text-[10px] uppercase tracking-wide px-2 mt-3">Source ranker</div>
          <Row k="Active source" v={tel.activeSourceLabel ?? '—'} tone="info" />
          <Row k="Source stability" v={tel.sourceStability !== undefined ? tel.sourceStability.toFixed(2) : '—'} />
          {sourceEntries.slice(0, 6).map(label => (
            <Row key={label} k={`SQI[${label}]`} v={typeof sourceSQI[label] === 'number' ? sourceSQI[label].toFixed(1) : '—'} />
          ))}

          {/* Beer-Lambert */}
          <div className="text-slate-500 text-[10px] uppercase tracking-wide px-2 mt-3">Beer-Lambert</div>
          <Row k="OD R / G / B" v={`${(tel.odR ?? 0).toFixed(2)} / ${(tel.odG ?? 0).toFixed(2)} / ${(tel.odB ?? 0).toFixed(2)}`} />
          <Row k="Lin RGB" v={`${Math.round(tel.linRed ?? 0)} / ${Math.round(tel.linGreen ?? 0)} / ${Math.round(tel.linBlue ?? 0)}`} />
          <Row k="Perfusion index" v={lastSignal?.perfusionIndex !== undefined ? lastSignal.perfusionIndex.toFixed(2) : '—'} />

          {/* HRV / Stress / Resp / Hb */}
          <div className="text-slate-500 text-[10px] uppercase tracking-wide px-2 mt-3">HRV / Stress / Resp / Hb</div>
          <Row k="SDNN (ms)" v={hrv ? hrv.time.sdnn.toFixed(1) : '—'} />
          <Row k="RMSSD (ms)" v={hrv ? hrv.time.rmssd.toFixed(1) : '—'} />
          <Row k="pNN50" v={hrv ? hrv.time.pnn50.toFixed(2) : '—'} />
          <Row k="LF / HF / LFHF" v={hrv ? `${hrv.freq.lfPower.toFixed(0)} / ${hrv.freq.hfPower.toFixed(0)} / ${hrv.freq.lfHfRatio.toFixed(2)}` : '—'} />
          <Row k="DFA α1" v={hrv ? hrv.nonlinear.dfaAlpha1.toFixed(2) : '—'} />
          <Row k="SampEn" v={hrv ? hrv.nonlinear.sampEn.toFixed(2) : '—'} />
          <Row k="Stress index" v={stress ? `${stress.index} (${stress.label})` : '—'}
               tone={stress && stress.index > 75 ? 'bad' : stress && stress.index > 50 ? 'warn' : 'ok'} />
          <Row k="Resp (brpm)" v={resp ? resp.brpm.toFixed(1) : '—'} />
          <Row k="Resp confidence" v={resp ? resp.confidence.toFixed(2) : '—'} />
          <Row k="Hb (g/dL)" v={hb && typeof hb.value === 'number' ? (hb.value as number).toFixed(1) : '—'} />
          <Row k="Hb mode" v={hb ? (hb.researchMode ? 'RESEARCH' : 'CALIBRATED') : '—'} />

          {/* Output gates */}
          {vitalSigns.outputStates && (
            <>
              <div className="text-slate-500 text-[10px] uppercase tracking-wide px-2 mt-3">Output gates</div>
              {Object.entries(vitalSigns.outputStates).map(([k, v]) => (
                <Row key={k} k={k} v={String(v)} tone={String(v).includes('HIGH') ? 'ok' : String(v).includes('WITHHELD') ? 'bad' : 'warn'} />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DebugPanel;

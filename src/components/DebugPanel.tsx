/**
 * DEBUG PANEL PROFESSIONAL - FASE 13
 * 
 * Panel de diagnóstico y telemetría para desarrollo e investigación.
 * Activable mediante gesture secreto o config flag.
 * 
 * Secciones:
 * 1. Camera Telemetry - FPS, torch, exposure, histograms
 * 2. Signal Pipeline - Raw/filtered PPG, OD signals, derivatives
 * 3. ROI & Tiles - Mask, scores, top tiles
 * 4. Beat Detection - Candidates, accepted/rejected
 * 5. Quality Metrics - SQI breakdown, flags
 * 6. Calibration Status - SpO2, BP, Glucose, Lipids
 * 7. Export - JSON session dump
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { MeasurementFrameState, MeasurementOutput } from '../types/measurement';

interface DebugPanelProps {
  isVisible: boolean;
  onToggle: () => void;
  frameState?: MeasurementFrameState;
  bpmOutput?: MeasurementOutput<number>;
  spo2Output?: MeasurementOutput<number>;
  bpOutput?: MeasurementOutput<{ systolic: number; diastolic: number }>;
  arrhythmiaOutput?: MeasurementOutput<string>;
  sessionStartTime?: number;
  onExportSession?: () => void;
}

interface TelemetryHistory {
  fps: number[];
  sqi: number[];
  contactScore: number[];
  motionScore: number[];
  timestamps: number[];
}

const MAX_HISTORY = 300; // 10 seconds at 30fps

export const DebugPanel: React.FC<DebugPanelProps> = ({
  isVisible,
  onToggle,
  frameState,
  bpmOutput,
  spo2Output,
  bpOutput,
  arrhythmiaOutput,
  sessionStartTime,
  onExportSession,
}) => {
  const [activeTab, setActiveTab] = useState<'camera' | 'signal' | 'roi' | 'beats' | 'quality' | 'calibration'>('camera');
  const [isMinimized, setIsMinimized] = useState(false);
  const historyRef = useRef<TelemetryHistory>({
    fps: [],
    sqi: [],
    contactScore: [],
    motionScore: [],
    timestamps: [],
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Update history
  useEffect(() => {
    if (!frameState) return;
    
    const history = historyRef.current;
    history.fps.push(frameState.fpsMeasured);
    history.sqi.push(frameState.signalQuality.sqi);
    history.contactScore.push(frameState.fingerContact.score);
    history.motionScore.push(frameState.motion.score);
    history.timestamps.push(frameState.timestamp);
    
    // Trim
    if (history.fps.length > MAX_HISTORY) {
      history.fps.shift();
      history.sqi.shift();
      history.contactScore.shift();
      history.motionScore.shift();
      history.timestamps.shift();
    }
  }, [frameState]);
  
  // Draw mini charts
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isMinimized) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const history = historyRef.current;
    if (history.fps.length < 2) return;
    
    const w = canvas.width;
    const h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    // Draw SQI chart
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < history.sqi.length; i++) {
      const x = (i / MAX_HISTORY) * w;
      const y = h - (history.sqi[i] * h * 0.5);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Draw contact score
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    for (let i = 0; i < history.contactScore.length; i++) {
      const x = (i / MAX_HISTORY) * w;
      const y = h - (history.contactScore[i] * h * 0.5) - h * 0.25;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Draw motion score
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    for (let i = 0; i < history.motionScore.length; i++) {
      const x = (i / MAX_HISTORY) * w;
      const y = h - (history.motionScore[i] * h * 0.25);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [frameState, isMinimized, activeTab]);
  
  if (!isVisible) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-4 right-4 z-50 bg-slate-800/80 text-white px-3 py-2 rounded-lg text-xs font-mono hover:bg-slate-700 transition-colors"
      >
        🔧 Debug
      </button>
    );
  }
  
  const history = historyRef.current;
  const avgFPS = history.fps.length > 0 
    ? history.fps.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, history.fps.length)
    : 0;
  
  return (
    <div className={`fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 border-t border-slate-700 transition-all duration-300 ${isMinimized ? 'h-12' : 'h-80'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <span className="text-white font-mono text-sm font-bold">PPG Debug</span>
          
          {/* Mini metrics */}
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className={avgFPS >= 25 ? 'text-green-400' : avgFPS >= 15 ? 'text-yellow-400' : 'text-red-400'}>
              FPS:{avgFPS.toFixed(1)}
            </span>
            {frameState && (
              <>
                <span className={frameState.signalQuality.sqi > 0.6 ? 'text-green-400' : frameState.signalQuality.sqi > 0.3 ? 'text-yellow-400' : 'text-red-400'}>
                  SQI:{(frameState.signalQuality.sqi * 100).toFixed(0)}%
                </span>
                <span className={frameState.fingerContact.score > 0.7 ? 'text-green-400' : 'text-yellow-400'}>
                  CNT:{(frameState.fingerContact.score * 100).toFixed(0)}%
                </span>
                <span className={frameState.motion.score < 0.2 ? 'text-green-400' : frameState.motion.score < 0.5 ? 'text-yellow-400' : 'text-red-400'}>
                  MOT:{(frameState.motion.score * 100).toFixed(0)}%
                </span>
              </>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="text-slate-400 hover:text-white px-2"
          >
            {isMinimized ? '▲' : '▼'}
          </button>
          <button
            onClick={onToggle}
            className="text-slate-400 hover:text-white px-2"
          >
            ✕
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <>
          {/* Tabs */}
          <div className="flex border-b border-slate-800">
            {(['camera', 'signal', 'roi', 'beats', 'quality', 'calibration'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-mono uppercase transition-colors ${
                  activeTab === tab 
                    ? 'bg-slate-800 text-white border-b-2 border-blue-500' 
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          
          {/* Content */}
          <div className="p-4 h-64 overflow-auto">
            {activeTab === 'camera' && (
              <CameraTab frameState={frameState} canvasRef={canvasRef} />
            )}
            {activeTab === 'signal' && (
              <SignalTab frameState={frameState} />
            )}
            {activeTab === 'roi' && (
              <ROITab frameState={frameState} />
            )}
            {activeTab === 'beats' && (
              <BeatsTab frameState={frameState} />
            )}
            {activeTab === 'quality' && (
              <QualityTab 
                frameState={frameState}
                bpmOutput={bpmOutput}
                spo2Output={spo2Output}
                bpOutput={bpOutput}
                arrhythmiaOutput={arrhythmiaOutput}
              />
            )}
            {activeTab === 'calibration' && (
              <CalibrationTab 
                spo2Output={spo2Output}
                bpOutput={bpOutput}
                onExportSession={onExportSession}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
//  SUB-COMPONENTES
// ═══════════════════════════════════════════════════════════════════

const CameraTab: React.FC<{ 
  frameState?: MeasurementFrameState; 
  canvasRef: React.RefObject<HTMLCanvasElement>;
}> = ({ frameState, canvasRef }) => {
  if (!frameState) return <div className="text-slate-400 text-sm">No frame data</div>;
  
  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Hardware */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Hardware</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Torch:</span>
            <span className={frameState.hardware.torchState === 'on' ? 'text-green-400' : 'text-yellow-400'}>
              {frameState.hardware.torchState}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Exposure:</span>
            <span className={frameState.hardware.exposureState === 'locked' ? 'text-green-400' : 'text-yellow-400'}>
              {frameState.hardware.exposureState}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">WB:</span>
            <span className={frameState.hardware.whiteBalanceState === 'locked' ? 'text-green-400' : 'text-yellow-400'}>
              {frameState.hardware.whiteBalanceState}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Drift:</span>
            <span className={frameState.hardware.exposureDriftScore < 0.1 ? 'text-green-400' : 'text-yellow-400'}>
              {(frameState.hardware.exposureDriftScore * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
      
      {/* Color Stats */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Color Stats</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-red-400">R:</span>
            <span className="text-slate-300">μ={frameState.colorStats.meanR.toFixed(1)} σ={frameState.colorStats.stdR.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-400">G:</span>
            <span className="text-slate-300">μ={frameState.colorStats.meanG.toFixed(1)} σ={frameState.colorStats.stdG.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-400">B:</span>
            <span className="text-slate-300">μ={frameState.colorStats.meanB.toFixed(1)} σ={frameState.colorStats.stdB.toFixed(1)}</span>
          </div>
          <div className="border-t border-slate-700 pt-1 mt-1">
            <span className="text-slate-400">Range: </span>
            <span className="text-slate-300">{frameState.saturationStats.dynamicRange.toFixed(0)}</span>
          </div>
        </div>
      </div>
      
      {/* History Chart */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">History (10s)</h4>
        <canvas 
          ref={canvasRef}
          width={200}
          height={80}
          className="w-full h-20"
        />
        <div className="flex gap-3 mt-1 text-[10px] font-mono">
          <span className="text-green-400">● SQI</span>
          <span className="text-blue-400">● Contact</span>
          <span className="text-red-400">● Motion</span>
        </div>
      </div>
    </div>
  );
};

const SignalTab: React.FC<{ frameState?: MeasurementFrameState }> = ({ frameState }) => {
  if (!frameState) return <div className="text-slate-400 text-sm">No signal data</div>;
  
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Raw Channels */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Raw Channels</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-red-400">Red:</span>
            <span className="text-slate-300">{frameState.rawChannels.red.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-400">Green:</span>
            <span className="text-slate-300">{frameState.rawChannels.green.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-400">Blue:</span>
            <span className="text-slate-300">{frameState.rawChannels.blue.toFixed(2)}</span>
          </div>
          <div className="border-t border-slate-700 pt-1 mt-1">
            <span className="text-slate-400">Luma: </span>
            <span className="text-slate-300">{frameState.rawChannels.luma.toFixed(2)}</span>
          </div>
        </div>
      </div>
      
      {/* Optical Density */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Optical Density</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-red-400">OD Red:</span>
            <span className="text-slate-300">{frameState.rawChannels.odRed.toFixed(3)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-400">OD Green:</span>
            <span className="text-slate-300">{frameState.rawChannels.odGreen.toFixed(3)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-400">OD Blue:</span>
            <span className="text-slate-300">{frameState.rawChannels.odBlue.toFixed(3)}</span>
          </div>
        </div>
      </div>
      
      {/* Processed Signal */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Processed</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Fused:</span>
            <span className="text-white font-bold">{frameState.processed.fusedSignal.toFixed(3)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Channel:</span>
            <span className="text-slate-300">{frameState.processed.fusedChannel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Derivative:</span>
            <span className={frameState.processed.derivative1 > 0 ? 'text-green-400' : 'text-red-400'}>
              {frameState.processed.derivative1 > 0 ? '+' : ''}{frameState.processed.derivative1.toFixed(3)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">2nd Deriv:</span>
            <span className="text-slate-300">{frameState.processed.derivative2.toFixed(3)}</span>
          </div>
        </div>
      </div>
      
      {/* Perfusion */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Perfusion</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Overall:</span>
            <span className={frameState.perfusion.index > 0.02 ? 'text-green-400' : 'text-yellow-400'}>
              {(frameState.perfusion.index * 100).toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-red-400">Red:</span>
            <span className="text-slate-300">{(frameState.perfusion.indexRed * 100).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-400">Green:</span>
            <span className="text-slate-300">{(frameState.perfusion.indexGreen * 100).toFixed(2)}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-blue-400">Blue:</span>
            <span className="text-slate-300">{(frameState.perfusion.indexBlue * 100).toFixed(2)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const ROITab: React.FC<{ frameState?: MeasurementFrameState }> = ({ frameState }) => {
  if (!frameState) return <div className="text-slate-400 text-sm">No ROI data</div>;
  
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* ROI Overview */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">ROI Overview</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Coverage:</span>
            <span className={(frameState.roi.coverage * 100) > 50 ? 'text-green-400' : 'text-yellow-400'}>
              {(frameState.roi.coverage * 100).toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Valid Tiles:</span>
            <span className="text-slate-300">{frameState.roi.validTileCount}/{frameState.roi.totalTileCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Uniformity:</span>
            <span className={frameState.roi.spatialUniformity > 0.6 ? 'text-green-400' : 'text-yellow-400'}>
              {(frameState.roi.spatialUniformity * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
      
      {/* Tile Scores */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Tile Quality</h4>
        <div className="grid grid-cols-5 gap-1">
          {frameState.roi.tileQualityScores.map((score, i) => (
            <div
              key={i}
              className={`h-6 rounded text-[10px] flex items-center justify-center ${
                score > 0.7 ? 'bg-green-500/50 text-green-100' :
                score > 0.4 ? 'bg-yellow-500/50 text-yellow-100' :
                'bg-red-500/50 text-red-100'
              }`}
              title={`Tile ${i}: ${(score * 100).toFixed(0)}%`}
            >
              {i}
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-2 text-[10px]">
          <span className="text-green-400">● Good (&gt;70%)</span>
          <span className="text-yellow-400">● Fair</span>
          <span className="text-red-400">● Poor</span>
        </div>
      </div>
      
      {/* Dominant Tiles */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Dominant Tiles</h4>
        <div className="flex gap-2">
          {frameState.roi.dominantTileIndices.map((idx) => (
            <span key={idx} className="bg-blue-500/30 text-blue-300 px-2 py-1 rounded text-xs">
              {idx}
            </span>
          ))}
        </div>
      </div>
      
      {/* Saturation Stats */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Saturation</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">High Sat:</span>
            <span className={frameState.saturationStats.percentHighSaturation < 5 ? 'text-green-400' : 'text-yellow-400'}>
              {frameState.saturationStats.percentHighSaturation.toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Low Sat:</span>
            <span className={frameState.saturationStats.percentLowSaturation < 10 ? 'text-green-400' : 'text-yellow-400'}>
              {frameState.saturationStats.percentLowSaturation.toFixed(1)}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Valid Range:</span>
            <span className={(frameState.saturationStats.percentValidRange * 100) > 80 ? 'text-green-400' : 'text-yellow-400'}>
              {(frameState.saturationStats.percentValidRange * 100).toFixed(1)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const BeatsTab: React.FC<{ frameState?: MeasurementFrameState }> = ({ frameState }) => {
  if (!frameState) return <div className="text-slate-400 text-sm">No beat data</div>;
  
  const { beats } = frameState;
  
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Beat Summary */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Beat Summary</h4>
        <div className="space-y-1 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Candidates:</span>
            <span className="text-slate-300">{beats.candidates.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Accepted:</span>
            <span className="text-green-400">{beats.accepted.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Rejection Rate:</span>
            <span className={beats.candidates.length > 0 && beats.accepted.length / beats.candidates.length > 0.6 ? 'text-green-400' : 'text-yellow-400'}>
              {beats.candidates.length > 0 
                ? ((1 - beats.accepted.length / beats.candidates.length) * 100).toFixed(0) 
                : 0}%
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Instant BPM:</span>
            <span className="text-white font-bold">
              {beats.instantaneousBPM ? beats.instantaneousBPM.toFixed(1) : '--'}
            </span>
          </div>
        </div>
      </div>
      
      {/* Last Beat Details */}
      {beats.accepted.length > 0 && (
        <div className="bg-slate-900 rounded p-3">
          <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Last Beat</h4>
          {(() => {
            const last = beats.accepted[beats.accepted.length - 1];
            return (
              <div className="space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Amplitude:</span>
                  <span className="text-slate-300">{last.amplitude.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Quality:</span>
                  <span className={last.beatSQI > 0.6 ? 'text-green-400' : 'text-yellow-400'}>
                    {(last.beatSQI * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">RR Interval:</span>
                  <span className="text-slate-300">{last.rrInterval.toFixed(0)}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Template Corr:</span>
                  <span className={last.templateCorrelation > 0.7 ? 'text-green-400' : 'text-yellow-400'}>
                    {(last.templateCorrelation * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

const QualityTab: React.FC<{
  frameState?: MeasurementFrameState;
  bpmOutput?: MeasurementOutput<number>;
  spo2Output?: MeasurementOutput<number>;
  bpOutput?: MeasurementOutput<{ systolic: number; diastolic: number }>;
  arrhythmiaOutput?: MeasurementOutput<string>;
}> = ({ frameState, bpmOutput, spo2Output, bpOutput, arrhythmiaOutput }) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* SQI Components */}
      {frameState && (
        <div className="bg-slate-900 rounded p-3">
          <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">SQI Breakdown</h4>
          <div className="space-y-1 text-xs font-mono">
            {Object.entries(frameState.signalQuality.components).map(([key, value]) => (
              <div key={key} className="flex justify-between">
                <span className="text-slate-400 capitalize">{key}:</span>
                <span className={(value || 0) > 0.6 ? 'text-green-400' : (value || 0) > 0.3 ? 'text-yellow-400' : 'text-red-400'}>
                  {((value || 0) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Metric Outputs */}
      <div className="bg-slate-900 rounded p-3">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Metric Status</h4>
        <div className="space-y-2">
          {bpmOutput && (
            <MetricRow 
              label="BPM" 
              value={bpmOutput.value} 
              confidence={bpmOutput.confidence} 
              status={bpmOutput.status}
              flags={bpmOutput.qualityFlags}
            />
          )}
          {spo2Output && (
            <MetricRow 
              label="SpO2" 
              value={spo2Output.value ? `${spo2Output.value}%` : null} 
              confidence={spo2Output.confidence} 
              status={spo2Output.status}
              flags={spo2Output.qualityFlags}
            />
          )}
          {bpOutput && (
            <MetricRow 
              label="BP" 
              value={bpOutput.value ? `${bpOutput.value.systolic}/${bpOutput.value.diastolic}` : null} 
              confidence={bpOutput.confidence} 
              status={bpOutput.status}
              flags={bpOutput.qualityFlags}
            />
          )}
          {arrhythmiaOutput && (
            <MetricRow 
              label="Rhythm" 
              value={arrhythmiaOutput.value} 
              confidence={arrhythmiaOutput.confidence} 
              status={arrhythmiaOutput.status}
              flags={arrhythmiaOutput.qualityFlags}
            />
          )}
        </div>
      </div>
      
      {/* Active Flags */}
      {frameState && frameState.flags.blockReasons.length > 0 && (
        <div className="bg-slate-900 rounded p-3 col-span-2">
          <h4 className="text-red-400 text-xs font-bold uppercase mb-2">Active Blockers</h4>
          <div className="flex flex-wrap gap-2">
            {frameState.flags.blockReasons.map((flag) => (
              <span key={flag} className="bg-red-500/20 text-red-300 px-2 py-1 rounded text-xs">
                {flag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const MetricRow: React.FC<{
  label: string;
  value: number | string | null;
  confidence: number;
  status: string;
  flags: string[];
}> = ({ label, value, confidence, status, flags }) => {
  const statusColor = status === 'ok' ? 'text-green-400' : 
                     status === 'research_only' ? 'text-purple-400' :
                     status === 'needs_calibration' ? 'text-orange-400' :
                     'text-red-400';
  
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400 font-mono">{label}:</span>
      <div className="flex items-center gap-2">
        <span className={value ? 'text-white font-bold' : 'text-slate-500'}>
          {value || 'N/A'}
        </span>
        <span className={confidence > 0.6 ? 'text-green-400' : confidence > 0.3 ? 'text-yellow-400' : 'text-red-400'}>
          ({(confidence * 100).toFixed(0)}%)
        </span>
        <span className={statusColor}>
          [{status}]
        </span>
      </div>
    </div>
  );
};

const CalibrationTab: React.FC<{
  spo2Output?: MeasurementOutput<number>;
  bpOutput?: MeasurementOutput<{ systolic: number; diastolic: number }>;
  onExportSession?: () => void;
}> = ({ spo2Output, bpOutput, onExportSession }) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      {/* SpO2 Calibration */}
      {spo2Output?.evidence && (
        <div className="bg-slate-900 rounded p-3">
          <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">SpO2 Calibration</h4>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">State:</span>
              <span className="text-slate-300">
                {(spo2Output.evidence as any).calibrationState || 'unknown'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Device:</span>
              <span className="text-slate-300">
                {(spo2Output.evidence as any).deviceCalibration || 'none'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Age:</span>
              <span className="text-slate-300">
                {(spo2Output.evidence as any).calibrationAgeDays?.toFixed(1) || '--'} days
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Samples:</span>
              <span className="text-slate-300">
                {(spo2Output.evidence as any).calibrationSampleCount || 0}
              </span>
            </div>
          </div>
        </div>
      )}
      
      {/* BP Calibration */}
      {bpOutput?.evidence && (
        <div className="bg-slate-900 rounded p-3">
          <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">BP Calibration</h4>
          <div className="space-y-1 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-slate-400">Points:</span>
              <span className="text-slate-300">
                {(bpOutput.evidence as any).calibrationPoints || 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Freshness:</span>
              <span className="text-slate-300">
                {(bpOutput.evidence as any).calibrationFreshnessDays?.toFixed(1) || '--'} days
              </span>
            </div>
          </div>
        </div>
      )}
      
      {/* Export */}
      <div className="bg-slate-900 rounded p-3 col-span-2">
        <h4 className="text-blue-400 text-xs font-bold uppercase mb-2">Session Export</h4>
        <button
          onClick={onExportSession}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded text-sm transition-colors"
        >
          📥 Export JSON Session
        </button>
        <p className="text-slate-400 text-xs mt-2">
          Exporta telemetría completa del pipeline para análisis offline
        </p>
      </div>
    </div>
  );
};

export default DebugPanel;

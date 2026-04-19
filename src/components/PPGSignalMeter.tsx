import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart, Activity } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';

interface PPGSignalMeterProps {
  value: number;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
  isMonitoring?: boolean;
  arrhythmiaStatus?: string;
  rawArrhythmiaData?: {
    timestamp: number;
    rmssd: number;
    rrVariation: number;
  } | null;
  preserveResults?: boolean;
  diagnosticMessage?: string;
  isPeak?: boolean;
  bpm?: number;
  spo2?: number;
  rrIntervals?: number[];
  // Phase 19 — EEG-style telemetry overlay (optional)
  systolic?: number;
  diastolic?: number;
  perfusionIndex?: number;
  respirationBrpm?: number;
  hrvLF?: number;
  hrvHF?: number;
  hrvLFHF?: number;
  dfaAlpha1?: number;
  sampleEntropy?: number;
  stressIndex?: number;
  stressLabel?: string;
  hemoglobinGdl?: number;
  glucoseMgDl?: number;
  contactState?: string;
  pressureState?: string;
  motionScore?: number;
  realFps?: number;
  activeSource?: string;
}

const CONFIG = {
  // Higher-resolution canvas (≈1.5×) so thin EKG-style traces stay crisp
  // on dense smartphone displays (DPR ≥ 3). Aspect ratio kept identical to
  // the original (1:2) so the CSS-scaled viewport mapping doesn't change.
  CANVAS_WIDTH: 2100,
  CANVAS_HEIGHT: 4200,
  WINDOW_MS: 2800,
  TARGET_FPS: 30,
  BUFFER_SIZE: 400,
  PLOT_AREA: {
    LEFT: 90,
    RIGHT: 90,
    TOP: 130,
    BOTTOM: 90,
  },
  COLORS: {
    // Pitch-black background ('monitor cardiaco' look)
    BG: '#000000',
    PLOT_BG: 'rgba(0, 8, 4, 0.55)',
    // Subtle EKG mint-green grid
    GRID_MAJOR: 'rgba(38, 200, 130, 0.32)',
    GRID_MINOR: 'rgba(38, 200, 130, 0.10)',
    BASELINE: 'rgba(212, 175, 55, 0.55)',
    // Trace and peaks
    SIGNAL_NORMAL: '#22ff8d',
    SIGNAL_GLOW: 'rgba(34, 255, 141, 0.55)',
    SIGNAL_ARRHYTHMIA: '#ff4d4d',
    ARRHYTHMIA_GLOW: 'rgba(255, 77, 77, 0.55)',
    PEAK_NORMAL: '#60a5fa',
    PEAK_ARRHYTHMIA: '#ff4d4d',
    VALLEY_COLOR: '#94a3b8',
    // Headings and labels — gold + clinical white
    TEXT_TITLE: '#FFD700',           // gold for panel titles
    TEXT_TITLE_SOFT: '#E6C25A',      // muted gold for sub-titles
    TEXT_PRIMARY: '#FFFFFF',         // white for vital values
    TEXT_SECONDARY: '#CBD5E1',
    TEXT_WARNING: '#FBBF24',
    TEXT_DANGER: '#ff4d4d',
    SCALE_TEXT: '#9CA3AF',
    SIGNAL_FILL_NORMAL: 'rgba(34, 255, 141, 0.08)',
    SIGNAL_FILL_ARR: 'rgba(255, 77, 77, 0.08)',
    SYSTOLIC_MARKER: '#60a5fa',
    DIASTOLIC_MARKER: '#818cf8',
    DICHROTIC_NOTCH: '#c084fc',
    IBI_TEXT: '#FFD700',
    EEG_TEXT: '#A7F3D0',
  },
};

const NON_ALERT_RHYTHMS = new Set(['SIN ARRITMIAS', 'SINUS_STABLE', 'SINUS_VARIABLE', 'CALIBRANDO...', 'UNDETERMINED_LOW_QUALITY']);

const parseRhythmStatus = (statusString?: string) => {
  const [label = 'SIN ARRITMIAS', countStr = '0'] = (statusString || 'SIN ARRITMIAS|0').split('|');
  const count = parseInt(countStr, 10) || 0;
  const normalized = label.trim();
  const display = normalized.split('_').join(' ');
  const isAlert = !NON_ALERT_RHYTHMS.has(normalized);
  const color = normalized === 'UNDETERMINED_LOW_QUALITY'
    ? CONFIG.COLORS.TEXT_WARNING
    : isAlert
      ? CONFIG.COLORS.TEXT_DANGER
      : CONFIG.COLORS.TEXT_PRIMARY;
  return { label: normalized, count, display, isAlert, color };
};

const PPGSignalMeter = ({
  value,
  quality,
  isFingerDetected,
  onStartMeasurement,
  onReset,
  isMonitoring = false,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false,
  diagnosticMessage,
  isPeak = false,
  bpm = 0,
  spo2 = 0,
  rrIntervals = [],
  systolic = 0,
  diastolic = 0,
  perfusionIndex = 0,
  respirationBrpm = 0,
  hrvLF = 0,
  hrvHF = 0,
  hrvLFHF = 0,
  dfaAlpha1 = 0,
  sampleEntropy = 0,
  stressIndex = 0,
  stressLabel = '',
  hemoglobinGdl = 0,
  glucoseMgDl = 0,
  contactState = '',
  pressureState = '',
  motionScore = 0,
  realFps = 0,
  activeSource = '',
}: PPGSignalMeterProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  const propsRef = useRef({
    value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, rawArrhythmiaData,
    systolic, diastolic, perfusionIndex, respirationBrpm, hrvLF, hrvHF, hrvLFHF,
    dfaAlpha1, sampleEntropy, stressIndex, stressLabel,
    hemoglobinGdl, glucoseMgDl, contactState, pressureState, motionScore, realFps, activeSource,
  });
  // Phase 19 — Snapshot used by the EEG overlay (HTML), refreshed at ~5 Hz
  // to keep the canvas hot loop unblocked but the overlay alive.
  const [eegSnapshot, setEegSnapshot] = useState({
    systolic: 0, diastolic: 0, perfusionIndex: 0, respirationBrpm: 0,
    hrvLFHF: 0, dfaAlpha1: 0, sampleEntropy: 0,
    stressIndex: 0, stressLabel: '',
    hemoglobinGdl: 0, glucoseMgDl: 0,
    contactState: '', pressureState: '', motionScore: 0, realFps: 0, activeSource: '',
    ibi: 0, sdnn: 0, rmssd: 0,
  });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);
  
  const beatArrhythmiaRef = useRef(false);
  const lastArrhythmiaCountRef = useRef(0);
  const beatHistoryRef = useRef<{ isArrhythmia: boolean; time: number }[]>([]);
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });
  const ibiDisplayRef = useRef<number>(0);
  const hrvDisplayRef = useRef<{ sdnn: number; rmssd: number }>({ sdnn: 0, rmssd: 0 });

  useEffect(() => {
    propsRef.current = {
      value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, rawArrhythmiaData,
      systolic, diastolic, perfusionIndex, respirationBrpm, hrvLF, hrvHF, hrvLFHF,
      dfaAlpha1, sampleEntropy, stressIndex, stressLabel,
      hemoglobinGdl, glucoseMgDl, contactState, pressureState, motionScore, realFps, activeSource,
    };
    if (rrIntervals && rrIntervals.length >= 2) {
      const last = rrIntervals[rrIntervals.length - 1];
      ibiDisplayRef.current = Math.round(last);
      const mean = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
      const variance = rrIntervals.reduce((sum, rr) => sum + (rr - mean) ** 2, 0) / rrIntervals.length;
      hrvDisplayRef.current.sdnn = Math.round(Math.sqrt(variance));
      let sumSqDiffs = 0;
      for (let i = 1; i < rrIntervals.length; i++) sumSqDiffs += (rrIntervals[i] - rrIntervals[i - 1]) ** 2;
      hrvDisplayRef.current.rmssd = Math.round(Math.sqrt(sumSqDiffs / (rrIntervals.length - 1)));
    }
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, rawArrhythmiaData,
      systolic, diastolic, perfusionIndex, respirationBrpm, hrvLF, hrvHF, hrvLFHF,
      dfaAlpha1, sampleEntropy, stressIndex, stressLabel,
      hemoglobinGdl, glucoseMgDl, contactState, pressureState, motionScore, realFps, activeSource]);

  useEffect(() => {
    if (isPeak && isFingerDetected) {
      const now = Date.now();
      if (now - lastPeakTimeRef.current > 250) {
        lastPeakTimeRef.current = now;
        setShowPulse(true);
        setTimeout(() => setShowPulse(false), 120);
      }
    }
  }, [isPeak, isFingerDetected]);

  useEffect(() => {
    if (!dataBufferRef.current) dataBufferRef.current = new CircularBuffer(CONFIG.BUFFER_SIZE);
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  // Phase 19 — refresh the EEG overlay snapshot at 5 Hz from the live ref.
  // This keeps overlay paints cheap without re-rendering the canvas hot path.
  useEffect(() => {
    const id = setInterval(() => {
      const p = propsRef.current;
      setEegSnapshot({
        systolic: p.systolic ?? 0,
        diastolic: p.diastolic ?? 0,
        perfusionIndex: p.perfusionIndex ?? 0,
        respirationBrpm: p.respirationBrpm ?? 0,
        hrvLFHF: p.hrvLFHF ?? 0,
        dfaAlpha1: p.dfaAlpha1 ?? 0,
        sampleEntropy: p.sampleEntropy ?? 0,
        stressIndex: p.stressIndex ?? 0,
        stressLabel: p.stressLabel ?? '',
        hemoglobinGdl: p.hemoglobinGdl ?? 0,
        glucoseMgDl: p.glucoseMgDl ?? 0,
        contactState: p.contactState ?? '',
        pressureState: p.pressureState ?? '',
        motionScore: p.motionScore ?? 0,
        realFps: p.realFps ?? 0,
        activeSource: p.activeSource ?? '',
        ibi: ibiDisplayRef.current,
        sdnn: hrvDisplayRef.current.sdnn,
        rmssd: hrvDisplayRef.current.rmssd,
      });
    }, 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (preserveResults && !isFingerDetected) {
      dataBufferRef.current?.clear();
    }
  }, [preserveResults, isFingerDetected]);

  const getPlotArea = useCallback(() => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, PLOT_AREA } = CONFIG;
    return {
      x: PLOT_AREA.LEFT,
      y: PLOT_AREA.TOP,
      width: W - PLOT_AREA.LEFT - PLOT_AREA.RIGHT,
      height: H - PLOT_AREA.TOP - PLOT_AREA.BOTTOM,
      centerY: PLOT_AREA.TOP + (H - PLOT_AREA.TOP - PLOT_AREA.BOTTOM) / 2
    };
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, COLORS } = CONFIG;
    const plot = getPlotArea();
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = COLORS.PLOT_BG;
    ctx.fillRect(plot.x, plot.y, plot.width, plot.height);
    ctx.strokeStyle = COLORS.GRID_MINOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = plot.x; x <= plot.x + plot.width; x += 20) {
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    }
    for (let y = plot.y; y <= plot.y + plot.height; y += 20) {
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();
    ctx.strokeStyle = COLORS.GRID_MAJOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = plot.x; x <= plot.x + plot.width; x += 100) {
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    }
    for (let y = plot.y; y <= plot.y + plot.height; y += 100) {
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.centerY);
    ctx.lineTo(plot.x + plot.width, plot.centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
  }, [getPlotArea]);

  const drawAmplitudeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS } = CONFIG;
    const plot = getPlotArea();
    const stats = amplitudeStatsRef.current;
    ctx.font = '11px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'right';
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = plot.y + (i / steps) * plot.height;
      const val = stats.max - (i / steps) * stats.range;
      ctx.fillText(val.toFixed(0), plot.x - 8, y + 4);
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x - 5, y);
      ctx.lineTo(plot.x, y);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(15, plot.centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillText('AMPLITUD (μV)', 0, 0);
    ctx.restore();
  }, [getPlotArea]);

  const drawTimeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS, WINDOW_MS } = CONFIG;
    const plot = getPlotArea();
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'center';
    const seconds = WINDOW_MS / 1000;
    for (let s = 0; s <= seconds; s++) {
      const x = plot.x + plot.width - (s / seconds) * plot.width;
      ctx.fillText(`${s}s`, x, plot.y + plot.height + 20);
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.height);
      ctx.lineTo(x, plot.y + plot.height + 5);
      ctx.stroke();
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.TEXT_PRIMARY;
    ctx.fillText('25mm/s', plot.x + plot.width, plot.y + plot.height + 40);
  }, [getPlotArea]);

  const drawVitalInfo = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, COLORS } = CONFIG;
    const { bpm, spo2, arrhythmiaStatus, quality, rrIntervals, rawArrhythmiaData } = propsRef.current;
    const rhythm = parseRhythmStatus(arrhythmiaStatus);
    const panelH = 95;
    const panelW = 160;
    const panelY = 2;
    const fontSize = {
      label: 'bold 14px "SF Mono", Consolas, monospace',
      value: 'bold 48px "SF Mono", Consolas, monospace',
      unit: '16px "SF Mono", Consolas, monospace',
      class: '11px "SF Mono", Consolas, monospace',
      small: '10px "SF Mono", Consolas, monospace',
    };
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(3, panelY, panelW, panelH);
    ctx.strokeStyle = COLORS.TEXT_TITLE;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(3, panelY, panelW, panelH);
    ctx.font = fontSize.label;
    // Title in GOLD (Phase 19)
    ctx.fillStyle = COLORS.TEXT_TITLE;
    ctx.textAlign = 'left';
    ctx.fillText('♥ FRECUENCIA', 10, panelY + 18);
    ctx.font = fontSize.value;
    // Value in WHITE
    ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
    ctx.fillText(bpm > 0 ? bpm.toString() : '--', 10, panelY + 66);
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.TEXT_TITLE_SOFT;
    ctx.fillText('BPM', panelW - 40, panelY + 66);
    if (bpm > 0) {
      ctx.font = fontSize.class;
      let hrLabel = '';
      let hrColor = COLORS.TEXT_PRIMARY;
      if (bpm < 60) { hrLabel = 'BRADICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      else if (bpm <= 100) { hrLabel = 'NORMAL'; hrColor = COLORS.TEXT_PRIMARY; }
      else { hrLabel = 'TAQUICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      ctx.fillStyle = hrColor;
      ctx.fillText(hrLabel, 10, panelY + 86);
    }
    
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(W - panelW - 3, panelY, panelW, panelH);
    const spo2Border = spo2 >= 95 ? COLORS.TEXT_TITLE : spo2 >= 90 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.strokeStyle = spo2Border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(W - panelW - 3, panelY, panelW, panelH);
    ctx.font = fontSize.label;
    // Title in GOLD (Phase 19)
    ctx.fillStyle = COLORS.TEXT_TITLE;
    ctx.textAlign = 'left';
    ctx.fillText('O₂ SATURACIÓN', W - panelW + 4, panelY + 18);
    ctx.font = fontSize.value;
    // Value in WHITE if normal, hi-vis warning otherwise
    const spo2Color = spo2 >= 95 ? COLORS.TEXT_PRIMARY : spo2 >= 90 ? COLORS.TEXT_WARNING : spo2 > 0 ? COLORS.TEXT_DANGER : COLORS.TEXT_SECONDARY;
    ctx.fillStyle = spo2Color;
    ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '--', W - panelW + 4, panelY + 66);
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.TEXT_TITLE_SOFT;
    ctx.fillText('%', W - 20, panelY + 66);
    if (spo2 > 0) {
      ctx.font = fontSize.class;
      let spLabel = '';
      let spColor = COLORS.TEXT_PRIMARY;
      if (spo2 >= 95) { spLabel = 'NORMAL'; spColor = COLORS.TEXT_PRIMARY; }
      else if (spo2 >= 90) { spLabel = 'HIPOXEMIA LEVE'; spColor = COLORS.TEXT_WARNING; }
      else { spLabel = 'HIPOXEMIA'; spColor = COLORS.TEXT_DANGER; }
      ctx.fillStyle = spColor;
      ctx.fillText(spLabel, W - panelW + 4, panelY + 86);
    }
    
    const centerX = W / 2;
    const centerW = 260;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.92)';
    ctx.fillRect(centerX - centerW / 2, panelY, centerW, panelH);
    ctx.strokeStyle = quality > 60 ? COLORS.TEXT_TITLE : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(centerX - centerW / 2, panelY, centerW, panelH);
    ctx.font = '12px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    // Title in GOLD (Phase 19)
    ctx.fillStyle = COLORS.TEXT_TITLE;
    ctx.fillText('CALIDAD SEÑAL', centerX, panelY + 18);
    const barWidth = 220;
    const barHeight = 10;
    const barX = centerX - barWidth / 2;
    const barY = panelY + 24;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    const qGrad = ctx.createLinearGradient(barX, 0, barX + (quality / 100) * barWidth, 0);
    if (quality > 60) { qGrad.addColorStop(0, '#166534'); qGrad.addColorStop(1, '#22c55e'); }
    else if (quality > 30) { qGrad.addColorStop(0, '#854d0e'); qGrad.addColorStop(1, '#f59e0b'); }
    else { qGrad.addColorStop(0, '#991b1b'); qGrad.addColorStop(1, '#ef4444'); }
    ctx.fillStyle = qGrad;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillText(`${quality.toFixed(0)}%`, centerX, panelY + 52);
    const ibi = ibiDisplayRef.current;
    const hrv = hrvDisplayRef.current;
    ctx.font = fontSize.small;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.IBI_TEXT;
    ctx.fillText(`IBI: ${ibi > 0 ? ibi + 'ms' : '--'}`, centerX - centerW / 2 + 8, panelY + 68);
    ctx.fillStyle = rhythm.color;
    ctx.fillText(`RITMO: ${rhythm.display}`, centerX - centerW / 2 + 8, panelY + 84);
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'right';
    ctx.fillText(`SDNN: ${hrv.sdnn > 0 ? hrv.sdnn + 'ms' : '--'}`, centerX + centerW / 2 - 8, panelY + 68);
    ctx.fillText(`RMSSD: ${hrv.rmssd > 0 ? hrv.rmssd + 'ms' : '--'}`, centerX + centerW / 2 - 8, panelY + 84);
    
    if (rhythm.isAlert) {
      const pulse = (Math.sin(now / 100) + 1) / 2;
      ctx.fillStyle = `rgba(239, 68, 68, ${0.3 + pulse * 0.4})`;
      ctx.fillRect(W - panelW - 3, panelY + panelH + 4, panelW, 30);
      ctx.strokeStyle = COLORS.TEXT_DANGER;
      ctx.lineWidth = 2;
      ctx.strokeRect(W - panelW - 3, panelY + panelH + 4, panelW, 30);
      ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_DANGER;
      ctx.textAlign = 'center';
      const label = rhythm.count > 0 ? `${rhythm.display} x${rhythm.count}` : rhythm.display;
      ctx.fillText(`⚠ ${label}`, W - panelW / 2 - 3, panelY + panelH + 22);
      if (rawArrhythmiaData && rawArrhythmiaData.rmssd > 0) {
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.8)';
        ctx.fillText(`RMSSD: ${rawArrhythmiaData.rmssd.toFixed(0)}ms`, W - panelW / 2 - 3, panelY + panelH + 42);
      }
    }

  }, []);

  useEffect(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    const frameTime = 1500 / CONFIG.TARGET_FPS;
    let lastRenderTime = 0;
    
    const render = () => {
      if (!isRunningRef.current) return;
      const canvas = canvasRef.current;
      const buffer = dataBufferRef.current;
      if (!canvas || !buffer) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      const now = Date.now();
      if (now - lastRenderTime < frameTime) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      lastRenderTime = now;
      
      const { value: signalValue, isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve, isPeak: peak } = propsRef.current;
      const rhythm = parseRhythmStatus(arrStatus);
      const plot = getPlotArea();
      const { WINDOW_MS, COLORS } = CONFIG;
      
      drawGrid(ctx);
      drawAmplitudeScale(ctx);
      drawTimeScale(ctx);
      drawVitalInfo(ctx, now);
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      const scaledValue = signalValue * 2;
      
      if (peak) {
        const currentCount = rhythm.count;
        const shouldMarkArrhythmia = rhythm.isAlert || currentCount > lastArrhythmiaCountRef.current;
        if (shouldMarkArrhythmia) {
          beatArrhythmiaRef.current = true;
          lastArrhythmiaCountRef.current = Math.max(lastArrhythmiaCountRef.current, currentCount);
          const { rrIntervals: rr } = propsRef.current;
          const lastRR = rr && rr.length > 0 ? rr[rr.length - 1] : 800;
          const retroDuration = Math.min(Math.max(lastRR, 400), 1500);
          buffer.markArrhythmiaBack(retroDuration);
        } else {
          beatArrhythmiaRef.current = false;
        }
        beatHistoryRef.current.push({ isArrhythmia: beatArrhythmiaRef.current, time: now });
        if (beatHistoryRef.current.length > 20) beatHistoryRef.current = beatHistoryRef.current.slice(-20);
      }
      const currentIsArrhythmia = beatArrhythmiaRef.current;
      
      buffer.push({ time: now, value: scaledValue, isArrhythmia: currentIsArrhythmia });
      const points = buffer.getPoints();
      if (points.length > 30) {
        const recentPoints = points.slice(-150);
        const values = recentPoints.map(p => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = Math.max(40, max - min);
        const stats = amplitudeStatsRef.current;
        stats.min = stats.min * 0.95 + (min - range * 0.1) * 0.05;
        stats.max = stats.max * 0.95 + (max + range * 0.1) * 0.05;
        stats.range = stats.max - stats.min;
      }
      const stats = amplitudeStatsRef.current;
      
      if (points.length > 2) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const pathCoords: { x: number; y: number; isArr: boolean }[] = [];
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          if (x < plot.x || x > plot.x + plot.width) continue;
          pathCoords.push({ x, y, isArr: pt.isArrhythmia });
        }
        if (pathCoords.length > 2) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pathCoords[0].x, plot.centerY);
          for (const c of pathCoords) ctx.lineTo(c.x, c.y);
          ctx.lineTo(pathCoords[pathCoords.length - 1].x, plot.centerY);
          ctx.closePath();
          const fillGrad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.height);
          fillGrad.addColorStop(0, 'rgba(34, 197, 94, 0.12)');
          fillGrad.addColorStop(0.5, 'rgba(34, 197, 94, 0.04)');
          fillGrad.addColorStop(1, 'rgba(34, 197, 94, 0.0)');
          ctx.fillStyle = fillGrad;
          ctx.fill();
          ctx.restore();
          const arrSegments: { x: number; y: number }[][] = [];
          let currentSeg: { x: number; y: number }[] = [];
          for (const c of pathCoords) {
            if (c.isArr) currentSeg.push(c);
            else {
              if (currentSeg.length > 1) arrSegments.push(currentSeg);
              currentSeg = [];
            }
          }
          if (currentSeg.length > 1) arrSegments.push(currentSeg);
          for (const seg of arrSegments) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(seg[0].x, plot.centerY);
            for (const c of seg) ctx.lineTo(c.x, c.y);
            ctx.lineTo(seg[seg.length - 1].x, plot.centerY);
            ctx.closePath();
            const arrFill = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.height);
            arrFill.addColorStop(0, 'rgba(239, 68, 68, 0.15)');
            arrFill.addColorStop(0.5, 'rgba(239, 68, 68, 0.05)');
            arrFill.addColorStop(1, 'rgba(239, 68, 68, 0.0)');
            ctx.fillStyle = arrFill;
            ctx.fill();
            ctx.restore();
          }
        }
        for (let i = 1; i < pathCoords.length; i++) {
          const prev = pathCoords[i - 1];
          const curr = pathCoords[i];
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(curr.x, curr.y);
          if (curr.isArr) {
            ctx.strokeStyle = COLORS.SIGNAL_ARRHYTHMIA;
            ctx.shadowColor = COLORS.ARRHYTHMIA_GLOW;
            ctx.shadowBlur = 18;
            ctx.lineWidth = 4;
          } else {
            ctx.strokeStyle = COLORS.SIGNAL_NORMAL;
            ctx.shadowColor = COLORS.SIGNAL_GLOW;
            ctx.shadowBlur = 12;
            ctx.lineWidth = 2.5;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        const peaks: { x: number; y: number; isArrhythmia: boolean; time: number }[] = [];
        const valleys: { x: number; y: number }[] = [];
        const history = beatHistoryRef.current;
        const visibleBeats: { time: number; x: number; y: number; isArrhythmia: boolean }[] = [];
        for (const beat of history) {
          const age = now - beat.time;
          if (age > WINDOW_MS || age < 0) continue;
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          if (x < plot.x || x > plot.x + plot.width) continue;
          let closestPt: PPGDataPoint | null = null;
          let minDist = Infinity;
          for (const pt of points) {
            const dist = Math.abs(pt.time - beat.time);
            if (dist < minDist) { minDist = dist; closestPt = pt; }
          }
          if (closestPt && minDist < 200) {
            const normalizedY = (stats.max - closestPt.value) / stats.range;
            const y = plot.y + normalizedY * plot.height;
            peaks.push({ x, y, isArrhythmia: beat.isArrhythmia, time: beat.time });
            visibleBeats.push({ time: beat.time, x, y, isArrhythmia: beat.isArrhythmia });
          }
        }
        for (let b = 0; b < visibleBeats.length - 1; b++) {
          const t0 = visibleBeats[b].time;
          const t1 = visibleBeats[b + 1].time;
          let minVal = Infinity;
          let minPt: PPGDataPoint | null = null;
          for (const pt of points) {
            if (pt.time > t0 && pt.time < t1 && pt.value < minVal) {
              minVal = pt.value;
              minPt = pt;
            }
          }
          if (minPt) {
            const age2 = now - minPt.time;
            const vx = plot.x + plot.width - (age2 * plot.width / WINDOW_MS);
            const vy = plot.y + ((stats.max - minPt.value) / stats.range) * plot.height;
            if (vx >= plot.x && vx <= plot.x + plot.width) valleys.push({ x: vx, y: vy });
          }
        }
        for (let i = 0; i < peaks.length - 1; i++) {
          const p1 = peaks[i];
          const p2 = peaks[i + 1];
          const ibiMs = Math.abs(p1.time - p2.time);
          if (ibiMs > 0 && ibiMs < 3000) {
            const midX = (p1.x + p2.x) / 2;
            const topY = Math.min(p1.y, p2.y) - 28;
            ctx.strokeStyle = 'rgba(103, 232, 249, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p1.x, topY + 8);
            ctx.lineTo(p1.x, topY);
            ctx.lineTo(p2.x, topY);
            ctx.lineTo(p2.x, topY + 8);
            ctx.stroke();
            ctx.font = '9px "SF Mono", Consolas, monospace';
            ctx.fillStyle = COLORS.IBI_TEXT;
            ctx.textAlign = 'center';
            ctx.fillText(`${ibiMs}ms`, midX, topY - 3);
          }
        }
        peaks.forEach(p => {
          const color = p.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.SIGNAL_NORMAL;
          ctx.save();
          ctx.strokeStyle = p.isArrhythmia ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p.x, plot.y);
          ctx.lineTo(p.x, plot.y + plot.height);
          ctx.stroke();
          ctx.restore();
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.isArrhythmia ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
          ctx.fillStyle = p.isArrhythmia ? COLORS.TEXT_DANGER : COLORS.SIGNAL_NORMAL;
          ctx.textAlign = 'center';
          ctx.fillText(p.isArrhythmia ? 'A' : 'N', p.x, p.y - 16);
          if (p.isArrhythmia) {
            const alpha = (Math.sin(now / 80) + 1) / 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.3 + alpha * 0.5})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(p.x, p.y, 22, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.1 + alpha * 0.2})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        });
        valleys.forEach(v => {
          ctx.beginPath();
          ctx.moveTo(v.x, v.y + 3);
          ctx.lineTo(v.x - 4, v.y + 10);
          ctx.lineTo(v.x + 4, v.y + 10);
          ctx.closePath();
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.fill();
          ctx.font = '8px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.textAlign = 'center';
          ctx.fillText('V', v.x, v.y + 22);
        });
      }
      
      const beatHistory = beatHistoryRef.current;
      if (beatHistory.length > 0) {
        const histX = plot.x;
        const histY = plot.y + plot.height + 30;
        const dotRadius = 7;
        const dotSpacing = 18;
        const totalWidth = beatHistory.length * dotSpacing;
        const startX = histX + (plot.width - totalWidth) / 2;
        ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
        const panelPad = 8;
        ctx.fillRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 14);
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 14);
        ctx.font = '8px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.textAlign = 'center';
        ctx.fillText('HISTORIAL DE LATIDOS', startX + totalWidth / 2, histY - dotRadius - 1);
        const arrCount = beatHistory.filter(b => b.isArrhythmia).length;
        const normalCount = beatHistory.length - arrCount;
        ctx.textAlign = 'right';
        ctx.fillStyle = COLORS.SIGNAL_NORMAL;
        ctx.fillText(`N:${normalCount}`, startX + totalWidth + panelPad - 2, histY - dotRadius - 1);
        ctx.fillStyle = arrCount > 0 ? COLORS.SIGNAL_ARRHYTHMIA : COLORS.TEXT_SECONDARY;
        ctx.fillText(`A:${arrCount}`, startX - 2, histY - dotRadius - 1);
        ctx.textAlign = 'center';
        beatHistory.forEach((beat, i) => {
          const cx = startX + i * dotSpacing + dotSpacing / 2;
          const cy = histY + 6;
          if (beat.isArrhythmia) {
            ctx.beginPath();
            ctx.arc(cx, cy, dotRadius + 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle = beat.isArrhythmia ? COLORS.SIGNAL_ARRHYTHMIA : COLORS.SIGNAL_NORMAL;
          ctx.fill();
          ctx.font = 'bold 7px "SF Mono", Consolas, monospace';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(`${i + 1}`, cx, cy + 3);
        });
      }
      
      const legendY = CONFIG.CANVAS_HEIGHT - 15;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      const lx = CONFIG.PLOT_AREA.LEFT;
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(lx, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 22, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal (N)', lx + 30, legendY);
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(lx + 110, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 132, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia (A)', lx + 140, legendY);
      ctx.beginPath();
      ctx.arc(lx + 230, legendY - 4, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.PEAK_NORMAL;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Pico', lx + 240, legendY);
      ctx.beginPath();
      ctx.moveTo(lx + 275, legendY - 6);
      ctx.lineTo(lx + 271, legendY);
      ctx.lineTo(lx + 279, legendY);
      ctx.closePath();
      ctx.fillStyle = COLORS.VALLEY_COLOR;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Valle', lx + 285, legendY);
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.fillRect(lx + 320, legendY - 5, 12, 2);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('IBI', lx + 338, legendY);
      animationRef.current = requestAnimationFrame(render);
    };
    
    animationRef.current = requestAnimationFrame(render);
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [drawGrid, drawAmplitudeScale, drawTimeScale, drawVitalInfo, getPlotArea]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    amplitudeStatsRef.current = { min: -50, max: 50, range: 100 };
    beatHistoryRef.current = [];
    lastArrhythmiaCountRef.current = 0;
    ibiDisplayRef.current = 0;
    hrvDisplayRef.current = { sdnn: 0, rmssd: 0 };
    onReset();
  }, [onReset]);

  // Phase 19 — EEG-style telemetry strip (3 compact rows over the canvas)
  const eegProps = eegSnapshot;
  const stressColorClass =
    eegProps.stressIndex >= 75 ? 'text-red-400' :
    eegProps.stressIndex >= 50 ? 'text-amber-400' :
    'text-white';
  const contactColorClass =
    eegProps.contactState === 'STABLE_CONTACT' ? 'text-emerald-300' :
    eegProps.contactState === 'UNSTABLE_CONTACT' ? 'text-amber-300' :
    'text-red-300';
  const Cell = ({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) => (
    <div className="flex flex-col items-start min-w-0 flex-1 px-1">
      <span className="text-[8px] uppercase tracking-wider truncate" style={{ color: '#E6C25A' }}>{label}</span>
      <span className={`text-[10px] font-mono font-bold truncate ${color}`}>{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black">
      <canvas ref={canvasRef} width={CONFIG.CANVAS_WIDTH} height={CONFIG.CANVAS_HEIGHT} className="w-full h-full absolute inset-0" />

      {/* Header strip: gold brand */}
      <div className="absolute top-0 left-0 p-2 z-10 flex items-center gap-2" style={{ top: '6px', left: '140px' }}>
        <div className={`p-1.5 rounded-full transition-all duration-100 ${showPulse ? 'bg-red-500/30 scale-110' : 'bg-amber-500/20'}`}>
          <Heart className={`w-4 h-4 transition-all duration-100 ${showPulse ? 'text-red-400 scale-110' : 'text-amber-400'}`} fill={showPulse ? 'currentColor' : 'none'} />
        </div>
        <Activity className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] font-mono" style={{ color: '#FFD700' }}>cPPG MONITOR v1.0.3</span>
      </div>

      {/* Phase 19 — EEG-style telemetry overlay (3 rows, compact, always visible) */}
      <div className="absolute left-0 right-0 z-10 px-1.5 space-y-0.5"
           style={{ top: '14%' }}>
        <div className="flex items-stretch border bg-black/85 backdrop-blur-sm rounded-sm"
             style={{ borderColor: 'rgba(212, 175, 55, 0.4)' }}>
          <div className="flex items-center px-2 text-[9px] font-bold tracking-wider"
               style={{ color: '#FFD700', minWidth: 56 }}>⌬ HEMO</div>
          <div className="flex flex-1 divide-x" style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}>
            <Cell label="BP" value={eegProps.systolic > 0 ? `${Math.round(eegProps.systolic)}/${Math.round(eegProps.diastolic)}` : '—'} />
            <Cell label="PI" value={eegProps.perfusionIndex > 0 ? eegProps.perfusionIndex.toFixed(2) + '%' : '—'} color="text-emerald-200" />
            <Cell label="IBI" value={eegProps.ibi > 0 ? eegProps.ibi + 'ms' : '—'} color="text-amber-200" />
            <Cell label="SDNN" value={eegProps.sdnn > 0 ? eegProps.sdnn + 'ms' : '—'} color="text-emerald-200" />
            <Cell label="RMSSD" value={eegProps.rmssd > 0 ? eegProps.rmssd + 'ms' : '—'} color="text-emerald-200" />
            <Cell label="LF/HF" value={eegProps.hrvLFHF > 0 ? eegProps.hrvLFHF.toFixed(2) : '—'} color="text-emerald-200" />
          </div>
        </div>
        <div className="flex items-stretch border bg-black/85 backdrop-blur-sm rounded-sm"
             style={{ borderColor: 'rgba(212, 175, 55, 0.4)' }}>
          <div className="flex items-center px-2 text-[9px] font-bold tracking-wider"
               style={{ color: '#FFD700', minWidth: 56 }}>⚡ NEURO</div>
          <div className="flex flex-1 divide-x" style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}>
            <Cell label="DFAα1" value={eegProps.dfaAlpha1 !== 0 ? eegProps.dfaAlpha1.toFixed(2) : '—'} color="text-emerald-200" />
            <Cell label="SampEn" value={eegProps.sampleEntropy > 0 ? eegProps.sampleEntropy.toFixed(2) : '—'} color="text-emerald-200" />
            <Cell label="STRESS" value={eegProps.stressIndex > 0 ? `${Math.round(eegProps.stressIndex)}` : '—'} color={stressColorClass} />
            <Cell label="RESP" value={eegProps.respirationBrpm > 0 ? `${eegProps.respirationBrpm.toFixed(0)}rpm` : '—'} color="text-emerald-200" />
            <Cell label="Hb" value={eegProps.hemoglobinGdl > 0 ? eegProps.hemoglobinGdl.toFixed(1) + 'g/dL' : '—'} />
            <Cell label="GLU" value={eegProps.glucoseMgDl > 0 ? `${eegProps.glucoseMgDl}mg/dL` : '—'} />
          </div>
        </div>
        <div className="flex items-stretch border bg-black/85 backdrop-blur-sm rounded-sm"
             style={{ borderColor: 'rgba(212, 175, 55, 0.4)' }}>
          <div className="flex items-center px-2 text-[9px] font-bold tracking-wider"
               style={{ color: '#FFD700', minWidth: 56 }}>⚙ HW</div>
          <div className="flex flex-1 divide-x" style={{ borderColor: 'rgba(212, 175, 55, 0.2)' }}>
            <Cell label="CONT" value={eegProps.contactState ? eegProps.contactState.split('_').join(' ').substring(0, 7) : '—'} color={contactColorClass} />
            <Cell label="PRES" value={eegProps.pressureState ? eegProps.pressureState.split('_').join(' ').substring(0, 7) : '—'} color="text-emerald-200" />
            <Cell label="SRC" value={eegProps.activeSource || '—'} color="text-emerald-200" />
            <Cell label="FPS" value={eegProps.realFps > 0 ? `${Math.round(eegProps.realFps)}` : '—'} color={eegProps.realFps >= 24 ? 'text-white' : 'text-amber-300'} />
            <Cell label="MOT" value={eegProps.motionScore.toFixed(2)} color={eegProps.motionScore > 0.6 ? 'text-red-300' : 'text-white'} />
            <Cell label="STRESS" value={eegProps.stressLabel ? eegProps.stressLabel.split('_').join(' ') : '—'} color={stressColorClass} />
          </div>
        </div>
      </div>
      <div className="fixed bottom-0 left-0 right-0 h-12 grid grid-cols-2 z-10">
        <button onClick={onStartMeasurement} className={`font-semibold text-sm transition-colors border-t border-slate-700/50 ${isMonitoring ? 'bg-red-500/20 hover:bg-red-500/30 active:bg-red-500/40 text-red-300 border-r' : 'bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 text-emerald-400 border-r'}`}>
          {isMonitoring ? 'DETENER' : 'INICIAR'}
        </button>
        <button onClick={handleReset} className="bg-slate-700/20 hover:bg-slate-700/30 active:bg-slate-700/40 text-slate-300 font-semibold text-sm transition-colors border-t border-slate-700/50">
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;

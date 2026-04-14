import React, { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { Activity, Heart, Radio, Square, Play } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';
import { NON_ALERT_RHYTHM_LABELS } from '../constants/rhythmAlert';
import type { BeatFlags } from '@/types/beat';
import { classifyBeatWaveClass, type BeatWaveClass } from '@/utils/beatVisualization';

/**
 * E5: datos ya calculados en el pipeline (PPG / vitales / metrología). El monitor solo refleja;
 * no sustituye a `VitalSignsProcessor` ni a `PPGSignalProcessor`.
 */
export type PipelineTelemetryMirror = {
  estimatedSampleRateHz?: number;
  captureTimingConfidence?: number;
  maskIoU?: number;
  measurementConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';
  activeSource?: string;
};

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
  /** Un incremento por latido aceptado (evita múltiples “picos” por el latch del UI). */
  peakEvent?: { seq: number; flags: BeatFlags | null; wallTime: number; morphologyScore?: number | null };
  bpm?: number;
  spo2?: number;
  rrIntervals?: number[];
  /** Telemetría del motor (opcional): solo lectura para el lienzo */
  pipelineTelemetry?: PipelineTelemetryMirror;
}

/** Resolución lógica del lienzo (coordenadas de dibujo); el buffer físico = esto × devicePixelRatio. */
const CONFIG = {
  /** Lienzo lógico algo menor = menos píxeles por frame (mejor FPS en móvil/PC). */
  CANVAS_WIDTH: 1400,
  CANVAS_HEIGHT: 2480,
  WINDOW_MS: 1800,
  /** 30 FPS para respuesta rápida sin cortes (vs 22 anterior, 45 causaba stuttering). */
  TARGET_FPS: 30,
  BUFFER_SIZE: 400,
  PLOT_AREA: {
    LEFT: 96,
    RIGHT: 96,
    TOP: 152,
    BOTTOM: 76
  },
  COLORS: {
    BG: '#020617',
    GRID_MAJOR: 'rgba(34, 211, 238, 0.12)',
    GRID_MINOR: 'rgba(52, 211, 153, 0.06)',
    BASELINE: 'rgba(45, 212, 191, 0.35)',
    SIGNAL_NORMAL: '#00ff88',
    SIGNAL_GLOW: 'rgba(0, 255, 136, 0.6)',
    SIGNAL_ARRHYTHMIA: '#ff3366',
    ARRHYTHMIA_GLOW: 'rgba(255, 51, 102, 0.6)',
    SIGNAL_WEAK: '#ffaa00',
    WEAK_GLOW: 'rgba(255, 170, 0, 0.5)',
    PEAK_NORMAL: '#00ffff',
    PEAK_WEAK: '#ffaa00',
    PEAK_ARRHYTHMIA: '#ff0000',
    VALLEY_COLOR: '#64748b',
    TEXT_PRIMARY: '#00ffff',
    TEXT_SECONDARY: '#94a3b8',
    TEXT_WARNING: '#ffaa00',
    TEXT_DANGER: '#ff3366',
    SCALE_TEXT: '#64748b',
    SIGNAL_FILL_NORMAL: 'rgba(0, 255, 136, 0.15)',
    SIGNAL_FILL_WEAK: 'rgba(255, 170, 0, 0.12)',
    SIGNAL_FILL_ARR: 'rgba(255, 51, 102, 0.12)',
    SYSTOLIC_MARKER: '#00ffff',
    DIASTOLIC_MARKER: '#818cf8',
    DICHROTIC_NOTCH: '#a78bfa',
    IBI_TEXT: '#67e8f9',
    ACCENT_LINE: 'rgba(0, 255, 255, 0.6)',
  }
};

/** Solo escala Y de la onda en el canvas; no afecta BPM/SpO₂ ni vitales (provienen de props). */
const VISUAL_WAVEFORM_GAIN = 3.2;

const parseRhythmStatus = (statusString?: string) => {
  const [label = 'SIN ARRITMIAS', countStr = '0'] = (statusString || 'SIN ARRITMIAS|0').split('|');
  const count = parseInt(countStr, 10) || 0;
  const normalized = label.trim();
  const display = normalized.split('_').join(' ');
  const isAlert = !NON_ALERT_RHYTHM_LABELS.has(normalized);
  const color = normalized === 'UNDETERMINED_LOW_QUALITY'
    ? CONFIG.COLORS.TEXT_WARNING
    : isAlert
      ? CONFIG.COLORS.TEXT_DANGER
      : CONFIG.COLORS.TEXT_PRIMARY;
  return { label: normalized, count, display, isAlert, color };
};

function strokeForWaveClass(wc: BeatWaveClass, COLORS: typeof CONFIG.COLORS) {
  switch (wc) {
    case 'arrhythmia':
      return { stroke: COLORS.SIGNAL_ARRHYTHMIA, glow: COLORS.ARRHYTHMIA_GLOW, blur: 8, width: 6.5 };
    case 'weak':
      return { stroke: COLORS.SIGNAL_WEAK, glow: COLORS.WEAK_GLOW, blur: 6, width: 5.8 };
    default:
      return { stroke: COLORS.SIGNAL_NORMAL, glow: COLORS.SIGNAL_GLOW, blur: 5, width: 5.2 };
  }
}

/** Panel estilo consola clínica (canvas). */
function fillMetricPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string
) {
  const r = 14;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, 'rgba(15, 23, 42, 0.92)');
  g.addColorStop(0.5, 'rgba(8, 15, 35, 0.96)');
  g.addColorStop(1, 'rgba(2, 6, 23, 0.98)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x + 1, y + 1, w - 2, h - 2, r - 1);
  }
  ctx.stroke();
}

/**
 * Cada segmento (entre vértices i-1 e i) usa el color de pathCoords[i].wc (como el bucle original).
 * Agrupa segmentos consecutivos con el mismo wc de destino → un stroke + sombra por grupo.
 */
function strokeWaveformRuns(
  pathCoords: { x: number; y: number; wc: BeatWaveClass }[],
  COLORS: typeof CONFIG.COLORS,
  ctx: CanvasRenderingContext2D
) {
  if (pathCoords.length < 2) return;
  let runSegLo = 1;
  for (let i = 2; i < pathCoords.length; i++) {
    if (pathCoords[i - 1]!.wc !== pathCoords[i]!.wc) {
      strokeMergedSegments(pathCoords, runSegLo, i - 1, COLORS, ctx);
      runSegLo = i;
    }
  }
  strokeMergedSegments(pathCoords, runSegLo, pathCoords.length - 1, COLORS, ctx);
}

function strokeMergedSegments(
  pathCoords: { x: number; y: number; wc: BeatWaveClass }[],
  segLo: number,
  segHi: number,
  COLORS: typeof CONFIG.COLORS,
  ctx: CanvasRenderingContext2D
) {
  if (segHi < segLo) return;
  const wc = pathCoords[segLo]!.wc;
  const st = strokeForWaveClass(wc, COLORS);
  ctx.beginPath();
  ctx.moveTo(pathCoords[segLo - 1]!.x, pathCoords[segLo - 1]!.y);
  for (let k = segLo; k <= segHi; k++) ctx.lineTo(pathCoords[k]!.x, pathCoords[k]!.y);
  ctx.strokeStyle = st.stroke;
  ctx.shadowColor = st.glow;
  ctx.shadowBlur = st.blur;
  ctx.lineWidth = st.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.shadowBlur = 0;
}

/** Máximo local de la PPG (máx. valor = pico sistólico) entre dos tiempos de latido. */
function refineSystolicPeak(
  points: readonly PPGDataPoint[],
  beatTime: number,
  prevBeatTime: number | undefined,
  now: number,
  plot: { x: number; y: number; width: number; height: number },
  windowMs: number,
  stats: { min: number; max: number; range: number }
): { x: number; y: number; amp: number } | null {
  const tLo = prevBeatTime != null ? prevBeatTime + 40 : beatTime - 720;
  const tHi = beatTime + 100;
  let best: PPGDataPoint | null = null;
  let bestV = -Infinity;
  const n = points.length;
  let idx = 0;
  while (idx < n && points[idx]!.time < tLo) idx++;
  for (; idx < n; idx++) {
    const pt = points[idx]!;
    if (pt.time > tHi) break;
    if (pt.value > bestV) {
      bestV = pt.value;
      best = pt;
    }
  }
  if (!best) return null;
  const age = now - best.time;
  if (age > windowMs || age < 0) return null;
  const x = plot.x + plot.width - (age * plot.width / windowMs);
  const y = plot.y + ((stats.max - best.value) / stats.range) * plot.height;
  if (x < plot.x || x > plot.x + plot.width) return null;
  return { x, y, amp: best.value };
}

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
  peakEvent = { seq: 0, flags: null, wallTime: 0, morphologyScore: null },
  bpm = 0,
  spo2 = 0,
  rrIntervals = [],
  pipelineTelemetry
}: PPGSignalMeterProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Escala física para nitidez en pantallas retina (coordenadas lógicas sin cambiar). */
  const dprRef = useRef(1);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  /** Rejilla + escala temporal: se redibuja solo al cambiar tamaño/DPR (no cada frame). */
  const staticLayerRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  const propsRef = useRef({
    value,
    quality,
    isFingerDetected,
    arrhythmiaStatus,
    preserveResults,
    peakEvent,
    bpm,
    spo2,
    rrIntervals,
    rawArrhythmiaData,
    pipelineTelemetry,
  });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);
  
  const lastRhythmCountSeenRef = useRef(0);
  const lastProcessedPeakSeqRef = useRef(0);
  const lastPulsePeakSeqRef = useRef(0);
  const beatHistoryRef = useRef<{
    waveClass: BeatWaveClass;
    time: number;
    ibiMs?: number;
    morph?: number | null;
  }[]>([]);
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });
  const ibiDisplayRef = useRef<number>(0);
  const hrvDisplayRef = useRef<{ sdnn: number; rmssd: number }>({ sdnn: 0, rmssd: 0 });

  useEffect(() => {
    propsRef.current = {
      value,
      quality,
      isFingerDetected,
      arrhythmiaStatus,
      preserveResults,
      peakEvent,
      bpm,
      spo2,
      rrIntervals,
      rawArrhythmiaData,
      pipelineTelemetry,
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
  }, [
    value,
    quality,
    isFingerDetected,
    arrhythmiaStatus,
    preserveResults,
    peakEvent,
    bpm,
    spo2,
    rrIntervals,
    rawArrhythmiaData,
    pipelineTelemetry,
  ]);

  useEffect(() => {
    const seq = peakEvent?.seq ?? 0;
    if (seq > 0 && seq !== lastPulsePeakSeqRef.current && isFingerDetected) {
      lastPulsePeakSeqRef.current = seq;
      const now = Date.now();
      if (now - lastPeakTimeRef.current > 250) {
        lastPeakTimeRef.current = now;
        setShowPulse(true);
        setTimeout(() => setShowPulse(false), 120);
      }
    }
  }, [peakEvent?.seq, isFingerDetected]);

  useEffect(() => {
    if (!dataBufferRef.current) dataBufferRef.current = new CircularBuffer(CONFIG.BUFFER_SIZE);
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    if (preserveResults && !isFingerDetected) {
      dataBufferRef.current?.clear();
    }
  }, [preserveResults, isFingerDetected]);

  useEffect(() => {
    if (peakEvent.seq === 0) {
      lastProcessedPeakSeqRef.current = 0;
      lastRhythmCountSeenRef.current = 0;
    }
  }, [peakEvent.seq]);

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
    const cx = plot.x + plot.width / 2;
    const cy = plot.y + plot.height / 2;
    const rad = Math.max(plot.width, plot.height) * 0.65;
    const vignette = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    vignette.addColorStop(0, 'rgba(8, 51, 68, 0.35)');
    vignette.addColorStop(0.45, 'rgba(4, 24, 38, 0.2)');
    vignette.addColorStop(1, 'rgba(2, 6, 23, 0.55)');
    ctx.fillStyle = vignette;
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
    ctx.lineWidth = 1.25;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.centerY);
    ctx.lineTo(plot.x + plot.width, plot.centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = COLORS.ACCENT_LINE;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.width - 1, plot.height - 1);
    const L = 20;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.45)';
    const corners: [number, number, 'tl' | 'tr' | 'bl' | 'br'][] = [
      [plot.x, plot.y, 'tl'],
      [plot.x + plot.width, plot.y, 'tr'],
      [plot.x, plot.y + plot.height, 'bl'],
      [plot.x + plot.width, plot.y + plot.height, 'br'],
    ];
    for (const [bx, by, c] of corners) {
      ctx.beginPath();
      if (c === 'tl') {
        ctx.moveTo(bx, by + L);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + L, by);
      } else if (c === 'tr') {
        ctx.moveTo(bx - L, by);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx, by + L);
      } else if (c === 'bl') {
        ctx.moveTo(bx, by - L);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx + L, by);
      } else {
        ctx.moveTo(bx - L, by);
        ctx.lineTo(bx, by);
        ctx.lineTo(bx, by - L);
      }
      ctx.stroke();
    }
  }, [getPlotArea]);

  const drawAmplitudeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS } = CONFIG;
    const plot = getPlotArea();
    const stats = amplitudeStatsRef.current;
    ctx.font = '13px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'right';
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = plot.y + (i / steps) * plot.height;
      const val = stats.max - (i / steps) * stats.range;
      ctx.fillText(val.toFixed(0), plot.x - 10, y + 5);
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x - 5, y);
      ctx.lineTo(plot.x, y);
      ctx.stroke();
    }
    ctx.save();
    ctx.translate(18, plot.centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.font = '12px "SF Mono", Consolas, monospace';
    ctx.fillText('AMPLITUD (u.a.)', 0, 0);
    ctx.restore();
  }, [getPlotArea]);

  const drawTimeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS, WINDOW_MS } = CONFIG;
    const plot = getPlotArea();
    ctx.font = '12px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'center';
    const seconds = WINDOW_MS / 1000;
    for (let s = 0; s <= seconds; s++) {
      const x = plot.x + plot.width - (s / seconds) * plot.width;
      ctx.fillText(`${s}s`, x, plot.y + plot.height + 24);
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.height);
      ctx.lineTo(x, plot.y + plot.height + 6);
      ctx.stroke();
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.TEXT_PRIMARY;
    ctx.font = '11px "SF Mono", Consolas, monospace';
    ctx.fillText('escala 25 mm/s', plot.x + plot.width, plot.y + plot.height + 48);
  }, [getPlotArea]);

  const paintStaticLayer = useCallback(() => {
    let sc = staticLayerRef.current;
    if (!sc) {
      sc = document.createElement('canvas');
      staticLayerRef.current = sc;
    }
    const dpr = dprRef.current;
    sc.width = Math.round(CONFIG.CANVAS_WIDTH * dpr);
    sc.height = Math.round(CONFIG.CANVAS_HEIGHT * dpr);
    const sctx = sc.getContext('2d', { alpha: false, desynchronized: true });
    if (!sctx) return;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'medium';
    drawGrid(sctx);
    drawTimeScale(sctx);
  }, [drawGrid, drawTimeScale]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const applySize = () => {
      const raw = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const dpr = Math.min(raw, 1.35);
      dprRef.current = dpr;
      canvas.width = Math.round(CONFIG.CANVAS_WIDTH * dpr);
      canvas.height = Math.round(CONFIG.CANVAS_HEIGHT * dpr);
      const c2 = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (c2) {
        c2.imageSmoothingEnabled = true;
        c2.imageSmoothingQuality = 'medium';
        ctxRef.current = c2;
      }
      paintStaticLayer();
    };
    applySize();
    window.addEventListener('resize', applySize);
    return () => window.removeEventListener('resize', applySize);
  }, [paintStaticLayer]);

  const drawVitalInfo = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, COLORS } = CONFIG;
    const { bpm, spo2, arrhythmiaStatus, quality, rrIntervals, rawArrhythmiaData } = propsRef.current;
    const rhythm = parseRhythmStatus(arrhythmiaStatus);
    const panelH = 112;
    const panelW = 186;
    const panelY = 4;
    const fontSize = {
      label: '600 11px "SF Mono", Consolas, monospace',
      value: 'bold 52px "SF Mono", Consolas, monospace',
      unit: '16px "SF Mono", Consolas, monospace',
      class: '12px "SF Mono", Consolas, monospace',
      small: '11px "SF Mono", Consolas, monospace',
    };

    fillMetricPanel(ctx, 3, panelY, panelW, panelH, 'rgba(34, 211, 238, 0.55)');
    ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
    ctx.fillRect(6, panelY + 2, panelW - 12, 3);

    ctx.font = fontSize.label;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
    ctx.textAlign = 'left';
    ctx.fillText('FRECUENCIA CARDIACA', 14, panelY + 22);
    ctx.font = fontSize.value;
    ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
    ctx.fillText(bpm > 0 ? bpm.toString() : '—', 14, panelY + 86);
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('BPM', panelW - 40, panelY + 86);
    if (bpm > 0) {
      ctx.font = fontSize.class;
      let hrLabel = '';
      let hrColor = COLORS.TEXT_PRIMARY;
      if (bpm < 60) { hrLabel = 'BRADICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      else if (bpm <= 100) { hrLabel = 'NORMAL'; hrColor = COLORS.TEXT_PRIMARY; }
      else { hrLabel = 'TAQUICARDIA'; hrColor = COLORS.TEXT_WARNING; }
      ctx.fillStyle = hrColor;
      ctx.fillText(hrLabel, 14, panelY + 114);
    }

    const spo2Border = spo2 >= 95 ? 'rgba(45, 212, 191, 0.65)' : spo2 >= 90 ? 'rgba(251, 191, 36, 0.65)' : 'rgba(248, 113, 113, 0.65)';
    fillMetricPanel(ctx, W - panelW - 3, panelY, panelW, panelH, spo2Border);
    ctx.fillStyle = spo2 >= 95 ? 'rgba(45, 212, 191, 0.85)' : spo2 >= 90 ? 'rgba(251, 191, 36, 0.85)' : spo2 > 0 ? 'rgba(248, 113, 113, 0.85)' : 'rgba(34, 211, 238, 0.35)';
    ctx.fillRect(W - panelW, panelY + 2, panelW - 12, 3);

    ctx.font = fontSize.label;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
    ctx.textAlign = 'left';
    ctx.fillText('SATURACION O2', W - panelW + 14, panelY + 22);
    ctx.font = fontSize.value;
    const spo2Color = spo2 >= 95 ? COLORS.TEXT_PRIMARY : spo2 >= 90 ? COLORS.TEXT_WARNING : spo2 > 0 ? COLORS.TEXT_DANGER : COLORS.TEXT_SECONDARY;
    ctx.fillStyle = spo2Color;
    ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '—', W - panelW + 14, panelY + 86);
    ctx.font = fontSize.unit;
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('%', W - 24, panelY + 86);
    if (spo2 > 0) {
      ctx.font = fontSize.class;
      let spLabel = '';
      let spColor = COLORS.TEXT_PRIMARY;
      if (spo2 >= 95) { spLabel = 'NORMAL'; spColor = COLORS.TEXT_PRIMARY; }
      else if (spo2 >= 90) { spLabel = 'HIPOXEMIA LEVE'; spColor = COLORS.TEXT_WARNING; }
      else { spLabel = 'HIPOXEMIA'; spColor = COLORS.TEXT_DANGER; }
      ctx.fillStyle = spColor;
      ctx.fillText(spLabel, W - panelW + 14, panelY + 114);
    }

    const centerX = W / 2;
    const centerW = 340;
    const qAccent = quality > 60 ? 'rgba(45, 212, 191, 0.6)' : quality > 30 ? 'rgba(251, 191, 36, 0.6)' : 'rgba(248, 113, 113, 0.55)';
    fillMetricPanel(ctx, centerX - centerW / 2, panelY, centerW, panelH, qAccent);
    ctx.fillStyle = quality > 60 ? 'rgba(45, 212, 191, 0.85)' : quality > 30 ? 'rgba(251, 191, 36, 0.75)' : 'rgba(248, 113, 113, 0.75)';
    ctx.fillRect(centerX - centerW / 2 + 3, panelY + 2, centerW - 6, 3);
    ctx.font = '600 11px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.95)';
    ctx.fillText('INDICE DE CALIDAD DE SEÑAL (SQI)', centerX, panelY + 22);
    const barWidth = 300;
    const barHeight = 14;
    const barX = centerX - barWidth / 2;
    const barY = panelY + 32;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    const qGrad = ctx.createLinearGradient(barX, 0, barX + (quality / 100) * barWidth, 0);
    if (quality > 60) { qGrad.addColorStop(0, '#0d9488'); qGrad.addColorStop(1, '#5eead4'); }
    else if (quality > 30) { qGrad.addColorStop(0, '#b45309'); qGrad.addColorStop(1, '#fbbf24'); }
    else { qGrad.addColorStop(0, '#b91c1c'); qGrad.addColorStop(1, '#f87171'); }
    ctx.fillStyle = qGrad;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    ctx.font = 'bold 18px "SF Mono", Consolas, monospace';
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillText(`${quality.toFixed(0)}%`, centerX, panelY + 64);
    const mc = propsRef.current.pipelineTelemetry?.measurementConfidence;
    if (mc && mc !== 'INVALID') {
      ctx.font = '600 10px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle =
        mc === 'HIGH' ? 'rgba(45, 212, 191, 0.95)' : mc === 'MEDIUM' ? 'rgba(251, 191, 36, 0.95)' : 'rgba(248, 113, 113, 0.9)';
      ctx.fillText(`Conf. medición · ${mc}`, centerX, panelY + 82);
    }
    const ibi = ibiDisplayRef.current;
    const hrv = hrvDisplayRef.current;
    ctx.font = fontSize.small;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.IBI_TEXT;
    ctx.fillText(`IBI ${ibi > 0 ? ibi + ' ms' : '—'}`, centerX - centerW / 2 + 12, panelY + 94);
    ctx.fillStyle = rhythm.color;
    ctx.fillText(`RITMO  ${rhythm.display}`, centerX - centerW / 2 + 12, panelY + 114);
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'right';
    ctx.fillText(`SDNN ${hrv.sdnn > 0 ? hrv.sdnn + ' ms' : '—'}`, centerX + centerW / 2 - 12, panelY + 94);
    ctx.fillText(`RMSSD ${hrv.rmssd > 0 ? hrv.rmssd + ' ms' : '—'}`, centerX + centerW / 2 - 12, panelY + 114);
    
    if (rhythm.isAlert) {
      const pulse = (Math.sin(now / 100) + 1) / 2;
      ctx.fillStyle = `rgba(239, 68, 68, ${0.3 + pulse * 0.4})`;
      ctx.fillRect(W - panelW - 3, panelY + panelH + 4, panelW, 34);
      ctx.strokeStyle = COLORS.TEXT_DANGER;
      ctx.lineWidth = 2;
      ctx.strokeRect(W - panelW - 3, panelY + panelH + 4, panelW, 34);
      ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_DANGER;
      ctx.textAlign = 'center';
      const label = rhythm.count > 0 ? `${rhythm.display} x${rhythm.count}` : rhythm.display;
      ctx.fillText(`ALERTA  ${label}`, W - panelW / 2 - 3, panelY + panelH + 24);
      if (rawArrhythmiaData && rawArrhythmiaData.rmssd > 0) {
        ctx.font = '12px "SF Mono", Consolas, monospace';
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
        ctx.fillText(`RMSSD ${rawArrhythmiaData.rmssd.toFixed(0)} ms`, W - panelW / 2 - 3, panelY + panelH + 44);
      }
    }
  }, []);

  useEffect(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    const frameTime = 1000 / CONFIG.TARGET_FPS;
    let lastRenderTime = 0;
    
    const render = () => {
      if (!isRunningRef.current) return;
      const now = Date.now();
      if (now - lastRenderTime < frameTime) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      lastRenderTime = now;
      const canvas = canvasRef.current;
      const buffer = dataBufferRef.current;
      if (!canvas || !buffer) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      let ctx = ctxRef.current;
      if (!ctx) {
        const c2 = canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!c2) {
          animationRef.current = requestAnimationFrame(render);
          return;
        }
        c2.imageSmoothingEnabled = true;
        c2.imageSmoothingQuality = 'medium';
        ctxRef.current = c2;
        ctx = c2;
      }
      const dpr = dprRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      const staticCanvas = staticLayerRef.current;
      if (staticCanvas && staticCanvas.width > 0) {
        ctx.drawImage(staticCanvas, 0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
      } else {
        drawGrid(ctx);
        drawTimeScale(ctx);
      }
      
      const { value: signalValue, isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve, peakEvent: pe } = propsRef.current;
      const rhythm = parseRhythmStatus(arrStatus);
      const plot = getPlotArea();
      const { WINDOW_MS, COLORS } = CONFIG;
      
      drawAmplitudeScale(ctx);
      drawVitalInfo(ctx, now);
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      const scaledValue = signalValue * VISUAL_WAVEFORM_GAIN;
      
      const peakSeq = pe?.seq ?? 0;
      if (peakSeq > 0 && peakSeq !== lastProcessedPeakSeqRef.current) {
        lastProcessedPeakSeqRef.current = peakSeq;
        const { rrIntervals: rr } = propsRef.current;
        const { waveClass, lastRhythmCountSeen } = classifyBeatWaveClass(
          pe.flags ?? null,
          { isAlert: rhythm.isAlert, count: rhythm.count },
          rr ?? [],
          lastRhythmCountSeenRef.current,
          pe.morphologyScore ?? null
        );
        lastRhythmCountSeenRef.current = lastRhythmCountSeen;
        const lastRR = rr && rr.length > 0 ? rr[rr.length - 1]! : 800;
        const beatDuration = Math.min(Math.max(lastRR, 400), 800); // Duración del latido en ms
        const beatTime = pe.wallTime > 0 ? pe.wallTime : now;
        
        // DEBUG: Log para verificar el flujo
        console.log('[PPGSignalMeter] Peak:', pe.seq, 'waveClass:', waveClass, 'beatTime:', beatTime, 'now:', now, 'lastRR:', lastRR);
        
        // Marcar solo el segmento del latido actual
        const segmentStart = beatTime - beatDuration / 2;
        if (waveClass === 'arrhythmia') {
          console.log('[PPGSignalMeter] Marking arrhythmia segment:', segmentStart, 'to', segmentStart + beatDuration);
          buffer.markWaveClassSegment(segmentStart, beatDuration, 'arrhythmia');
        } else if (waveClass === 'weak') {
          buffer.markWaveClassSegment(segmentStart, beatDuration, 'weak');
        }
        
        beatHistoryRef.current.push({
          waveClass,
          time: beatTime,
          ibiMs: lastRR,
          morph: pe.morphologyScore ?? null,
        });
        if (beatHistoryRef.current.length > 20) beatHistoryRef.current = beatHistoryRef.current.slice(-20);
      }

      // Siempre usar 'normal' para nuevos puntos - el marking segment se hace por separado
      buffer.push({ time: now, value: scaledValue, waveClass: 'normal' });
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
      const { isFingerDetected: fingerOk, bpm: bpmLive, rrIntervals: rrLive } = propsRef.current;

      if (points.length > 2) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        const pathCoords: { x: number; y: number; wc: BeatWaveClass }[] = [];
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          if (x < plot.x || x > plot.x + plot.width) continue;
          pathCoords.push({ x, y, wc: pt.waveClass });
        }
        if (pathCoords.length > 2) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pathCoords[0].x, plot.centerY);
          for (const c of pathCoords) ctx.lineTo(c.x, c.y);
          ctx.lineTo(pathCoords[pathCoords.length - 1].x, plot.centerY);
          ctx.closePath();
          const fillGrad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.height);
          fillGrad.addColorStop(0, 'rgba(45, 212, 191, 0.2)');
          fillGrad.addColorStop(0.5, 'rgba(52, 211, 153, 0.08)');
          fillGrad.addColorStop(1, 'rgba(52, 211, 153, 0)');
          ctx.fillStyle = fillGrad;
          ctx.fill();
          ctx.restore();
          const collectSeg = (cls: BeatWaveClass) => {
            const segs: { x: number; y: number }[][] = [];
            let cur: { x: number; y: number }[] = [];
            for (const c of pathCoords) {
              if (c.wc === cls) cur.push({ x: c.x, y: c.y });
              else {
                if (cur.length > 1) segs.push(cur);
                cur = [];
              }
            }
            if (cur.length > 1) segs.push(cur);
            return segs;
          };
          const weakSegs = collectSeg('weak');
          const arrSegs = collectSeg('arrhythmia');
          for (const seg of weakSegs) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(seg[0]!.x, plot.centerY);
            for (const c of seg) ctx.lineTo(c.x, c.y);
            ctx.lineTo(seg[seg.length - 1]!.x, plot.centerY);
            ctx.closePath();
            const wFill = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.height);
            wFill.addColorStop(0, 'rgba(245, 158, 11, 0.14)');
            wFill.addColorStop(0.5, 'rgba(245, 158, 11, 0.05)');
            wFill.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
            ctx.fillStyle = wFill;
            ctx.fill();
            ctx.restore();
          }
          for (const seg of arrSegs) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(seg[0]!.x, plot.centerY);
            for (const c of seg) ctx.lineTo(c.x, c.y);
            ctx.lineTo(seg[seg.length - 1]!.x, plot.centerY);
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
        strokeWaveformRuns(pathCoords, COLORS, ctx);
        
        // Efecto de electricidad en picos sistólicos
        for (let i = 1; i < pathCoords.length - 1; i++) {
          const prev = pathCoords[i - 1]!;
          const curr = pathCoords[i]!;
          const next = pathCoords[i + 1]!;
          
          // Detectar pico local (máximo)
          if (curr.y < prev.y && curr.y < next.y) {
            const depth = Math.min(prev.y - curr.y, next.y - curr.y);
            if (depth > 15) {
              // Dibujar líneas eléctricas radiantes desde el pico
              ctx.save();
              ctx.strokeStyle = curr.wc === 'arrhythmia' ? '#ff3366' : curr.wc === 'weak' ? '#ffaa00' : '#00ffff';
              ctx.lineWidth = 1.5;
              ctx.globalAlpha = 0.7;
              
              for (let ray = 0; ray < 8; ray++) {
                const angle = (ray / 8) * Math.PI * 2;
                const rayLen = 12 + depth * 0.3;
                ctx.beginPath();
                ctx.moveTo(curr.x, curr.y);
                ctx.lineTo(
                  curr.x + Math.cos(angle) * rayLen,
                  curr.y + Math.sin(angle) * rayLen
                );
                ctx.stroke();
              }
              ctx.restore();
            }
          }
        }

        const plotTelemetryY = plot.y + 10;
        const telH = 54;
        const tel = propsRef.current.pipelineTelemetry;
        const fsStr =
          tel?.estimatedSampleRateHz != null && tel.estimatedSampleRateHz > 0
            ? `${tel.estimatedSampleRateHz.toFixed(1)} Hz`
            : '—';
        const iouStr = tel?.maskIoU != null ? `${(tel.maskIoU * 100).toFixed(0)}%` : '—';
        const rvfcStr =
          tel?.captureTimingConfidence != null && tel.captureTimingConfidence > 0
            ? `${(tel.captureTimingConfidence * 100).toFixed(0)}%`
            : '—';
        const srcStr = tel?.activeSource && tel.activeSource.length > 0 ? tel.activeSource : '—';
        ctx.save();
        fillMetricPanel(ctx, plot.x, plotTelemetryY, plot.width, telH, 'rgba(34, 211, 238, 0.35)');
        ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
        ctx.fillRect(plot.x + 2, plotTelemetryY + 2, plot.width - 4, 2);
        ctx.font = '600 12px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_PRIMARY;
        ctx.textAlign = 'left';
        ctx.fillText(`CANAL · ${srcStr}  ·  Fs ${fsStr}  ·  IoU ${iouStr}  ·  RVFC ${rvfcStr}`, plot.x + 14, plotTelemetryY + 22);
        ctx.font = '12px "SF Mono", Consolas, monospace';
        ctx.fillStyle = 'rgba(203, 213, 225, 0.95)';
        const ampTxt = stats.range > 1 ? `${Math.round(stats.range)} u.a.` : '—';
        const lastRr = rrLive && rrLive.length > 0 ? `${Math.round(rrLive[rrLive.length - 1]!)} ms` : '—';
        ctx.fillText(
          `Ventana ${(WINDOW_MS / 1000).toFixed(1)} s  ·  Amp ${ampTxt}  ·  FC ${bpmLive > 0 ? Math.round(bpmLive) : '—'}  ·  IBI ${lastRr}  ·  ${fingerOk ? 'LISTO' : 'ESPERANDO'}`,
          plot.x + 14,
          plotTelemetryY + 42
        );
        ctx.restore();

        const peaks: {
          x: number;
          y: number;
          waveClass: BeatWaveClass;
          time: number;
          ibiMs?: number;
          morph?: number | null;
        }[] = [];
        const valleys: { x: number; y: number }[] = [];
        const history = beatHistoryRef.current;
        const visibleBeats: { time: number; x: number; y: number; waveClass: BeatWaveClass }[] = [];
        for (let idx = 0; idx < history.length; idx++) {
          const beat = history[idx]!;
          const age = now - beat.time;
          if (age > WINDOW_MS || age < 0) continue;
          const prevT = idx > 0 ? history[idx - 1]!.time : undefined;
          const refined = refineSystolicPeak(points, beat.time, prevT, now, plot, WINDOW_MS, stats);
          if (!refined) continue;
          const { x, y } = refined;
          peaks.push({
            x,
            y,
            waveClass: beat.waveClass,
            time: beat.time,
            ibiMs: beat.ibiMs,
            morph: beat.morph,
          });
          visibleBeats.push({ time: beat.time, x, y, waveClass: beat.waveClass });
        }
        let valleyScan = 0;
        const nPts = points.length;
        for (let b = 0; b < visibleBeats.length - 1; b++) {
          const t0 = visibleBeats[b].time;
          const t1 = visibleBeats[b + 1].time;
          while (valleyScan < nPts && points[valleyScan]!.time <= t0) valleyScan++;
          let minVal = Infinity;
          let minPt: PPGDataPoint | null = null;
          let k = valleyScan;
          while (k < nPts && points[k]!.time < t1) {
            const pt = points[k]!;
            if (pt.time > t0 && pt.value < minVal) {
              minVal = pt.value;
              minPt = pt;
            }
            k++;
          }
          valleyScan = k;
          if (minPt) {
            const age2 = now - minPt.time;
            const vx = plot.x + plot.width - (age2 * plot.width / WINDOW_MS);
            const vy = plot.y + ((stats.max - minPt.value) / stats.range) * plot.height;
            if (vx >= plot.x && vx <= plot.x + plot.width) valleys.push({ x: vx, y: vy });
          }
        }
        for (let i = 0; i < peaks.length - 1; i++) {
          const p1 = peaks[i]!;
          const p2 = peaks[i + 1]!;
          const ibiMs = Math.abs(p1.time - p2.time);
          if (ibiMs > 0 && ibiMs < 3000) {
            const midX = (p1.x + p2.x) / 2;
            const topY = Math.min(p1.y, p2.y) - 36;
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(p1.x, topY + 10);
            ctx.lineTo(p1.x, topY);
            ctx.lineTo(p2.x, topY);
            ctx.lineTo(p2.x, topY + 10);
            ctx.stroke();
            ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
            ctx.fillStyle = 'rgba(125, 211, 252, 0.98)';
            ctx.textAlign = 'center';
            ctx.fillText(`RR ${ibiMs} ms`, midX, topY - 8);
          }
        }
        const lastPeakIdx = peaks.length - 1;
        peaks.forEach((p, pi) => {
          const peakColor =
            p.waveClass === 'arrhythmia' ? COLORS.PEAK_ARRHYTHMIA :
            p.waveClass === 'weak' ? COLORS.PEAK_WEAK :
            COLORS.PEAK_NORMAL;
          const vLineStroke =
            p.waveClass === 'arrhythmia' ? 'rgba(248, 113, 113, 0.85)' :
            p.waveClass === 'weak' ? 'rgba(251, 191, 36, 0.9)' :
            'rgba(96, 165, 250, 0.9)';
          const label = p.waveClass === 'arrhythmia' ? 'A' : p.waveClass === 'weak' ? 'W' : 'N';
          const textCol =
            p.waveClass === 'arrhythmia' ? COLORS.TEXT_DANGER :
            p.waveClass === 'weak' ? COLORS.TEXT_WARNING :
            COLORS.TEXT_PRIMARY;
          const pr = p.waveClass === 'arrhythmia' ? 16 : p.waveClass === 'weak' ? 14 : 13;
          const isLatest = pi === lastPeakIdx && lastPeakIdx >= 0;
          const traceTop = plot.y + 44;

          ctx.save();
          ctx.setLineDash([]);
          ctx.strokeStyle = vLineStroke;
          ctx.lineWidth = 4;
          ctx.shadowColor = peakColor;
          ctx.shadowBlur = isLatest ? 14 : 8;
          ctx.beginPath();
          ctx.moveTo(p.x, traceTop);
          ctx.lineTo(p.x, plot.y + plot.height);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.restore();

          if (isLatest) {
            const pulse = (Math.sin(now / 120) + 1) / 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, pr + 10 + pulse * 6, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,255,255,${0.12 + pulse * 0.2})`;
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          ctx.beginPath();
          ctx.arc(p.x, p.y, pr + 3, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, pr, 0, Math.PI * 2);
          ctx.fillStyle = peakColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, pr * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();

          ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
          ctx.fillStyle = 'rgba(241, 245, 249, 0.98)';
          ctx.textAlign = 'center';
          ctx.fillText('P', p.x, p.y - pr - 12);
          ctx.font = 'bold 15px "SF Mono", Consolas, monospace';
          ctx.fillStyle = textCol;
          ctx.fillText(label, p.x, p.y - pr - 28);

          const tagY = p.y + pr + 16;
          let tagLine = 0;
          ctx.font = '11px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.IBI_TEXT;
          if (p.ibiMs != null && p.ibiMs > 0) {
            ctx.fillText(`IBI ${Math.round(p.ibiMs)} ms`, p.x, tagY + tagLine * 14);
            tagLine++;
          }
          if (p.morph != null && p.morph >= 0) {
            ctx.font = '10px "SF Mono", Consolas, monospace';
            ctx.fillStyle = COLORS.TEXT_SECONDARY;
            ctx.fillText(`Morf ${Math.round(p.morph)}`, p.x, tagY + tagLine * 14);
          }

          if (p.waveClass === 'arrhythmia') {
            const alpha = (Math.sin(now / 80) + 1) / 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, pr + 18, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.25 + alpha * 0.45})`;
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        });
        valleys.forEach(v => {
          ctx.beginPath();
          ctx.moveTo(v.x, v.y + 4);
          ctx.lineTo(v.x - 5, v.y + 12);
          ctx.lineTo(v.x + 5, v.y + 12);
          ctx.closePath();
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.fill();
          ctx.font = '10px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.textAlign = 'center';
          ctx.fillText('V', v.x, v.y + 26);
        });
      }
      
      const beatHistory = beatHistoryRef.current;
      if (beatHistory.length > 0) {
        const histX = plot.x;
        const histY = plot.y + plot.height + 34;
        const dotRadius = 8;
        const dotSpacing = 20;
        const totalWidth = beatHistory.length * dotSpacing;
        const startX = histX + (plot.width - totalWidth) / 2;
        ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
        const panelPad = 8;
        const panelExtra = 24;
        ctx.fillRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + panelExtra);
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + panelExtra);
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.textAlign = 'center';
        ctx.fillText('HISTORIAL DE LATIDOS', startX + totalWidth / 2, histY - dotRadius - 1);
        const nCount = beatHistory.filter(b => b.waveClass === 'normal').length;
        const wCount = beatHistory.filter(b => b.waveClass === 'weak').length;
        const aCount = beatHistory.filter(b => b.waveClass === 'arrhythmia').length;
        ctx.font = '9px "SF Mono", Consolas, monospace';
        ctx.fillText(`N:${nCount} · W:${wCount} · A:${aCount}`, startX + totalWidth / 2, histY - dotRadius + 10);
        ctx.textAlign = 'center';
        beatHistory.forEach((beat, i) => {
          const cx = startX + i * dotSpacing + dotSpacing / 2;
          const cy = histY + 16;
          if (beat.waveClass === 'arrhythmia') {
            ctx.beginPath();
            ctx.arc(cx, cy, dotRadius + 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(239, 68, 68, 0.25)';
            ctx.fill();
          } else if (beat.waveClass === 'weak') {
            ctx.beginPath();
            ctx.arc(cx, cy, dotRadius + 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(245, 158, 11, 0.22)';
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          ctx.fillStyle =
            beat.waveClass === 'arrhythmia' ? COLORS.SIGNAL_ARRHYTHMIA :
            beat.waveClass === 'weak' ? COLORS.SIGNAL_WEAK :
            COLORS.SIGNAL_NORMAL;
          ctx.fill();
          ctx.font = 'bold 8px "SF Mono", Consolas, monospace';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(`${i + 1}`, cx, cy + 3);
        });
      }
      
      const legendY = CONFIG.CANVAS_HEIGHT - 22;
      ctx.font = '13px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      const lx = CONFIG.PLOT_AREA.LEFT;
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(lx, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 22, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal (N)', lx + 30, legendY);
      ctx.fillStyle = COLORS.SIGNAL_WEAK;
      ctx.fillRect(lx + 108, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 130, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Débil (W)', lx + 138, legendY);
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(lx + 210, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 232, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia (A)', lx + 240, legendY);
      ctx.beginPath();
      ctx.arc(lx + 330, legendY - 4, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.PEAK_NORMAL;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Pico', lx + 340, legendY);
      ctx.beginPath();
      ctx.moveTo(lx + 365, legendY - 6);
      ctx.lineTo(lx + 361, legendY);
      ctx.lineTo(lx + 369, legendY);
      ctx.closePath();
      ctx.fillStyle = COLORS.VALLEY_COLOR;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Valle', lx + 375, legendY);
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.fillRect(lx + 410, legendY - 5, 12, 2);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('IBI', lx + 428, legendY);
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
    lastRhythmCountSeenRef.current = 0;
    lastProcessedPeakSeqRef.current = 0;
    lastPulsePeakSeqRef.current = 0;
    ibiDisplayRef.current = 0;
    hrvDisplayRef.current = { sdnn: 0, rmssd: 0 };
    onReset();
  }, [onReset]);

  return (
    <div className="fixed inset-0 z-[15] bg-[#020617]">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.45]"
        style={{
          backgroundImage: `radial-gradient(ellipse 90% 55% at 50% -15%, rgba(34,211,238,0.14), transparent), radial-gradient(ellipse 50% 35% at 100% 100%, rgba(16,185,129,0.1), transparent)`,
        }}
      />
      <canvas
        ref={canvasRef}
        className="w-full h-full absolute inset-0 z-0 block touch-none"
        style={{ imageRendering: 'auto' }}
      />

      <header className="monitor-header-grid pointer-events-none absolute left-0 right-0 top-0 z-[100] border-b border-cyan-500/20 bg-gradient-to-b from-[#020617]/98 via-[#0f172a]/93 to-transparent backdrop-blur-2xl">
        <div className="flex flex-col gap-3 px-3 pb-4 pt-[max(12px,env(safe-area-inset-top))] sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
            <div
              className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-cyan-500/15 via-slate-900/80 to-emerald-900/30 shadow-[0_0_40px_rgba(34,211,238,0.12),inset_0_1px_0_rgba(255,255,255,0.06)] transition-transform duration-150 ${
                showPulse ? 'scale-105 ring-2 ring-rose-400/50' : ''
              }`}
            >
              <Heart
                className={`h-7 w-7 sm:h-8 sm:w-8 ${showPulse ? 'fill-rose-400/90 text-rose-200' : 'text-cyan-300'}`}
                fill={showPulse ? 'currentColor' : 'none'}
                strokeWidth={2}
              />
              {isMonitoring && (
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-cyan-500/90">Imaging PPG</p>
                <span className="hidden h-3 w-px bg-cyan-500/30 sm:block" aria-hidden />
                <Radio className="h-3.5 w-3.5 text-cyan-500/70" aria-hidden />
              </div>
              <h1 className="monitor-glow-text truncate text-lg font-bold tracking-tight text-white sm:text-xl">
                Monitor hemodinámico
              </h1>
              <p className="mt-0.5 text-xs text-slate-400">Fotopletismografía · tiempo real</p>
            </div>
          </div>

          <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:min-w-[200px] sm:items-end">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                  isFingerDetected
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/35'
                    : 'bg-slate-800/90 text-slate-500 ring-1 ring-white/10'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${isFingerDetected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-600'}`}
                />
                {isFingerDetected ? 'Señal válida' : 'Sin contacto'}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ring-1 ${
                  isMonitoring
                    ? 'bg-rose-500/15 text-rose-200 ring-rose-400/40'
                    : 'bg-slate-800/90 text-slate-500 ring-white/10'
                }`}
              >
                {isMonitoring ? '● Adquisición' : 'En espera'}
              </span>
            </div>
            <div className="w-full sm:w-48">
              <div className="mb-1 flex justify-between text-[9px] font-medium uppercase tracking-wider text-slate-500">
                <span>SQI</span>
                <span className="font-mono text-cyan-200/90">{quality.toFixed(0)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-900 ring-1 ring-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-600 via-teal-400 to-emerald-400 transition-[width] duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, quality))}%` }}
                />
              </div>
            </div>
            {diagnosticMessage ? (
              <p className="max-h-10 w-full overflow-hidden text-right font-mono text-[10px] leading-snug text-cyan-200/60 sm:max-w-[20rem]">
                {diagnosticMessage}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <div className="fixed bottom-0 left-0 right-0 z-50 grid h-[4.25rem] grid-cols-2 gap-px rounded-t-2xl border border-cyan-500/15 bg-slate-950/90 pb-[max(0.35rem,env(safe-area-inset-bottom))] shadow-[0_-16px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:h-[4.5rem]">
        <button
          type="button"
          onClick={onStartMeasurement}
          className={`monitor-dock-btn flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 rounded-tl-2xl border-0 sm:flex-row sm:gap-2 ${
            isMonitoring
              ? 'bg-gradient-to-b from-rose-600/35 to-rose-950/45 text-rose-50'
              : 'bg-gradient-to-b from-emerald-600/45 to-emerald-950/55 text-emerald-50'
          }`}
        >
          {isMonitoring ? (
            <Square className="h-5 w-5 opacity-90 sm:h-6 sm:w-6" strokeWidth={2.5} />
          ) : (
            <Play className="h-5 w-5 opacity-90 sm:h-6 sm:w-6" strokeWidth={2.5} />
          )}
          <span className="text-sm font-bold tracking-wide sm:text-base">{isMonitoring ? 'Detener' : 'Iniciar'}</span>
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="monitor-dock-btn flex min-h-[3.75rem] flex-col items-center justify-center gap-0.5 rounded-tr-2xl border-0 bg-gradient-to-b from-slate-800/95 to-slate-950/95 text-slate-100 sm:flex-row sm:gap-2"
        >
          <Activity className="h-5 w-5 opacity-80 sm:h-6 sm:w-6" strokeWidth={2} />
          <span className="text-sm font-bold tracking-wide sm:text-base">Reiniciar</span>
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;

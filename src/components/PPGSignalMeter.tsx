import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart, Activity } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';

interface PPGSignalMeterProps {
  value: number;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
  livePpgEvidencePassed?: boolean;
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
}

/**
 * PPGSignalMeter - Monitor cardíaco profesional en tiempo real
 *
 * Optimizaciones de rendimiento:
 * - Canvas reducido a tamaño nativo del dispositivo (ajuste DPR) para evitar 1400×2800 px
 *   que generaban 5–10× más píxeles a renderizar por frame.
 * - Renderizado de la onda en una única `Path2D` (un solo `stroke`) en vez de N strokes con
 *   `shadowBlur` por segmento (que es enormemente costoso).
 * - Cálculo de min/max amortizado por frame y normalización afín (sin filter() ni map() costosos).
 * - Throttle real al objetivo de FPS (no `1500/30`).
 */

const CONFIG = {
  WINDOW_MS: 2800,
  TARGET_FPS: 60,
  BUFFER_SIZE: 320,
  PLOT_AREA: { LEFT: 40, RIGHT: 18, TOP: 76, BOTTOM: 56 },
  COLORS: {
    BG: '#0a0f1a',
    GRID_MAJOR: 'rgba(34, 197, 94, 0.22)',
    GRID_MINOR: 'rgba(34, 197, 94, 0.08)',
    BASELINE: 'rgba(34, 197, 94, 0.4)',
    SIGNAL_NORMAL: '#22c55e',
    SIGNAL_GLOW: 'rgba(34, 197, 94, 0.45)',
    SIGNAL_ARRHYTHMIA: '#ef4444',
    ARRHYTHMIA_GLOW: 'rgba(239, 68, 68, 0.5)',
    PEAK_NORMAL: '#3b82f6',
    PEAK_ARRHYTHMIA: '#ef4444',
    VALLEY_COLOR: '#64748b',
    TEXT_PRIMARY: '#22c55e',
    TEXT_SECONDARY: '#94a3b8',
    TEXT_WARNING: '#f59e0b',
    TEXT_DANGER: '#ef4444',
    SCALE_TEXT: '#6b7280',
    SIGNAL_FILL_NORMAL: 'rgba(34, 197, 94, 0.10)',
    IBI_TEXT: '#67e8f9',
  },
};

const NON_ALERT_RHYTHMS = new Set([
  'SIN ARRITMIAS',
  'SINUS_STABLE',
  'SINUS_VARIABLE',
  'CALIBRANDO...',
  'UNDETERMINED_LOW_QUALITY',
  'NORMAL',
  'BRADYCARDIA_PATTERN',
  'TACHYCARDIA_PATTERN',
]);

const parseRhythmStatus = (statusString?: string) => {
  const [label = 'SIN ARRITMIAS', countStr = '0'] = (statusString || 'SIN ARRITMIAS|0').split('|');
  const count = parseInt(countStr, 10) || 0;
  const normalized = label.trim();
  const display = normalized.split('_').join(' ');
  const isAlert = !NON_ALERT_RHYTHMS.has(normalized);
  const color =
    normalized === 'UNDETERMINED_LOW_QUALITY'
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
  isPeak = false,
  bpm = 0,
  spo2 = 0,
  rrIntervals = [],
  livePpgEvidencePassed = false,
}: PPGSignalMeterProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);

  const propsRef = useRef({
    value,
    quality,
    isFingerDetected,
    arrhythmiaStatus,
    preserveResults,
    isPeak,
    bpm,
    spo2,
    rrIntervals,
    rawArrhythmiaData,
    livePpgEvidencePassed,
  });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);

  const lastArrhythmiaCountRef = useRef(0);
  const beatHistoryRef = useRef<{ isArrhythmia: boolean; time: number }[]>([]);
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });
  const ibiDisplayRef = useRef<number>(0);
  const hrvDisplayRef = useRef<{ sdnn: number; rmssd: number }>({ sdnn: 0, rmssd: 0 });
  const invalidSinceRef = useRef<number | null>(null);
  const canvasSizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });

  // ============ Sincronización de props (evita closure stale) ============
  useEffect(() => {
    propsRef.current = {
      value,
      quality,
      isFingerDetected,
      arrhythmiaStatus,
      preserveResults,
      isPeak,
      bpm,
      spo2,
      rrIntervals,
      rawArrhythmiaData,
      livePpgEvidencePassed,
    };
    if (rrIntervals && rrIntervals.length >= 2) {
      const last = rrIntervals[rrIntervals.length - 1];
      ibiDisplayRef.current = Math.round(last);
      const mean = rrIntervals.reduce((a, b) => a + b, 0) / rrIntervals.length;
      let variance = 0;
      for (const rr of rrIntervals) variance += (rr - mean) ** 2;
      variance /= rrIntervals.length;
      hrvDisplayRef.current.sdnn = Math.round(Math.sqrt(variance));
      let sumSqDiffs = 0;
      for (let i = 1; i < rrIntervals.length; i++)
        sumSqDiffs += (rrIntervals[i] - rrIntervals[i - 1]) ** 2;
      hrvDisplayRef.current.rmssd = Math.round(Math.sqrt(sumSqDiffs / (rrIntervals.length - 1)));
    }
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, rawArrhythmiaData, livePpgEvidencePassed]);

  // ============ Pulso visual sobre pico ============
  useEffect(() => {
    const { isPeak: peak, livePpgEvidencePassed: livePassed, quality: q } = propsRef.current;
    const hasValidPpg = livePassed === true && q >= 15;
    if (hasValidPpg && peak && isFingerDetected) {
      const now = Date.now();
      if (now - lastPeakTimeRef.current > 250) {
        lastPeakTimeRef.current = now;
        setShowPulse(true);
        const t = setTimeout(() => setShowPulse(false), 110);
        return () => clearTimeout(t);
      }
    }
  }, [isPeak, isFingerDetected]);

  // ============ Init buffer + cleanup ============
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

  // ============ Resize canvas a tamaño nativo (DPR-aware) ============
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleResize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1); // capar a 2 para perf en móviles
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(360, Math.floor(rect.width));
      const h = Math.max(540, Math.floor(rect.height));
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvasSizeRef.current = { w, h, dpr };
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  const getPlotArea = useCallback(() => {
    const { w, h } = canvasSizeRef.current;
    const { LEFT, RIGHT, TOP, BOTTOM } = CONFIG.PLOT_AREA;
    return {
      x: LEFT,
      y: TOP,
      width: w - LEFT - RIGHT,
      height: h - TOP - BOTTOM,
      centerY: TOP + (h - TOP - BOTTOM) / 2,
    };
  }, []);

  // ============ Render LOOP ============
  useEffect(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    const targetFrameMs = 1000 / CONFIG.TARGET_FPS;
    let lastRenderTime = 0;

    const drawGrid = (ctx: CanvasRenderingContext2D) => {
      const { COLORS } = CONFIG;
      const { w, h } = canvasSizeRef.current;
      const plot = getPlotArea();
      ctx.fillStyle = COLORS.BG;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0, 20, 10, 0.3)';
      ctx.fillRect(plot.x, plot.y, plot.width, plot.height);

      // Minor grid (10 px steps)
      ctx.strokeStyle = COLORS.GRID_MINOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      const minorStep = 10;
      for (let x = plot.x; x <= plot.x + plot.width; x += minorStep) {
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.height);
      }
      for (let y = plot.y; y <= plot.y + plot.height; y += minorStep) {
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.width, y);
      }
      ctx.stroke();

      // Major grid (50 px steps)
      ctx.strokeStyle = COLORS.GRID_MAJOR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const majorStep = 50;
      for (let x = plot.x; x <= plot.x + plot.width; x += majorStep) {
        ctx.moveTo(x, plot.y);
        ctx.lineTo(x, plot.y + plot.height);
      }
      for (let y = plot.y; y <= plot.y + plot.height; y += majorStep) {
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.width, y);
      }
      ctx.stroke();

      // Baseline
      ctx.strokeStyle = COLORS.BASELINE;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(plot.x, plot.centerY);
      ctx.lineTo(plot.x + plot.width, plot.centerY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Border
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
    };

    const drawAmplitudeScale = (ctx: CanvasRenderingContext2D) => {
      const { COLORS } = CONFIG;
      const plot = getPlotArea();
      const stats = amplitudeStatsRef.current;
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.SCALE_TEXT;
      ctx.textAlign = 'right';
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const y = plot.y + (i / steps) * plot.height;
        const val = stats.max - (i / steps) * stats.range;
        ctx.fillText(val.toFixed(0), plot.x - 4, y + 3);
        ctx.strokeStyle = COLORS.SCALE_TEXT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plot.x - 3, y);
        ctx.lineTo(plot.x, y);
        ctx.stroke();
      }
    };

    const drawTimeScale = (ctx: CanvasRenderingContext2D) => {
      const { COLORS, WINDOW_MS } = CONFIG;
      const plot = getPlotArea();
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.SCALE_TEXT;
      ctx.textAlign = 'center';
      const seconds = WINDOW_MS / 1000;
      for (let s = 0; s <= seconds; s++) {
        const x = plot.x + plot.width - (s / seconds) * plot.width;
        ctx.fillText(`${s}s`, x, plot.y + plot.height + 14);
        ctx.strokeStyle = COLORS.SCALE_TEXT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, plot.y + plot.height);
        ctx.lineTo(x, plot.y + plot.height + 4);
        ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.TEXT_PRIMARY;
      ctx.fillText('25 mm/s', plot.x + plot.width, plot.y + plot.height + 28);
    };

    const drawVitalInfo = (ctx: CanvasRenderingContext2D, now: number) => {
      const { COLORS } = CONFIG;
      const { w } = canvasSizeRef.current;
      const { bpm: bpmCurrent, spo2: spo2Current, arrhythmiaStatus, quality, rawArrhythmiaData } = propsRef.current;
      const rhythm = parseRhythmStatus(arrhythmiaStatus);
      const panelH = 64;
      const panelW = Math.min(140, w * 0.32);
      const panelY = 4;

      // ======= Panel BPM =======
      ctx.fillStyle = 'rgba(0, 30, 15, 0.9)';
      ctx.fillRect(4, panelY, panelW, panelH);
      ctx.strokeStyle = COLORS.TEXT_PRIMARY;
      ctx.lineWidth = 1;
      ctx.strokeRect(4, panelY, panelW, panelH);
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('♥ FRECUENCIA', 9, panelY + 13);
      ctx.font = 'bold 30px "SF Mono", Consolas, monospace';
      ctx.fillStyle = bpmCurrent > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
      ctx.fillText(bpmCurrent > 0 ? bpmCurrent.toString() : '--', 9, panelY + 44);
      ctx.font = '11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('BPM', panelW - 28, panelY + 44);
      if (bpmCurrent > 0) {
        ctx.font = '9px "SF Mono", Consolas, monospace';
        let hrLabel = 'NORMAL';
        let hrColor = COLORS.TEXT_PRIMARY;
        if (bpmCurrent < 60) {
          hrLabel = 'BRADICARDIA';
          hrColor = COLORS.TEXT_WARNING;
        } else if (bpmCurrent > 100) {
          hrLabel = 'TAQUICARDIA';
          hrColor = COLORS.TEXT_WARNING;
        }
        ctx.fillStyle = hrColor;
        ctx.fillText(hrLabel, 9, panelY + 58);
      }

      // ======= Panel SpO2 =======
      const rightX = w - panelW - 4;
      ctx.fillStyle = 'rgba(0, 15, 30, 0.9)';
      ctx.fillRect(rightX, panelY, panelW, panelH);
      const spo2Border =
        spo2Current >= 95
          ? COLORS.TEXT_PRIMARY
          : spo2Current >= 90
          ? COLORS.TEXT_WARNING
          : COLORS.TEXT_DANGER;
      ctx.strokeStyle = spo2Border;
      ctx.lineWidth = 1;
      ctx.strokeRect(rightX, panelY, panelW, panelH);
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('O₂ SATURACIÓN', rightX + 5, panelY + 13);
      ctx.font = 'bold 30px "SF Mono", Consolas, monospace';
      const spo2Color =
        spo2Current >= 95
          ? COLORS.TEXT_PRIMARY
          : spo2Current >= 90
          ? COLORS.TEXT_WARNING
          : spo2Current > 0
          ? COLORS.TEXT_DANGER
          : COLORS.TEXT_SECONDARY;
      ctx.fillStyle = spo2Color;
      ctx.fillText(spo2Current > 0 ? spo2Current.toFixed(0) : '--', rightX + 5, panelY + 44);
      ctx.font = '11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('%', rightX + panelW - 18, panelY + 44);

      // ======= Calidad central =======
      const centerW = Math.min(220, w * 0.4);
      const centerX = w / 2;
      ctx.fillStyle = 'rgba(20, 20, 30, 0.85)';
      ctx.fillRect(centerX - centerW / 2, panelY, centerW, panelH);
      ctx.strokeStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX - centerW / 2, panelY, centerW, panelH);
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('CALIDAD SEÑAL', centerX, panelY + 13);
      const barWidth = centerW - 22;
      const barHeight = 6;
      const barX = centerX - barWidth / 2;
      const barY = panelY + 18;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      const qPct = Math.max(0, Math.min(1, quality / 100));
      const qFillEnd = Math.max(0.001, qPct);
      const qGrad = ctx.createLinearGradient(barX, 0, barX + qFillEnd * barWidth, 0);
      if (quality > 60) {
        qGrad.addColorStop(0, '#166534');
        qGrad.addColorStop(1, '#22c55e');
      } else if (quality > 30) {
        qGrad.addColorStop(0, '#854d0e');
        qGrad.addColorStop(1, '#f59e0b');
      } else {
        qGrad.addColorStop(0, '#991b1b');
        qGrad.addColorStop(1, '#ef4444');
      }
      ctx.fillStyle = qGrad;
      ctx.fillRect(barX, barY, qPct * barWidth, barHeight);
      ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
      ctx.fillText(`${quality.toFixed(0)}%`, centerX, panelY + 36);
      const ibi = ibiDisplayRef.current;
      const hrv = hrvDisplayRef.current;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.fillText(`IBI ${ibi > 0 ? ibi + 'ms' : '--'}`, centerX - centerW / 2 + 6, panelY + 50);
      ctx.fillStyle = rhythm.color;
      ctx.fillText(rhythm.display, centerX - centerW / 2 + 6, panelY + 60);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`SDNN ${hrv.sdnn > 0 ? hrv.sdnn + 'ms' : '--'}`, centerX + centerW / 2 - 6, panelY + 50);
      ctx.fillText(`RMSSD ${hrv.rmssd > 0 ? hrv.rmssd + 'ms' : '--'}`, centerX + centerW / 2 - 6, panelY + 60);

      // Alerta de arritmia (sin pulso costoso)
      if (rhythm.isAlert) {
        const alertY = panelY + panelH + 4;
        const alertH = 30;
        const alertW = panelW;
        ctx.fillStyle = 'rgba(220, 38, 38, 0.20)';
        ctx.fillRect(rightX, alertY, alertW, alertH);
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.strokeRect(rightX, alertY, alertW, alertH);
        ctx.font = 'bold 9px "SF Mono", Consolas, monospace';
        ctx.fillStyle = '#dc2626';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ ARRITMIA', rightX + alertW / 2, alertY + 12);
        ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
        ctx.fillStyle = '#ef4444';
        const label = rhythm.count > 0 ? `${rhythm.display} (x${rhythm.count})` : rhythm.display;
        ctx.fillText(label, rightX + alertW / 2, alertY + 25);
        if (rawArrhythmiaData && rawArrhythmiaData.rmssd > 0) {
          // Métricas opcionales muy pequeñas
        }
      }
    };

    const render = (now: number) => {
      if (!isRunningRef.current) return;
      const canvas = canvasRef.current;
      const buffer = dataBufferRef.current;
      if (!canvas || !buffer) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      if (now - lastRenderTime < targetFrameMs) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      lastRenderTime = now;

      const { dpr } = canvasSizeRef.current;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const { value: signalValue, isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve, isPeak: peak, livePpgEvidencePassed: livePassed, quality: q } = propsRef.current;
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

      // Estados de render:
      //  - validatedPpg: el gate confirmó pulso vivo → onda VERDE intensa.
      //  - provisionalPpg: hay señal con calidad mínima pero el gate aún
      //    no validó (calibrando / pocos latidos) → onda ÁMBAR translúcida.
      //  - sinSenal: sin contacto / cámara cubierta / calidad nula.
      const validatedPpg = livePassed === true && q >= 15;
      const provisionalPpg = !validatedPpg && (signalValue !== 0 || q >= 8);
      const hasAnySignal = validatedPpg || provisionalPpg;
      const scaledValue = hasAnySignal ? signalValue * 2 : 0;

      // Limpieza de buffers tras 1.5s SIN señal alguna (no solo sin gate)
      if (!hasAnySignal) {
        if (invalidSinceRef.current === null) invalidSinceRef.current = now;
        else if (now - invalidSinceRef.current > 1500) {
          beatHistoryRef.current = [];
          ibiDisplayRef.current = 0;
          hrvDisplayRef.current = { sdnn: 0, rmssd: 0 };
          dataBufferRef.current?.clear();
        }
      } else {
        invalidSinceRef.current = null;
      }

      // Anotar pico en historia. Se permite también en modo provisional para
      // que el operador vea inmediatamente la respuesta del detector temporal;
      // las arritmias solo se marcan cuando el gate validó (evita falsos
      // positivos por ruido durante la consolidación).
      if (hasAnySignal && peak) {
        const currentCount = rhythm.count;
        const shouldMarkArrhythmia =
          validatedPpg && (rhythm.isAlert || currentCount > lastArrhythmiaCountRef.current);
        if (shouldMarkArrhythmia)
          lastArrhythmiaCountRef.current = Math.max(lastArrhythmiaCountRef.current, currentCount);
        beatHistoryRef.current.push({ isArrhythmia: shouldMarkArrhythmia, time: now });
        if (beatHistoryRef.current.length > 16) beatHistoryRef.current.shift();
      }

      buffer.push({ time: now, value: scaledValue, isArrhythmia: false });

      if (!hasAnySignal) {
        // Onda plana + mensaje
        ctx.save();
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(plot.x, plot.centerY);
        ctx.lineTo(plot.x + plot.width, plot.centerY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_WARNING;
        ctx.textAlign = 'center';
        ctx.fillText('SIN SEÑAL', plot.x + plot.width / 2, plot.centerY - 14);
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.fillText('Cubra cámara y flash con la yema del dedo', plot.x + plot.width / 2, plot.centerY + 14);
        ctx.restore();
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      const points = buffer.getPoints();
      if (points.length < 3) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }

      // Auto-rango con EMA
      const stats = amplitudeStatsRef.current;
      let pmin = Infinity;
      let pmax = -Infinity;
      const startIdx = Math.max(0, points.length - 150);
      for (let i = startIdx; i < points.length; i++) {
        const v = points[i].value;
        if (v < pmin) pmin = v;
        if (v > pmax) pmax = v;
      }
      const newRange = Math.max(40, pmax - pmin);
      stats.min = stats.min * 0.95 + (pmin - newRange * 0.1) * 0.05;
      stats.max = stats.max * 0.95 + (pmax + newRange * 0.1) * 0.05;
      stats.range = stats.max - stats.min;

      // Construir Path2D una sola vez
      const wave = new Path2D();
      const fill = new Path2D();
      const visibleCoords: Array<{ x: number; y: number; t: number; v: number }> = [];
      let started = false;
      const cutoff = now - WINDOW_MS;
      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (pt.time < cutoff) continue;
        const age = now - pt.time;
        const x = plot.x + plot.width - (age * plot.width) / WINDOW_MS;
        const ny = (stats.max - pt.value) / stats.range;
        const y = plot.y + ny * plot.height;
        if (!started) {
          wave.moveTo(x, y);
          fill.moveTo(x, plot.centerY);
          fill.lineTo(x, y);
          started = true;
        } else {
          wave.lineTo(x, y);
          fill.lineTo(x, y);
        }
        visibleCoords.push({ x, y, t: pt.time, v: pt.value });
      }
      if (visibleCoords.length > 0) {
        const last = visibleCoords[visibleCoords.length - 1];
        fill.lineTo(last.x, plot.centerY);
        fill.closePath();
      }

      // Relleno del área (degradado vertical) - ámbar provisional / verde validado
      const fillGrad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.height);
      if (validatedPpg) {
        fillGrad.addColorStop(0, 'rgba(34, 197, 94, 0.12)');
        fillGrad.addColorStop(0.5, 'rgba(34, 197, 94, 0.04)');
        fillGrad.addColorStop(1, 'rgba(34, 197, 94, 0.0)');
      } else {
        fillGrad.addColorStop(0, 'rgba(245, 158, 11, 0.10)');
        fillGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.03)');
        fillGrad.addColorStop(1, 'rgba(245, 158, 11, 0.0)');
      }
      ctx.fillStyle = fillGrad;
      ctx.fill(fill);

      // Onda principal: sombra UNA SOLA VEZ, no por línea
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      if (validatedPpg) {
        ctx.shadowColor = COLORS.SIGNAL_GLOW;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = COLORS.SIGNAL_NORMAL;
        ctx.lineWidth = 2.4;
      } else {
        ctx.shadowColor = 'rgba(245, 158, 11, 0.35)';
        ctx.shadowBlur = 6;
        ctx.strokeStyle = COLORS.TEXT_WARNING;
        ctx.lineWidth = 1.8;
      }
      ctx.stroke(wave);
      ctx.shadowBlur = 0;

      // Aviso en modo provisional
      if (provisionalPpg) {
        ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_WARNING;
        ctx.textAlign = 'center';
        ctx.fillText('VALIDANDO PULSO…', plot.x + plot.width / 2, plot.y + 12);
      }

      // Picos visibles (asociados al historial de latidos)
      const history = beatHistoryRef.current;
      if (history.length > 0 && visibleCoords.length > 0) {
        const visStart = visibleCoords[0].t;
        for (const beat of history) {
          if (beat.time < cutoff || beat.time > now) continue;
          // Buscar coord más cercana en tiempo (binario aprox: lineal corto)
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < visibleCoords.length; i++) {
            const d = Math.abs(visibleCoords[i].t - beat.time);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = i;
            }
            if (d < 30) break;
          }
          if (bestDist > 200) continue;
          const c = visibleCoords[bestIdx];
          const peakColor = beat.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
          // Marcador
          ctx.beginPath();
          ctx.arc(c.x, c.y, beat.isArrhythmia ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = peakColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.font = 'bold 9px "SF Mono", Consolas, monospace';
          ctx.fillStyle = beat.isArrhythmia ? COLORS.TEXT_DANGER : COLORS.SIGNAL_NORMAL;
          ctx.textAlign = 'center';
          ctx.fillText(beat.isArrhythmia ? 'A' : 'N', c.x, c.y - 9);
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [getPlotArea]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    amplitudeStatsRef.current = { min: -50, max: 50, range: 100 };
    beatHistoryRef.current = [];
    lastArrhythmiaCountRef.current = 0;
    ibiDisplayRef.current = 0;
    hrvDisplayRef.current = { sdnn: 0, rmssd: 0 };
    onReset();
  }, [onReset]);

  return (
    <div className="fixed inset-0 bg-slate-950">
      <canvas ref={canvasRef} className="w-full h-full absolute inset-0" />
      <div
        className="absolute top-0 left-0 p-2 z-10 flex items-center gap-2"
        style={{ top: '6px', left: '120px' }}
      >
        <div
          className={`p-1.5 rounded-full transition-all duration-100 ${
            showPulse ? 'bg-red-500/30 scale-110' : 'bg-emerald-500/20'
          }`}
        >
          <Heart
            className={`w-4 h-4 transition-all duration-100 ${
              showPulse ? 'text-red-400 scale-110' : 'text-emerald-400'
            }`}
            fill={showPulse ? 'currentColor' : 'none'}
          />
        </div>
        <Activity className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-[10px] font-mono text-emerald-400/80">PPG MONITOR v4</span>
      </div>
      <div className="fixed bottom-0 left-0 right-0 h-12 grid grid-cols-2 z-10">
        <button
          onClick={onStartMeasurement}
          className={`font-semibold text-sm transition-colors border-t border-slate-700/50 ${
            isMonitoring
              ? 'bg-red-500/20 hover:bg-red-500/30 active:bg-red-500/40 text-red-300 border-r'
              : 'bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 text-emerald-400 border-r'
          }`}
        >
          {isMonitoring ? 'DETENER' : 'INICIAR'}
        </button>
        <button
          onClick={handleReset}
          className="bg-slate-700/20 hover:bg-slate-700/30 active:bg-slate-700/40 text-white font-semibold text-sm transition-colors border-t border-slate-700/50"
        >
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;

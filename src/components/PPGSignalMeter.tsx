import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart } from 'lucide-react';
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
  // Ventana más corta = barrido más rápido y "eléctrico", como un monitor clínico real.
  WINDOW_MS: 2200,
  TARGET_FPS: 60,
  // Buffer más grande para no perder muestras a 60 fps × 2.2 s.
  BUFFER_SIZE: 420,
  // HUD compacto arriba; se reserva un poco menos abajo (la barra inferior
  // de signos vitales secundarios flota encima del canvas).
  PLOT_AREA: { LEFT: 38, RIGHT: 14, TOP: 86, BOTTOM: 86 },
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
  // Historial de latidos: time, tipo, y label corto fijo (PVC, AF, B, T, N).
  const beatHistoryRef = useRef<
    Array<{ time: number; isArrhythmia: boolean; label: 'N' | 'PVC' | 'AF' | 'B' | 'T' }>
  >([]);
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

    const drawVitalInfo = (ctx: CanvasRenderingContext2D) => {
      const { COLORS } = CONFIG;
      const { w } = canvasSizeRef.current;
      const { bpm: bpmCurrent, spo2: spo2Current, arrhythmiaStatus, quality } = propsRef.current;
      const rhythm = parseRhythmStatus(arrhythmiaStatus);

      // HUD compacto en una sola fila: 3 paneles con anchos proporcionales.
      // Padding 6 px entre paneles. Altura única 70 px.
      const padX = 6;
      const padOuter = 4;
      const totalW = w - padOuter * 2;
      const innerSpacing = padX * 2;
      const sidePanelW = Math.max(96, Math.min(150, (totalW - innerSpacing) * 0.27));
      const centerW = totalW - innerSpacing - sidePanelW * 2;
      const panelH = 70;
      const panelY = 6;

      const leftX = padOuter;
      const centerX = leftX + sidePanelW + padX;
      const rightX = centerX + centerW + padX;

      // ===== Panel izquierdo: BPM =====
      ctx.fillStyle = 'rgba(0, 30, 15, 0.92)';
      ctx.fillRect(leftX, panelY, sidePanelW, panelH);
      ctx.strokeStyle = COLORS.TEXT_PRIMARY;
      ctx.lineWidth = 1;
      ctx.strokeRect(leftX + 0.5, panelY + 0.5, sidePanelW - 1, panelH - 1);
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('FRECUENCIA', leftX + 6, panelY + 13);
      ctx.font = 'bold 28px "SF Mono", Consolas, monospace';
      ctx.fillStyle = bpmCurrent > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(bpmCurrent > 0 ? bpmCurrent.toString() : '--', leftX + 6, panelY + 44);
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText('BPM', leftX + sidePanelW - 6, panelY + 44);
      ctx.textAlign = 'left';
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
        ctx.fillText(hrLabel, leftX + 6, panelY + 60);
      }

      // ===== Panel central: Calidad + ritmo + IBI/HRV =====
      ctx.fillStyle = 'rgba(20, 20, 30, 0.92)';
      ctx.fillRect(centerX, panelY, centerW, panelH);
      const qBorder = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
      ctx.strokeStyle = qBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(centerX + 0.5, panelY + 0.5, centerW - 1, panelH - 1);
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'center';
      ctx.fillText('CALIDAD SEÑAL', centerX + centerW / 2, panelY + 13);
      const barX = centerX + 8;
      const barY = panelY + 18;
      const barWidth = centerW - 16;
      const barHeight = 5;
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(barX, barY, barWidth, barHeight);
      const qPct = Math.max(0, Math.min(1, quality / 100));
      if (qPct > 0) {
        const qGrad = ctx.createLinearGradient(barX, 0, barX + qPct * barWidth, 0);
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
      }
      ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = qBorder;
      ctx.fillText(`${quality.toFixed(0)}%`, centerX + centerW / 2, panelY + 38);

      // Línea inferior del panel central: IBI / RITMO / SDNN / RMSSD en un grid.
      const ibi = ibiDisplayRef.current;
      const hrv = hrvDisplayRef.current;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      const lineY = panelY + 53;
      const line2Y = panelY + 64;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.fillText(`IBI ${ibi > 0 ? ibi + 'ms' : '--'}`, centerX + 8, lineY);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`SDNN ${hrv.sdnn > 0 ? hrv.sdnn : '--'}`, centerX + centerW - 8, lineY);
      ctx.textAlign = 'left';
      ctx.fillStyle = rhythm.color;
      ctx.fillText(rhythm.display.length > 18 ? rhythm.display.slice(0, 18) + '…' : rhythm.display, centerX + 8, line2Y);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`RMSSD ${hrv.rmssd > 0 ? hrv.rmssd : '--'}`, centerX + centerW - 8, line2Y);

      // ===== Panel derecho: SpO2 =====
      ctx.fillStyle = 'rgba(0, 15, 30, 0.92)';
      ctx.fillRect(rightX, panelY, sidePanelW, panelH);
      const spo2Border =
        spo2Current >= 95
          ? COLORS.TEXT_PRIMARY
          : spo2Current >= 90
          ? COLORS.TEXT_WARNING
          : spo2Current > 0
          ? COLORS.TEXT_DANGER
          : COLORS.TEXT_SECONDARY;
      ctx.strokeStyle = spo2Border;
      ctx.lineWidth = 1;
      ctx.strokeRect(rightX + 0.5, panelY + 0.5, sidePanelW - 1, panelH - 1);
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('O₂ SATURACIÓN', rightX + 6, panelY + 13);
      ctx.font = 'bold 28px "SF Mono", Consolas, monospace';
      ctx.fillStyle = spo2Border;
      ctx.fillText(spo2Current > 0 ? spo2Current.toFixed(0) : '--', rightX + 6, panelY + 44);
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText('%', rightX + sidePanelW - 6, panelY + 44);
      if (spo2Current > 0) {
        ctx.font = '9px "SF Mono", Consolas, monospace';
        ctx.textAlign = 'left';
        let spLabel = 'NORMAL';
        if (spo2Current < 90) spLabel = 'HIPOXEMIA';
        else if (spo2Current < 95) spLabel = 'HIP. LEVE';
        ctx.fillStyle = spo2Border;
        ctx.fillText(spLabel, rightX + 6, panelY + 60);
      }

      // ===== Indicador de arritmia (compacto, debajo del panel SpO2) =====
      if (rhythm.isAlert) {
        const alertY = panelY + panelH + 4;
        const alertH = 22;
        ctx.fillStyle = 'rgba(220, 38, 38, 0.22)';
        ctx.fillRect(rightX, alertY, sidePanelW, alertH);
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rightX + 0.5, alertY + 0.5, sidePanelW - 1, alertH - 1);
        ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = '#fca5a5';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ ARRITMIA', rightX + sidePanelW / 2, alertY + 14);
      }

      // ===== Leyenda de etiquetas debajo del panel central =====
      // Pequeña, no invade la onda; explica qué significan N / B / T / PVC / AF.
      const legendY = panelY + panelH + 4;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      const legendItems: Array<{ k: string; c: string; t: string }> = [
        { k: 'N', c: '#3b82f6', t: 'sinusal' },
        { k: 'B', c: '#f59e0b', t: 'bradi' },
        { k: 'T', c: '#f59e0b', t: 'taqui' },
        { k: 'PVC', c: '#ef4444', t: 'prematuro' },
        { k: 'AF', c: '#ef4444', t: 'fib.' },
      ];
      let lx = centerX + 6;
      const ly = legendY + 12;
      for (const item of legendItems) {
        ctx.fillStyle = item.c;
        ctx.fillText(item.k, lx, ly);
        const kw = ctx.measureText(item.k).width;
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.fillText(' ' + item.t, lx + kw, ly);
        lx += kw + ctx.measureText(' ' + item.t).width + 8;
        if (lx > centerX + centerW - 30) break;
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
      drawVitalInfo(ctx);

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
      // Sin ganancia artificial: la señal ya viene normalizada del
      // HeartBeatProcessor (±60 unidades). El auto-rango EMA se encarga
      // de que ocupe el viewport sin recortarla. Aplicar gain extra
      // produciría un "maquillaje" visual y aplastaría picos reales.
      const scaledValue = hasAnySignal ? signalValue : 0;

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

      // Anotar pico en historia con etiqueta clínica clara: N / PVC / AF / B / T.
      // Solo se marcan arrítmicos cuando el gate ha validado, para evitar
      // falsos positivos durante la fase provisional.
      if (hasAnySignal && peak) {
        const currentCount = rhythm.count;
        const isArrhythmia =
          validatedPpg && (rhythm.isAlert || currentCount > lastArrhythmiaCountRef.current);
        let label: 'N' | 'PVC' | 'AF' | 'B' | 'T' = 'N';
        if (isArrhythmia) {
          // Clasificar según el rhythm label upstream y el BPM actual.
          // El RhythmClassifier produce: PVC, AF (atrial fibrillation), etc.
          const lab = rhythm.label.toUpperCase();
          if (lab.includes('AF') || lab.includes('FIB')) label = 'AF';
          else if (lab.includes('PVC') || lab.includes('PREMATURE') || lab.includes('PAC')) label = 'PVC';
          else label = 'PVC';
          lastArrhythmiaCountRef.current = Math.max(lastArrhythmiaCountRef.current, currentCount);
        } else {
          // Latido sinusal: clasificar por BPM (bradi / taqui / normal).
          const bpmCurr = propsRef.current.bpm;
          if (bpmCurr > 0 && bpmCurr < 60) label = 'B';
          else if (bpmCurr > 100) label = 'T';
          else label = 'N';
        }
        beatHistoryRef.current.push({ time: now, isArrhythmia, label });
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

      // Auto-rango EMA mucho más rápido (ataque/release diferenciados):
      // ataca rápido cuando llegan picos nuevos para no recortarlos,
      // y libera más lento para mantener la línea base estable.
      const stats = amplitudeStatsRef.current;
      let pmin = Infinity;
      let pmax = -Infinity;
      const startIdx = Math.max(0, points.length - 120);
      for (let i = startIdx; i < points.length; i++) {
        const v = points[i].value;
        if (v < pmin) pmin = v;
        if (v > pmax) pmax = v;
      }
      const newRange = Math.max(30, pmax - pmin);
      const tgtMin = pmin - newRange * 0.08;
      const tgtMax = pmax + newRange * 0.08;
      const attack = 0.28;
      const release = 0.06;
      stats.max = tgtMax > stats.max ? stats.max + (tgtMax - stats.max) * attack : stats.max + (tgtMax - stats.max) * release;
      stats.min = tgtMin < stats.min ? stats.min + (tgtMin - stats.min) * attack : stats.min + (tgtMin - stats.min) * release;
      stats.range = Math.max(30, stats.max - stats.min);

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

      // Relleno verde fijo bajo la onda. Sin alternancia ámbar/verde:
      // un solo color estable que corresponde a "PPG en pantalla".
      const fillGrad = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.height);
      fillGrad.addColorStop(0, 'rgba(34, 197, 94, 0.12)');
      fillGrad.addColorStop(0.5, 'rgba(34, 197, 94, 0.04)');
      fillGrad.addColorStop(1, 'rgba(34, 197, 94, 0.0)');
      ctx.fillStyle = fillGrad;
      ctx.fill(fill);

      // Onda principal SIEMPRE verde (3 capas de fosforescencia clínica).
      // Solo los SEGMENTOS adyacentes a un latido arrítmico se redibujan
      // encima en rojo: el resto del trazo permanece verde.
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(74, 222, 128, 0.85)';
      ctx.shadowBlur = 14;
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.55)';
      ctx.lineWidth = 4.8;
      ctx.stroke(wave);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#86efac';
      ctx.lineWidth = 2.0;
      ctx.stroke(wave);
      ctx.strokeStyle = 'rgba(240, 253, 244, 0.85)';
      ctx.lineWidth = 0.9;
      ctx.stroke(wave);

      // Aviso en modo provisional (texto pequeño, no toca el color de onda)
      if (provisionalPpg) {
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.textAlign = 'center';
        ctx.fillText('VALIDANDO PULSO…', plot.x + plot.width / 2, plot.y + 12);
      }

      // ============================================================
      // SEGMENTOS ARRÍTMICOS — solo el latido específico se redibuja
      // en rojo, sobre la onda verde ya pintada. El operador identifica
      // exactamente cuál latido fue anómalo, no toda la traza.
      // ============================================================
      const arrhythmiaBeats = beatHistoryRef.current.filter((b) => b.isArrhythmia);
      if (arrhythmiaBeats.length > 0 && visibleCoords.length > 2) {
        // Para cada beat arrítmico, redibujar el sub-tramo de la onda
        // en una ventana de ±SEGMENT_MS alrededor del pico.
        const SEGMENT_MS = 250; // ~250 ms cubre la sístole y parte de la diástole
        for (const beat of arrhythmiaBeats) {
          if (beat.time < cutoff || beat.time > now) continue;
          const tStart = beat.time - SEGMENT_MS;
          const tEnd = beat.time + SEGMENT_MS;
          const seg = new Path2D();
          let segStarted = false;
          for (const c of visibleCoords) {
            if (c.t < tStart || c.t > tEnd) continue;
            if (!segStarted) {
              seg.moveTo(c.x, c.y);
              segStarted = true;
            } else {
              seg.lineTo(c.x, c.y);
            }
          }
          if (!segStarted) continue;
          // Mismo render trifásico, en rojo.
          ctx.shadowColor = 'rgba(239, 68, 68, 0.85)';
          ctx.shadowBlur = 14;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
          ctx.lineWidth = 4.8;
          ctx.stroke(seg);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#fca5a5';
          ctx.lineWidth = 2.2;
          ctx.stroke(seg);
          ctx.strokeStyle = 'rgba(254, 242, 242, 0.95)';
          ctx.lineWidth = 0.9;
          ctx.stroke(seg);
        }
      }

      // Marcadores de pico: punto en el ápex + etiqueta clínica clara.
      const history = beatHistoryRef.current;
      if (history.length > 0 && visibleCoords.length > 0) {
        for (const beat of history) {
          if (beat.time < cutoff || beat.time > now) continue;
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
          // Color del marcador coherente con el segmento:
          //  - N (normal sinusal):     azul
          //  - B (bradicardia):        ámbar
          //  - T (taquicardia):        ámbar
          //  - PVC / AF (arrítmico):   rojo
          let pColor: string;
          let pLabelColor: string;
          if (beat.isArrhythmia) {
            pColor = '#ef4444';
            pLabelColor = '#fca5a5';
          } else if (beat.label === 'B' || beat.label === 'T') {
            pColor = '#f59e0b';
            pLabelColor = '#fcd34d';
          } else {
            pColor = '#3b82f6';
            pLabelColor = '#93c5fd';
          }
          // Punto del marcador
          ctx.beginPath();
          ctx.arc(c.x, c.y, beat.isArrhythmia ? 6 : 4.5, 0, Math.PI * 2);
          ctx.fillStyle = pColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(c.x, c.y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          // Etiqueta encima del marcador
          ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
          ctx.fillStyle = pLabelColor;
          ctx.textAlign = 'center';
          ctx.fillText(beat.label, c.x, c.y - 10);
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
      {/* Indicador de pulso flotante - alineado con el panel BPM del canvas */}
      <div
        className="absolute z-10 pointer-events-none"
        style={{ top: '12px', left: '50%', transform: 'translateX(-50%)' }}
      >
        <div
          className={`p-1 rounded-full transition-all duration-100 ${
            showPulse ? 'bg-red-500/40 scale-125' : 'bg-emerald-500/0'
          }`}
        >
          <Heart
            className={`w-4 h-4 transition-all duration-100 ${
              showPulse ? 'text-red-400' : 'text-emerald-400/60'
            }`}
            fill={showPulse ? 'currentColor' : 'none'}
          />
        </div>
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

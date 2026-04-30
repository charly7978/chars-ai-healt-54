import React, { useEffect, useRef, useCallback } from 'react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';

interface PPGSignalMeterProps {
  // Callback de muestreo: el monitor lee el valor instantáneo del PPG
  // SIN provocar re-render del padre. Antes la señal venía como prop
  // y forzaba reconciliación de React 60 veces/segundo.
  getValue: () => number;
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
  bpm?: number;
  spo2?: number;
  rrIntervals?: number[];
  /** Signos vitales secundarios — se dibujan dentro del canvas para
   *  evitar overlays React solapando la onda. */
  bp?: { systolic: number; diastolic: number };
  glucose?: number;
  lipids?: { totalCholesterol: number; triglycerides: number };
  rhythmLabel?: string;
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
  BUFFER_SIZE: 420,
  // HUD generoso: TOP=130 (3 paneles de 110 px). BOTTOM=170 reserva
  // espacio para la barra de signos vitales secundarios DENTRO del canvas
  // (presión / glucosa / lípidos / ritmo). Antes era un overlay React
  // que solapaba la onda; ahora es nativo del canvas y no compite por
  // re-renders ni z-index.
  PLOT_AREA: { LEFT: 50, RIGHT: 18, TOP: 130, BOTTOM: 170 },
  COLORS: {
    // Fondo y rejilla neutros, no de "saturación de videojuego".
    BG: '#070b14',
    GRID_MAJOR: 'rgba(148, 163, 184, 0.10)',
    GRID_MINOR: 'rgba(148, 163, 184, 0.04)',
    BASELINE: 'rgba(148, 163, 184, 0.22)',
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
  getValue,
  quality,
  isFingerDetected,
  onStartMeasurement,
  onReset,
  isMonitoring = false,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false,
  bpm = 0,
  spo2 = 0,
  rrIntervals = [],
  livePpgEvidencePassed = false,
  bp,
  glucose = 0,
  lipids,
  rhythmLabel,
}: PPGSignalMeterProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);

  const propsRef = useRef({
    quality,
    isFingerDetected,
    arrhythmiaStatus,
    preserveResults,
    bpm,
    spo2,
    rrIntervals,
    rawArrhythmiaData,
    livePpgEvidencePassed,
    getValue,
    bp,
    glucose,
    lipids,
    rhythmLabel,
  });
  const lastPeakTimeRef = useRef(0);

  const lastArrhythmiaCountRef = useRef(0);
  // Historial de latidos: time, tipo, y label corto fijo (PVC, AF, B, T, N).
  const beatHistoryRef = useRef<
    Array<{ time: number; isArrhythmia: boolean; label: 'N' | 'PVC' | 'AF' | 'B' | 'T' }>
  >([]);
  // Detector de pico INTERNO del monitor (sin depender de isPeak prop):
  // se busca cruce descendente del derivativo en la señal muestreada.
  const peakDetectStateRef = useRef({
    prev: 0,
    prev2: 0,
    rising: false,
    lastPeakTime: 0,
    threshold: 0,
  });
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });
  const ibiDisplayRef = useRef<number>(0);
  const hrvDisplayRef = useRef<{ sdnn: number; rmssd: number }>({ sdnn: 0, rmssd: 0 });
  const invalidSinceRef = useRef<number | null>(null);
  const canvasSizeRef = useRef<{ w: number; h: number; dpr: number }>({ w: 0, h: 0, dpr: 1 });

  // ============ Sincronización de props (evita closure stale) ============
  useEffect(() => {
    propsRef.current = {
      quality,
      isFingerDetected,
      arrhythmiaStatus,
      preserveResults,
      bpm,
      spo2,
      rrIntervals,
      rawArrhythmiaData,
      livePpgEvidencePassed,
      getValue,
      bp,
      glucose,
      lipids,
      rhythmLabel,
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
  }, [getValue, quality, isFingerDetected, arrhythmiaStatus, preserveResults, bpm, spo2, rrIntervals, rawArrhythmiaData, livePpgEvidencePassed, bp, glucose, lipids, rhythmLabel]);

  // (Flash del corazón eliminado: producía 2 setStates por latido, lo que
  // forzaba reconciliación de React 120-200 veces/min y generaba los
  // micro-cortes visibles en la onda. La onda + marcadores N/PVC en el
  // canvas ya muestran cada latido sin recurrir a state de React.)
  void lastPeakTimeRef;

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
      // Sin tinte verde dentro del plot — fondo plano, sobrio.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.012)';
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

      // Border discreto neutro.
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
    };

    const drawAmplitudeScale = (ctx: CanvasRenderingContext2D) => {
      const { COLORS } = CONFIG;
      const plot = getPlotArea();
      const stats = amplitudeStatsRef.current;
      ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.SCALE_TEXT;
      ctx.textAlign = 'right';
      const steps = 4;
      for (let i = 0; i <= steps; i++) {
        const y = plot.y + (i / steps) * plot.height;
        const val = stats.max - (i / steps) * stats.range;
        ctx.fillText(val.toFixed(0), plot.x - 6, y + 4);
        ctx.strokeStyle = COLORS.SCALE_TEXT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(plot.x - 4, y);
        ctx.lineTo(plot.x, y);
        ctx.stroke();
      }
    };

    const drawTimeScale = (ctx: CanvasRenderingContext2D) => {
      const { COLORS, WINDOW_MS } = CONFIG;
      const plot = getPlotArea();
      ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.SCALE_TEXT;
      ctx.textAlign = 'center';
      const seconds = WINDOW_MS / 1000;
      for (let s = 0; s <= seconds; s++) {
        const x = plot.x + plot.width - (s / seconds) * plot.width;
        ctx.fillText(`${s}s`, x, plot.y + plot.height + 18);
        ctx.strokeStyle = COLORS.SCALE_TEXT;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, plot.y + plot.height);
        ctx.lineTo(x, plot.y + plot.height + 5);
        ctx.stroke();
      }
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.TEXT_PRIMARY;
      ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
      ctx.fillText('25 mm/s', plot.x + plot.width, plot.y + plot.height + 38);
    };

    /** Tira inferior de signos vitales secundarios DENTRO del canvas:
     *  presión / glucosa / lípidos / ritmo. 4 paneles uniformes. */
    const drawSecondaryVitals = (ctx: CanvasRenderingContext2D) => {
      const { COLORS } = CONFIG;
      const { w, h } = canvasSizeRef.current;
      const plot = getPlotArea();
      const stripY = plot.y + plot.height + 56;
      const stripH = h - stripY - 60; // deja 60 px para los 2 botones nativos
      if (stripH < 50) return;
      const stripX = 6;
      const stripW = w - 12;
      const cellW = stripW / 4;
      const padBox = 4;
      const { bp: bpVal, glucose: glu, lipids: lip, rhythmLabel: rhy } = propsRef.current;

      // Fondo translúcido común
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(stripX, stripY, stripW, stripH);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = 1;
      ctx.strokeRect(stripX + 0.5, stripY + 0.5, stripW - 1, stripH - 1);

      const cells: Array<{
        title: string;
        value: string;
        unit: string;
        color: string;
      }> = [
        {
          title: 'PRESIÓN',
          value:
            bpVal && bpVal.systolic > 0 ? `${bpVal.systolic}/${bpVal.diastolic}` : '--/--',
          unit: 'mmHg',
          color: bpVal && bpVal.systolic > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY,
        },
        {
          title: 'GLUCOSA',
          value: glu > 0 ? String(Math.round(glu)) : '--',
          unit: 'mg/dL',
          color: glu > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY,
        },
        {
          title: 'COL./TRG.',
          value:
            lip && (lip.totalCholesterol > 0 || lip.triglycerides > 0)
              ? `${lip.totalCholesterol || '--'}/${lip.triglycerides || '--'}`
              : '--/--',
          unit: 'mg/dL',
          color: lip && lip.totalCholesterol > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY,
        },
        {
          title: 'RITMO',
          value: rhy ? rhy.split('_').join(' ').slice(0, 14) : '--',
          unit: '',
          color: COLORS.TEXT_PRIMARY,
        },
      ];
      ctx.textAlign = 'left';
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        const cx = stripX + i * cellW + padBox;
        const cy = stripY + padBox;
        // Separador interno
        if (i > 0) {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(stripX + i * cellW, stripY + 6);
          ctx.lineTo(stripX + i * cellW, stripY + stripH - 6);
          ctx.stroke();
        }
        ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.fillText(c.title, cx, cy + 14);
        ctx.font = 'bold 22px "SF Mono", Consolas, monospace';
        ctx.fillStyle = c.color;
        ctx.fillText(c.value, cx, cy + 42);
        if (c.unit) {
          ctx.font = '10px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.TEXT_SECONDARY;
          ctx.fillText(c.unit, cx, cy + 56);
        }
      }
    };

    const drawVitalInfo = (ctx: CanvasRenderingContext2D) => {
      const { COLORS } = CONFIG;
      const { w } = canvasSizeRef.current;
      const { bpm: bpmCurrent, spo2: spo2Current, arrhythmiaStatus, quality } = propsRef.current;
      const rhythm = parseRhythmStatus(arrhythmiaStatus);

      // HUD agrandado para que se lea con claridad en monitor forense.
      // 3 paneles a lo largo del ancho con tipografía cómoda.
      const padX = 8;
      const padOuter = 6;
      const totalW = w - padOuter * 2;
      const innerSpacing = padX * 2;
      const sidePanelW = Math.max(140, Math.min(220, (totalW - innerSpacing) * 0.30));
      const centerW = totalW - innerSpacing - sidePanelW * 2;
      const panelH = 110;
      const panelY = 10;

      const leftX = padOuter;
      const centerX = leftX + sidePanelW + padX;
      const rightX = centerX + centerW + padX;

      // ===== Panel izquierdo: BPM =====
      ctx.fillStyle = 'rgba(0, 30, 15, 0.92)';
      ctx.fillRect(leftX, panelY, sidePanelW, panelH);
      ctx.strokeStyle = COLORS.TEXT_PRIMARY;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(leftX + 0.5, panelY + 0.5, sidePanelW - 1, panelH - 1);
      ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('FRECUENCIA', leftX + 10, panelY + 22);
      ctx.font = 'bold 56px "SF Mono", Consolas, monospace';
      ctx.fillStyle = bpmCurrent > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(bpmCurrent > 0 ? bpmCurrent.toString() : '--', leftX + 10, panelY + 78);
      ctx.font = 'bold 16px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText('BPM', leftX + sidePanelW - 10, panelY + 78);
      ctx.textAlign = 'left';
      if (bpmCurrent > 0) {
        ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
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
        ctx.fillText(hrLabel, leftX + 10, panelY + 100);
      }

      // ===== Panel central: Calidad + ritmo + IBI/HRV =====
      ctx.fillStyle = 'rgba(20, 20, 30, 0.92)';
      ctx.fillRect(centerX, panelY, centerW, panelH);
      const qBorder = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
      ctx.strokeStyle = qBorder;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(centerX + 0.5, panelY + 0.5, centerW - 1, panelH - 1);
      ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'center';
      ctx.fillText('CALIDAD SEÑAL', centerX + centerW / 2, panelY + 22);
      const barX = centerX + 12;
      const barY = panelY + 30;
      const barWidth = centerW - 24;
      const barHeight = 9;
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
      ctx.font = 'bold 18px "SF Mono", Consolas, monospace';
      ctx.fillStyle = qBorder;
      ctx.fillText(`${quality.toFixed(0)}%`, centerX + centerW / 2, panelY + 60);

      // Línea inferior del panel central: IBI / RITMO / SDNN / RMSSD
      const ibi = ibiDisplayRef.current;
      const hrv = hrvDisplayRef.current;
      ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
      const lineY = panelY + 82;
      const line2Y = panelY + 100;
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.IBI_TEXT;
      ctx.fillText(`IBI ${ibi > 0 ? ibi + 'ms' : '--'}`, centerX + 12, lineY);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`SDNN ${hrv.sdnn > 0 ? hrv.sdnn : '--'}`, centerX + centerW - 12, lineY);
      ctx.textAlign = 'left';
      ctx.fillStyle = rhythm.color;
      ctx.fillText(rhythm.display.length > 22 ? rhythm.display.slice(0, 22) + '…' : rhythm.display, centerX + 12, line2Y);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`RMSSD ${hrv.rmssd > 0 ? hrv.rmssd : '--'}`, centerX + centerW - 12, line2Y);

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
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rightX + 0.5, panelY + 0.5, sidePanelW - 1, panelH - 1);
      ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('O₂ SATURACIÓN', rightX + 10, panelY + 22);
      ctx.font = 'bold 56px "SF Mono", Consolas, monospace';
      ctx.fillStyle = spo2Border;
      ctx.fillText(spo2Current > 0 ? spo2Current.toFixed(0) : '--', rightX + 10, panelY + 78);
      ctx.font = 'bold 18px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText('%', rightX + sidePanelW - 10, panelY + 78);
      if (spo2Current > 0) {
        ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
        ctx.textAlign = 'left';
        let spLabel = 'NORMAL';
        if (spo2Current < 90) spLabel = 'HIPOXEMIA';
        else if (spo2Current < 95) spLabel = 'HIP. LEVE';
        ctx.fillStyle = spo2Border;
        ctx.fillText(spLabel, rightX + 10, panelY + 100);
      }

      // ===== Indicador de arritmia =====
      if (rhythm.isAlert) {
        const alertY = panelY + panelH + 6;
        const alertH = 28;
        ctx.fillStyle = 'rgba(220, 38, 38, 0.22)';
        ctx.fillRect(rightX, alertY, sidePanelW, alertH);
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 2;
        ctx.strokeRect(rightX + 0.5, alertY + 0.5, sidePanelW - 1, alertH - 1);
        ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
        ctx.fillStyle = '#fca5a5';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ ARRITMIA', rightX + sidePanelW / 2, alertY + 19);
      }

      // ===== Leyenda de etiquetas debajo del panel central =====
      const legendY = panelY + panelH + 6;
      ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      const legendItems: Array<{ k: string; c: string; t: string }> = [
        { k: 'N', c: '#3b82f6', t: 'sinusal' },
        { k: 'B', c: '#f59e0b', t: 'bradi' },
        { k: 'T', c: '#f59e0b', t: 'taqui' },
        { k: 'PVC', c: '#ef4444', t: 'prematuro' },
        { k: 'AF', c: '#ef4444', t: 'fib.' },
      ];
      let lx = centerX + 8;
      const ly = legendY + 18;
      for (const item of legendItems) {
        ctx.fillStyle = item.c;
        ctx.fillText(item.k, lx, ly);
        const kw = ctx.measureText(item.k).width;
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.fillText(' ' + item.t, lx + kw, ly);
        lx += kw + ctx.measureText(' ' + item.t).width + 10;
        if (lx > centerX + centerW - 40) break;
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

      const { isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve, livePpgEvidencePassed: livePassed, quality: q, getValue: getV } = propsRef.current;
      const signalValue = getV();

      // Detector de pico interno (sin re-renders externos):
      // - rising: pendiente positiva sostenida.
      // - peak detectado al cambiar de positiva a negativa con amplitud
      //   por encima del umbral adaptativo.
      // - refractory 350 ms.
      const pd = peakDetectStateRef.current;
      const dy = signalValue - pd.prev;
      const dy2 = pd.prev - pd.prev2;
      const refractoryMs = 350;
      let peak = false;
      if (livePassed && q >= 15) {
        // Threshold adaptativo: 35% del pico reciente (Pan-Tompkins simplificado).
        if (signalValue > pd.threshold) pd.threshold = signalValue;
        else pd.threshold *= 0.998;
        const minAmp = pd.threshold * 0.35;
        if (dy2 > 0 && dy <= 0 && pd.prev > minAmp && now - pd.lastPeakTime > refractoryMs) {
          peak = true;
          pd.lastPeakTime = now;
        }
      } else {
        pd.threshold *= 0.99;
      }
      pd.prev2 = pd.prev;
      pd.prev = signalValue;
      const rhythm = parseRhythmStatus(arrStatus);
      const plot = getPlotArea();
      const { WINDOW_MS, COLORS } = CONFIG;

      drawGrid(ctx);
      drawAmplitudeScale(ctx);
      drawTimeScale(ctx);
      drawVitalInfo(ctx);
      drawSecondaryVitals(ctx);

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
        ctx.fillText('Cubra la cámara con la yema del dedo', plot.x + plot.width / 2, plot.centerY + 14);
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

      // Construir Path2D una sola vez (solo trazo, sin relleno)
      const wave = new Path2D();
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
          started = true;
        } else {
          wave.lineTo(x, y);
        }
        visibleCoords.push({ x, y, t: pt.time, v: pt.value });
      }

      // Trazo único, sobrio pero visible. Línea de 2.2 px en color
      // verde médico — fácil de leer en pantalla móvil sin ser arcade.
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.2;
      ctx.stroke(wave);

      // Aviso en modo provisional, discreto pero legible.
      if (provisionalPpg) {
        ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText('VALIDANDO PULSO', plot.x + plot.width / 2, plot.y + 14);
      }

      // SEGMENTOS ARRÍTMICOS — solo el latido específico se redibuja
      // en rojo, sobre la onda verde ya pintada. Trazo sobrio igualmente.
      const arrhythmiaBeats = beatHistoryRef.current.filter((b) => b.isArrhythmia);
      if (arrhythmiaBeats.length > 0 && visibleCoords.length > 2) {
        const SEGMENT_MS = 220;
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
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2.6;
          ctx.stroke(seg);
        }
      }

      // Marcadores de pico discretos. Los normales (N) NO se etiquetan
      // para no saturar la pantalla — solo se destaca la anomalía. Los
      // arrítmicos y los fuera de rango (B/T) sí muestran etiqueta.
      const history = beatHistoryRef.current;
      if (history.length > 0 && visibleCoords.length > 0) {
        ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
        ctx.textAlign = 'center';
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
          if (beat.isArrhythmia) {
            // Punto rojo + etiqueta
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fca5a5';
            ctx.fillText(beat.label, c.x, c.y - 12);
          } else if (beat.label === 'B' || beat.label === 'T') {
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(c.x, c.y, 3.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fcd34d';
            ctx.fillText(beat.label, c.x, c.y - 11);
          } else {
            // Latido sinusal normal: solo un punto verde, sin etiqueta.
            ctx.fillStyle = 'rgba(34, 197, 94, 0.95)';
            ctx.beginPath();
            ctx.arc(c.x, c.y, 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
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

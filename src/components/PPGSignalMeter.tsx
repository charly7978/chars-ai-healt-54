import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart, Activity, Shield } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';
import { HRVAnalyzer, HRVMetrics, PoincarePoint } from '../modules/vital-signs/HRVAnalyzer';

interface PipelineMetrics {
  detectionConfidence: number;
  fingerDetected: boolean;
  signalQuality: number;
  perfusionIndex: number;
  smoothedRed: number;
  smoothedGreen: number;
  smoothedBlue: number;
  fingerConfidenceCount: number;
  fingerLostCount: number;
  bufferFill: number;
  coverageScore: number;
  spatialStability: number;
  tilePulseScore: number;
  motionLevel: number;
}

interface PPGSignalMeterProps {
  value: number;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
  onOpenCalibration: () => void;
  isMonitoring?: boolean;
  isCalibrated?: boolean;
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
  // NUEVAS: métricas de pipeline para debug
  pipelineMetrics?: PipelineMetrics;
  vitalSignsFeatureQuality?: number;
  pressure?: { systolic: number; diastolic: number; confidence: string; featureQuality: number };
  elapsedTime?: number;
  maxMeasurementTime?: number;
}

// Configuración del monitor profesional
const CONFIG = {
  CANVAS_WIDTH: 1400,
  CANVAS_HEIGHT: 2800,
  WINDOW_MS: 2800, // 6 segundos de ventana
  TARGET_FPS: 30,
  BUFFER_SIZE: 400, // 6s @ 60fps
  // Área de visualización (evitar solapamiento con info)
  PLOT_AREA: {
    LEFT: 80,    // Espacio para escala Y izquierda
    RIGHT: 80,   // Espacio para info derecha
    TOP: 100,    // Espacio para info superior
    BOTTOM: 60   // Espacio para escala tiempo
  },
  COLORS: {
    BG: '#0a0f1a',
    GRID_MAJOR: 'rgba(34, 197, 94, 0.25)',
    GRID_MINOR: 'rgba(34, 197, 94, 0.1)',
    BASELINE: 'rgba(34, 197, 94, 0.4)',
    SIGNAL_NORMAL: '#22c55e',
    SIGNAL_GLOW: 'rgba(34, 197, 94, 0.5)',
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
  }
} as const;

const PPGSignalMeter = ({ 
  value, 
  quality, 
  isFingerDetected,
  onStartMeasurement,
  onReset,
  onOpenCalibration,
  isMonitoring = false,
  isCalibrated = false,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false,
  diagnosticMessage,
  isPeak = false,
  bpm = 0,
  spo2 = 0,
  rrIntervals = [],
  pipelineMetrics,
  vitalSignsFeatureQuality = 0,
  pressure,
  elapsedTime = 0,
  maxMeasurementTime = 60,
}: PPGSignalMeterProps) => {
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  const propsRef = useRef({ value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, pipelineMetrics, vitalSignsFeatureQuality, pressure });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const showDebugRef = useRef(false);
  
  useEffect(() => { showDebugRef.current = showDebug; }, [showDebug]);
  
  // Estado de arritmia persistente por latido completo
  const beatArrhythmiaRef = useRef(false);
  const lastArrhythmiaCountRef = useRef(0);
  
  // Historial de últimos 20 latidos
  const beatHistoryRef = useRef<{ isArrhythmia: boolean; time: number }[]>([]);
  
  // Estadísticas de amplitud para escala dinámica
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });

  useEffect(() => {
    propsRef.current = { value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, pipelineMetrics, vitalSignsFeatureQuality, pressure };
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals, pipelineMetrics, vitalSignsFeatureQuality, pressure]);

  // Efecto visual de pulso
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
    if (!dataBufferRef.current) {
      dataBufferRef.current = new CircularBuffer(CONFIG.BUFFER_SIZE);
    }
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

  // Calcular área de plot
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

  // Dibujar grid profesional con escala
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, COLORS } = CONFIG;
    const plot = getPlotArea();
    
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    
    // Fondo del área de plot ligeramente diferente
    ctx.fillStyle = 'rgba(0, 20, 10, 0.3)';
    ctx.fillRect(plot.x, plot.y, plot.width, plot.height);
    
    // Grid menor (cada 20px)
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
    
    // Grid mayor (cada 100px)
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
    
    // Línea base central (0)
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.centerY);
    ctx.lineTo(plot.x + plot.width, plot.centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Borde del área de plot
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
  }, [getPlotArea]);

  // Dibujar escala de amplitud (eje Y)
  const drawAmplitudeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS } = CONFIG;
    const plot = getPlotArea();
    const stats = amplitudeStatsRef.current;
    
    ctx.font = '11px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'right';
    
    // Escala en el lado izquierdo
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const y = plot.y + (i / steps) * plot.height;
      const val = stats.max - (i / steps) * stats.range;
      
      // Valor
      ctx.fillText(val.toFixed(0), plot.x - 8, y + 4);
      
      // Línea de marca
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x - 5, y);
      ctx.lineTo(plot.x, y);
      ctx.stroke();
    }
    
    // Etiqueta del eje
    ctx.save();
    ctx.translate(15, plot.centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillText('AMPLITUD (uV)', 0, 0);
    ctx.restore();
  }, [getPlotArea]);

  // Dibujar escala de tiempo (eje X)
  const drawTimeScale = useCallback((ctx: CanvasRenderingContext2D) => {
    const { COLORS, WINDOW_MS } = CONFIG;
    const plot = getPlotArea();
    
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.SCALE_TEXT;
    ctx.textAlign = 'center';
    
    // Marcas de tiempo cada segundo
    const seconds = WINDOW_MS / 1000;
    for (let s = 0; s <= seconds; s++) {
      const x = plot.x + plot.width - (s / seconds) * plot.width;
      
      // Valor
      ctx.fillText(`${s}s`, x, plot.y + plot.height + 20);
      
      // Línea de marca
      ctx.strokeStyle = COLORS.SCALE_TEXT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y + plot.height);
      ctx.lineTo(x, plot.y + plot.height + 5);
      ctx.stroke();
    }
    
    // Velocidad de barrido
    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.TEXT_PRIMARY;
    ctx.fillText('25mm/s', plot.x + plot.width, plot.y + plot.height + 40);
  }, [getPlotArea]);

  // Dibujar información vital (paneles separados)
  const drawVitalInfo = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, COLORS } = CONFIG;
    const { bpm, spo2, arrhythmiaStatus, quality, rrIntervals } = propsRef.current;
    
    // === PANEL SUPERIOR IZQUIERDO: BPM ===
    ctx.fillStyle = 'rgba(0, 30, 15, 0.8)';
    ctx.fillRect(5, 5, 130, 85);
    ctx.strokeStyle = COLORS.TEXT_PRIMARY;
    ctx.lineWidth = 1;
    ctx.strokeRect(5, 5, 130, 85);
    
    ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.fillText('♥ FRECUENCIA', 12, 22);
    
    ctx.font = 'bold 42px "SF Mono", Consolas, monospace';
    ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
    ctx.fillText(bpm > 0 ? bpm.toString() : '--', 12, 65);
    
    ctx.font = '14px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('BPM', 100, 65);
    
    // === PANEL SUPERIOR DERECHO: SpO2 ===
    ctx.fillStyle = 'rgba(0, 15, 30, 0.8)';
    ctx.fillRect(W - 135, 5, 130, 85);
    ctx.strokeStyle = spo2 >= 95 ? COLORS.TEXT_PRIMARY : 
                      spo2 >= 90 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.strokeRect(W - 135, 5, 130, 85);
    
    ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.fillText('O₂ SATURACIÓN', W - 128, 22);
    
    ctx.font = 'bold 42px "SF Mono", Consolas, monospace';
    const spo2Color = spo2 >= 95 ? COLORS.TEXT_PRIMARY : 
                      spo2 >= 90 ? COLORS.TEXT_WARNING : 
                      spo2 > 0 ? COLORS.TEXT_DANGER : COLORS.TEXT_SECONDARY;
    ctx.fillStyle = spo2Color;
    ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '--', W - 128, 65);
    
    ctx.font = '14px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('%', W - 35, 65);
    
    // === PANEL CENTRO SUPERIOR: Calidad y RR ===
    const centerX = W / 2;
    ctx.fillStyle = 'rgba(20, 20, 30, 0.8)';
    ctx.fillRect(centerX - 90, 5, 180, 50);
    ctx.strokeStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                      quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - 90, 5, 180, 50);
    
    // Calidad de señal
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('CALIDAD SEÑAL', centerX, 20);
    
    // Barra de calidad
    const barWidth = 140;
    const barHeight = 8;
    const barX = centerX - barWidth / 2;
    const barY = 26;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                    quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    
    // Valor de calidad
    ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
    ctx.fillText(`${quality.toFixed(0)}%`, centerX, 48);
    
    // Último RR interval
    if (rrIntervals && rrIntervals.length > 0) {
      const lastRR = rrIntervals[rrIntervals.length - 1];
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'right';
      ctx.fillText(`RR: ${lastRR.toFixed(0)}ms`, centerX + 85, 48);
    }
    
    // === INDICADOR DE ARRITMIA ===
    if (arrhythmiaStatus?.includes('ARRITMIA')) {
      const parts = arrhythmiaStatus.split('|');
      const count = parts.length > 1 ? parseInt(parts[1]) : 0;
      
      // Panel pulsante en el lado derecho
      const pulse = (Math.sin(now / 100) + 1) / 2;
      ctx.fillStyle = `rgba(239, 68, 68, ${0.3 + pulse * 0.4})`;
      ctx.fillRect(W - 135, 92, 130, 28);
      ctx.strokeStyle = COLORS.TEXT_DANGER;
      ctx.lineWidth = 2;
      ctx.strokeRect(W - 135, 92, 130, 28);
      
      ctx.font = 'bold 13px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_DANGER;
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ ARRITMIA x${count}`, W - 70, 110);
    }
  }, []);

  // === PANEL DE DEBUG Y ESTABILIDAD DE DEDO ===
  const drawDebugPanel = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, COLORS } = CONFIG;
    const metrics = propsRef.current.pipelineMetrics;
    const fq = propsRef.current.vitalSignsFeatureQuality || 0;
    const bp = propsRef.current.pressure;
    
    if (!metrics) return;
    
    const panelX = 5;
    const panelY = 130;
    const panelW = W - 10;
    const panelH = 165;
    
    // Fondo semitransparente
    ctx.fillStyle = 'rgba(5, 10, 25, 0.92)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, panelY, panelW, panelH);
    
    // Título
    ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
    ctx.fillStyle = '#60a5fa';
    ctx.textAlign = 'left';
    ctx.fillText('🔧 PIPELINE DEBUG', panelX + 8, panelY + 14);
    
    const col1 = panelX + 8;
    const col2 = panelX + panelW * 0.36;
    const col3 = panelX + panelW * 0.70;
    let y = panelY + 28;
    const lineH = 14;
    
    const drawMetric = (x: number, y: number, label: string, value: string, color: string) => {
      ctx.font = '7px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText(label, x, y);
      ctx.font = 'bold 9px "SF Mono", Consolas, monospace';
      ctx.fillStyle = color;
      ctx.fillText(value, x, y + 10);
    };

    const drawBar = (x: number, y: number, w: number, value: number, max: number, color: string) => {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, y, w, 4);
      const fill = Math.max(0, Math.min(1, value / max));
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w * fill, 4);
    };

    // --- Fila 1: Confianza | SQI | Perfusión ---
    const confColor = metrics.detectionConfidence > 0.7 ? '#22c55e' : metrics.detectionConfidence > 0.4 ? '#f59e0b' : '#ef4444';
    drawMetric(col1, y, 'CONFIANZA', `${(metrics.detectionConfidence * 100).toFixed(0)}%`, confColor);
    drawBar(col1, y + 14, 85, metrics.detectionConfidence, 1, confColor);
    
    const sqiColor = metrics.signalQuality > 60 ? '#22c55e' : metrics.signalQuality > 30 ? '#f59e0b' : '#ef4444';
    drawMetric(col2, y, 'SQI', `${metrics.signalQuality.toFixed(0)}%`, sqiColor);
    drawBar(col2, y + 14, 85, metrics.signalQuality, 100, sqiColor);
    
    const piColor = metrics.perfusionIndex > 1.0 ? '#22c55e' : metrics.perfusionIndex > 0.3 ? '#f59e0b' : '#ef4444';
    drawMetric(col3, y, 'PERFUSIÓN', `${metrics.perfusionIndex.toFixed(2)}%`, piColor);
    drawBar(col3, y + 14, 85, metrics.perfusionIndex, 5, piColor);
    
    y += lineH + 18;
    
    // --- Fila 2: Cobertura | Estabilidad Espacial | Movimiento ---
    const covColor = metrics.coverageScore > 0.7 ? '#22c55e' : metrics.coverageScore > 0.4 ? '#f59e0b' : '#ef4444';
    drawMetric(col1, y, 'COBERTURA', `${(metrics.coverageScore * 100).toFixed(0)}%`, covColor);
    drawBar(col1, y + 14, 85, metrics.coverageScore, 1, covColor);
    
    const spatColor = metrics.spatialStability > 0.7 ? '#22c55e' : metrics.spatialStability > 0.4 ? '#f59e0b' : '#ef4444';
    drawMetric(col2, y, 'ESTAB. ESPACIAL', `${(metrics.spatialStability * 100).toFixed(0)}%`, spatColor);
    drawBar(col2, y + 14, 85, metrics.spatialStability, 1, spatColor);
    
    const motColor = metrics.motionLevel < 0.3 ? '#22c55e' : metrics.motionLevel < 0.6 ? '#f59e0b' : '#ef4444';
    drawMetric(col3, y, 'MOVIMIENTO', `${(metrics.motionLevel * 100).toFixed(0)}%`, motColor);
    drawBar(col3, y + 14, 85, metrics.motionLevel, 1, motColor);
    
    y += lineH + 18;
    
    // --- Fila 3: Feature Quality | Buffer | Estab. Dedo ---
    const fqColor = fq > 60 ? '#22c55e' : fq > 30 ? '#f59e0b' : '#ef4444';
    drawMetric(col1, y, 'FEAT. QUALITY', `${fq.toFixed(0)}`, fqColor);
    drawBar(col1, y + 14, 85, fq, 100, fqColor);
    
    const bufColor = metrics.bufferFill > 0.7 ? '#22c55e' : metrics.bufferFill > 0.3 ? '#f59e0b' : '#94a3b8';
    drawMetric(col2, y, 'BUFFER', `${(metrics.bufferFill * 100).toFixed(0)}%`, bufColor);
    drawBar(col2, y + 14, 85, metrics.bufferFill, 1, bufColor);
    
    const stability = metrics.fingerConfidenceCount / (metrics.fingerConfidenceCount + metrics.fingerLostCount + 1);
    const stabColor = stability > 0.7 ? '#22c55e' : stability > 0.35 ? '#f59e0b' : '#ef4444';
    drawMetric(col3, y, 'ESTAB. DEDO', `${(stability * 100).toFixed(0)}%`, stabColor);
    drawBar(col3, y + 14, 85, stability, 1, stabColor);
    
    y += lineH + 18;
    
    // --- Fila 4: RGB + PA + Dedo status ---
    ctx.font = '7px "SF Mono", Consolas, monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`RGB: R=${metrics.smoothedRed.toFixed(0)} G=${metrics.smoothedGreen.toFixed(0)} B=${metrics.smoothedBlue.toFixed(0)}  Pulse:${metrics.tilePulseScore.toFixed(3)}`, col1, y + 4);
    
    if (bp && bp.systolic > 0) {
      const bpConfColor = bp.confidence === 'HIGH' ? '#22c55e' : bp.confidence === 'MEDIUM' ? '#f59e0b' : bp.confidence === 'LOW' ? '#ef4444' : '#64748b';
      ctx.fillStyle = bpConfColor;
      ctx.font = 'bold 8px "SF Mono", Consolas, monospace';
      ctx.fillText(`PA: ${bp.systolic}/${bp.diastolic} [${bp.confidence}] FQ:${bp.featureQuality}`, col2, y + 4);
    }
    
    const fingerIcon = metrics.fingerDetected ? '🟢' : '🔴';
    ctx.font = '8px "SF Mono", Consolas, monospace';
    ctx.fillStyle = metrics.fingerDetected ? '#22c55e' : '#ef4444';
    ctx.textAlign = 'right';
    ctx.fillText(`${fingerIcon} DEDO: ${metrics.fingerDetected ? 'OK' : 'NO'}  Lost:${metrics.fingerLostCount}`, panelX + panelW - 8, panelY + 14);
    ctx.textAlign = 'left';
  }, []);

  // === PANEL HRV + POINCARÉ ===
  const hrvRef = useRef<HRVMetrics | null>(null);
  const lastHRVCalcRef = useRef<number>(0);

  const drawHRVPanel = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, COLORS } = CONFIG;
    const intervals = propsRef.current.rrIntervals;
    if (!intervals || intervals.length < 6) return;

    // Recalcular HRV cada 500ms para eficiencia
    if (now - lastHRVCalcRef.current > 500) {
      hrvRef.current = HRVAnalyzer.compute(intervals);
      lastHRVCalcRef.current = now;
    }
    const hrv = hrvRef.current;
    if (!hrv || !hrv.isValid) return;

    // Posición del panel: debajo del debug si está activo, sino debajo de los paneles vitales
    const debugActive = showDebugRef.current;
    const panelX = 5;
    const panelY = debugActive ? 300 : 130;
    const panelW = W - 10;
    const panelH = 195;

    // Fondo
    ctx.fillStyle = 'rgba(5, 8, 20, 0.93)';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // Título
    ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
    ctx.fillStyle = '#a855f7';
    ctx.textAlign = 'left';
    ctx.fillText('📊 HRV ANALYSIS', panelX + 8, panelY + 14);

    ctx.font = '7px "SF Mono", Consolas, monospace';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    ctx.fillText(`N=${hrv.totalIntervals}`, panelX + panelW - 8, panelY + 14);

    // --- Métricas en columnas ---
    const col1 = panelX + 8;
    const col2 = panelX + panelW * 0.36;
    const col3 = panelX + panelW * 0.68;
    let y = panelY + 28;

    const drawM = (x: number, y: number, label: string, value: string, unit: string, color: string) => {
      ctx.font = '7px "SF Mono", Consolas, monospace';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'left';
      ctx.fillText(label, x, y);
      ctx.font = 'bold 12px "SF Mono", Consolas, monospace';
      ctx.fillStyle = color;
      ctx.fillText(value, x, y + 13);
      ctx.font = '7px "SF Mono", Consolas, monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText(unit, x + ctx.measureText(value).width + 3, y + 13);
    };

    // Fila 1: SDNN | RMSSD | pNN50
    const sdnnColor = hrv.sdnn > 100 ? '#22c55e' : hrv.sdnn > 50 ? '#f59e0b' : '#ef4444';
    drawM(col1, y, 'SDNN', hrv.sdnn.toFixed(1), 'ms', sdnnColor);

    const rmssdColor = hrv.rmssd > 40 ? '#22c55e' : hrv.rmssd > 20 ? '#f59e0b' : '#ef4444';
    drawM(col2, y, 'RMSSD', hrv.rmssd.toFixed(1), 'ms', rmssdColor);

    const pnnColor = hrv.pnn50 > 20 ? '#22c55e' : hrv.pnn50 > 5 ? '#f59e0b' : '#ef4444';
    drawM(col3, y, 'pNN50', hrv.pnn50.toFixed(1), '%', pnnColor);

    y += 30;

    // Fila 2: MeanRR | MeanHR | SD1/SD2
    drawM(col1, y, 'MEAN RR', hrv.meanRR.toString(), 'ms', '#38bdf8');
    drawM(col2, y, 'MEAN HR', hrv.meanHR.toFixed(1), 'bpm', '#38bdf8');
    drawM(col3, y, 'SD1/SD2', hrv.sd1sd2Ratio.toFixed(2), '', '#c084fc');

    y += 30;

    // --- Poincaré Plot (miniatura) ---
    const plotSize = 90;
    const plotX = panelX + panelW - plotSize - 12;
    const plotY2 = y + 2;

    // Fondo del scatter
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(plotX, plotY2, plotSize, plotSize);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.3)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(plotX, plotY2, plotSize, plotSize);

    // Línea de identidad (diagonal)
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(plotX, plotY2 + plotSize);
    ctx.lineTo(plotX + plotSize, plotY2);
    ctx.stroke();

    // Ejes label
    ctx.font = '6px "SF Mono", Consolas, monospace';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText('RR(n) ms', plotX + plotSize / 2, plotY2 + plotSize + 10);
    ctx.save();
    ctx.translate(plotX - 6, plotY2 + plotSize / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('RR(n+1)', 0, 0);
    ctx.restore();

    // Plot points
    const points = HRVAnalyzer.getPoincarePoints(intervals);
    if (points.length > 0) {
      // Auto-scale
      const allRR = intervals.filter(rr => rr >= 300 && rr <= 2000);
      const minRR = Math.min(...allRR) - 30;
      const maxRR = Math.max(...allRR) + 30;
      const rangeRR = maxRR - minRR || 1;

      // Draw SD1/SD2 ellipse
      const centerPx = plotSize / 2;
      const sd1Px = (hrv.sd1 / rangeRR) * plotSize;
      const sd2Px = (hrv.sd2 / rangeRR) * plotSize;
      ctx.save();
      ctx.translate(plotX + centerPx, plotY2 + centerPx);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(2, sd2Px), Math.max(2, sd1Px), 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(168, 85, 247, 0.08)';
      ctx.fill();
      ctx.restore();

      // Draw scatter points
      points.forEach((pt, i) => {
        const px = plotX + ((pt.rrN - minRR) / rangeRR) * plotSize;
        const py = plotY2 + plotSize - ((pt.rrN1 - minRR) / rangeRR) * plotSize;

        if (px >= plotX && px <= plotX + plotSize && py >= plotY2 && py <= plotY2 + plotSize) {
          const alpha = 0.4 + (i / points.length) * 0.6; // más recientes más brillantes
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(168, 85, 247, ${alpha})`;
          ctx.fill();
        }
      });
    }

    // Título del plot
    ctx.font = 'bold 7px "SF Mono", Consolas, monospace';
    ctx.fillStyle = '#c084fc';
    ctx.textAlign = 'center';
    ctx.fillText('POINCARÉ', plotX + plotSize / 2, plotY2 - 3);

    // SD1 / SD2 valores debajo del scatter
    ctx.font = '7px "SF Mono", Consolas, monospace';
    ctx.fillStyle = '#a855f7';
    ctx.textAlign = 'left';
    ctx.fillText(`SD1: ${hrv.sd1.toFixed(1)}ms`, col1, y + plotSize - 5);
    ctx.fillText(`SD2: ${hrv.sd2.toFixed(1)}ms`, col1, y + plotSize + 7);

    // Interpretación
    ctx.font = '7px "SF Mono", Consolas, monospace';
    const interpretation = hrv.rmssd > 40 ? 'TONO VAGAL ALTO' :
                           hrv.rmssd > 20 ? 'VARIABILIDAD NORMAL' : 'VARIABILIDAD REDUCIDA';
    const interpColor = hrv.rmssd > 40 ? '#22c55e' : hrv.rmssd > 20 ? '#f59e0b' : '#ef4444';
    ctx.fillStyle = interpColor;
    ctx.fillText(interpretation, col1, y + plotSize + 20);
  }, []);

  // Loop de renderizado principal
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
      const plot = getPlotArea();
      const { WINDOW_MS, COLORS } = CONFIG;
      
      // Dibujar fondo, grid y escalas
      drawGrid(ctx);
      drawAmplitudeScale(ctx);
      drawTimeScale(ctx);
      drawVitalInfo(ctx, now);
      
      // Panel de debug (si está activo)
      if (showDebugRef.current) {
        drawDebugPanel(ctx);
      }
      
      // Panel HRV siempre visible durante monitoreo
      drawHRVPanel(ctx, now);
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      // === PROCESAMIENTO DE SEÑAL ===
      // Escalar valor a amplitud visual controlada
      const scaledValue = signalValue * 2; // Amplificación para visualización
      
      // Propagar estado de arritmia por latido individual
      // Solo marcar como arrítmico cuando el conteo INCREMENTA en ese pico específico
      if (peak) {
        const currentCount = arrStatus ? parseInt(arrStatus.split('|')[1] || '0') : 0;
        if (currentCount > lastArrhythmiaCountRef.current) {
          beatArrhythmiaRef.current = true;
          lastArrhythmiaCountRef.current = currentCount;
        } else {
          beatArrhythmiaRef.current = false;
        }
        // Registrar en historial de latidos (últimos 20)
        beatHistoryRef.current.push({ isArrhythmia: beatArrhythmiaRef.current, time: now });
        if (beatHistoryRef.current.length > 20) {
          beatHistoryRef.current = beatHistoryRef.current.slice(-20);
        }
      }
      const currentIsArrhythmia = beatArrhythmiaRef.current;
      
      // Agregar punto al buffer
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: currentIsArrhythmia
      });
      
      // Actualizar estadísticas de amplitud dinámicamente
      const points = buffer.getPoints();
      if (points.length > 30) {
        const recentPoints = points.slice(-150);
        const values = recentPoints.map(p => p.value);
        const min = Math.min(...values);
        const max = Math.max(...values);
        const range = Math.max(40, max - min); // Mínimo 40 de rango
        
        // Suavizar cambios de escala
        const stats = amplitudeStatsRef.current;
        stats.min = stats.min * 0.95 + (min - range * 0.1) * 0.05;
        stats.max = stats.max * 0.95 + (max + range * 0.1) * 0.05;
        stats.range = stats.max - stats.min;
      }
      
      const stats = amplitudeStatsRef.current;
      
      // === DIBUJAR SEÑAL PPG ===
      if (points.length > 2) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let prevX: number | null = null;
        let prevY: number | null = null;
        
        // Arrays para marcar picos y valles
        const peaks: { x: number; y: number; isArrhythmia: boolean }[] = [];
        const valleys: { x: number; y: number }[] = [];
        
        // Dibujar segmentos
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          // Posición X: el más reciente a la derecha
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          
          // Posición Y: normalizada a la escala
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          
          // Clip al área de plot
          if (x < plot.x || x > plot.x + plot.width) continue;
          
          if (prevX !== null && prevY !== null) {
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            
            if (pt.isArrhythmia) {
              ctx.strokeStyle = COLORS.SIGNAL_ARRHYTHMIA;
              ctx.shadowColor = COLORS.ARRHYTHMIA_GLOW;
              ctx.shadowBlur = 15;
              ctx.lineWidth = 3.5;
            } else {
              ctx.strokeStyle = COLORS.SIGNAL_NORMAL;
              ctx.shadowColor = COLORS.SIGNAL_GLOW;
              ctx.shadowBlur = 10;
              ctx.lineWidth = 2.5;
            }
            
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          prevX = x;
          prevY = y;
        }
        
        // === DETECTAR Y MARCAR PICOS/VALLES ===
        const recentPoints = points.filter(p => now - p.time < WINDOW_MS);
        
        for (let i = 3; i < recentPoints.length - 3; i++) {
          const pt = recentPoints[i];
          const age = now - pt.time;
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          
          if (x < plot.x || x > plot.x + plot.width) continue;
          
          const prev1 = recentPoints[i - 1].value;
          const prev2 = recentPoints[i - 2].value;
          const prev3 = recentPoints[i - 3].value;
          const next1 = recentPoints[i + 1].value;
          const next2 = recentPoints[i + 2].value;
          const next3 = recentPoints[i + 3].value;
          
          // Detectar pico (máximo local significativo)
          const isPeakPoint = pt.value > prev1 && pt.value > prev2 && pt.value > prev3 &&
                              pt.value > next1 && pt.value > next2 && pt.value > next3 &&
                              pt.value > stats.min + stats.range * 0.4;
          
          // Detectar valle (mínimo local significativo)
          const isValley = pt.value < prev1 && pt.value < prev2 && pt.value < prev3 &&
                          pt.value < next1 && pt.value < next2 && pt.value < next3 &&
                          pt.value < stats.max - stats.range * 0.4;
          
          if (isPeakPoint) {
            peaks.push({ x, y, isArrhythmia: pt.isArrhythmia });
          }
          
          if (isValley) {
            valleys.push({ x, y });
          }
        }
        
        // Dibujar marcadores de pico con líneas verticales de referencia
        peaks.forEach(p => {
          const color = p.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.SIGNAL_NORMAL;
          
          // Línea vertical de referencia (punteada)
          ctx.save();
          ctx.strokeStyle = p.isArrhythmia ? 'rgba(239, 68, 68, 0.35)' : 'rgba(34, 197, 94, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(p.x, plot.y);
          ctx.lineTo(p.x, plot.y + plot.height);
          ctx.stroke();
          ctx.restore();
          
          // Círculo del pico
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.isArrhythmia ? 8 : 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          
          // Etiqueta N (Normal) o A (Arritmia)
          ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
          ctx.fillStyle = p.isArrhythmia ? COLORS.TEXT_DANGER : COLORS.SIGNAL_NORMAL;
          ctx.textAlign = 'center';
          ctx.fillText(p.isArrhythmia ? 'A' : 'N', p.x, p.y - 14);
          
          // Halo pulsante para arritmia
          if (p.isArrhythmia) {
            const alpha = (Math.sin(now / 80) + 1) / 2;
            ctx.beginPath();
            ctx.arc(p.x, p.y, 15, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.3 + alpha * 0.5})`;
            ctx.lineWidth = 2.5;
            ctx.stroke();
          }
        });
        
        // Dibujar marcadores de valle
        valleys.forEach(v => {
          // Triángulo pequeño hacia abajo
          ctx.beginPath();
          ctx.moveTo(v.x, v.y + 3);
          ctx.lineTo(v.x - 4, v.y + 10);
          ctx.lineTo(v.x + 4, v.y + 10);
          ctx.closePath();
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.fill();
          
          // Etiqueta
          ctx.font = '8px "SF Mono", Consolas, monospace';
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.textAlign = 'center';
          ctx.fillText('V', v.x, v.y + 22);
        });
      }
      
      // === HISTORIAL DE LATIDOS (últimos 20) ===
      const history = beatHistoryRef.current;
      if (history.length > 0) {
        const histX = plot.x;
        const histY = plot.y + plot.height + 30;
        const dotRadius = 7;
        const dotSpacing = 18;
        const totalWidth = history.length * dotSpacing;
        const startX = histX + (plot.width - totalWidth) / 2;
        
        // Fondo del panel
        ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
        const panelPad = 8;
        ctx.fillRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 14);
        ctx.strokeStyle = 'rgba(100, 116, 139, 0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(startX - panelPad, histY - dotRadius - panelPad, totalWidth + panelPad * 2, dotRadius * 2 + panelPad * 2 + 14);
        
        // Título
        ctx.font = '8px "SF Mono", Consolas, monospace';
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.textAlign = 'center';
        ctx.fillText('HISTORIAL DE LATIDOS', startX + totalWidth / 2, histY - dotRadius - 1);
        
        // Puntos
        history.forEach((beat, i) => {
          const cx = startX + i * dotSpacing + dotSpacing / 2;
          const cy = histY + 6;
          
          // Glow para arrítmicos
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
          
          // Número del latido
          ctx.font = 'bold 7px "SF Mono", Consolas, monospace';
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(`${i + 1}`, cx, cy + 3);
        });
      }
      
      // === LEYENDA ===
      const legendY = CONFIG.CANVAS_HEIGHT - 15;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      const lx = CONFIG.PLOT_AREA.LEFT;
      
      // Normal (N) - línea verde + círculo
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(lx, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 22, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal (N)', lx + 30, legendY);
      
      // Arritmia (A) - línea roja + círculo
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(lx + 110, legendY - 6, 15, 3);
      ctx.beginPath();
      ctx.arc(lx + 132, legendY - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia (A)', lx + 140, legendY);
      
      // Pico
      ctx.beginPath();
      ctx.arc(lx + 230, legendY - 4, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.PEAK_NORMAL;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Pico', lx + 240, legendY);
      
      // Valle
      ctx.beginPath();
      ctx.moveTo(lx + 275, legendY - 6);
      ctx.lineTo(lx + 271, legendY);
      ctx.lineTo(lx + 279, legendY);
      ctx.closePath();
      ctx.fillStyle = COLORS.VALLEY_COLOR;
      ctx.fill();
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Valle', lx + 285, legendY);
      
      animationRef.current = requestAnimationFrame(render);
    };
    
    animationRef.current = requestAnimationFrame(render);
    
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [drawGrid, drawAmplitudeScale, drawTimeScale, drawVitalInfo, drawDebugPanel, getPlotArea]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    amplitudeStatsRef.current = { min: -50, max: 50, range: 100 };
    beatHistoryRef.current = [];
    lastArrhythmiaCountRef.current = 0;
    onReset();
  }, [onReset]);

  return (
    <div className="fixed inset-0 bg-slate-950">
      <canvas
        ref={canvasRef}
        width={CONFIG.CANVAS_WIDTH}
        height={CONFIG.CANVAS_HEIGHT}
        className="w-full h-full absolute inset-0"
      />

      <div className="absolute top-0 left-0 p-2 z-10 flex items-center gap-2" style={{ top: '6px', left: '140px' }}>
        <div className={`p-1.5 rounded-full transition-all duration-100 ${
          showPulse ? 'bg-red-500/30 scale-110' : 'bg-emerald-500/20'
        }`}>
          <Heart 
            className={`w-4 h-4 transition-all duration-100 ${
              showPulse ? 'text-red-400 scale-110' : 'text-emerald-400'
            }`}
            fill={showPulse ? 'currentColor' : 'none'}
          />
        </div>
        <Activity className="w-3.5 h-3.5 text-emerald-400" />
        <button 
          onClick={() => setShowDebug(prev => !prev)}
          className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
            showDebug ? 'text-blue-300 bg-blue-500/20' : 'text-emerald-400/80'
          }`}
        >
          {showDebug ? '🔧 DEBUG ON' : 'PPG MONITOR v2'}
        </button>
      </div>

      <button
        onClick={onOpenCalibration}
        className={`absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-semibold backdrop-blur-sm transition-colors ${
          isCalibrated
            ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
            : 'border-sky-500/40 bg-sky-500/20 text-sky-200'
        }`}
      >
        <Shield className="h-3.5 w-3.5" />
        {isCalibrated ? 'CALIBRADA' : 'CALIBRAR PA'}
      </button>

      {/* BARRA DE PROGRESO Y TIEMPO */}
      {isMonitoring && (
        <div className="fixed bottom-12 left-0 right-0 z-10">
          <div className="h-1 w-full bg-slate-800">
            <div 
              className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-1000 ease-linear"
              style={{ width: `${Math.min(100, (elapsedTime / maxMeasurementTime) * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between px-3 py-1 bg-slate-900/90">
            <span className="text-[10px] font-mono text-slate-400">
              {String(Math.floor(elapsedTime / 60)).padStart(1, '0')}:{String(elapsedTime % 60).padStart(2, '0')}
            </span>
            <span className="text-[10px] font-mono text-emerald-400/70">
              {maxMeasurementTime - elapsedTime}s restantes
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {Math.round((elapsedTime / maxMeasurementTime) * 100)}%
            </span>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 h-12 grid grid-cols-3 z-10">
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
          onClick={onOpenCalibration}
          className={`border-t border-r border-slate-700/50 font-semibold text-sm transition-colors ${
            isCalibrated
              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 active:bg-emerald-500/30 text-emerald-300'
              : 'bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/30 text-sky-200'
          }`}
        >
          {isCalibrated ? 'RECALIBRAR' : 'CALIBRAR'}
        </button>
        <button 
          onClick={handleReset}
          className="bg-slate-700/20 hover:bg-slate-700/30 active:bg-slate-700/40 text-slate-300 font-semibold text-sm transition-colors border-t border-slate-700/50"
        >
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;

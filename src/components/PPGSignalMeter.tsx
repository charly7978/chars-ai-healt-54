import React, { useEffect, useRef, useCallback, useState, memo } from 'react';
import { Heart, Activity } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';

interface PPGSignalMeterProps {
  value: number;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
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
 * =========================================================================
 * PPG SIGNAL METER - OPTIMIZADO
 * =========================================================================
 * 
 * OPTIMIZACIONES:
 * 1. NO usa requestAnimationFrame propio - usa setInterval a 15 FPS
 * 2. Cálculos de picos/valles cacheados
 * 3. Renderizado simplificado
 * 4. Memo para evitar re-renders innecesarios
 * =========================================================================
 */

// Configuración del monitor profesional
const CONFIG = {
  CANVAS_WIDTH: 1400,
  CANVAS_HEIGHT: 2800,
  WINDOW_MS: 2800,
  TARGET_FPS: 15, // REDUCIDO de 30 a 15
  BUFFER_SIZE: 400,
  PLOT_AREA: {
    LEFT: 80,
    RIGHT: 80,
    TOP: 100,
    BOTTOM: 60
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

const PPGSignalMeter = memo(({ 
  value, 
  quality, 
  isFingerDetected,
  onStartMeasurement,
  onReset,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false,
  diagnosticMessage,
  isPeak = false,
  bpm = 0,
  spo2 = 0,
  rrIntervals = []
}: PPGSignalMeterProps) => {
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderIntervalRef = useRef<number | null>(null);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  const propsRef = useRef({ value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);
  
  // Estadísticas de amplitud cacheadas
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });
  
  // Cache de picos/valles para evitar recalcular cada frame
  const peakCacheRef = useRef<{ x: number; y: number; isArrhythmia: boolean }[]>([]);
  const valleyCacheRef = useRef<{ x: number; y: number }[]>([]);
  const lastCacheUpdateRef = useRef(0);
  const CACHE_UPDATE_INTERVAL = 200; // Actualizar cache cada 200ms

  useEffect(() => {
    propsRef.current = { value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals };
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals]);

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
      if (renderIntervalRef.current) {
        clearInterval(renderIntervalRef.current);
      }
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
    
    ctx.fillStyle = 'rgba(0, 20, 10, 0.3)';
    ctx.fillRect(plot.x, plot.y, plot.width, plot.height);
    
    // Grid menor - SIMPLIFICADO (cada 40px en vez de 20)
    ctx.strokeStyle = COLORS.GRID_MINOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = plot.x; x <= plot.x + plot.width; x += 40) {
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    }
    for (let y = plot.y; y <= plot.y + plot.height; y += 40) {
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
    ctx.stroke();
    
    // Grid mayor
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
    
    // Línea base central
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, plot.centerY);
    ctx.lineTo(plot.x + plot.width, plot.centerY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Borde
    ctx.strokeStyle = 'rgba(34, 197, 94, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.width, plot.height);
  }, [getPlotArea]);

  // Dibujar información vital (paneles separados) - SIMPLIFICADO
  const drawVitalInfo = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, COLORS } = CONFIG;
    const { bpm, spo2, arrhythmiaStatus, quality } = propsRef.current;
    
    // === PANEL BPM ===
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
    
    // === PANEL SpO2 ===
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
    
    // === PANEL CALIDAD ===
    const centerX = W / 2;
    ctx.fillStyle = 'rgba(20, 20, 30, 0.8)';
    ctx.fillRect(centerX - 90, 5, 180, 50);
    ctx.strokeStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                      quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.lineWidth = 1;
    ctx.strokeRect(centerX - 90, 5, 180, 50);
    
    ctx.font = '10px "SF Mono", Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('CALIDAD SEÑAL', centerX, 20);
    
    const barWidth = 140;
    const barHeight = 8;
    const barX = centerX - barWidth / 2;
    const barY = 26;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                    quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    
    ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
    ctx.fillText(`${quality.toFixed(0)}%`, centerX, 48);
    
    // === INDICADOR DE ARRITMIA ===
    if (arrhythmiaStatus?.includes('ARRITMIA')) {
      const parts = arrhythmiaStatus.split('|');
      const count = parts.length > 1 ? parseInt(parts[1]) : 0;
      
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

  // Loop de renderizado usando setInterval (NO requestAnimationFrame)
  useEffect(() => {
    const FRAME_TIME = 1000 / CONFIG.TARGET_FPS; // ~66ms para 15 FPS
    
    const render = () => {
      const canvas = canvasRef.current;
      const buffer = dataBufferRef.current;
      if (!canvas || !buffer) return;
      
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return;
      
      const now = Date.now();
      const { value: signalValue, isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve, isPeak: peak } = propsRef.current;
      const plot = getPlotArea();
      const { WINDOW_MS, COLORS } = CONFIG;
      
      // Dibujar fondo y grid
      drawGrid(ctx);
      drawVitalInfo(ctx, now);
      
      if (preserve && !detected) return;
      
      // Escalar valor
      const scaledValue = signalValue * 2;
      const currentIsArrhythmia = peak && arrStatus?.includes('ARRITMIA');
      
      // Agregar punto al buffer
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: currentIsArrhythmia || false
      });
      
      // Actualizar estadísticas de amplitud
      const points = buffer.getPoints();
      if (points.length > 30) {
        const recentPoints = points.slice(-100);
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
      
      // === DIBUJAR SEÑAL PPG ===
      if (points.length > 2) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let prevX: number | null = null;
        let prevY: number | null = null;
        
        // Dibujar segmentos
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = plot.x + plot.width - (age * plot.width / WINDOW_MS);
          const normalizedY = (stats.max - pt.value) / stats.range;
          const y = plot.y + normalizedY * plot.height;
          
          if (x < plot.x || x > plot.x + plot.width) continue;
          
          if (prevX !== null && prevY !== null) {
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            
            if (pt.isArrhythmia) {
              ctx.strokeStyle = COLORS.SIGNAL_ARRHYTHMIA;
              ctx.shadowColor = COLORS.ARRHYTHMIA_GLOW;
              ctx.shadowBlur = 10;
              ctx.lineWidth = 3;
            } else {
              ctx.strokeStyle = COLORS.SIGNAL_NORMAL;
              ctx.shadowColor = COLORS.SIGNAL_GLOW;
              ctx.shadowBlur = 6;
              ctx.lineWidth = 2;
            }
            
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          prevX = x;
          prevY = y;
        }
        
        // === DETECTAR PICOS/VALLES (con cache) ===
        if (now - lastCacheUpdateRef.current > CACHE_UPDATE_INTERVAL) {
          lastCacheUpdateRef.current = now;
          
          const peaks: { x: number; y: number; isArrhythmia: boolean }[] = [];
          const valleys: { x: number; y: number }[] = [];
          
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
            
            const isPeakPoint = pt.value > prev1 && pt.value > prev2 && pt.value > prev3 &&
                                pt.value > next1 && pt.value > next2 && pt.value > next3 &&
                                pt.value > stats.min + stats.range * 0.4;
            
            const isValley = pt.value < prev1 && pt.value < prev2 && pt.value < prev3 &&
                            pt.value < next1 && pt.value < next2 && pt.value < next3 &&
                            pt.value < stats.max - stats.range * 0.4;
            
            if (isPeakPoint) peaks.push({ x, y, isArrhythmia: pt.isArrhythmia });
            if (isValley) valleys.push({ x, y });
          }
          
          peakCacheRef.current = peaks;
          valleyCacheRef.current = valleys;
        }
        
        // Dibujar picos cacheados
        peakCacheRef.current.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.isArrhythmia ? 6 : 4, 0, Math.PI * 2);
          ctx.fillStyle = p.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
          ctx.fill();
          
          ctx.font = 'bold 9px "SF Mono", Consolas, monospace';
          ctx.fillStyle = p.isArrhythmia ? COLORS.TEXT_DANGER : '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(p.isArrhythmia ? 'A' : 'R', p.x, p.y - 10);
        });
        
        // Dibujar valles cacheados
        valleyCacheRef.current.forEach(v => {
          ctx.beginPath();
          ctx.moveTo(v.x, v.y + 3);
          ctx.lineTo(v.x - 3, v.y + 8);
          ctx.lineTo(v.x + 3, v.y + 8);
          ctx.closePath();
          ctx.fillStyle = COLORS.VALLEY_COLOR;
          ctx.fill();
        });
      }
      
      // === LEYENDA SIMPLIFICADA ===
      const legendY = CONFIG.CANVAS_HEIGHT - 15;
      ctx.font = '9px "SF Mono", Consolas, monospace';
      ctx.textAlign = 'left';
      
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(CONFIG.PLOT_AREA.LEFT, legendY - 6, 15, 3);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal', CONFIG.PLOT_AREA.LEFT + 20, legendY);
      
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(CONFIG.PLOT_AREA.LEFT + 80, legendY - 6, 15, 3);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia', CONFIG.PLOT_AREA.LEFT + 100, legendY);
    };
    
    // Usar setInterval en vez de requestAnimationFrame
    renderIntervalRef.current = window.setInterval(render, FRAME_TIME);
    
    return () => {
      if (renderIntervalRef.current) {
        clearInterval(renderIntervalRef.current);
      }
    };
  }, [drawGrid, drawVitalInfo, getPlotArea]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    amplitudeStatsRef.current = { min: -50, max: 50, range: 100 };
    peakCacheRef.current = [];
    valleyCacheRef.current = [];
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

      {/* Header con icono de pulso */}
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
        <span className="text-[10px] font-mono text-emerald-400/80">PPG MONITOR v3</span>
      </div>

      {/* Botones */}
      <div className="fixed bottom-0 left-0 right-0 h-12 grid grid-cols-2 z-10">
        <button 
          onClick={onStartMeasurement}
          className="bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 
                     text-emerald-400 font-semibold text-sm transition-colors border-t border-r border-slate-700/50"
        >
          INICIAR
        </button>
        <button 
          onClick={handleReset}
          className="bg-slate-700/20 hover:bg-slate-700/30 active:bg-slate-700/40 
                     text-slate-300 font-semibold text-sm transition-colors border-t border-slate-700/50"
        >
          RESET
        </button>
      </div>
    </div>
  );
});

PPGSignalMeter.displayName = 'PPGSignalMeter';

export default PPGSignalMeter;

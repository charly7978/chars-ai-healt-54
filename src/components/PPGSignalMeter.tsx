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

// Configuración OPTIMIZADA del monitor
const CONFIG = {
  CANVAS_WIDTH: 800,   // Reducido de 1200
  CANVAS_HEIGHT: 400,  // Reducido de 600
  WINDOW_MS: 5000,     // 5 segundos (antes 6)
  TARGET_FPS: 30,      // Reducido de 60
  BUFFER_SIZE: 180,    // Reducido de 540
  PLOT_AREA: {
    LEFT: 60,
    RIGHT: 60,
    TOP: 80,
    BOTTOM: 50
  },
  COLORS: {
    BG: '#0a0f1a',
    GRID_MAJOR: 'rgba(34, 197, 94, 0.2)',
    GRID_MINOR: 'rgba(34, 197, 94, 0.08)',
    BASELINE: 'rgba(34, 197, 94, 0.3)',
    SIGNAL_NORMAL: '#22c55e',
    SIGNAL_ARRHYTHMIA: '#ef4444',
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
  preserveResults = false,
  isPeak = false,
  bpm = 0,
  spo2 = 0,
  rrIntervals = []
}: PPGSignalMeterProps) => {
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  // Usar refs para props que cambian frecuentemente
  const propsRef = useRef({ value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);
  
  // Estadísticas de amplitud - actualizar menos frecuente
  const amplitudeStatsRef = useRef({ min: -50, max: 50, range: 100 });
  const statsUpdateCounter = useRef(0);

  // Actualizar refs cuando props cambian
  useEffect(() => {
    propsRef.current = { value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals };
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals]);

  // Efecto visual de pulso - throttled
  useEffect(() => {
    if (isPeak && isFingerDetected) {
      const now = Date.now();
      if (now - lastPeakTimeRef.current > 300) {
        lastPeakTimeRef.current = now;
        setShowPulse(true);
        const timer = setTimeout(() => setShowPulse(false), 100);
        return () => clearTimeout(timer);
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

  // Calcular área de plot (memoizado)
  const plotArea = useRef({
    x: CONFIG.PLOT_AREA.LEFT,
    y: CONFIG.PLOT_AREA.TOP,
    width: CONFIG.CANVAS_WIDTH - CONFIG.PLOT_AREA.LEFT - CONFIG.PLOT_AREA.RIGHT,
    height: CONFIG.CANVAS_HEIGHT - CONFIG.PLOT_AREA.TOP - CONFIG.PLOT_AREA.BOTTOM,
    centerY: CONFIG.PLOT_AREA.TOP + (CONFIG.CANVAS_HEIGHT - CONFIG.PLOT_AREA.TOP - CONFIG.PLOT_AREA.BOTTOM) / 2
  }).current;

  // Loop de renderizado OPTIMIZADO
  useEffect(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    
    const frameTime = 1000 / CONFIG.TARGET_FPS;
    let lastRenderTime = 0;
    
    const render = () => {
      if (!isRunningRef.current) return;
      
      const canvas = canvasRef.current;
      const buffer = dataBufferRef.current;
      if (!canvas || !buffer) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      const now = Date.now();
      
      // Throttle rendering
      if (now - lastRenderTime < frameTime) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      lastRenderTime = now;
      
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      const { value: signalValue, isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve, isPeak: peak, bpm, spo2, quality, rrIntervals } = propsRef.current;
      const { WINDOW_MS, COLORS } = CONFIG;
      
      // === FONDO ===
      ctx.fillStyle = COLORS.BG;
      ctx.fillRect(0, 0, CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);
      
      // === GRID SIMPLIFICADO ===
      ctx.strokeStyle = COLORS.GRID_MAJOR;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      
      // Grid vertical cada 100px
      for (let x = plotArea.x; x <= plotArea.x + plotArea.width; x += 100) {
        ctx.moveTo(x, plotArea.y);
        ctx.lineTo(x, plotArea.y + plotArea.height);
      }
      // Grid horizontal cada 50px
      for (let y = plotArea.y; y <= plotArea.y + plotArea.height; y += 50) {
        ctx.moveTo(plotArea.x, y);
        ctx.lineTo(plotArea.x + plotArea.width, y);
      }
      ctx.stroke();
      
      // Línea base
      ctx.strokeStyle = COLORS.BASELINE;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(plotArea.x, plotArea.centerY);
      ctx.lineTo(plotArea.x + plotArea.width, plotArea.centerY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // === INFO VITAL (simplificado) ===
      // BPM
      ctx.fillStyle = 'rgba(0, 30, 15, 0.8)';
      ctx.fillRect(5, 5, 100, 65);
      ctx.strokeStyle = COLORS.TEXT_PRIMARY;
      ctx.lineWidth = 1;
      ctx.strokeRect(5, 5, 100, 65);
      
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('♥ HR', 12, 20);
      
      ctx.font = 'bold 32px monospace';
      ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
      ctx.fillText(bpm > 0 ? bpm.toString() : '--', 12, 52);
      
      ctx.font = '10px monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('BPM', 75, 52);
      
      // SpO2
      const W = CONFIG.CANVAS_WIDTH;
      ctx.fillStyle = 'rgba(0, 15, 30, 0.8)';
      ctx.fillRect(W - 105, 5, 100, 65);
      ctx.strokeStyle = spo2 >= 95 ? COLORS.TEXT_PRIMARY : spo2 >= 90 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
      ctx.strokeRect(W - 105, 5, 100, 65);
      
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'left';
      ctx.fillText('O₂ SAT', W - 98, 20);
      
      ctx.font = 'bold 32px monospace';
      ctx.fillStyle = spo2 >= 95 ? COLORS.TEXT_PRIMARY : spo2 >= 90 ? COLORS.TEXT_WARNING : spo2 > 0 ? COLORS.TEXT_DANGER : COLORS.TEXT_SECONDARY;
      ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '--', W - 98, 52);
      
      ctx.font = '10px monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('%', W - 25, 52);
      
      // Calidad
      const centerX = W / 2;
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
      ctx.fillText(`Q: ${quality.toFixed(0)}%`, centerX, 20);
      
      // RR interval
      if (rrIntervals && rrIntervals.length > 0) {
        ctx.fillStyle = COLORS.TEXT_SECONDARY;
        ctx.fillText(`RR: ${rrIntervals[rrIntervals.length - 1].toFixed(0)}ms`, centerX, 35);
      }
      
      // Arritmia
      if (arrStatus?.includes('ARRITMIA')) {
        const parts = arrStatus.split('|');
        const count = parts.length > 1 ? parseInt(parts[1]) : 0;
        
        ctx.fillStyle = COLORS.TEXT_DANGER;
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`⚠ ARRITMIA x${count}`, centerX, 55);
      }
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      // === AGREGAR PUNTO ===
      const scaledValue = signalValue * 3;
      const currentIsArrhythmia = peak && arrStatus?.includes('ARRITMIA');
      
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: currentIsArrhythmia || false
      });
      
      // Actualizar estadísticas cada 10 frames
      statsUpdateCounter.current++;
      if (statsUpdateCounter.current >= 10) {
        statsUpdateCounter.current = 0;
        
        const points = buffer.getPoints();
        if (points.length > 30) {
          const recentPoints = points.slice(-100);
          let min = Infinity, max = -Infinity;
          for (const p of recentPoints) {
            if (p.value < min) min = p.value;
            if (p.value > max) max = p.value;
          }
          const range = Math.max(40, max - min);
          const stats = amplitudeStatsRef.current;
          stats.min = stats.min * 0.9 + (min - range * 0.1) * 0.1;
          stats.max = stats.max * 0.9 + (max + range * 0.1) * 0.1;
          stats.range = stats.max - stats.min;
        }
      }
      
      const stats = amplitudeStatsRef.current;
      
      // === DIBUJAR SEÑAL ===
      const points = buffer.getPoints();
      if (points.length > 2) {
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let prevX: number | null = null;
        let prevY: number | null = null;
        let prevIsArrhythmia: boolean | null = null;
        
        // Dibujar en un solo path cuando sea posible
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = plotArea.x + plotArea.width - (age * plotArea.width / WINDOW_MS);
          const normalizedY = stats.range > 0 ? (stats.max - pt.value) / stats.range : 0.5;
          const y = plotArea.y + normalizedY * plotArea.height;
          
          if (x < plotArea.x || x > plotArea.x + plotArea.width) continue;
          
          if (prevX !== null && prevY !== null) {
            // Solo cambiar color cuando cambia estado
            if (prevIsArrhythmia !== pt.isArrhythmia || prevX === null) {
              ctx.beginPath();
              ctx.moveTo(prevX, prevY);
            }
            
            ctx.lineTo(x, y);
            ctx.strokeStyle = pt.isArrhythmia ? COLORS.SIGNAL_ARRHYTHMIA : COLORS.SIGNAL_NORMAL;
            ctx.lineWidth = pt.isArrhythmia ? 3 : 2;
            ctx.stroke();
          }
          
          prevX = x;
          prevY = y;
          prevIsArrhythmia = pt.isArrhythmia;
        }
        
        // === MARCAR PICOS (simplificado) ===
        const recentPoints = points.filter(p => now - p.time < WINDOW_MS);
        
        for (let i = 3; i < recentPoints.length - 3; i++) {
          const pt = recentPoints[i];
          const age = now - pt.time;
          const x = plotArea.x + plotArea.width - (age * plotArea.width / WINDOW_MS);
          const normalizedY = stats.range > 0 ? (stats.max - pt.value) / stats.range : 0.5;
          const y = plotArea.y + normalizedY * plotArea.height;
          
          if (x < plotArea.x || x > plotArea.x + plotArea.width) continue;
          
          const prev1 = recentPoints[i - 1].value;
          const prev2 = recentPoints[i - 2].value;
          const next1 = recentPoints[i + 1].value;
          const next2 = recentPoints[i + 2].value;
          
          // Detectar pico
          const isPeakPoint = pt.value > prev1 && pt.value > prev2 &&
                              pt.value > next1 && pt.value > next2 &&
                              pt.value > stats.min + stats.range * 0.4;
          
          if (isPeakPoint) {
            ctx.beginPath();
            ctx.arc(x, y, pt.isArrhythmia ? 5 : 4, 0, Math.PI * 2);
            ctx.fillStyle = pt.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
            ctx.fill();
            
            ctx.font = 'bold 9px monospace';
            ctx.fillStyle = pt.isArrhythmia ? COLORS.TEXT_DANGER : '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(pt.isArrhythmia ? 'A' : 'R', x, y - 8);
          }
        }
      }
      
      // === LEYENDA SIMPLE ===
      const legendY = CONFIG.CANVAS_HEIGHT - 12;
      ctx.font = '8px monospace';
      ctx.textAlign = 'left';
      
      ctx.fillStyle = COLORS.SIGNAL_NORMAL;
      ctx.fillRect(plotArea.x, legendY - 4, 12, 2);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Normal', plotArea.x + 16, legendY);
      
      ctx.fillStyle = COLORS.SIGNAL_ARRHYTHMIA;
      ctx.fillRect(plotArea.x + 70, legendY - 4, 12, 2);
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText('Arritmia', plotArea.x + 86, legendY);
      
      animationRef.current = requestAnimationFrame(render);
    };
    
    animationRef.current = requestAnimationFrame(render);
    
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [plotArea]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    amplitudeStatsRef.current = { min: -50, max: 50, range: 100 };
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

      {/* Header simplificado */}
      <div className="absolute top-0 left-0 p-2 z-10 flex items-center gap-2" style={{ top: '4px', left: '110px' }}>
        <div className={`p-1 rounded-full transition-all duration-75 ${
          showPulse ? 'bg-red-500/30 scale-110' : 'bg-emerald-500/20'
        }`}>
          <Heart 
            className={`w-3.5 h-3.5 transition-all duration-75 ${
              showPulse ? 'text-red-400 scale-110' : 'text-emerald-400'
            }`}
            fill={showPulse ? 'currentColor' : 'none'}
          />
        </div>
        <Activity className="w-3 h-3 text-emerald-400" />
        <span className="text-[9px] font-mono text-emerald-400/70">PPG v3</span>
      </div>

      {/* Botones */}
      <div className="fixed bottom-0 left-0 right-0 h-11 grid grid-cols-2 z-10">
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

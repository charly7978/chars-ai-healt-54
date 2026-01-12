import React, { useEffect, useRef, useCallback, useState } from 'react';
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

// Configuración del monitor profesional
const CONFIG = {
  CANVAS_WIDTH: 1200,
  CANVAS_HEIGHT: 600,
  WINDOW_MS: 5000,
  TARGET_FPS: 60,
  BUFFER_SIZE: 450,
  COLORS: {
    BG: '#0a0f1a',
    GRID_MAJOR: 'rgba(34, 197, 94, 0.2)',
    GRID_MINOR: 'rgba(34, 197, 94, 0.08)',
    BASELINE: 'rgba(34, 197, 94, 0.3)',
    SIGNAL_NORMAL: '#22c55e',
    SIGNAL_GLOW: 'rgba(34, 197, 94, 0.4)',
    SIGNAL_ARRHYTHMIA: '#ef4444',
    ARRHYTHMIA_GLOW: 'rgba(239, 68, 68, 0.4)',
    PEAK_NORMAL: '#3b82f6',
    PEAK_ARRHYTHMIA: '#ef4444',
    TEXT_PRIMARY: '#22c55e',
    TEXT_SECONDARY: '#94a3b8',
    TEXT_WARNING: '#f59e0b',
    TEXT_DANGER: '#ef4444',
  }
} as const;

const PPGSignalMeter = ({ 
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
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  const propsRef = useRef({ value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak, bpm, spo2, rrIntervals });
  const lastPeakTimeRef = useRef(0);
  const peakValuesRef = useRef<{ time: number; value: number; isArrhythmia: boolean }[]>([]);
  const [showPulse, setShowPulse] = useState(false);

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
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  useEffect(() => {
    if (preserveResults && !isFingerDetected) {
      dataBufferRef.current?.clear();
    }
  }, [preserveResults, isFingerDetected]);

  // Dibujar grid estilo monitor ECG/PPG profesional
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, COLORS } = CONFIG;
    
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    
    // Grid menor (cada 25px = 0.04s a 25px/s)
    ctx.strokeStyle = COLORS.GRID_MINOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 25) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += 25) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    
    // Grid mayor (cada 125px = 0.2s)
    ctx.strokeStyle = COLORS.GRID_MAJOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 125) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += 125) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    
    // Línea base central
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 5]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  // Dibujar información del monitor
  const drawMonitorInfo = useCallback((ctx: CanvasRenderingContext2D, now: number) => {
    const { CANVAS_WIDTH: W, COLORS } = CONFIG;
    const { bpm, spo2, arrhythmiaStatus, quality, rrIntervals } = propsRef.current;
    
    // Panel superior izquierdo - BPM
    ctx.font = 'bold 14px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'left';
    ctx.fillText('HR', 15, 25);
    
    ctx.font = 'bold 48px "SF Mono", Consolas, monospace';
    ctx.fillStyle = bpm > 0 ? COLORS.TEXT_PRIMARY : COLORS.TEXT_SECONDARY;
    ctx.fillText(bpm > 0 ? bpm.toString() : '--', 15, 70);
    
    ctx.font = '16px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('BPM', 15, 90);
    
    // Panel superior derecho - SpO2
    ctx.font = 'bold 14px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.textAlign = 'right';
    ctx.fillText('SpO₂', W - 15, 25);
    
    ctx.font = 'bold 48px "SF Mono", Consolas, monospace';
    const spo2Color = spo2 >= 95 ? COLORS.TEXT_PRIMARY : 
                      spo2 >= 90 ? COLORS.TEXT_WARNING : 
                      spo2 > 0 ? COLORS.TEXT_DANGER : COLORS.TEXT_SECONDARY;
    ctx.fillStyle = spo2Color;
    ctx.fillText(spo2 > 0 ? spo2.toFixed(0) : '--', W - 15, 70);
    
    ctx.font = '16px "SF Mono", Consolas, monospace';
    ctx.fillStyle = COLORS.TEXT_SECONDARY;
    ctx.fillText('%', W - 15, 90);
    
    // Indicador de calidad de señal
    ctx.textAlign = 'center';
    ctx.font = '12px "SF Mono", Consolas, monospace';
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                    quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillText(`SQ: ${quality.toFixed(0)}%`, W / 2, 25);
    
    // Barra de calidad
    const barWidth = 100;
    const barHeight = 6;
    const barX = (W - barWidth) / 2;
    const barY = 32;
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = quality > 60 ? COLORS.TEXT_PRIMARY : 
                    quality > 30 ? COLORS.TEXT_WARNING : COLORS.TEXT_DANGER;
    ctx.fillRect(barX, barY, (quality / 100) * barWidth, barHeight);
    
    // Último RR interval
    if (rrIntervals && rrIntervals.length > 0) {
      const lastRR = rrIntervals[rrIntervals.length - 1];
      ctx.font = '11px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.fillText(`RR: ${lastRR.toFixed(0)}ms`, W / 2, 55);
    }
    
    // Estado de arritmia en la esquina
    if (arrhythmiaStatus?.includes('ARRITMIA')) {
      const parts = arrhythmiaStatus.split('|');
      const count = parts.length > 1 ? parseInt(parts[1]) : 0;
      
      // Fondo pulsante
      const pulse = (Math.sin(now / 150) + 1) / 2;
      ctx.fillStyle = `rgba(239, 68, 68, ${0.2 + pulse * 0.3})`;
      ctx.fillRect(W / 2 - 80, 65, 160, 28);
      
      ctx.font = 'bold 14px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_DANGER;
      ctx.textAlign = 'center';
      ctx.fillText(`⚠ ARRITMIA x${count}`, W / 2, 84);
    }
  }, []);

  // Loop de renderizado principal
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
      
      // Dibujar fondo y grid
      drawGrid(ctx);
      
      // Dibujar información del monitor
      drawMonitorInfo(ctx, now);
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      // === PROCESAMIENTO DE SEÑAL ===
      const { CANVAS_HEIGHT: H, CANVAS_WIDTH: W, WINDOW_MS, COLORS } = CONFIG;
      const centerY = H / 2;
      const amplitude = H * 0.35;
      
      // Escalar valor normalizado
      const scaledValue = (signalValue / 50) * amplitude;
      
      // Detectar si es arritmia en este momento
      const currentIsArrhythmia = peak && arrStatus?.includes('ARRITMIA');
      
      // Guardar pico para etiquetas
      if (peak) {
        peakValuesRef.current.push({
          time: now,
          value: scaledValue,
          isArrhythmia: currentIsArrhythmia || false
        });
        // Mantener solo los últimos 20 picos
        if (peakValuesRef.current.length > 20) {
          peakValuesRef.current = peakValuesRef.current.slice(-20);
        }
      }
      
      // Agregar punto al buffer
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: currentIsArrhythmia || false
      });
      
      // === DIBUJAR SEÑAL PPG ===
      const points = buffer.getPoints();
      
      if (points.length > 2) {
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let prevX: number | null = null;
        let prevY: number | null = null;
        
        // Dibujar segmentos con color según arritmia
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = W - (age * W / WINDOW_MS);
          const y = centerY - pt.value;
          
          if (prevX !== null && prevY !== null) {
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            
            if (pt.isArrhythmia) {
              ctx.strokeStyle = COLORS.SIGNAL_ARRHYTHMIA;
              ctx.shadowColor = COLORS.ARRHYTHMIA_GLOW;
              ctx.shadowBlur = 12;
              ctx.lineWidth = 3.5;
            } else {
              ctx.strokeStyle = COLORS.SIGNAL_NORMAL;
              ctx.shadowColor = COLORS.SIGNAL_GLOW;
              ctx.shadowBlur = 8;
              ctx.lineWidth = 2.5;
            }
            
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          prevX = x;
          prevY = y;
        }
        
        // === MARCAR PICOS Y VALLES ===
        // Encontrar picos y valles recientes
        const recentPoints = points.filter(p => now - p.time < WINDOW_MS);
        
        for (let i = 2; i < recentPoints.length - 2; i++) {
          const pt = recentPoints[i];
          const age = now - pt.time;
          const x = W - (age * W / WINDOW_MS);
          const y = centerY - pt.value;
          
          const prev1 = recentPoints[i - 1].value;
          const prev2 = recentPoints[i - 2].value;
          const next1 = recentPoints[i + 1].value;
          const next2 = recentPoints[i + 2].value;
          
          // Detectar pico (máximo local)
          const isPeakPoint = pt.value > prev1 && pt.value > prev2 && 
                              pt.value > next1 && pt.value > next2 &&
                              pt.value > 15; // Umbral mínimo
          
          // Detectar valle (mínimo local)
          const isValley = pt.value < prev1 && pt.value < prev2 && 
                          pt.value < next1 && pt.value < next2 &&
                          pt.value < -10;
          
          if (isPeakPoint) {
            // Marcador de pico
            ctx.beginPath();
            ctx.arc(x, y, pt.isArrhythmia ? 8 : 5, 0, Math.PI * 2);
            ctx.fillStyle = pt.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
            ctx.fill();
            
            // Etiqueta "P" o "A" para pico/arritmia
            ctx.font = 'bold 10px "SF Mono", Consolas, monospace';
            ctx.fillStyle = pt.isArrhythmia ? COLORS.TEXT_DANGER : COLORS.TEXT_PRIMARY;
            ctx.textAlign = 'center';
            ctx.fillText(pt.isArrhythmia ? 'A' : 'P', x, y - 12);
            
            // Halo pulsante para arritmia
            if (pt.isArrhythmia) {
              const alpha = (Math.sin(now / 100) + 1) / 2;
              ctx.beginPath();
              ctx.arc(x, y, 14, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(239, 68, 68, ${0.3 + alpha * 0.5})`;
              ctx.lineWidth = 2;
              ctx.stroke();
            }
          }
          
          if (isValley && Math.abs(pt.value) > 15) {
            // Marcador de valle (pequeño)
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
            ctx.fill();
            
            // Etiqueta "V"
            ctx.font = '9px "SF Mono", Consolas, monospace';
            ctx.fillStyle = COLORS.TEXT_SECONDARY;
            ctx.textAlign = 'center';
            ctx.fillText('V', x, y + 14);
          }
        }
      }
      
      // === ESCALA DE TIEMPO ===
      ctx.font = '10px "SF Mono", Consolas, monospace';
      ctx.fillStyle = COLORS.TEXT_SECONDARY;
      ctx.textAlign = 'center';
      for (let s = 0; s <= 5; s++) {
        const x = W - (s * W / 5);
        ctx.fillText(`${s}s`, x, H - 8);
      }
      
      // Indicador de tiempo real
      ctx.textAlign = 'right';
      ctx.fillStyle = COLORS.TEXT_PRIMARY;
      ctx.fillText('25mm/s', W - 10, H - 25);
      
      animationRef.current = requestAnimationFrame(render);
    };
    
    animationRef.current = requestAnimationFrame(render);
    
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [drawGrid, drawMonitorInfo]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    peakValuesRef.current = [];
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
      <div className="absolute top-0 left-0 p-2 z-10 flex items-center gap-2">
        <div className={`p-1.5 rounded-full transition-all duration-100 ${
          showPulse ? 'bg-red-500/30 scale-110' : 'bg-emerald-500/20'
        }`}>
          <Heart 
            className={`w-5 h-5 transition-all duration-100 ${
              showPulse ? 'text-red-400 scale-110' : 'text-emerald-400'
            }`}
            fill={showPulse ? 'currentColor' : 'none'}
          />
        </div>
        <Activity className="w-4 h-4 text-emerald-400" />
        <span className="text-xs font-mono text-emerald-400/80">PPG MONITOR</span>
      </div>

      {/* Debug info */}
      {diagnosticMessage && (
        <div className="absolute top-2 right-2 z-10 bg-black/60 px-2 py-1 rounded text-[10px] text-slate-400 font-mono">
          {diagnosticMessage}
        </div>
      )}

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
};

export default PPGSignalMeter;
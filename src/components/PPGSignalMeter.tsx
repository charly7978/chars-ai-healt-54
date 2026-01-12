import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';
// Arritmias visualizadas directamente en la onda con colores diferenciados

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
}

const CONFIG = {
  CANVAS_WIDTH: 1000,
  CANVAS_HEIGHT: 800,
  WINDOW_MS: 4000,
  TARGET_FPS: 60,
  BUFFER_SIZE: 600,
  GRID_MAJOR: 100,
  GRID_MINOR: 20,
  COLORS: {
    BG: '#0f172a',
    GRID_MAJOR: 'rgba(59, 130, 246, 0.25)',
    GRID_MINOR: 'rgba(59, 130, 246, 0.1)',
    BASELINE: 'rgba(148, 163, 184, 0.4)',
    SIGNAL: '#22c55e',
    SIGNAL_GLOW: 'rgba(34, 197, 94, 0.3)',
    PEAK_NORMAL: '#3b82f6',
    PEAK_ARRHYTHMIA: '#ef4444',
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
  isPeak = false
}: PPGSignalMeterProps) => {
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  const propsRef = useRef({ value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak });
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);

  useEffect(() => {
    propsRef.current = { value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak };
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak]);

  // Efecto visual de pulso cuando hay pico
  useEffect(() => {
    if (isPeak && isFingerDetected) {
      const now = Date.now();
      if (now - lastPeakTimeRef.current > 300) {
        lastPeakTimeRef.current = now;
        setShowPulse(true);
        setTimeout(() => setShowPulse(false), 150);
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

  // Dibujar grid
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, GRID_MAJOR, GRID_MINOR, COLORS } = CONFIG;
    
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    
    ctx.strokeStyle = COLORS.GRID_MINOR;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += GRID_MINOR) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += GRID_MINOR) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    
    ctx.strokeStyle = COLORS.GRID_MAJOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += GRID_MAJOR) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += GRID_MAJOR) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  // Loop de renderizado
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
      
      drawGrid(ctx);
      
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      // ========== VISUALIZACIÓN DIRECTA ==========
      // El valor ya viene normalizado del HeartBeatProcessor (rango -50 a +50)
      // Solo lo escalamos para llenar el canvas
      
      const { CANVAS_HEIGHT: H } = CONFIG;
      const centerY = H / 2;
      
      // Escalar: valor normalizado (-50 a +50) → píxeles
      // Amplitud objetivo: 40% del canvas por lado = 0.4 * H/2 = 0.2 * H
      const amplitude = H * 0.35;
      const scaledValue = (signalValue / 50) * amplitude;
      
      // Detectar si el pico actual es arrítmico
      const currentIsArrhythmia = peak && arrStatus?.includes('ARRITMIA');
      
      // Agregar punto - marcar como arritmia si hay pico arrítmico
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: currentIsArrhythmia || false
      });
      
      // Dibujar señal CON COLORES DIFERENCIADOS POR ARRITMIA
      const points = buffer.getPoints();
      const { CANVAS_WIDTH: W, WINDOW_MS, COLORS } = CONFIG;
      
      if (points.length > 2) {
        // Dibujar segmentos con colores según arritmia
        // Verde = normal, Rojo = arritmia
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let prevX: number | null = null;
        let prevY: number | null = null;
        let lastPoint: { x: number; y: number; isArrhythmia: boolean } | null = null;
        
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = W - (age * W / WINDOW_MS);
          const y = centerY - pt.value;
          
          if (prevX !== null && prevY !== null) {
            // Dibujar segmento con color según arritmia del punto actual
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(x, y);
            
            if (pt.isArrhythmia) {
              // Segmento ROJO para arritmia
              ctx.strokeStyle = COLORS.PEAK_ARRHYTHMIA;
              ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
              ctx.shadowBlur = 10;
            } else {
              // Segmento VERDE normal
              ctx.strokeStyle = COLORS.SIGNAL;
              ctx.shadowColor = COLORS.SIGNAL_GLOW;
              ctx.shadowBlur = 6;
            }
            
            ctx.stroke();
            ctx.shadowBlur = 0;
          }
          
          prevX = x;
          prevY = y;
          lastPoint = { x, y, isArrhythmia: pt.isArrhythmia };
        }
        
        // Marcar pico actual si lo hay
        if (peak && lastPoint) {
          ctx.beginPath();
          ctx.arc(lastPoint.x, lastPoint.y, lastPoint.isArrhythmia ? 12 : 8, 0, Math.PI * 2);
          ctx.fillStyle = lastPoint.isArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
          ctx.fill();
          
          // Halo pulsante para arritmia
          if (lastPoint.isArrhythmia) {
            const alpha = (Math.sin(now / 100) + 1) / 2;
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, 20, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${0.3 + alpha * 0.5})`;
            ctx.lineWidth = 3;
            ctx.stroke();
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
  }, [drawGrid]);

  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
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

      {/* Header con pulso visual */}
      <div className="absolute top-0 left-0 p-3 z-10">
        <div className="flex items-center gap-2">
          <Heart 
            className={`w-6 h-6 transition-all duration-150 ${
              showPulse ? 'text-red-500 scale-125' : 'text-emerald-500'
            }`}
            fill={showPulse ? 'currentColor' : 'none'}
          />
          <span className="text-lg font-bold text-slate-100">PPG</span>
        </div>
      </div>

      {/* Diagnóstico - visible para debugging */}
      {diagnosticMessage && (
        <div className="absolute top-0 right-0 p-2 z-10 bg-black/50 text-xs text-white font-mono">
          {diagnosticMessage}
        </div>
      )}

      {/* Botones */}
      <div className="fixed bottom-0 left-0 right-0 h-14 grid grid-cols-2 z-10">
        <button 
          onClick={onStartMeasurement}
          className="bg-emerald-600/20 hover:bg-emerald-600/30 active:bg-emerald-600/40 
                     text-emerald-400 font-semibold text-sm transition-colors border-t border-r border-slate-700"
        >
          INICIAR
        </button>
        <button 
          onClick={handleReset}
          className="bg-slate-700/20 hover:bg-slate-700/30 active:bg-slate-700/40 
                     text-slate-300 font-semibold text-sm transition-colors border-t border-slate-700"
        >
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;

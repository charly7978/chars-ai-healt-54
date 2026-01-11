import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Heart } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';
import { parseArrhythmiaStatus } from '@/utils/arrhythmiaUtils';

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
      
      // Agregar punto
      buffer.push({
        time: now,
        value: scaledValue,
        isArrhythmia: arrStatus?.includes('ARRITMIA') || false
      });
      
      // Dibujar señal
      const points = buffer.getPoints();
      const { CANVAS_WIDTH: W, WINDOW_MS, COLORS } = CONFIG;
      
      if (points.length > 2) {
        ctx.shadowColor = COLORS.SIGNAL_GLOW;
        ctx.shadowBlur = 8;
        
        ctx.beginPath();
        ctx.strokeStyle = COLORS.SIGNAL;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let started = false;
        let lastPoint: { x: number; y: number } | null = null;
        
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = W - (age * W / WINDOW_MS);
          const y = centerY - pt.value; // NEGATIVO: valores positivos van ARRIBA
          
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
          
          lastPoint = { x, y };
        }
        
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Marcar pico
        if (peak && lastPoint) {
          const hasArrhythmia = arrStatus?.includes('ARRITMIA') || false;
          
          ctx.beginPath();
          ctx.arc(lastPoint.x, lastPoint.y, hasArrhythmia ? 10 : 7, 0, Math.PI * 2);
          ctx.fillStyle = hasArrhythmia ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
          ctx.fill();
          
          if (hasArrhythmia) {
            const alpha = (Math.sin(now / 150) + 1) / 2;
            ctx.beginPath();
            ctx.arc(lastPoint.x, lastPoint.y, 16, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }
      }
      
      // Alerta de arritmia
      if (arrStatus) {
        const parsed = parseArrhythmiaStatus(arrStatus);
        if (parsed?.status === 'DETECTED') {
          const pulse = (Math.sin(now / 200) + 1) / 4;
          ctx.fillStyle = `rgba(239, 68, 68, ${0.1 + pulse * 0.15})`;
          ctx.fillRect(0, 0, W, 100);
          
          ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
          ctx.fillStyle = '#ef4444';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          
          const text = parsed.count > 1 
            ? `⚠ ARRITMIAS DETECTADAS: ${parsed.count}` 
            : '⚠ ARRITMIA DETECTADA';
          
          ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
          ctx.shadowBlur = 10;
          ctx.fillText(text, 30, 55);
          ctx.shadowBlur = 0;
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

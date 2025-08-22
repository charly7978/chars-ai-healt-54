import React, { useEffect, useRef, useCallback, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';
import { parseArrhythmiaStatus } from '@/utils/arrhythmiaUtils';
import SignalQualityIndicator from './SignalQualityIndicator';

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
  snr?: number;
  isMonitoring?: boolean;
}

const PPGSignalMeter = ({ 
  value, 
  quality, 
  isFingerDetected,
  onStartMeasurement,
  onReset,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false,
  snr = 0,
  isMonitoring = false
}: PPGSignalMeterProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  const baselineRef = useRef<number | null>(null);
  const lastValueRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number>();
  const lastRenderTimeRef = useRef<number>(0);
  const lastArrhythmiaTime = useRef<number>(0);
  const arrhythmiaCountRef = useRef<number>(0);
  const peaksRef = useRef<{time: number, value: number, isArrhythmia: boolean}[]>([]);
  const [showArrhythmiaAlert, setShowArrhythmiaAlert] = useState(false);
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // CLEANUP PROFUNDO MEJORADO
  const cleanupRefs = useRef({
    buffer: null as CircularBuffer | null,
    baseline: null as number | null,
    lastValue: null as number | null,
    peaks: [] as {time: number, value: number, isArrhythmia: boolean}[]
  });

  const WINDOW_WIDTH_MS = 2300;
  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 800;
  const GRID_SIZE_X = 45;
  const GRID_SIZE_Y = 10;
  const verticalScale = 95.0;
  const SMOOTHING_FACTOR = 1.5;
  const TARGET_FPS = 60;
  const FRAME_TIME = 1000 / TARGET_FPS;
  const BUFFER_SIZE = 600;
  const PEAK_DETECTION_WINDOW = 8;
  const PEAK_THRESHOLD = 3;
  const MIN_PEAK_DISTANCE_MS = 400;
  const IMMEDIATE_RENDERING = true;
  const MAX_PEAKS_TO_DISPLAY = 25;

  // CLEANUP CRÍTICO MEJORADO - Prevenir degradación
  const performCriticalCleanup = useCallback(() => {
    console.log('🧹 CRITICAL CLEANUP PPGSignalMeter iniciado...');
    
    // Cancelar animaciones pendientes
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }
    
    // Limpiar canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
    }
    
    // Reset completo de estados
    if (dataBufferRef.current) {
      dataBufferRef.current.clear();
      dataBufferRef.current = null;
    }
    
    baselineRef.current = null;
    lastValueRef.current = null;
    lastRenderTimeRef.current = 0;
    lastArrhythmiaTime.current = 0;
    arrhythmiaCountRef.current = 0;
    peaksRef.current = [];
    
    // Reset alerts
    setShowArrhythmiaAlert(false);
    
    console.log('✅ CRITICAL CLEANUP PPGSignalMeter completado');
  }, []);

  useEffect(() => {
    if (!dataBufferRef.current) {
      dataBufferRef.current = new CircularBuffer(BUFFER_SIZE);
    }
    
    // CLEANUP cuando se detiene monitoreo o preserveResults cambia
    if (!isMonitoring || (preserveResults && !isFingerDetected)) {
      performCriticalCleanup();
      // Recrear buffer limpio
      dataBufferRef.current = new CircularBuffer(BUFFER_SIZE);
    }
  }, [preserveResults, isFingerDetected, isMonitoring, performCriticalCleanup]);

  const smoothValue = useCallback((currentValue: number, previousValue: number | null): number => {
    if (previousValue === null) return currentValue;
    return previousValue + SMOOTHING_FACTOR * (currentValue - previousValue);
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    // FONDO AZUL OSCURO PARA MONITOR CARDÍACO
    ctx.fillStyle = '#1e3a8a'; // blue-800
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)'; // blue-500 con transparencia
    ctx.lineWidth = 0.5;
    
    // Draw vertical grid lines
    for (let x = 0; x <= CANVAS_WIDTH; x += GRID_SIZE_X) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      if (x % (GRID_SIZE_X * 5) === 0) {
        ctx.fillStyle = 'rgba(219, 234, 254, 0.8)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(x.toString(), x, CANVAS_HEIGHT - 5);
      }
    }
    
    // Draw horizontal grid lines
    for (let y = 0; y <= CANVAS_HEIGHT; y += GRID_SIZE_Y) {
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      if (y % (GRID_SIZE_Y * 5) === 0) {
        ctx.fillStyle = 'rgba(219, 234, 254, 0.8)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(y.toString(), 15, y + 3);
      }
    }
    ctx.stroke();
    
    // Draw center line (baseline)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(219, 234, 254, 0.6)';
    ctx.lineWidth = 1;
    ctx.moveTo(0, CANVAS_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
    ctx.stroke();
    
    const status = arrhythmiaStatus ? parseArrhythmiaStatus(arrhythmiaStatus) : null;
    if (status?.status === 'DETECTED') {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 24px Inter';
      ctx.textAlign = 'left';
      ctx.fillText(status.count > 1 
        ? `Arritmias: ${status.count}` 
        : '¡PRIMERA ARRITMIA DETECTADA!', 45, 95);
    }
  }, [arrhythmiaStatus]);

  const detectPeaks = useCallback((points: PPGDataPoint[], now: number) => {
    if (points.length < PEAK_DETECTION_WINDOW) return;
    
    const potentialPeaks: {index: number, value: number, time: number, isArrhythmia: boolean}[] = [];
    
    for (let i = PEAK_DETECTION_WINDOW; i < points.length - PEAK_DETECTION_WINDOW; i++) {
      const currentPoint = points[i];
      
      const recentlyProcessed = peaksRef.current.some(
        peak => Math.abs(peak.time - currentPoint.time) < MIN_PEAK_DISTANCE_MS
      );
      
      if (recentlyProcessed) continue;
      
      let isPeak = true;
      
      for (let j = i - PEAK_DETECTION_WINDOW; j < i; j++) {
        if (points[j].value >= currentPoint.value) {
          isPeak = false;
          break;
        }
      }
      
      if (isPeak) {
        for (let j = i + 1; j <= i + PEAK_DETECTION_WINDOW; j++) {
          if (j < points.length && points[j].value > currentPoint.value) {
            isPeak = false;
            break;
          }
        }
      }
      
      if (isPeak && Math.abs(currentPoint.value) > PEAK_THRESHOLD) {
        potentialPeaks.push({
          index: i,
          value: currentPoint.value,
          time: currentPoint.time,
          isArrhythmia: currentPoint.isArrhythmia
        });
      }
    }
    
    for (const peak of potentialPeaks) {
      const tooClose = peaksRef.current.some(
        existingPeak => Math.abs(existingPeak.time - peak.time) < MIN_PEAK_DISTANCE_MS
      );
      
      if (!tooClose) {
        peaksRef.current.push({
          time: peak.time,
          value: peak.value,
          isArrhythmia: peak.isArrhythmia
        });
      }
    }
    
    peaksRef.current.sort((a, b) => a.time - b.time);
    
    peaksRef.current = peaksRef.current
      .filter(peak => now - peak.time < WINDOW_WIDTH_MS)
      .slice(-MAX_PEAKS_TO_DISPLAY);
  }, []);

  const renderSignal = useCallback(() => {
    if (!canvasRef.current || !dataBufferRef.current) {
      if (isMonitoring) {
        animationFrameRef.current = requestAnimationFrame(renderSignal);
      }
      return;
    }
    
    const currentTime = performance.now();
    const timeSinceLastRender = currentTime - lastRenderTimeRef.current;
    
    if (!IMMEDIATE_RENDERING && timeSinceLastRender < FRAME_TIME) {
      if (isMonitoring) {
        animationFrameRef.current = requestAnimationFrame(renderSignal);
      }
      return;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    
    if (!ctx) {
      if (isMonitoring) {
        animationFrameRef.current = requestAnimationFrame(renderSignal);
      }
      return;
    }
    
    const now = Date.now();
    
    drawGrid(ctx);
    
    if (!isMonitoring || (preserveResults && !isFingerDetected)) {
      lastRenderTimeRef.current = currentTime;
      return;
    }
    
    if (baselineRef.current === null) {
      baselineRef.current = value;
    } else {
      baselineRef.current = baselineRef.current * 0.95 + value * 0.05;
    }
    
    const smoothedValue = smoothValue(value, lastValueRef.current);
    lastValueRef.current = smoothedValue;
    
    const normalizedValue = (baselineRef.current || 0) - smoothedValue;
    const scaledValue = normalizedValue * verticalScale;
    
    let isArrhythmia = false;
    if (rawArrhythmiaData && 
        arrhythmiaStatus?.includes("ARRITMIA") && 
        now - rawArrhythmiaData.timestamp < 1000) {
      isArrhythmia = true;
      lastArrhythmiaTime.current = now;
    }
    
    const dataPoint: PPGDataPoint = {
      time: now,
      value: scaledValue,
      isArrhythmia
    };
    
    dataBufferRef.current.push(dataPoint);
    
    const points = dataBufferRef.current.getPoints();
    detectPeaks(points, now);
    
    if (points.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#10b981'; // emerald-500
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      
      let firstPoint = true;
      
      for (let i = 1; i < points.length; i++) {
        const prevPoint = points[i - 1];
        const point = points[i];
        
        const x1 = canvas.width - ((now - prevPoint.time) * canvas.width / WINDOW_WIDTH_MS);
        const y1 = canvas.height / 2 - prevPoint.value;
        
        const x2 = canvas.width - ((now - point.time) * canvas.width / WINDOW_WIDTH_MS);
        const y2 = canvas.height / 2 - point.value;
        
        if (firstPoint) {
          ctx.moveTo(x1, y1);
          firstPoint = false;
        }
        
        ctx.lineTo(x2, y2);
        
        if (point.isArrhythmia) {
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = '#DC2626';
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = '#10b981';
          ctx.moveTo(x2, y2);
          firstPoint = true;
        }
      }
      
      ctx.stroke();
      
      peaksRef.current.forEach(peak => {
        const x = canvas.width - ((now - peak.time) * canvas.width / WINDOW_WIDTH_MS);
        const y = canvas.height / 2 - peak.value;
        
        if (x >= 0 && x <= canvas.width) {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = peak.isArrhythmia ? '#DC2626' : '#0EA5E9';
          ctx.fill();
          
          if (peak.isArrhythmia) {
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.strokeStyle = '#FEF7CD';
            ctx.lineWidth = 3;
            ctx.stroke();
            
            ctx.font = 'bold 18px Inter'; 
            ctx.fillStyle = '#F97316';
            ctx.textAlign = 'center';
            ctx.fillText('ARRITMIA', x, y - 25);
          }
          
          ctx.font = 'bold 16px Inter'; 
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'center';
          ctx.fillText(Math.abs(peak.value / verticalScale).toFixed(2), x, y - 15);
        }
      });
    }
    
    lastRenderTimeRef.current = currentTime;
    if (isMonitoring) {
      animationFrameRef.current = requestAnimationFrame(renderSignal);
    }
  }, [value, quality, isFingerDetected, rawArrhythmiaData, arrhythmiaStatus, drawGrid, detectPeaks, smoothValue, preserveResults, isMonitoring]);

  useEffect(() => {
    if (isMonitoring) {
      renderSignal();
    } else {
      // STOP rendering cuando no está monitoreando
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [renderSignal, isMonitoring]);

  useEffect(() => {
    const offscreen = document.createElement('canvas');
    offscreen.width = CANVAS_WIDTH;
    offscreen.height = CANVAS_HEIGHT;
    const offCtx = offscreen.getContext('2d');
    
    if(offCtx){
      drawGrid(offCtx);
      gridCanvasRef.current = offscreen;
    }
  }, [drawGrid]);

  const handleReset = useCallback(() => {
    console.log('🔄 PPGSignalMeter Reset iniciado...');
    performCriticalCleanup();
    setShowArrhythmiaAlert(false);
    onReset();
    console.log('✅ PPGSignalMeter Reset completado');
  }, [onReset, performCriticalCleanup]);

  // CLEANUP al desmontar
  useEffect(() => {
    return () => {
      console.log('🗑️ PPGSignalMeter desmontando...');
      performCriticalCleanup();
    };
  }, [performCriticalCleanup]);

  return (
    <div className="fixed inset-0 bg-blue-950/95 backdrop-blur-sm">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full h-[100vh] absolute inset-0 z-0"
      />

      {/* INDICADOR DE CALIDAD MOVIDO A ARRIBA IZQUIERDA CON MÁS TRANSPARENCIA */}
      <div className="absolute top-2 left-2 z-10">
        <SignalQualityIndicator
          quality={quality}
          isMonitoring={isMonitoring}
          isFingerDetected={isFingerDetected}
          snr={snr}
          className="bg-black/20 backdrop-blur-md border-white/10"
        />
      </div>

      <div className="fixed bottom-0 left-0 right-0 h-[60px] grid grid-cols-2 bg-transparent z-10">
        <button 
          onClick={onStartMeasurement}
          className="bg-transparent text-blue-100 hover:bg-blue-800/20 active:bg-blue-700/30 transition-colors duration-200 text-sm font-semibold"
        >
          INICIAR
        </button>
        <button 
          onClick={handleReset}
          className="bg-transparent text-blue-100 hover:bg-blue-800/20 active:bg-blue-700/30 transition-colors duration-200 text-sm font-semibold"
        >
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Fingerprint, AlertCircle } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';
import { getQualityColor, getQualityText } from '@/utils/qualityUtils';
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
  // Diagnóstico de detección de dedo
  diagnosticMessage?: string;
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
  diagnosticMessage
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

  const WINDOW_WIDTH_MS = 3300;
  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 800;
  const GRID_SIZE_X = 35;
  const GRID_SIZE_Y = 10;
  const verticalScale = 95.0;
  const SMOOTHING_FACTOR = 1.7;
  const TARGET_FPS = 60;
  const FRAME_TIME = 1000 / TARGET_FPS;
  const BUFFER_SIZE = 600;
  const PEAK_DETECTION_WINDOW = 8;
  const PEAK_THRESHOLD = 3;
  const MIN_PEAK_DISTANCE_MS = 300;
  const IMMEDIATE_RENDERING = true;
  const MAX_PEAKS_TO_DISPLAY = 25;

  useEffect(() => {
    if (!dataBufferRef.current) {
      dataBufferRef.current = new CircularBuffer(BUFFER_SIZE);
    }
    if (preserveResults && !isFingerDetected) {
      if (dataBufferRef.current) {
        dataBufferRef.current.clear();
      }
      peaksRef.current = [];
      baselineRef.current = null;
      lastValueRef.current = null;
    }
  }, [preserveResults, isFingerDetected]);

  const smoothValue = useCallback((currentValue: number, previousValue: number | null): number => {
    if (previousValue === null) return currentValue;
    return previousValue + SMOOTHING_FACTOR * (currentValue - previousValue);
  }, []);

  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    // FONDO AZUL OSCURO PARA MONITOR CARDÍACO
    ctx.fillStyle = '#1e3a8a'; // blue-800 - azul oscuro pero no estropea visualización
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)'; // blue-500 con transparencia para grid
    ctx.lineWidth = 0.5;
    
    // Draw vertical grid lines
    for (let x = 0; x <= CANVAS_WIDTH; x += GRID_SIZE_X) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      if (x % (GRID_SIZE_X * 5) === 0) {
        ctx.fillStyle = 'rgba(219, 234, 254, 0.8)'; // blue-100 para texto
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
        ctx.fillStyle = 'rgba(219, 234, 254, 0.8)'; // blue-100 para texto
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(y.toString(), 15, y + 3);
      }
    }
    ctx.stroke();
    
    // Draw center line (baseline) - más visible sobre fondo azul
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(219, 234, 254, 0.6)'; // blue-100 semi-transparente
    ctx.lineWidth = 1;
    ctx.moveTo(0, CANVAS_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
    ctx.stroke();
    
    // VISUALIZACIÓN DE ARRITMIA EN GRID - MÁS PROMINENTE
    const status = arrhythmiaStatus ? parseArrhythmiaStatus(arrhythmiaStatus) : null;
    if (status?.status === 'DETECTED') {
      // Fondo rojo parpadeante para arritmia
      const alpha = (Math.sin(Date.now() / 200) + 1) / 4; // Parpadeo suave
      ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`; // red-500 con alpha variable
      ctx.fillRect(0, 0, CANVAS_WIDTH, 120);
      
      // Texto de alerta grande y visible
      ctx.fillStyle = '#fff'; // Blanco para contraste
      ctx.font = 'bold 32px Inter';
      ctx.textAlign = 'left';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 10;
      ctx.fillText(status.count > 1 
        ? `⚠️ ARRITMIAS: ${status.count}` 
        : '⚠️ ARRITMIA DETECTADA', 45, 80);
      ctx.shadowBlur = 0;
      
      console.log("🫀 PPGSignalMeter: Renderizando alerta de arritmia", status);
    }
  }, [arrhythmiaStatus]);

  const detectPeaks = useCallback((points: PPGDataPoint[], now: number, isArrhythmiaActive: boolean) => {
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
        // MARCAR COMO ARRÍTMICO SOLO SI HAY ARRITMIA ACTIVA Y ES PICO R
        const isPeakArrhythmic = isArrhythmiaActive && (now - currentPoint.time < 1500);
        
        potentialPeaks.push({
          index: i,
          value: currentPoint.value,
          time: currentPoint.time,
          isArrhythmia: isPeakArrhythmic
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
      animationFrameRef.current = requestAnimationFrame(renderSignal);
      return;
    }
    
    const currentTime = performance.now();
    const timeSinceLastRender = currentTime - lastRenderTimeRef.current;
    
    if (!IMMEDIATE_RENDERING && timeSinceLastRender < FRAME_TIME) {
      animationFrameRef.current = requestAnimationFrame(renderSignal);
      return;
    }
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    
    if (!ctx) {
      animationFrameRef.current = requestAnimationFrame(renderSignal);
      return;
    }
    
    const now = Date.now();
    
    drawGrid(ctx);
    
    if (preserveResults && !isFingerDetected) {
      lastRenderTimeRef.current = currentTime;
      animationFrameRef.current = requestAnimationFrame(renderSignal);
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
    
    // DETECCIÓN DE ARRITMIA - NO MARCAR TODOS LOS PUNTOS, SOLO LATIDOS ESPECÍFICOS
    // La arritmia se marca solo en los picos detectados, no en todos los puntos
    const dataPoint: PPGDataPoint = {
      time: now,
      value: scaledValue,
      isArrhythmia: false // Los puntos normales no son arrítmicos por defecto
    };
    
    // Actualizar referencia si hay arritmia detectada
    if (arrhythmiaStatus && arrhythmiaStatus.includes("ARRITMIA DETECTADA")) {
      lastArrhythmiaTime.current = now;
      console.log("🫀 PPGSignalMeter: Arritmia detectada - se marcará en picos R", {
        status: arrhythmiaStatus,
        timestamp: now
      });
    }
    
    dataBufferRef.current.push(dataPoint);
    
    const points = dataBufferRef.current.getPoints();
    const isArrhythmiaActive = arrhythmiaStatus?.includes("ARRITMIA DETECTADA") || false;
    detectPeaks(points, now, isArrhythmiaActive);
    
    if (points.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#10b981'; // emerald-500 - verde brillante para onda cardíaca sobre azul
      ctx.lineWidth = 3; // Más gruesa para mejor visibilidad
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
      }
      
      ctx.stroke();
      
      peaksRef.current.forEach(peak => {
        const x = canvas.width - ((now - peak.time) * canvas.width / WINDOW_WIDTH_MS);
        const y = canvas.height / 2 - peak.value;
        
        if (x >= 0 && x <= canvas.width) {
          // DIBUJAR SEGMENTO ROJO SOLO ALREDEDOR DEL PICO ARRÍTMICO
          if (peak.isArrhythmia) {
            // Buscar puntos alrededor del pico para dibujar segmento rojo
            const peakIndex = points.findIndex(p => Math.abs(p.time - peak.time) < 50);
            if (peakIndex > 0 && peakIndex < points.length - 1) {
              const startIndex = Math.max(0, peakIndex - 15);
              const endIndex = Math.min(points.length - 1, peakIndex + 15);
              
              ctx.beginPath();
              ctx.strokeStyle = '#EF4444';
              ctx.lineWidth = 5;
              ctx.lineJoin = 'round';
              ctx.lineCap = 'round';
              
              for (let k = startIndex; k <= endIndex; k++) {
                const pt = points[k];
                const px = canvas.width - ((now - pt.time) * canvas.width / WINDOW_WIDTH_MS);
                const py = canvas.height / 2 - pt.value;
                
                if (k === startIndex) {
                  ctx.moveTo(px, py);
                } else {
                  ctx.lineTo(px, py);
                }
              }
              ctx.stroke();
              
              // Halo rojo
              ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
              ctx.lineWidth = 10;
              ctx.stroke();
            }
          }
          
          // Marcador del pico
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = peak.isArrhythmia ? '#DC2626' : '#0EA5E9';
          ctx.fill();
          
          // Anillo exterior para arritmias
          if (peak.isArrhythmia) {
            const alpha = (Math.sin(Date.now() / 150) + 1) / 2;
            ctx.beginPath();
            ctx.arc(x, y, 15, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
            ctx.lineWidth = 4;
            ctx.stroke();
            
            // Etiqueta de arritmia
            ctx.font = 'bold 18px Inter'; 
            ctx.fillStyle = '#EF4444';
            ctx.strokeStyle = '#FFF';
            ctx.lineWidth = 3;
            ctx.textAlign = 'center';
            ctx.strokeText('⚠️', x, y - 25);
            ctx.fillText('⚠️', x, y - 25);
            
            console.log("🫀 PPGSignalMeter: Marcando LATIDO arrítmico", { x, y, time: peak.time });
          }
          
          // Valor del pico
          ctx.font = 'bold 14px Inter'; 
          ctx.fillStyle = peak.isArrhythmia ? '#EF4444' : '#fff';
          ctx.textAlign = 'center';
          ctx.fillText(Math.abs(peak.value / verticalScale).toFixed(2), x, y - 8);
        }
      });
    }
    
    lastRenderTimeRef.current = currentTime;
    animationFrameRef.current = requestAnimationFrame(renderSignal);
  }, [value, quality, isFingerDetected, rawArrhythmiaData, arrhythmiaStatus, drawGrid, detectPeaks, smoothValue, preserveResults]);

  useEffect(() => {
    renderSignal();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderSignal]);

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
    setShowArrhythmiaAlert(false);
    peaksRef.current = [];
    onReset();
  }, [onReset]);

  return (
    <div className="fixed inset-0 bg-blue-950/95 backdrop-blur-sm"> {/* Fondo azul oscuro general */}
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full h-[100vh] absolute inset-0 z-0"
      />

      <div className="absolute top-0 left-0 right-0 p-1 flex justify-between items-center bg-transparent z-10 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-blue-100">PPG</span> {/* Texto claro sobre azul */}
          <div className="w-[180px]">
            <div className={`h-1 w-full rounded-full bg-gradient-to-r ${getQualityColor(quality)} transition-all duration-1000 ease-in-out`}>
              <div
                className="h-full rounded-full bg-white/20 animate-pulse transition-all duration-1000"
                style={{ width: `${isFingerDetected ? quality : 0}%` }}
              />
            </div>
            <span className="text-[8px] text-center mt-0.5 font-medium transition-colors duration-700 block text-blue-200"> {/* Texto claro */}
              {getQualityText(quality, isFingerDetected, 'meter')}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center max-w-[200px]">
          <Fingerprint
            className={`h-8 w-8 transition-colors duration-300 ${
              !isFingerDetected ? 'text-blue-400' :
              quality > 75 ? 'text-green-400' :
              quality > 50 ? 'text-yellow-400' :
              'text-red-400'
            }`}
            strokeWidth={1.5}
          />
          <span className="text-[9px] text-center font-medium text-blue-200 leading-tight px-1">
            {diagnosticMessage || (isFingerDetected ? "Dedo detectado" : "Ubique la YEMA del dedo sobre el flash")}
          </span>
        </div>
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

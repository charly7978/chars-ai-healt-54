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
  const animationFrameRef = useRef<number | null>(null);
  const lastRenderTimeRef = useRef<number>(0);
  const lastArrhythmiaTime = useRef<number>(0);
  const arrhythmiaCountRef = useRef<number>(0);
  const peaksRef = useRef<{time: number, value: number, isArrhythmia: boolean}[]>([]);
  const [showArrhythmiaAlert, setShowArrhythmiaAlert] = useState(false);
  
  // CRÍTICO: Canvas offscreen creado UNA SOLA VEZ
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridCanvasInitialized = useRef<boolean>(false);
  
  // CRÍTICO: Referencias para evitar recrear renderSignal
  const valueRef = useRef(value);
  const qualityRef = useRef(quality);
  const isFingerDetectedRef = useRef(isFingerDetected);
  const arrhythmiaStatusRef = useRef(arrhythmiaStatus);
  const preserveResultsRef = useRef(preserveResults);
  
  // CRÍTICO: Flag para controlar UN SOLO loop de animación
  const animationLoopActiveRef = useRef<boolean>(false);

  const WINDOW_WIDTH_MS = 2200;
  const CANVAS_WIDTH =980;
  const CANVAS_HEIGHT = 720;
  const GRID_SIZE_X = 35;
  const GRID_SIZE_Y = 10;
  const verticalScale = 50.0;
  const SMOOTHING_FACTOR = 1.8;
  const TARGET_FPS = 120; // REDUCIDO de 60 a 30 para mejor rendimiento
  const FRAME_TIME = 1000 / TARGET_FPS;
  const BUFFER_SIZE = 600; // REDUCIDO de 600 a 300
  const PEAK_DETECTION_WINDOW = 8;
  const PEAK_THRESHOLD = 3;
  const MIN_PEAK_DISTANCE_MS = 250;
  const MAX_PEAKS_TO_DISPLAY = 15; // REDUCIDO de 25 a 15

  // Actualizar refs cuando props cambian (sin recrear funciones)
  useEffect(() => {
    valueRef.current = value;
    qualityRef.current = quality;
    isFingerDetectedRef.current = isFingerDetected;
    arrhythmiaStatusRef.current = arrhythmiaStatus;
    preserveResultsRef.current = preserveResults;
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults]);

  // Inicializar buffer UNA SOLA VEZ
  useEffect(() => {
    if (!dataBufferRef.current) {
      dataBufferRef.current = new CircularBuffer(BUFFER_SIZE);
    }
    
    return () => {
      // CRÍTICO: Limpiar al desmontar
      animationLoopActiveRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (dataBufferRef.current) {
        dataBufferRef.current.clear();
        dataBufferRef.current = null;
      }
      peaksRef.current = [];
      baselineRef.current = null;
      lastValueRef.current = null;
    };
  }, []);

  // Limpiar buffer cuando preserveResults cambia y no hay dedo
  useEffect(() => {
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

  // Dibujar grid (función estable sin dependencias de props)
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D, currentArrhythmiaStatus?: string) => {
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
    ctx.lineWidth = 0.5;
    
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
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(219, 234, 254, 0.6)';
    ctx.lineWidth = 1;
    ctx.moveTo(0, CANVAS_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
    ctx.stroke();
    
    const status = currentArrhythmiaStatus ? parseArrhythmiaStatus(currentArrhythmiaStatus) : null;
    if (status?.status === 'DETECTED') {
      const alpha = (Math.sin(Date.now() / 200) + 1) / 4;
      ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
      ctx.fillRect(0, 0, CANVAS_WIDTH, 120);
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 32px Inter';
      ctx.textAlign = 'left';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 10;
      ctx.fillText(status.count > 1 
        ? `⚠️ ARRITMIAS: ${status.count}` 
        : '⚠️ ARRITMIA DETECTADA', 45, 80);
      ctx.shadowBlur = 0;
    }
  }, []);

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

  // CRÍTICO: Loop de renderizado que lee de refs, NO de props
  useEffect(() => {
    // SOLO iniciar UN loop
    if (animationLoopActiveRef.current) {
      return;
    }
    
    animationLoopActiveRef.current = true;
    
    const renderLoop = () => {
      // Si el loop fue desactivado, salir
      if (!animationLoopActiveRef.current) {
        return;
      }
      
      if (!canvasRef.current || !dataBufferRef.current) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      
      const currentTime = performance.now();
      const timeSinceLastRender = currentTime - lastRenderTimeRef.current;
      
      if (timeSinceLastRender < FRAME_TIME) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { alpha: false });
      
      if (!ctx) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      
      const now = Date.now();
      
      // Leer valores desde refs
      const currentValue = valueRef.current;
      const currentIsFingerDetected = isFingerDetectedRef.current;
      const currentArrhythmiaStatus = arrhythmiaStatusRef.current;
      const currentPreserveResults = preserveResultsRef.current;
      
      drawGrid(ctx, currentArrhythmiaStatus);
      
      if (currentPreserveResults && !currentIsFingerDetected) {
        lastRenderTimeRef.current = currentTime;
        animationFrameRef.current = requestAnimationFrame(renderLoop);
        return;
      }
      
      if (baselineRef.current === null) {
        baselineRef.current = currentValue;
      } else {
        baselineRef.current = baselineRef.current * 0.95 + currentValue * 0.05;
      }
      
      const smoothedValue = smoothValue(currentValue, lastValueRef.current);
      lastValueRef.current = smoothedValue;
      
      const normalizedValue = (baselineRef.current || 0) - smoothedValue;
      const scaledValue = normalizedValue * verticalScale;
      
      const dataPoint: PPGDataPoint = {
        time: now,
        value: scaledValue,
        isArrhythmia: false
      };
      
      if (currentArrhythmiaStatus && currentArrhythmiaStatus.includes("ARRITMIA DETECTADA")) {
        lastArrhythmiaTime.current = now;
      }
      
      dataBufferRef.current.push(dataPoint);
      
      // OPTIMIZADO: Trabajar directamente con la referencia readonly
      const points = dataBufferRef.current.getPoints();
      const isArrhythmiaActive = currentArrhythmiaStatus?.includes("ARRITMIA DETECTADA") || false;
      detectPeaks(points as PPGDataPoint[], now, isArrhythmiaActive);
      
      if (points.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = '#10b981';
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
        }
        
        ctx.stroke();
        
        peaksRef.current.forEach(peak => {
          const x = canvas.width - ((now - peak.time) * canvas.width / WINDOW_WIDTH_MS);
          const y = canvas.height / 2 - peak.value;
          
          if (x >= 0 && x <= canvas.width) {
            if (peak.isArrhythmia) {
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
                
                ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
                ctx.lineWidth = 10;
                ctx.stroke();
              }
            }
            
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = peak.isArrhythmia ? '#DC2626' : '#0EA5E9';
            ctx.fill();
            
            if (peak.isArrhythmia) {
              const alpha = (Math.sin(Date.now() / 150) + 1) / 2;
              ctx.beginPath();
              ctx.arc(x, y, 15, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
              ctx.lineWidth = 4;
              ctx.stroke();
              
              ctx.font = 'bold 18px Inter';
              ctx.fillStyle = '#EF4444';
              ctx.strokeStyle = '#FFF';
              ctx.lineWidth = 3;
              ctx.textAlign = 'center';
              ctx.strokeText('⚠️', x, y - 25);
              ctx.fillText('⚠️', x, y - 25);
            }
            
            ctx.font = 'bold 14px Inter';
            ctx.fillStyle = peak.isArrhythmia ? '#EF4444' : '#fff';
            ctx.textAlign = 'center';
            ctx.fillText(Math.abs(peak.value / verticalScale).toFixed(2), x, y - 8);
          }
        });
      }
      
      lastRenderTimeRef.current = currentTime;
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };
    
    // Iniciar el loop
    animationFrameRef.current = requestAnimationFrame(renderLoop);
    
    return () => {
      animationLoopActiveRef.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [drawGrid, detectPeaks, smoothValue]);

  const handleReset = useCallback(() => {
    setShowArrhythmiaAlert(false);
    peaksRef.current = [];
    
    // CRÍTICO: Limpiar buffer al resetear
    if (dataBufferRef.current) {
      dataBufferRef.current.clear();
    }
    baselineRef.current = null;
    lastValueRef.current = null;
    
    onReset();
  }, [onReset]);

  return (
    <div className="fixed inset-0 bg-blue-950/95 backdrop-blur-sm">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full h-[100vh] absolute inset-0 z-0"
      />

      <div className="absolute top-0 left-0 right-0 p-1 flex justify-between items-center bg-transparent z-10 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-blue-100">PPG</span>
          <div className="w-[180px]">
            <div className={`h-1 w-full rounded-full bg-gradient-to-r ${getQualityColor(quality)} transition-all duration-1000 ease-in-out`}>
              <div
                className="h-full rounded-full bg-white/20 animate-pulse transition-all duration-1000"
                style={{ width: `${isFingerDetected ? quality : 0}%` }}
              />
            </div>
            <span className="text-[8px] text-center mt-0.5 font-medium transition-colors duration-700 block text-blue-200">
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

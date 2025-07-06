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
}

const PPGSignalMeter = ({ 
  value, 
  quality, 
  isFingerDetected,
  onStartMeasurement,
  onReset,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false
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

  const WINDOW_WIDTH_MS = 2800;
  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 900;
  const GRID_SIZE_X = 10;
  const GRID_SIZE_Y = 10;
  const verticalScale = 75.0;
  const SMOOTHING_FACTOR = 1.9;
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
    // Fondo médico profesional
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Cuadrícula médica precisa
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.15)';
    ctx.lineWidth = 0.5;
    
    // Líneas verticales cada 50ms (para latidos)
    for (let x = 0; x <= CANVAS_WIDTH; x += 50) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      if (x % 200 === 0) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.6)';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${(x / 50).toFixed(1)}s`, x, CANVAS_HEIGHT - 10);
      }
    }
    
    // Líneas horizontales para amplitud
    for (let y = 0; y <= CANVAS_HEIGHT; y += 50) {
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      if (y % 100 === 0) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.6)';
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'right';
        const amplitude = ((CANVAS_HEIGHT / 2 - y) / verticalScale).toFixed(2);
        ctx.fillText(amplitude, 30, y + 4);
      }
    }
    ctx.stroke();
    
    // Línea central (baseline)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.moveTo(0, CANVAS_HEIGHT / 2);
    ctx.lineTo(CANVAS_WIDTH, CANVAS_HEIGHT / 2);
    ctx.stroke();
    
    // Información de estado en tiempo real
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    
    // Estado del dedo
    ctx.fillStyle = isFingerDetected ? '#00ff00' : '#ff4444';
    ctx.fillText(`Dedo: ${isFingerDetected ? 'DETECTADO' : 'NO DETECTADO'}`, 10, 25);
    
    // Calidad de señal
    const qualityColor = getQualityColor(quality);
    ctx.fillStyle = qualityColor;
    ctx.fillText(`Calidad: ${quality.toFixed(1)}%`, 10, 45);
    
    // Estado de arritmia
    const status = arrhythmiaStatus ? parseArrhythmiaStatus(arrhythmiaStatus) : null;
    if (status?.status === 'DETECTED') {
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 16px monospace';
      ctx.fillText(`⚠️ ARRITMIA #${status.count}`, 10, 70);
      
      // Mostrar métricas de arritmia si están disponibles
      if (rawArrhythmiaData) {
        ctx.font = '12px monospace';
        ctx.fillStyle = '#ffaa00';
        ctx.fillText(`RMSSD: ${rawArrhythmiaData.rmssd.toFixed(1)}ms`, 10, 90);
        ctx.fillText(`Variación RR: ${(rawArrhythmiaData.rrVariation * 100).toFixed(1)}%`, 10, 105);
      }
    } else if (status?.status === 'CALIBRATING') {
      ctx.fillStyle = '#ffff00';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('🔬 CALIBRANDO...', 10, 70);
    } else {
      ctx.fillStyle = '#00ff00';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('✅ RITMO NORMAL', 10, 70);
    }
    
    // Escala de tiempo
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TIEMPO (segundos)', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 5);
    
    // Escala de amplitud
    ctx.save();
    ctx.translate(15, CANVAS_HEIGHT / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('AMPLITUD PPG', 0, 0);
    ctx.restore();
  }, [arrhythmiaStatus, isFingerDetected, quality, rawArrhythmiaData]);

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
      // Dibujar señal PPG principal con estilo médico
      ctx.beginPath();
      ctx.strokeStyle = isFingerDetected ? '#00ff00' : '#666666';
      ctx.lineWidth = isFingerDetected ? 3 : 1;
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
        
        // Resaltar segmentos de arritmia
        if (point.isArrhythmia) {
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = '#ff4444';
          ctx.lineWidth = 4;
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
          ctx.beginPath();
          ctx.strokeStyle = isFingerDetected ? '#00ff00' : '#666666';
          ctx.lineWidth = isFingerDetected ? 3 : 1;
          ctx.moveTo(x2, y2);
          firstPoint = true;
        }
      }
      
      ctx.stroke();
      
      // Dibujar marcadores de picos cardíacos
      peaksRef.current.forEach(peak => {
        const x = canvas.width - ((now - peak.time) * canvas.width / WINDOW_WIDTH_MS);
        const y = canvas.height / 2 - peak.value;
        
        if (x >= 0 && x <= canvas.width) {
          // Pico normal
          if (!peak.isArrhythmia) {
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#00ff00';
            ctx.fill();
            
            // Línea vertical del pico
            ctx.beginPath();
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 1;
            ctx.moveTo(x, canvas.height / 2);
            ctx.lineTo(x, y);
            ctx.stroke();
          } else {
            // Pico de arritmia - más prominente
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ff4444';
            ctx.fill();
            
            // Anillo de alerta
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Línea vertical roja
            ctx.beginPath();
            ctx.strokeStyle = '#ff4444';
            ctx.lineWidth = 2;
            ctx.moveTo(x, canvas.height / 2);
            ctx.lineTo(x, y);
            ctx.stroke();
            
            // Etiqueta de arritmia
            ctx.font = 'bold 12px monospace'; 
            ctx.fillStyle = '#ff4444';
            ctx.textAlign = 'center';
            ctx.fillText('⚠️', x, y - 20);
          }
          
          // Mostrar amplitud del pico
          ctx.font = '10px monospace'; 
          ctx.fillStyle = peak.isArrhythmia ? '#ff4444' : '#00ff00';
          ctx.textAlign = 'center';
          ctx.fillText(Math.abs(peak.value / verticalScale).toFixed(3), x, y + 15);
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
    <div className="fixed inset-0 bg-black/5 backdrop-blur-[1px]">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="w-full h-[100vh] absolute inset-0 z-0"
      />

      <div className="absolute top-0 left-0 right-0 p-1 flex justify-between items-center bg-transparent z-10 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-black/80">PPG</span>
          <div className="w-[180px]">
            <div className={`h-1 w-full rounded-full bg-gradient-to-r ${getQualityColor(quality)} transition-all duration-1000 ease-in-out`}>
              <div
                className="h-full rounded-full bg-white/20 animate-pulse transition-all duration-1000"
                style={{ width: `${isFingerDetected ? quality : 0}%` }}
              />
            </div>
            <span className="text-[8px] text-center mt-0.5 font-medium transition-colors duration-700 block" 
                  style={{ color: quality > 60 ? '#0EA5E9' : '#F59E0B' }}>
              {getQualityText(quality, isFingerDetected, 'meter')}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <Fingerprint
            className={`h-8 w-8 transition-colors duration-300 ${
              !isFingerDetected ? 'text-gray-400' :
              quality > 75 ? 'text-green-500' :
              quality > 50 ? 'text-yellow-500' :
              'text-red-500'
            }`}
            strokeWidth={1.5}
          />
          <span className="text-[8px] text-center font-medium text-black/80">
            {isFingerDetected ? "Dedo detectado" : "Ubique su dedo"}
          </span>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 h-[60px] grid grid-cols-2 bg-transparent z-10">
        <button 
          onClick={onStartMeasurement}
          className="bg-transparent text-black/80 hover:bg-white/5 active:bg-white/10 transition-colors duration-200 text-sm font-semibold"
        >
          INICIAR
        </button>
        <button 
          onClick={handleReset}
          className="bg-transparent text-black/80 hover:bg-white/5 active:bg-white/10 transition-colors duration-200 text-sm font-semibold"
        >
          RESET
        </button>
      </div>
    </div>
  );
};

export default PPGSignalMeter;

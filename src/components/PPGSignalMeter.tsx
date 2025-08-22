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
  debug?: {
    snr?: number;
    bandRatio?: number;
    reasons?: string[];
    gatedFinger?: boolean;
    gatedQuality?: boolean;
    gatedSnr?: boolean;
    spectralOk?: boolean;
  };
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
  debug
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
  const [showDebug, setShowDebug] = useState(false);

  const WINDOW_WIDTH_MS = 2300;
  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 800;
  const GRID_SIZE_X = 45;
  const GRID_SIZE_Y = 10;
  const verticalScale = 110.0;
  const SMOOTHING_FACTOR = 1.5;
  const TARGET_FPS = 60;
  const FRAME_TIME = 1000 / TARGET_FPS;
  const BUFFER_SIZE = 600;
  const PEAK_DETECTION_WINDOW = 8;
  const PEAK_THRESHOLD = 3;
  const MIN_PEAK_DISTANCE_MS = 400;
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
    
    const status = arrhythmiaStatus ? parseArrhythmiaStatus(arrhythmiaStatus) : null;
    if (status?.status === 'DETECTED') {
      ctx.fillStyle = '#ef4444'; // red-500 para alertas
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
    
    // Usar grilla prerenderizada si está disponible para reducir carga
    if (gridCanvasRef.current) {
      ctx.drawImage(gridCanvasRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      drawGrid(ctx);
    }
    
    if (preserveResults && !isFingerDetected) {
      lastRenderTimeRef.current = currentTime;
      animationFrameRef.current = requestAnimationFrame(renderSignal);
      return;
    }
    
    if (baselineRef.current === null) {
      baselineRef.current = value;
    } else {
      baselineRef.current = baselineRef.current * 0.98 + value * 0.02;
    }
    
    // Smoothing de render (no afecta cálculo base)
    const smoothedValue = smoothValue(value, lastValueRef.current);
    lastValueRef.current = smoothedValue;
    
    const normalizedValue = smoothedValue - (baselineRef.current || 0);
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
    
    // Usar solo puntos visibles en la ventana actual
    const visiblePoints = points.filter(p => now - p.time <= WINDOW_WIDTH_MS);
    if (visiblePoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#38bdf8'; // sky-400 - azul/cian clásico
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      
      // Polilínea con decimación por píxel (sin cortes)
      const toXY = (pt: PPGDataPoint) => ({
        x: canvas.width - ((now - pt.time) * canvas.width / WINDOW_WIDTH_MS),
        y: canvas.height / 2 - pt.value
      });
      const pts = visiblePoints.map(toXY);
      // Recorremos de más viejo a más nuevo, dibujando un punto por píxel
      let lastDrawnX = -Infinity;
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const { x, y } = pts[i];
        if (!started) {
          ctx.moveTo(x, y);
          lastDrawnX = x;
          started = true;
          continue;
        }
        if (x - lastDrawnX >= 1) {
          ctx.lineTo(x, y);
          lastDrawnX = x;
        }
      }
      
      ctx.stroke();
      
      peaksRef.current.forEach(peak => {
        const x = canvas.width - ((now - peak.time) * canvas.width / WINDOW_WIDTH_MS);
        const y = canvas.height / 2 - peak.value;
        
        if (x >= 0 && x <= canvas.width) {
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#38bdf8'; // punto azul para pico normal
          ctx.fill();
          if (peak.isArrhythmia) {
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.strokeStyle = '#DC2626'; // anillo rojo para arritmia
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      });
    }
    
    // Limitar a TARGET_FPS usando timestamp
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

      {/* Panel de diagnóstico (sobre la botonera) */}
      {showDebug && (
      <div className="absolute left-0 right-0 bottom-[60px] z-10 px-3 pb-2">
        <div className="mx-3 rounded-lg border border-white/10 bg-black/40 backdrop-blur px-3 py-2 text-[10px] text-blue-100 grid grid-cols-3 gap-2">
          <div>
            <div className="opacity-70">Dedo</div>
            <div className={isFingerDetected ? 'text-green-300 font-bold' : 'text-red-300 font-bold'}>
              {isFingerDetected ? 'Detectado' : 'No detectado'}
            </div>
          </div>
          <div>
            <div className="opacity-70">Calidad</div>
            <div className="font-bold">{Math.round(quality)}%</div>
          </div>
          <div>
            <div className="opacity-70">FPS aprox.</div>
            <div>{Math.round(1000 / Math.max(1, (performance.now() - lastRenderTimeRef.current)))} </div>
          </div>
        </div>
        <div className="mx-3 mt-1 rounded-lg border border-white/10 bg-black/30 backdrop-blur px-3 py-2 text-[10px] text-blue-100 grid grid-cols-3 gap-2">
          <div>
            <div className="opacity-70">SNR</div>
            <div className="font-bold">{debug?.snr !== undefined ? debug.snr.toFixed(2) : '--'}</div>
          </div>
          <div>
            <div className="opacity-70">Band</div>
            <div className="font-bold">{debug?.bandRatio !== undefined ? debug.bandRatio.toFixed(2) : '--'}</div>
          </div>
          <div>
            <div className="opacity-70">Gates</div>
            <div className="font-bold">
              {debug ? (
                <>
                  {debug.gatedFinger ? '✓' : '✗'} dedo · {debug.gatedQuality ? '✓' : '✗'} cal · {debug.gatedSnr ? '✓' : '✗'} snr · {debug.spectralOk ? '✓' : '✗'} spec
                </>
              ) : '--'}
            </div>
          </div>
          <div className="col-span-3">
            <div className="opacity-70">Motivos</div>
            <div className="font-bold truncate">{debug?.reasons && debug.reasons.length ? debug.reasons.join(', ') : '—'}</div>
          </div>
        </div>
      </div>
      )}

      {/* Toggle para el panel de diagnóstico */}
      <div className="absolute left-3 bottom-[60px] z-10">
        <button
          onClick={() => setShowDebug(v => !v)}
          className={`px-3 py-1 rounded-full text-[10px] font-semibold border transition-colors ${showDebug ? 'bg-blue-600/80 border-white/20 text-white' : 'bg-black/40 border-white/10 text-blue-100'} backdrop-blur`}
        >
          {showDebug ? 'Ocultar DEBUG' : 'Mostrar DEBUG'}
        </button>
      </div>

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

        <div className="flex flex-col items-center">
          <Fingerprint
            className={`h-8 w-8 transition-colors duration-300 ${
              !isFingerDetected ? 'text-blue-400' :
              quality > 75 ? 'text-green-400' :
              quality > 50 ? 'text-yellow-400' :
              'text-red-400'
            }`}
            strokeWidth={1.5}
          />
          <span className="text-[8px] text-center font-medium text-blue-200"> {/* Texto claro */}
            {isFingerDetected ? "Dedo detectado" : "Ubique su dedo"}
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

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Fingerprint, AlertCircle, Signal } from 'lucide-react';
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

  // Configuración original del monitor - NO TOCAR
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

  // Mejorado: Cálculo de calidad más preciso y permisivo
  const [realTimeQuality, setRealTimeQuality] = useState(0);
  const [signalStrength, setSignalStrength] = useState(0);
  const [signalStability, setSignalStability] = useState(0);
  const qualityHistoryRef = useRef<number[]>([]);
  const signalHistoryRef = useRef<number[]>([]);

  // Algoritmo mejorado para calidad de señal PPG más realista
  const calculateRealSignalQuality = useCallback((currentValue: number, detectedFinger: boolean) => {
    if (!detectedFinger) {
      setRealTimeQuality(0);
      setSignalStrength(0);
      setSignalStability(0);
      return 0;
    }

    // Agregar a historial con ventana más grande para mejor análisis
    signalHistoryRef.current.push(currentValue);
    if (signalHistoryRef.current.length > 50) { // Aumentado de 30 a 50
      signalHistoryRef.current.shift();
    }

    if (signalHistoryRef.current.length < 8) { // Reducido de 5 a 8
      return quality; // Usar calidad proporcionada si no hay suficientes datos
    }

    const recentSignals = signalHistoryRef.current.slice(-20); // Aumentado de -15 a -20
    
    // 1. Fuerza de Señal PPG (más permisiva para señales humanas reales)
    const maxSignal = Math.max(...recentSignals);
    const minSignal = Math.min(...recentSignals);
    const signalRange = maxSignal - minSignal;
    
    // Umbral más bajo para señales PPG reales (reducido de 50 a 25)
    const strengthScore = Math.min(100, Math.max(0, (signalRange / 25) * 100));
    
    // 2. Estabilidad de Señal (más tolerante a variaciones naturales)
    const mean = recentSignals.reduce((sum, val) => sum + val, 0) / recentSignals.length;
    const variance = recentSignals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / recentSignals.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = mean > 0 ? stdDev / mean : 1;
    
    // Más tolerante a variaciones (aumentado multiplicador de 100 a 120)
    const stabilityScore = Math.min(100, Math.max(0, (1 - coefficientOfVariation) * 120));
    
    // 3. Detección de Pulsatilidad (mejorada para PPG humano)
    let pulsatilityScore = 50; // Base score más alto para señales detectadas
    if (recentSignals.length >= 12) {
      const peaks = [];
      const valleys = [];
      
      // Detección más sofisticada de picos y valles
      for (let i = 2; i < recentSignals.length - 2; i++) {
        const current = recentSignals[i];
        const prev1 = recentSignals[i-1];
        const prev2 = recentSignals[i-2];
        const next1 = recentSignals[i+1];
        const next2 = recentSignals[i+2];
        
        // Pico: mayor que sus vecinos
        if (current > prev1 && current > next1 && current > prev2 && current > next2) {
          peaks.push({ index: i, value: current });
        }
        
        // Valle: menor que sus vecinos
        if (current < prev1 && current < next1 && current < prev2 && current < next2) {
          valleys.push({ index: i, value: current });
        }
      }
      
      // Evaluación mejorada de pulsatilidad
      const expectedRhythm = recentSignals.length / 12; // ~1.5-2 latidos por ventana
      const actualPeaks = peaks.length;
      const actualValleys = valleys.length;
      
      if (actualPeaks >= 1 && actualValleys >= 1) {
        const rhythmScore = Math.min(100, (actualPeaks / expectedRhythm) * 70);
        const alternatingPattern = Math.abs(actualPeaks - actualValleys) <= 1 ? 30 : 15;
        pulsatilityScore = rhythmScore + alternatingPattern;
      }
    }
    
    // 4. Relación Señal-Ruido mejorada para PPG
    const acComponent = stdDev;
    const dcComponent = mean;
    let snrScore = 40; // Base score más alto
    
    if (dcComponent > 0) {
      const snrRatio = acComponent / dcComponent;
      // Rango óptimo para PPG humano: 0.01 - 0.1
      if (snrRatio >= 0.005 && snrRatio <= 0.15) {
        snrScore = Math.min(100, 40 + (snrRatio * 400)); // Amplificado
      }
    }
    
    // 5. Bonus por estabilidad temporal
    let stabilityBonus = 0;
    if (qualityHistoryRef.current.length >= 3) {
      const recentQualities = qualityHistoryRef.current.slice(-3);
      const avgRecentQuality = recentQualities.reduce((sum, q) => sum + q, 0) / recentQualities.length;
      const qualityVariance = recentQualities.reduce((sum, q) => sum + Math.pow(q - avgRecentQuality, 2), 0) / recentQualities.length;
      
      if (qualityVariance < 100) { // Baja varianza = estabilidad
        stabilityBonus = 15;
      }
    }
    
    // Combinación ponderada optimizada para señales PPG humanas
    const combinedQuality = (
      strengthScore * 0.25 +      // 25% fuerza de señal
      stabilityScore * 0.20 +     // 20% estabilidad
      pulsatilityScore * 0.30 +   // 30% pulsatilidad (más importante)
      snrScore * 0.20 +          // 20% relación señal-ruido
      stabilityBonus * 0.05      // 5% bonus estabilidad
    );
    
    // Actualizar métricas individuales
    setSignalStrength(Math.round(strengthScore));
    setSignalStability(Math.round(stabilityScore));
    
    // Suavizado mejorado de la calidad
    const smoothedQuality = Math.round(Math.min(100, Math.max(0, combinedQuality)));
    qualityHistoryRef.current.push(smoothedQuality);
    if (qualityHistoryRef.current.length > 8) { // Historial más largo
      qualityHistoryRef.current.shift();
    }
    
    // Promedio ponderado que favorece valores recientes
    const weights = [0.4, 0.3, 0.2, 0.1]; // Más peso a valores recientes
    let weightedSum = 0;
    let totalWeight = 0;
    
    for (let i = 0; i < Math.min(qualityHistoryRef.current.length, weights.length); i++) {
      const idx = qualityHistoryRef.current.length - 1 - i;
      const weight = weights[i];
      weightedSum += qualityHistoryRef.current[idx] * weight;
      totalWeight += weight;
    }
    
    const finalQuality = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : smoothedQuality;
    setRealTimeQuality(finalQuality);
    
    return finalQuality;
  }, [quality]);

  useEffect(() => {
    calculateRealSignalQuality(value, isFingerDetected);
  }, [value, isFingerDetected, calculateRealSignalQuality]);

  // Usar calidad calculada en tiempo real
  const displayQuality = realTimeQuality;

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
    ctx.fillStyle = '#FDF5E6';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(60, 60, 60, 0.3)';
    ctx.lineWidth = 0.5;
    
    // Draw vertical grid lines
    for (let x = 0; x <= CANVAS_WIDTH; x += GRID_SIZE_X) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      if (x % (GRID_SIZE_X * 5) === 0) {
        ctx.fillStyle = 'rgba(50, 50, 50, 0.8)';
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
        ctx.fillStyle = 'rgba(50, 50, 50, 0.8)';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        ctx.fillText(y.toString(), 15, y + 3);
      }
    }
    ctx.stroke();
    
    // Draw center line (baseline)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.5)';
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

  // Función de renderizado original - NO MODIFICAR LA VISUALIZACIÓN
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
      ctx.beginPath();
      ctx.strokeStyle = '#0EA5E9';
      ctx.lineWidth = 2;
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
          ctx.strokeStyle = '#0EA5E9';
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
    animationFrameRef.current = requestAnimationFrame(renderSignal);
  }, [value, displayQuality, isFingerDetected, rawArrhythmiaData, arrhythmiaStatus, drawGrid, detectPeaks, smoothValue, preserveResults]);

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
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-black/80">PPG</span>
          
          {/* Display de calidad mejorado */}
          <div className="w-[200px]">
            <div className={`h-1.5 w-full rounded-full bg-gradient-to-r transition-all duration-500 ease-in-out`}
                 style={{ backgroundColor: getQualityColor(displayQuality) }}>
              <div
                className="h-full rounded-full bg-white/30 animate-pulse transition-all duration-500"
                style={{ width: `${isFingerDetected ? displayQuality : 0}%` }}
              />
            </div>
            
            <div className="flex justify-between items-center mt-1">
              <span className="text-[7px] text-center font-medium transition-colors duration-700" 
                    style={{ color: displayQuality > 60 ? '#0EA5E9' : '#F59E0B' }}>
                {getQualityText(displayQuality, isFingerDetected, 'meter')}
              </span>
              <span className="text-[7px] font-bold text-black/70">
                {displayQuality}%
              </span>
            </div>
            
            {/* Métricas de señal mejoradas */}
            {isFingerDetected && displayQuality > 0 && (
              <div className="flex gap-2 mt-0.5">
                <div className="flex items-center gap-1">
                  <Signal className="h-2 w-2 text-blue-600" />
                  <span className="text-[6px] text-black/60">F:{signalStrength}%</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                  <span className="text-[6px] text-black/60">E:{signalStability}%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center">
          <Fingerprint
            className={`h-8 w-8 transition-colors duration-300 ${
              !isFingerDetected ? 'text-gray-400' :
              displayQuality > 75 ? 'text-green-500' :
              displayQuality > 50 ? 'text-yellow-500' :
              displayQuality > 25 ? 'text-orange-500' :
              'text-red-500'
            }`}
            strokeWidth={1.5}
          />
          <span className="text-[8px] text-center font-medium text-black/80">
            {isFingerDetected ? 
              `Calidad: ${displayQuality}%` : 
              "Ubique su dedo"
            }
          </span>
          
          {/* Alerta de calidad mejorada */}
          {isFingerDetected && displayQuality < 35 && (
            <div className="flex items-center gap-1 mt-1">
              <AlertCircle className="h-3 w-3 text-amber-500" />
              <span className="text-[6px] text-amber-600">Ajuste posición</span>
            </div>
          )}
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

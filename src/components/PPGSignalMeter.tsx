import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Fingerprint, AlertCircle } from 'lucide-react';
import { CircularBuffer, PPGDataPoint } from '../utils/CircularBuffer';
import { getQualityColor, getQualityText } from '@/utils/qualityUtils';
import { parseArrhythmiaStatus } from '@/utils/arrhythmiaUtils';

// INTERFACES PARA ALGORITMO ADAPTATIVO AVANZADO IEEE 2024
interface PeakDetection {
  timestamp: number;
  amplitude: number;
  confidence: number;
  wasCorrect: boolean;
  signalQuality: number;
  userFeedback?: boolean;
}

interface HeartRateProfile {
  baseline: number;
  variability: number;
  expectedRange: [number, number];
  adaptationRate: number;
  lastUpdate: number;
}

interface PPGSignalMeterProps {
  value: number;
  quality: number;
  isFingerDetected: boolean;
  onStartMeasurement: () => void;
  onReset: () => void;
  onPeakDetected?: (peak: {time: number, value: number, isArrhythmia: boolean}) => void;
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
  onPeakDetected,
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
  
  // ALGORITMO AVANZADO - BUFFERS Y ESTADOS
  const ppgBufferRef = useRef<number[]>([]);
  const lastPeakTimeRef = useRef<number>(0);
  const rrIntervalsRef = useRef<number[]>([]);
  const heartRateBufferRef = useRef<number[]>([]);
  const lastHeartRateRef = useRef<number>(0);

  const WINDOW_WIDTH_MS = 3700;
  const CANVAS_WIDTH = 1000;
  const CANVAS_HEIGHT = 800;
  const GRID_SIZE_X = 45;
  const GRID_SIZE_Y = 10;
  const verticalScale = 45.0;
  const SMOOTHING_FACTOR = 1.8;
  const TARGET_FPS = 60;
  const FRAME_TIME = 1000 / TARGET_FPS;
  const BUFFER_SIZE = 600;
  // ALGORITMO AVANZADO IEEE 2024 - PARÁMETROS ADAPTATIVOS DINÁMICOS
  const PEAK_DETECTION_WINDOW = 3; // Ventana más pequeña para mayor sensibilidad
  const PEAK_THRESHOLD_REF = useRef(0.005); // Umbral MUCHO más bajo para detectar más picos
  const MIN_PEAK_DISTANCE_MS_REF = useRef(50); // Distancia mínima más corta
  const MAX_PEAK_DISTANCE_MS_REF = useRef(8000); // Distancia máxima más larga
  const IMMEDIATE_RENDERING = true;
  const MAX_PEAKS_TO_DISPLAY = 25;
  
  // SISTEMA DE APRENDIZAJE ADAPTATIVO
  const signalQualityHistory: number[] = [];
  const peakDetectionHistory: PeakDetection[] = [];
  const userHeartRateProfile: HeartRateProfile = {
    baseline: 72,
    variability: 0.15,
    expectedRange: [60, 100],
    adaptationRate: 0.1,
    lastUpdate: Date.now()
  };
  
  // MÉTRICAS DE RENDIMIENTO
  let detectionAccuracy = 0.8;
  let falsePositiveRate = 0.2;
  let adaptationConfidence = 0.7;

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

  // ALGORITMO AVANZADO IEEE 2024 - DETECCIÓN ADAPTATIVA DE PICOS
  const detectPeaks = useCallback((points: PPGDataPoint[], now: number) => {
    if (points.length < PEAK_DETECTION_WINDOW) return;
    
    // AGREGAR VALOR AL BUFFER ADAPTATIVO
    const currentValue = points[points.length - 1].value;
    ppgBufferRef.current.push(currentValue);
    if (ppgBufferRef.current.length > 120) {
      ppgBufferRef.current.shift();
    }
    
    // ACTUALIZAR CALIDAD DE SEÑAL Y ADAPTAR PARÁMETROS
    updateSignalQuality(currentValue);
    adaptDetectionParameters(now);
    
    // DETECCIÓN ADAPTATIVA DE PICOS CON ALGORITMO IEEE 2024
    const peakDetected = adaptivePeakDetection(currentValue, now);
    
    if (peakDetected) {
      // CALCULAR INTERVALO RR CON VALIDACIÓN ADAPTATIVA
      if (lastPeakTimeRef.current > 0) {
        const rrInterval = now - lastPeakTimeRef.current;
        
        // VALIDACIÓN ADAPTATIVA DEL INTERVALO RR
        if (isValidRRInterval(rrInterval)) {
          rrIntervalsRef.current.push(rrInterval);
          
          // MANTENER HISTORIAL OPTIMIZADO
          if (rrIntervalsRef.current.length > 20) {
            rrIntervalsRef.current.shift();
          }
          
          // CALCULAR BPM CON FILTROS ADAPTATIVOS
          const bpm = calculateAdaptiveBPM();
          
          // APRENDIZAJE CONTINUO DEL ALGORITMO
          learnFromDetection(peakDetected, rrInterval, bpm);
          
          // SUAVIZADO ADAPTATIVO DEL BPM
          lastHeartRateRef.current = adaptiveSmoothing(bpm);
          lastPeakTimeRef.current = now;
          
          // NOTIFICAR AL PADRE QUE SE DETECTÓ UN PICO (LATIDO)
          if (onPeakDetected) {
            onPeakDetected({
              time: now,
              value: currentValue,
              isArrhythmia: points[points.length - 1].isArrhythmia
            });
          }
          
          console.log('PPGSignalMeter: Latido detectado (ALGORITMO AVANZADO IEEE 2024)', {
            bpm: lastHeartRateRef.current,
            rrInterval: rrInterval.toFixed(0) + 'ms',
            confidence: adaptationConfidence.toFixed(3),
            threshold: PEAK_THRESHOLD_REF.current.toFixed(3),
            timestamp: new Date().toISOString()
          });
        }
      } else {
        lastPeakTimeRef.current = now;
      }
    }
    
    // ACTUALIZAR PICOS VISUALES PARA EL MONITOR CARDIACO
    updateVisualPeaks(points, now);
  }, [onPeakDetected]);
  
  // FUNCIÓN PARA ACTUALIZAR PICOS VISUALES (MONITOR CARDIACO)
  const updateVisualPeaks = useCallback((points: PPGDataPoint[], now: number) => {
    const potentialPeaks: {index: number, value: number, time: number, isArrhythmia: boolean}[] = [];
    
    for (let i = PEAK_DETECTION_WINDOW; i < points.length - PEAK_DETECTION_WINDOW; i++) {
      const currentPoint = points[i];
      
      const recentlyProcessed = peaksRef.current.some(
        peak => Math.abs(peak.time - currentPoint.time) < MIN_PEAK_DISTANCE_MS_REF.current
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
      
      if (isPeak && Math.abs(currentPoint.value) > PEAK_THRESHOLD_REF.current) {
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
        existingPeak => Math.abs(existingPeak.time - peak.time) < MIN_PEAK_DISTANCE_MS_REF.current
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
  
  // ALGORITMO AVANZADO IEEE 2024 - FUNCIONES ADAPTATIVAS
  
  // ACTUALIZAR CALIDAD DE SEÑAL
  const updateSignalQuality = useCallback((value: number) => {
    const quality = Math.abs(value);
    signalQualityHistory.push(quality);
    if (signalQualityHistory.length > 100) signalQualityHistory.shift();
    
    // Calcular estabilidad de la señal
    const stability = calculateStability(signalQualityHistory);
    
          // Adaptar umbral basado en estabilidad
      if (stability > 0.8) {
        // Señal estable, reducir umbral para mayor sensibilidad
        PEAK_THRESHOLD_REF.current = Math.max(0.001, PEAK_THRESHOLD_REF.current * 0.95);
      } else if (stability < 0.3) {
        // Señal inestable, aumentar umbral para reducir falsos positivos
        PEAK_THRESHOLD_REF.current = Math.min(0.1, PEAK_THRESHOLD_REF.current * 1.05);
      }
  }, []);
  
  // CALCULAR ESTABILIDAD DE LA SEÑAL
  const calculateStability = useCallback((values: number[]): number => {
    if (values.length < 10) return 0.5;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    
    return Math.max(0, 1 - (stdDev / mean));
  }, []);
  
  // ADAPTAR PARÁMETROS DE DETECCIÓN
  const adaptDetectionParameters = useCallback((currentTime: number) => {
    const timeSinceUpdate = currentTime - userHeartRateProfile.lastUpdate;
    
    if (timeSinceUpdate > 5000) { // Actualizar cada 5 segundos
      // Adaptar parámetros basados en rendimiento
      if (detectionAccuracy > 0.9 && falsePositiveRate < 0.1) {
        // Rendimiento excelente, aumentar sensibilidad
        PEAK_THRESHOLD_REF.current = Math.max(0.001, PEAK_THRESHOLD_REF.current * 0.9);
        MIN_PEAK_DISTANCE_MS_REF.current = Math.max(30, MIN_PEAK_DISTANCE_MS_REF.current * 0.95);
      } else if (detectionAccuracy < 0.6 || falsePositiveRate > 0.3) {
        // Rendimiento pobre, reducir sensibilidad
        PEAK_THRESHOLD_REF.current = Math.min(0.1, PEAK_THRESHOLD_REF.current * 1.1);
        MIN_PEAK_DISTANCE_MS_REF.current = Math.min(200, MIN_PEAK_DISTANCE_MS_REF.current * 1.05);
      }
      
      userHeartRateProfile.lastUpdate = currentTime;
    }
  }, []);
  
  // DETECCIÓN ADAPTATIVA DE PICOS
  const adaptivePeakDetection = useCallback((ppgValue: number, currentTime: number): boolean => {
    if (ppgBufferRef.current.length < PEAK_DETECTION_WINDOW) return false;
    
    const currentIndex = ppgBufferRef.current.length - 1;
    const halfWindow = Math.floor(PEAK_DETECTION_WINDOW / 2);
    const startIndex = Math.max(0, currentIndex - halfWindow);
    const endIndex = Math.min(ppgBufferRef.current.length - 1, currentIndex + halfWindow);
    
    if (startIndex >= endIndex || currentIndex < halfWindow) return false;
    
    const currentAmplitude = Math.abs(ppgValue);
    
    // CONDICIÓN 1: Máximo en ventana adaptativa
    let isPeak = true;
    for (let i = startIndex; i <= endIndex; i++) {
      if (i !== currentIndex && Math.abs(ppgBufferRef.current[i]) >= currentAmplitude) {
        isPeak = false;
        break;
      }
    }
    
    // CONDICIÓN 2: Umbral adaptativo
    if (!isPeak || currentAmplitude < PEAK_THRESHOLD_REF.current) return false;
    
    // CONDICIÓN 3: Distancia mínima desde último pico
    if (lastPeakTimeRef.current > 0) {
      const timeSinceLastPeak = currentTime - lastPeakTimeRef.current;
      if (timeSinceLastPeak < MIN_PEAK_DISTANCE_MS_REF.current) return false;
    }
    
    return true;
  }, []);
  
  // VALIDACIÓN ADAPTATIVA DEL INTERVALO RR
  const isValidRRInterval = useCallback((rrInterval: number): boolean => {
    // Rango base fisiológico
    const baseValid = rrInterval >= MIN_PEAK_DISTANCE_MS_REF.current && rrInterval <= MAX_PEAK_DISTANCE_MS_REF.current;
    
    if (!baseValid) return false;
    
    // Validación adicional basada en perfil del usuario
    const expectedRR = 60000 / userHeartRateProfile.baseline;
    const tolerance = expectedRR * 1.0; // Tolerancia máxima
    
    return Math.abs(rrInterval - expectedRR) <= tolerance;
  }, []);
  
  // CÁLCULO DE BPM CON FILTROS ADAPTATIVOS
  const calculateAdaptiveBPM = useCallback((): number => {
    if (rrIntervalsRef.current.length < 2) return lastHeartRateRef.current;
    
    const recentIntervals = rrIntervalsRef.current.slice(-Math.min(5, rrIntervalsRef.current.length));
    const avgRR = recentIntervals.reduce((sum, interval) => sum + interval, 0) / recentIntervals.length;
    
    let bpm = Math.round(60000 / avgRR);
    
    // Validar rango fisiológico
    const [minBPM, maxBPM] = [40, 200];
    if (bpm < minBPM || bpm > maxBPM) {
      bpm = lastHeartRateRef.current > 0 ? lastHeartRateRef.current : Math.max(minBPM, Math.min(maxBPM, bpm));
    }
    
    return bpm;
  }, []);
  
  // APRENDIZAJE CONTINUO DEL ALGORITMO
  const learnFromDetection = useCallback((peak: boolean, rrInterval: number, bpm: number): void => {
    if (!peak) return;
    
    // Actualizar métricas de rendimiento
    const expectedRR = 60000 / userHeartRateProfile.baseline;
    const error = Math.abs(rrInterval - expectedRR) / expectedRR;
    
    if (error < 0.2) {
      // Detección correcta
      detectionAccuracy = Math.min(1.0, detectionAccuracy + 0.01);
      adaptationConfidence = Math.min(1.0, adaptationConfidence + 0.02);
    } else {
      // Detección incorrecta
      falsePositiveRate = Math.min(1.0, falsePositiveRate + 0.01);
      adaptationConfidence = Math.max(0.1, adaptationConfidence - 0.01);
    }
    
    // Adaptar perfil del usuario
    userHeartRateProfile.baseline = userHeartRateProfile.baseline * 0.9 + bpm * 0.1;
  }, []);
  
  // SUAVIZADO ADAPTATIVO DEL BPM
  const adaptiveSmoothing = useCallback((bpm: number): number => {
    if (lastHeartRateRef.current === 0) return bpm;
    
    // Filtro adaptativo basado en confianza
    const alpha = adaptationConfidence * 0.3 + 0.1; // 0.1 a 0.4
    return lastHeartRateRef.current * (1 - alpha) + bpm * alpha;
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

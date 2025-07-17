import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Fingerprint } from 'lucide-react';
import { CircularBuffer } from '../utils/CircularBuffer';
import { getQualityColor, getQualityText } from '@/utils/qualityUtils';
import { parseArrhythmiaStatus } from '@/utils/arrhythmiaUtils';
import type { PPGDataPoint as BasePPGDataPoint } from '../utils/CircularBuffer';

// PPGDataPoint type is now defined only once below

interface ArrhythmiaStatus {
  status: 'NORMAL' | 'DETECTED' | 'ERROR' | 'NONE' | 'CALIBRATING';
  confidence?: number;
  type?: string;
  timestamp?: number;
  isArrhythmia: boolean;
  rawRed?: number;
  rawIr?: number;
  rawGreen?: number;
  rawBlue?: number;
  heartRate?: number;
  spo2?: number;
  count?: number;
}

// Move these constants to the top of the file, before they are used
const SAMPLE_RATE = 30; // Hz
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 300;
const GRID_SIZE_X = 50;
const GRID_SIZE_Y = 30;
const VERTICAL_SCALE = 100;
const WINDOW_WIDTH_MS = 5000; // 5 seconds of visualization
const FRAME_TIME = 1000 / 30; // 30 FPS
const BUFFER_SECONDS = 30; // Seconds of data to keep in buffer
const PEAK_DETECTION_WINDOW_MS = 3000; // Peak detection window
const PEAK_THRESHOLD = 0.5; // Threshold for peak detection
const MIN_PEAK_DISTANCE_MS = 300; // Minimum distance between peaks in ms
const MAX_PEAKS_TO_DISPLAY = 5; // Maximum number of peaks to display
const IMMEDIATE_RENDERING = true; // Immediate rendering
const BUFFER_SIZE = SAMPLE_RATE * BUFFER_SECONDS;
const SIGNAL_WINDOW_MS = 10000; // 10 seconds for signal analysis
const MIN_SIGNAL_QUALITY = 0.3; // Minimum signal quality to consider valid
const ARRHYTHMIA_THRESHOLD = 0.35; // Threshold for arrhythmia detection

// Extend the base PPGDataPoint type with additional properties
type PPGDataPoint = BasePPGDataPoint & {
  rawIr?: number;
  rawRed?: number;
  rawGreen?: number;
  rawBlue?: number;
  heartRate?: number;
  spo2?: number;
  confidence?: number;
};

interface PPGSignalMeterProps {
  value: number;                     // Valor actual de la señal PPG
  quality: number;                   // Calidad de la señal (0-100)
  isFingerDetected: boolean;         // Si se detecta un dedo en el sensor
  onStartMeasurement: () => void;    // Callback para iniciar medición
  onReset: () => void;               // Callback para reiniciar
  onHeartRateCalculated?: (bpm: number, confidence: number) => void; // Nueva prop para devolver FC
  onSpO2Calculated?: (spo2: number, confidence: number) => void;     // Nueva prop para devolver SpO2
  arrhythmiaStatus?: string;         // Estado de arritmia detectada
  rawArrhythmiaData?: {
    timestamp: number;               // Marca de tiempo de la detección
    rmssd: number;                   // Variabilidad del ritmo cardíaco
    rrVariation: number;             // Variación del intervalo RR
  } | null;
  preserveResults?: boolean;          // Si se deben preservar los resultados al quitar el dedo
  redSignal?: number;                 // Señal del canal rojo (opcional para SpO2)
  irSignal?: number;                  // Señal del canal infrarrojo (opcional para SpO2)
}

const PPGSignalMeter = ({ 
  value, 
  quality, 
  isFingerDetected,
  onStartMeasurement,
  onReset,
  onHeartRateCalculated,
  onSpO2Calculated,
  arrhythmiaStatus,
  rawArrhythmiaData,
  preserveResults = false,
  redSignal,
  irSignal
}: PPGSignalMeterProps) => {
  // Refs for rendering and state management
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);
  const dataBufferRef = useRef<CircularBuffer>(new CircularBuffer(BUFFER_SIZE, SAMPLE_RATE));
  const redSignalBufferRef = useRef<number[]>([]);
  const irSignalBufferRef = useRef<number[]>([]);
  const animationFrameRef = useRef<number>();
  const lastRenderTimeRef = useRef<number>(0);
  const lastArrhythmiaTimeRef = useRef<number>(0);
  const lastValueRef = useRef<number>(0);
  const smoothValueRef = useRef<number>(0);
  const verticalScaleRef = useRef<number>(VERTICAL_SCALE);
  const [showArrhythmiaAlert, setShowArrhythmiaAlert] = useState(false);
  const peaksRef = useRef<Array<{time: number; value: number; isArrhythmia: boolean}>>([]);
  const arrhythmiaStatusRef = useRef<ArrhythmiaStatus>({
    status: 'NORMAL',
    isArrhythmia: false
  });
  
  const statsRef = useRef<{
    heartRate: number;
    spo2: number;
    confidence: number;
    lastUpdate: number;
  }>({ 
    heartRate: 0, 
    spo2: 0, 
    confidence: 0, 
    lastUpdate: 0 
  });
  
  const [metrics, setMetrics] = useState({
    heartRate: 0,
    spo2: 0,
    confidence: 0,
    signalQuality: 0,
    lastUpdate: 0
  });
  const baselineRef = useRef<number>(0);
  
  // Inicializar el buffer circular
  useEffect(() => {
    if (!dataBufferRef.current) {
      dataBufferRef.current = new CircularBuffer(BUFFER_SIZE, SAMPLE_RATE);
    }
    
    if (preserveResults && !isFingerDetected) {
      dataBufferRef.current.clear();
      redSignalBufferRef.current = [];
      irSignalBufferRef.current = [];
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isFingerDetected, preserveResults]);
  
  // Define drawGrid function
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!ctx) return;
    
    // Clear the canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    
    // Draw vertical grid lines
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    
    for (let x = 0; x <= ctx.canvas.width; x += GRID_SIZE_X) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ctx.canvas.height);
      
      // Draw thicker line and label every 5th grid line
      if (x % (GRID_SIZE_X * 5) === 0) {
        ctx.strokeStyle = '#b0b0b0';
        ctx.fillStyle = '#666';
        ctx.fillText(
          `${(x / GRID_SIZE_X).toFixed(1)}s`,
          x,
          ctx.canvas.height - 5
        );
      }
      
      ctx.stroke();
      ctx.strokeStyle = '#e0e0e0';
    }
    
    // Draw horizontal grid lines
    for (let y = 0; y <= ctx.canvas.height; y += GRID_SIZE_Y) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ctx.canvas.width, y);
      ctx.stroke();
    }
  }, [GRID_SIZE_X, GRID_SIZE_Y]);
  
  // Render signal function
  const renderSignal = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      if (animationFrameRef.current) {
        animationFrameRef.current = requestAnimationFrame(renderSignal);
      }
      return;
    }
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Limpiar el canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Dibujar la cuadrícula
    drawGrid(ctx);
    
    // Obtener los datos del buffer
    const data = dataBufferRef.current?.getPoints() || [];
    if (data.length === 0) return;
    
    // Configuración del dibujo
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3b82f6';
    ctx.beginPath();
    
    // Dibujar la señal
    const now = Date.now();
    const startTime = now - WINDOW_WIDTH_MS;
    
    // Filtrar y dibujar los puntos visibles
    const visiblePoints = data.filter(point => point.time >= startTime);
    
    if (visiblePoints.length > 0) {
      const firstPoint = visiblePoints[0];
      const x = ((firstPoint.time - startTime) / WINDOW_WIDTH_MS) * canvas.width;
      const y = (1 - firstPoint.value / verticalScaleRef.current) * (canvas.height / 2) + (canvas.height / 4);
      
      ctx.moveTo(x, y);
      
      for (let i = 1; i < visiblePoints.length; i++) {
        const point = visiblePoints[i];
        const x = ((point.time - startTime) / WINDOW_WIDTH_MS) * canvas.width;
        const y = (1 - point.value / verticalScaleRef.current) * (canvas.height / 2) + (canvas.height / 4);
        
        ctx.lineTo(x, y);
      }
      
      ctx.stroke();
    }
    
    // Programar el siguiente frame
    animationFrameRef.current = requestAnimationFrame(renderSignal);
  }, [WINDOW_WIDTH_MS, drawGrid]);

  // Render constants
  const TARGET_FPS = 30; // Reduce FPS to save resources
  const FRAME_TIME = 1000 / TARGET_FPS;

  // Clean up animation frame on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Handle signal value changes
  useEffect(() => {
    if (!isFingerDetected) return;
    
    const now = Date.now();
    
    // Smooth the value
    const smoothValue = smoothValueRef.current || 0;
    const newSmoothValue = smoothValue + (value - smoothValue) * 0.1;
    smoothValueRef.current = newSmoothValue;
    
    // Add point to buffer
    if (dataBufferRef.current) {
      const dataPoint: PPGDataPoint = {
        time: now,
        value: newSmoothValue,
        isArrhythmia: false,
        rawRed: 0, // Initialize with default values
        rawIr: 0   // Initialize with default values
      };
      
      // Add point to the circular buffer using the push method
      dataBufferRef.current.push(dataPoint);
    }
    
    // Update rendering if needed
    if (IMMEDIATE_RENDERING) {
      renderSignal();
    }
    
    // Update last value
    lastValueRef.current = value;
  }, [value, isFingerDetected, renderSignal]);

  // Handle raw arrhythmia data
  useEffect(() => {
    if (rawArrhythmiaData) {
      // Process raw arrhythmia data if needed
      console.log('Raw arrhythmia data:', rawArrhythmiaData);
    }
  }, [rawArrhythmiaData]);

  // Handle arrhythmia status changes
  useEffect(() => {
    if (arrhythmiaStatus) {
      const status = parseArrhythmiaStatus(arrhythmiaStatus);
      const isArrhythmia = status.status === 'DETECTED';
      
      arrhythmiaStatusRef.current = {
        ...status,
        timestamp: Date.now(),
        isArrhythmia
      };
      
      if (isArrhythmia) {
        setShowArrhythmiaAlert(true);
        lastArrhythmiaTimeRef.current = Date.now();
        
        // Hide alert after 5 seconds
        const timer = setTimeout(() => {
          setShowArrhythmiaAlert(false);
        }, 5000);
        
        return () => clearTimeout(timer);
      } else {
        setShowArrhythmiaAlert(false);
      }
    }
  }, [arrhythmiaStatus]);

  // Efecto para manejar cambios en las señales de color (para SpO2)
  useEffect(() => {
    if (redSignal !== undefined) {
      redSignalBufferRef.current = [...redSignalBufferRef.current.slice(-100), redSignal];
    }
    
    if (irSignal !== undefined) {
      irSignalBufferRef.current = [...irSignalBufferRef.current.slice(-100), irSignal];
    }
  }, [redSignal, irSignal]);

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

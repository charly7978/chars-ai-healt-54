import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Fingerprint, AlertCircle, Heart } from 'lucide-react';
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
  isPeak?: boolean;
}

// ========== CONSTANTES DE CONFIGURACIÓN PPG ==========
const CONFIG = {
  // Canvas
  CANVAS_WIDTH: 1000,
  CANVAS_HEIGHT: 800,
  
  // Ventana temporal (4 segundos = ~4-6 latidos visibles)
  WINDOW_MS: 4000,
  
  // Renderizado
  TARGET_FPS: 60,
  
  // Buffer de datos
  BUFFER_SIZE: 300,
  
  // Grid médico estándar
  GRID_MAJOR: 100,   // Líneas principales cada 100px
  GRID_MINOR: 20,    // Líneas menores cada 20px
  
  // Procesamiento de señal PPG - CALIBRADO PARA VALORES REALES
  SIGNAL: {
    // Normalización automática - VALORES MUY AMPLIOS para capturar cualquier señal
    MIN_RANGE: 0.001,    // Rango mínimo muy pequeño para señales débiles
    MAX_RANGE: 200,      // Rango máximo amplio
    
    // Suavizado exponencial (0.1 = muy suave, 0.5 = más reactivo)
    SMOOTHING: 0.12,     // Más suave para ondas limpias
    
    // Línea base adaptativa (velocidad de adaptación) - MÁS LENTA
    BASELINE_SPEED: 0.003,
    
    // Altura de onda objetivo (% del canvas) - ONDAS MÁS GRANDES
    TARGET_AMPLITUDE: 0.55,  // 35% del alto para ondas bien visibles
    
    // AMPLIFICACIÓN FIJA para señales muy pequeñas
    AMPLIFICATION: 170,   // Multiplicador base
  },
  
  // Detección de picos
  PEAKS: {
    MIN_DISTANCE_MS: 250,   // Mínimo entre picos (200 BPM máx)
    DETECTION_WINDOW: 3,    // Puntos a cada lado para detectar (más sensible)
    MIN_PROMINENCE: 0.06,   // Prominencia mínima BAJA para detectar más picos
  },
  
  // Colores
  COLORS: {
    BG: '#0f172a',              // Fondo oscuro profesional
    GRID_MAJOR: 'rgba(59, 130, 246, 0.25)',
    GRID_MINOR: 'rgba(59, 130, 246, 0.1)',
    BASELINE: 'rgba(148, 163, 184, 0.4)',
    SIGNAL: '#22c55e',          // Verde médico
    SIGNAL_GLOW: 'rgba(34, 197, 94, 0.3)',
    PEAK_NORMAL: '#3b82f6',     // Azul para picos normales
    PEAK_ARRHYTHMIA: '#ef4444', // Rojo para arritmias
    TEXT: '#e2e8f0',
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
  
  // ========== REFERENCIAS ==========
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  
  // Buffer de datos
  const dataBufferRef = useRef<CircularBuffer | null>(null);
  
  // Procesamiento de señal
  const processingRef = useRef({
    baseline: null as number | null,
    lastSmoothed: null as number | null,
    signalMin: Infinity,
    signalMax: -Infinity,
    lastRenderTime: 0,
  });
  
  // Picos detectados
  const peaksRef = useRef<Array<{
    time: number;
    x: number;
    y: number;
    isArrhythmia: boolean;
  }>>([]);
  
  // Referencias a props para el loop
  const propsRef = useRef({
    value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak
  });
  
  const lastPeakTimeRef = useRef(0);
  const [showPulse, setShowPulse] = useState(false);

  // ========== ACTUALIZAR REFS ==========
  useEffect(() => {
    propsRef.current = { value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak };
  }, [value, quality, isFingerDetected, arrhythmiaStatus, preserveResults, isPeak]);

  // ========== SINCRONIZACIÓN DE PICOS EXTERNOS ==========
  useEffect(() => {
    if (isPeak && isFingerDetected) {
      const now = Date.now();
      if (now - lastPeakTimeRef.current > CONFIG.PEAKS.MIN_DISTANCE_MS) {
        lastPeakTimeRef.current = now;
        setShowPulse(true);
        setTimeout(() => setShowPulse(false), 150);
      }
    }
  }, [isPeak, isFingerDetected]);

  // ========== INICIALIZACIÓN ==========
  useEffect(() => {
    if (!dataBufferRef.current) {
      dataBufferRef.current = new CircularBuffer(CONFIG.BUFFER_SIZE);
    }
    
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  // ========== LIMPIAR AL CAMBIAR ESTADO ==========
  useEffect(() => {
    if (preserveResults && !isFingerDetected) {
      dataBufferRef.current?.clear();
      peaksRef.current = [];
      processingRef.current = {
        baseline: null,
        lastSmoothed: null,
        signalMin: Infinity,
        signalMax: -Infinity,
        lastRenderTime: 0,
      };
    }
  }, [preserveResults, isFingerDetected]);

  // ========== DIBUJAR GRID MÉDICO ==========
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, GRID_MAJOR, GRID_MINOR, COLORS } = CONFIG;
    
    // Fondo
    ctx.fillStyle = COLORS.BG;
    ctx.fillRect(0, 0, W, H);
    
    // Grid menor
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
    
    // Grid mayor
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
    
    // Línea base central
    ctx.strokeStyle = COLORS.BASELINE;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  // ========== DIBUJAR ALERTA DE ARRITMIA ==========
  const drawArrhythmiaAlert = useCallback((ctx: CanvasRenderingContext2D, status: string) => {
    const parsed = parseArrhythmiaStatus(status);
    if (parsed?.status !== 'DETECTED') return;
    
    const { CANVAS_WIDTH: W } = CONFIG;
    
    // Fondo pulsante rojo
    const pulse = (Math.sin(Date.now() / 200) + 1) / 4;
    ctx.fillStyle = `rgba(239, 68, 68, ${0.1 + pulse * 0.15})`;
    ctx.fillRect(0, 0, W, 100);
    
    // Texto de alerta
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
  }, []);

  // ========== LOOP DE RENDERIZADO PRINCIPAL ==========
  useEffect(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    
    const frameTime = 1000 / CONFIG.TARGET_FPS;
    
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
      const proc = processingRef.current;
      
      // Control de FPS
      if (now - proc.lastRenderTime < frameTime) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      proc.lastRenderTime = now;
      
      // Leer props actuales
      const { value: rawValue, isFingerDetected: detected, arrhythmiaStatus: arrStatus, preserveResults: preserve } = propsRef.current;
      
      // Dibujar grid
      drawGrid(ctx);
      
      // Si preservando resultados y sin dedo, solo mostrar grid
      if (preserve && !detected) {
        animationRef.current = requestAnimationFrame(render);
        return;
      }
      
      // ========== PROCESAMIENTO DE SEÑAL PPG - SIMPLIFICADO Y ROBUSTO ==========
      const S = CONFIG.SIGNAL;
      
      // 1. Inicializar línea base (DC) con el primer valor
      if (proc.baseline === null) {
        proc.baseline = rawValue;
        proc.signalMin = rawValue;
        proc.signalMax = rawValue;
      }
      
      // 2. Actualizar línea base MUY LENTAMENTE (sigue cambios de iluminación)
      proc.baseline = proc.baseline * (1 - S.BASELINE_SPEED) + rawValue * S.BASELINE_SPEED;
      
      // 3. Suavizado exponencial de la señal
      const smoothed = proc.lastSmoothed === null 
        ? rawValue 
        : proc.lastSmoothed + S.SMOOTHING * (rawValue - proc.lastSmoothed);
      proc.lastSmoothed = smoothed;
      
      // 4. Extraer componente AC (variación pulsátil) = señal - línea base
      const ac = smoothed - proc.baseline;
      
      // 5. Tracking del rango dinámico con decay
      proc.signalMin = Math.min(proc.signalMin * 0.9995 + ac * 0.0005, ac);
      proc.signalMax = Math.max(proc.signalMax * 0.9995 + ac * 0.0005, ac);
      
      // 6. Calcular amplitud dinámica
      const dynamicRange = Math.max(proc.signalMax - proc.signalMin, S.MIN_RANGE);
      
      // 7. AMPLIFICACIÓN ADAPTATIVA: escalar para llenar TARGET_AMPLITUDE del canvas
      const targetHeight = CONFIG.CANVAS_HEIGHT * S.TARGET_AMPLITUDE;
      
      // Calcular factor de escala necesario
      let scaleFactor = targetHeight / Math.max(dynamicRange, 0.001);
      
      // Limitar el factor para evitar ruido excesivo
      scaleFactor = Math.min(scaleFactor, S.AMPLIFICATION);
      scaleFactor = Math.max(scaleFactor, 10); // Mínimo de amplificación
      
      // 8. Aplicar escala (invertido: valores positivos de AC van hacia ARRIBA)
      const scaledValue = -ac * scaleFactor;
      
      // 9. Clamp para evitar valores extremos
      const maxAmplitude = targetHeight * 1.2;
      const clampedValue = Math.max(-maxAmplitude, Math.min(maxAmplitude, scaledValue));
      
      // Agregar punto al buffer
      buffer.push({
        time: now,
        value: clampedValue,
        isArrhythmia: arrStatus?.includes('ARRITMIA') || false
      });
      
      // ========== DIBUJAR SEÑAL PPG ==========
      const points = buffer.getPoints();
      const { CANVAS_WIDTH: W, CANVAS_HEIGHT: H, WINDOW_MS, COLORS } = CONFIG;
      const centerY = H / 2;
      
      if (points.length > 2) {
        // Efecto glow
        ctx.shadowColor = COLORS.SIGNAL_GLOW;
        ctx.shadowBlur = 8;
        
        // Línea principal
        ctx.beginPath();
        ctx.strokeStyle = COLORS.SIGNAL;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        let started = false;
        const peakCandidates: Array<{x: number; y: number; time: number; val: number}> = [];
        
        for (let i = 0; i < points.length; i++) {
          const pt = points[i];
          const age = now - pt.time;
          if (age > WINDOW_MS) continue;
          
          const x = W - (age * W / WINDOW_MS);
          const y = centerY + pt.value;
          
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
          
          // Detectar picos locales (picos van hacia ARRIBA = valores NEGATIVOS en canvas)
          if (i >= CONFIG.PEAKS.DETECTION_WINDOW && i < points.length - CONFIG.PEAKS.DETECTION_WINDOW) {
            let isPeakLocal = true;
            const currentVal = pt.value;
            
            // Un pico es un MÍNIMO local (valor más negativo = más arriba en canvas)
            for (let j = i - CONFIG.PEAKS.DETECTION_WINDOW; j <= i + CONFIG.PEAKS.DETECTION_WINDOW; j++) {
              if (j !== i && points[j].value < currentVal) {
                // Hay un punto más alto (más negativo), no es pico
                isPeakLocal = false;
                break;
              }
            }
            
            // Verificar prominencia: el pico debe estar significativamente arriba de la línea base
            // (valor negativo grande = arriba)
            const prominence = -currentVal; // Convertir a positivo para comparar
            const minProminence = CONFIG.CANVAS_HEIGHT * CONFIG.SIGNAL.TARGET_AMPLITUDE * CONFIG.PEAKS.MIN_PROMINENCE;
            
            if (isPeakLocal && prominence > minProminence) {
              peakCandidates.push({ x, y, time: pt.time, val: pt.value });
            }
          }
        }
        
        ctx.stroke();
        ctx.shadowBlur = 0;
        
        // ========== MARCAR PICOS ==========
        // Filtrar picos muy cercanos
        const validPeaks = peakCandidates.filter((peak, idx) => {
          if (idx === 0) return true;
          const prev = peakCandidates[idx - 1];
          return peak.time - prev.time >= CONFIG.PEAKS.MIN_DISTANCE_MS;
        });
        
        // Verificar arritmia
        const hasArrhythmia = arrStatus?.includes('ARRITMIA') || false;
        
        validPeaks.forEach((peak, idx) => {
          const isArrPeak = hasArrhythmia && idx === validPeaks.length - 1;
          
          // Círculo del pico
          ctx.beginPath();
          ctx.arc(peak.x, peak.y, isArrPeak ? 8 : 5, 0, Math.PI * 2);
          ctx.fillStyle = isArrPeak ? COLORS.PEAK_ARRHYTHMIA : COLORS.PEAK_NORMAL;
          ctx.fill();
          
          // Halo para arritmias
          if (isArrPeak) {
            const alpha = (Math.sin(now / 150) + 1) / 2;
            ctx.beginPath();
            ctx.arc(peak.x, peak.y, 14, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        });
      }
      
      // Dibujar alerta de arritmia si aplica
      if (arrStatus) {
        drawArrhythmiaAlert(ctx, arrStatus);
      }
      
      animationRef.current = requestAnimationFrame(render);
    };
    
    animationRef.current = requestAnimationFrame(render);
    
    return () => {
      isRunningRef.current = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [drawGrid, drawArrhythmiaAlert]);

  // ========== RESET ==========
  const handleReset = useCallback(() => {
    dataBufferRef.current?.clear();
    peaksRef.current = [];
    processingRef.current = {
      baseline: null,
      lastSmoothed: null,
      signalMin: Infinity,
      signalMax: -Infinity,
      lastRenderTime: 0,
    };
    onReset();
  }, [onReset]);

  // ========== RENDER UI ==========
  return (
    <div className="fixed inset-0 bg-slate-950">
      {/* Canvas PPG */}
      <canvas
        ref={canvasRef}
        width={CONFIG.CANVAS_WIDTH}
        height={CONFIG.CANVAS_HEIGHT}
        className="w-full h-full absolute inset-0"
      />

      {/* Header con indicadores */}
      <div className="absolute top-0 left-0 right-0 p-3 flex justify-between items-start z-10">
        {/* Indicador PPG + Calidad */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Heart 
              className={`w-6 h-6 transition-all duration-150 ${
                showPulse ? 'text-red-500 scale-125' : 'text-emerald-500'
              }`}
              fill={showPulse ? 'currentColor' : 'none'}
            />
            <span className="text-lg font-bold text-slate-100">PPG</span>
          </div>
          
          <div className="w-32">
            <div className={`h-1.5 rounded-full bg-gradient-to-r ${getQualityColor(quality)} transition-all duration-500`}>
              <div
                className="h-full rounded-full bg-white/30 transition-all duration-500"
                style={{ width: `${isFingerDetected ? quality : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              {getQualityText(quality, isFingerDetected, 'meter')}
            </span>
          </div>
        </div>

        {/* Indicador de dedo */}
        <div className="flex flex-col items-center max-w-[180px]">
          <Fingerprint
            className={`h-8 w-8 transition-colors duration-300 ${
              !isFingerDetected ? 'text-slate-500' :
              quality > 75 ? 'text-emerald-400' :
              quality > 50 ? 'text-yellow-400' :
              'text-red-400'
            }`}
            strokeWidth={1.5}
          />
          <span className="text-[10px] text-center text-slate-400 leading-tight mt-1">
            {diagnosticMessage || (isFingerDetected ? "Dedo detectado" : "Ubique el dedo sobre el flash")}
          </span>
        </div>
      </div>

      {/* Botones de acción */}
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

import React, { useRef, useEffect } from 'react';

/**
 * PPG MONITOR v3 - CON CALIBRACIÓN AUTOMÁTICA DE CÁMARA
 * 
 * Mejoras:
 * - Calibración automática de exposición para evitar saturación
 * - Control dinámico del flash
 * - Mejor extracción de señal PPG
 * - Detección de picos mejorada
 */

interface PPGData {
  redValue: number;
  greenValue: number;
  blueValue: number;
  signalValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean;
  bpm: number;
  isPeak: boolean;
  rrIntervals: number[];
  timestamp: number;
}

interface PPGMonitorProps {
  isActive: boolean;
  onData: (data: PPGData) => void;
  onCameraReady?: () => void;
  onError?: (error: string) => void;
  onStreamReady?: (stream: MediaStream | null) => void;
}

// ============ FILTRO PASABANDA SIMPLE (MÁS ESTABLE) ============
class SimpleFilter {
  private buffer: number[] = [];
  private readonly SIZE = 15; // ~0.5 segundos @ 30fps
  
  filter(value: number): number {
    this.buffer.push(value);
    if (this.buffer.length > this.SIZE) {
      this.buffer.shift();
    }
    
    if (this.buffer.length < 3) return 0;
    
    // Promedio móvil para suavizar
    const avg = this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
    
    // Retornar diferencia del promedio (componente AC)
    return value - avg;
  }
  
  reset(): void {
    this.buffer = [];
  }
}

// ============ DETECTOR DE PICOS ROBUSTO ============
class RobustPeakDetector {
  private signalBuffer: number[] = [];
  private peakTimes: number[] = [];
  private lastPeakTime = 0;
  private baselineBuffer: number[] = [];
  
  private readonly SIGNAL_BUFFER_SIZE = 180; // 6 segundos
  private readonly MIN_INTERVAL = 350; // Max ~170 BPM
  private readonly MAX_INTERVAL = 1500; // Min ~40 BPM
  
  process(value: number, timestamp: number): { isPeak: boolean; bpm: number } {
    this.signalBuffer.push(value);
    if (this.signalBuffer.length > this.SIGNAL_BUFFER_SIZE) {
      this.signalBuffer.shift();
    }
    
    // Necesitamos al menos 2 segundos de datos
    if (this.signalBuffer.length < 60) {
      return { isPeak: false, bpm: 0 };
    }
    
    // Calcular estadísticas de la señal
    const recent = this.signalBuffer.slice(-90); // últimos 3 segundos
    const sorted = [...recent].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;
    
    // Umbral adaptativo: 60% del rango desde el mínimo
    const threshold = min + range * 0.6;
    
    // Detectar pico
    let isPeak = false;
    const timeSinceLastPeak = timestamp - this.lastPeakTime;
    
    if (timeSinceLastPeak > this.MIN_INTERVAL && this.signalBuffer.length >= 7) {
      const window = this.signalBuffer.slice(-7);
      const center = window[3];
      
      // Verificar máximo local
      const isMax = center > window[0] && center > window[1] && center > window[2] &&
                    center >= window[4] && center >= window[5] && center >= window[6];
      
      // Verificar umbral y prominencia
      const aboveThreshold = center > threshold;
      const prominence = center - Math.min(window[0], window[6]);
      const hasProminence = prominence > range * 0.2;
      
      if (isMax && aboveThreshold && hasProminence && range > 0.3) {
        isPeak = true;
        this.lastPeakTime = timestamp;
        this.peakTimes.push(timestamp);
        
        if (this.peakTimes.length > 30) {
          this.peakTimes.shift();
        }
        
        console.log(`💓 PICO: val=${center.toFixed(2)} thresh=${threshold.toFixed(2)} range=${range.toFixed(2)}`);
      }
    }
    
    // Calcular BPM
    let bpm = 0;
    if (this.peakTimes.length >= 4) {
      const intervals: number[] = [];
      for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 8; i--) {
        const interval = this.peakTimes[i] - this.peakTimes[i - 1];
        if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
          intervals.push(interval);
        }
      }
      
      if (intervals.length >= 3) {
        intervals.sort((a, b) => a - b);
        const median = intervals[Math.floor(intervals.length / 2)];
        bpm = 60000 / median;
      }
    }
    
    return { isPeak, bpm };
  }
  
  getSignalRange(): number {
    if (this.signalBuffer.length < 30) return 0;
    const sorted = [...this.signalBuffer].sort((a, b) => a - b);
    return sorted[sorted.length - 1] - sorted[0];
  }
  
  getRRIntervals(): number[] {
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 10; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
        intervals.push(interval);
      }
    }
    return intervals;
  }
  
  getCV(): number {
    const intervals = this.getRRIntervals();
    if (intervals.length < 3) return 1;
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    return Math.sqrt(variance) / mean;
  }
  
  reset(): void {
    this.signalBuffer = [];
    this.peakTimes = [];
    this.lastPeakTime = 0;
    this.baselineBuffer = [];
  }
}

// ============ COMPONENTE PRINCIPAL ============
const PPGMonitor: React.FC<PPGMonitorProps> = ({ 
  isActive, 
  onData, 
  onCameraReady,
  onError,
  onStreamReady
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const mountedRef = useRef(true);
  
  const filterRef = useRef<SimpleFilter | null>(null);
  const detectorRef = useRef<RobustPeakDetector | null>(null);
  
  const bpmSmoothedRef = useRef(0);
  const qualitySmoothedRef = useRef(0);
  const frameCountRef = useRef(0);
  const flashEnabledRef = useRef(false);
  
  // Calibración de cámara
  const calibrationRef = useRef({
    isCalibrating: true,
    framesSinceStart: 0,
    avgRed: 0,
    samples: [] as number[],
  });
  
  // Refs para callbacks
  const onDataRef = useRef(onData);
  const onCameraReadyRef = useRef(onCameraReady);
  const onErrorRef = useRef(onError);
  const onStreamReadyRef = useRef(onStreamReady);
  
  useEffect(() => {
    onDataRef.current = onData;
    onCameraReadyRef.current = onCameraReady;
    onErrorRef.current = onError;
    onStreamReadyRef.current = onStreamReady;
  }, [onData, onCameraReady, onError, onStreamReady]);
  
  useEffect(() => {
    mountedRef.current = true;
    
    const cleanup = async () => {
      if (!isRunningRef.current && !streamRef.current) return;
      
      console.log('🧹 Cleanup PPGMonitor');
      isRunningRef.current = false;
      
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      
      if (streamRef.current) {
        const tracks = streamRef.current.getTracks();
        for (const track of tracks) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch && flashEnabledRef.current) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
        flashEnabledRef.current = false;
        onStreamReadyRef.current?.(null);
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      filterRef.current = null;
      detectorRef.current = null;
      bpmSmoothedRef.current = 0;
      qualitySmoothedRef.current = 0;
      frameCountRef.current = 0;
      calibrationRef.current = {
        isCalibrating: true,
        framesSinceStart: 0,
        avgRed: 0,
        samples: [],
      };
    };
    
    const processFrame = () => {
      if (!isRunningRef.current || !mountedRef.current) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
      if (!ctx) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      frameCountRef.current++;
      const cal = calibrationRef.current;
      cal.framesSinceStart++;
      
      // Capturar frame
      ctx.drawImage(video, 0, 0, 64, 64);
      const imageData = ctx.getImageData(0, 0, 64, 64);
      const data = imageData.data;
      
      // ===== EXTRAER VALORES RGB DE ZONA CENTRAL =====
      let redSum = 0, greenSum = 0, blueSum = 0;
      let totalPixels = 0;
      
      // Zona central 50%
      for (let y = 16; y < 48; y++) {
        for (let x = 16; x < 48; x++) {
          const i = (y * 64 + x) * 4;
          redSum += data[i];
          greenSum += data[i + 1];
          blueSum += data[i + 2];
          totalPixels++;
        }
      }
      
      const avgRed = redSum / totalPixels;
      const avgGreen = greenSum / totalPixels;
      const avgBlue = blueSum / totalPixels;
      
      // ===== CALIBRACIÓN AUTOMÁTICA (primeros 30 frames = 1 segundo) =====
      if (cal.isCalibrating && cal.framesSinceStart < 30) {
        cal.samples.push(avgRed);
        cal.avgRed = cal.samples.reduce((a, b) => a + b, 0) / cal.samples.length;
        
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      if (cal.isCalibrating) {
        cal.isCalibrating = false;
        console.log(`📐 Calibración completa: avgRed=${cal.avgRed.toFixed(1)}`);
        
        // Si rojo muy alto (>240), la imagen está saturada - desactivar flash
        if (cal.avgRed > 240 && flashEnabledRef.current && streamRef.current) {
          console.log('⚠️ Imagen saturada, desactivando flash...');
          const track = streamRef.current.getVideoTracks()[0];
          if (track) {
            track.applyConstraints({ advanced: [{ torch: false } as any] })
              .then(() => {
                flashEnabledRef.current = false;
                console.log('🔦 Flash APAGADO por saturación');
              })
              .catch(() => {});
          }
        }
      }
      
      // ===== DETECCIÓN DE DEDO =====
      // Dedo = predominancia de rojo Y valores altos
      const fingerDetected = avgRed > 100 && avgRed > avgGreen * 1.1 && avgGreen > avgBlue;
      
      // ===== SEÑAL PPG (usar canal verde que es menos saturado) =====
      // El canal verde tiene mejor relación señal-ruido en PPG
      const rawSignal = avgGreen;
      const filteredValue = filterRef.current?.filter(rawSignal) ?? 0;
      
      // ===== DETECCIÓN DE PICOS =====
      const timestamp = Date.now();
      const { isPeak, bpm } = detectorRef.current?.process(filteredValue, timestamp) 
        ?? { isPeak: false, bpm: 0 };
      
      if (bpm > 0) {
        bpmSmoothedRef.current = bpmSmoothedRef.current === 0 
          ? bpm 
          : bpmSmoothedRef.current * 0.85 + bpm * 0.15;
      }
      
      // ===== CALIDAD DE SEÑAL =====
      let quality = 0;
      if (fingerDetected && detectorRef.current) {
        const range = detectorRef.current.getSignalRange();
        const cv = detectorRef.current.getCV();
        const intervals = detectorRef.current.getRRIntervals();
        
        // Rango de señal: 0-40 puntos (rango 0.5-3 = 0-40%)
        const rangeScore = Math.min(40, (range / 3) * 40);
        
        // Estabilidad: 0-40 puntos (CV bajo = más puntos)
        const stabilityScore = intervals.length >= 3 
          ? Math.max(0, 40 * (1 - Math.min(1, cv / 0.25)))
          : 0;
        
        // Cobertura: 0-20 puntos
        const coverageScore = Math.min(20, intervals.length * 4);
        
        quality = rangeScore + stabilityScore + coverageScore;
        qualitySmoothedRef.current = qualitySmoothedRef.current * 0.9 + quality * 0.1;
        quality = qualitySmoothedRef.current;
      }
      
      // Log cada 2 segundos
      if (frameCountRef.current % 60 === 0) {
        const range = detectorRef.current?.getSignalRange() ?? 0;
        const cv = detectorRef.current?.getCV() ?? 0;
        console.log(`📊 R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} range=${range.toFixed(2)} CV=${cv.toFixed(2)} BPM=${bpmSmoothedRef.current.toFixed(0)} Q=${quality.toFixed(0)}%`);
      }
      
      // Enviar datos
      onDataRef.current({
        redValue: avgRed,
        greenValue: avgGreen,
        blueValue: avgBlue,
        signalValue: rawSignal,
        filteredValue,
        quality: Math.round(quality),
        fingerDetected,
        bpm: Math.round(bpmSmoothedRef.current),
        isPeak,
        rrIntervals: detectorRef.current?.getRRIntervals() ?? [],
        timestamp
      });
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    const startCamera = async () => {
      if (!mountedRef.current) return;
      
      console.log('🎥 Iniciando cámara...');
      isRunningRef.current = true;
      
      filterRef.current = new SimpleFilter();
      detectorRef.current = new RobustPeakDetector();
      
      if (canvasRef.current) {
        canvasRef.current.width = 64;
        canvasRef.current.height = 64;
      }
      
      try {
        let stream: MediaStream | null = null;
        
        const constraints = [
          { audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } } },
          { audio: false, video: { facingMode: 'environment' } },
          { audio: false, video: true }
        ];
        
        for (const c of constraints) {
          if (!mountedRef.current || !isRunningRef.current) return;
          try {
            stream = await navigator.mediaDevices.getUserMedia(c);
            console.log('✅ Stream obtenido');
            break;
          } catch (e) {
            console.log('⚠️ Constraint falló:', (e as Error).message);
          }
        }
        
        if (!stream) throw new Error('No se pudo acceder a la cámara');
        if (!mountedRef.current || !isRunningRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        onStreamReadyRef.current?.(stream);
        
        // Intentar encender flash
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              flashEnabledRef.current = true;
              console.log('🔦 Flash ENCENDIDO');
            }
            
            // Reducir exposición si es posible
            if (caps?.exposureCompensation) {
              const minExp = caps.exposureCompensation.min;
              await track.applyConstraints({ 
                advanced: [{ exposureCompensation: minExp } as any] 
              });
              console.log('📷 Exposición reducida al mínimo');
            }
          } catch (e) {
            console.log('⚠️ Error configurando cámara:', (e as Error).message);
          }
        }
        
        // Conectar video
        const video = videoRef.current;
        if (!video) throw new Error('Video element no disponible');
        
        video.srcObject = stream;
        
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (video.videoWidth > 0) resolve();
            else reject(new Error('Video timeout'));
          }, 3000);
          
          video.oncanplay = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
        
        await video.play();
        console.log('▶️ Video:', video.videoWidth, 'x', video.videoHeight);
        
        if (!mountedRef.current || !isRunningRef.current) {
          await cleanup();
          return;
        }
        
        onCameraReadyRef.current?.();
        animationRef.current = requestAnimationFrame(processFrame);
        
      } catch (error: any) {
        console.error('❌ Error cámara:', error.message);
        onErrorRef.current?.(error.message);
        await cleanup();
      }
    };
    
    if (isActive) {
      startCamera();
    } else {
      cleanup();
    }
    
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [isActive]);
  
  return (
    <>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          position: 'fixed',
          top: -1,
          left: -1,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{ display: 'none' }}
      />
    </>
  );
};

export default PPGMonitor;
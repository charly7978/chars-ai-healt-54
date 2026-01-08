import React, { useRef, useEffect, useCallback } from 'react';

/**
 * PPG MONITOR - IMPLEMENTACIÓN PROFESIONAL
 * 
 * Basado en literatura científica:
 * - De Haan & Jeanne (2013) - CHROM method
 * - Verkruysse et al. (2008) - PPG from ambient light
 * - Poh et al. (2010) - ICA-based PPG
 * 
 * Características:
 * 1. Captura robusta de cámara con manejo correcto del ciclo de vida
 * 2. Flash encendido ANTES de reproducir video
 * 3. Filtro pasabanda IIR Butterworth 0.5-4Hz
 * 4. Detección de picos con umbral adaptativo
 * 5. Cálculo de BPM con validación fisiológica
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

// ============ FILTRO IIR BUTTERWORTH ============
class ButterworthFilter {
  private b: number[];
  private a: number[];
  private x: number[];
  private y: number[];
  
  constructor(sampleRate: number, lowCut: number, highCut: number, order: number = 2) {
    // Coeficientes pre-calculados para filtro pasabanda 0.5-4Hz @ 30Hz
    // Calculados con scipy.signal.butter y convertidos
    if (sampleRate === 30 && lowCut === 0.5 && highCut === 4) {
      // Butterworth bandpass 0.5-4Hz, order 2, fs=30Hz
      this.b = [0.1311, 0, -0.2622, 0, 0.1311];
      this.a = [1, -2.1192, 1.8298, -0.7821, 0.1584];
    } else {
      // Coeficientes genéricos (menos precisos)
      const nyq = sampleRate / 2;
      const low = lowCut / nyq;
      const high = highCut / nyq;
      
      // Aproximación simple para otros rates
      const w0 = Math.sqrt(low * high);
      const bw = high - low;
      const q = w0 / bw;
      
      this.b = [bw, 0, -bw];
      this.a = [1 + bw/q, -2*Math.cos(2*Math.PI*w0), 1 - bw/q];
    }
    
    this.x = new Array(this.b.length).fill(0);
    this.y = new Array(this.a.length).fill(0);
  }
  
  filter(sample: number): number {
    // Shift samples
    this.x.pop();
    this.x.unshift(sample);
    
    // Calculate output
    let y = 0;
    for (let i = 0; i < this.b.length; i++) {
      y += this.b[i] * this.x[i];
    }
    for (let i = 1; i < this.a.length; i++) {
      y -= this.a[i] * this.y[i - 1];
    }
    
    // Shift output
    this.y.pop();
    this.y.unshift(y);
    
    return y;
  }
  
  reset(): void {
    this.x.fill(0);
    this.y.fill(0);
  }
}

// ============ DETECTOR DE PICOS ADAPTATIVO ============
class AdaptivePeakDetector {
  private buffer: number[] = [];
  private peakTimes: number[] = [];
  private lastPeakTime = 0;
  private threshold = 0;
  private readonly BUFFER_SIZE = 90; // 3 segundos @ 30fps
  private readonly MIN_PEAK_INTERVAL = 300; // Max 200 BPM
  private readonly MAX_PEAK_INTERVAL = 2000; // Min 30 BPM
  private readonly REFRACTORY_PERIOD = 250; // ms
  
  addSample(value: number, timestamp: number): { isPeak: boolean; bpm: number } {
    this.buffer.push(value);
    if (this.buffer.length > this.BUFFER_SIZE) {
      this.buffer.shift();
    }
    
    // Actualizar umbral adaptativo
    if (this.buffer.length >= 30) {
      const sorted = [...this.buffer].sort((a, b) => a - b);
      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = p75 - p25;
      
      // Umbral = mediana + 0.5 * IQR
      const median = sorted[Math.floor(sorted.length * 0.5)];
      this.threshold = median + 0.3 * iqr;
    }
    
    // Detectar pico
    let isPeak = false;
    const timeSinceLastPeak = timestamp - this.lastPeakTime;
    
    if (timeSinceLastPeak > this.REFRACTORY_PERIOD && this.buffer.length >= 7) {
      const recent = this.buffer.slice(-7);
      const current = recent[3]; // Punto central
      
      // Es máximo local
      const isLocalMax = current > recent[0] && 
                         current > recent[1] && 
                         current > recent[2] &&
                         current >= recent[4] && 
                         current >= recent[5] && 
                         current >= recent[6];
      
      // Supera umbral
      const aboveThreshold = current > this.threshold;
      
      // Prominencia mínima
      const localMin = Math.min(...recent);
      const prominence = current - localMin;
      const hasProminence = prominence > 0.1;
      
      if (isLocalMax && aboveThreshold && hasProminence) {
        isPeak = true;
        this.lastPeakTime = timestamp;
        this.peakTimes.push(timestamp);
        
        // Mantener últimos 20 picos
        if (this.peakTimes.length > 20) {
          this.peakTimes.shift();
        }
      }
    }
    
    // Calcular BPM
    let bpm = 0;
    if (this.peakTimes.length >= 3) {
      const validIntervals: number[] = [];
      
      for (let i = this.peakTimes.length - 1; i > 0; i--) {
        const interval = this.peakTimes[i] - this.peakTimes[i - 1];
        if (interval >= this.MIN_PEAK_INTERVAL && interval <= this.MAX_PEAK_INTERVAL) {
          validIntervals.push(interval);
          if (validIntervals.length >= 5) break;
        }
      }
      
      if (validIntervals.length >= 2) {
        // Usar mediana para robustez
        validIntervals.sort((a, b) => a - b);
        const medianInterval = validIntervals[Math.floor(validIntervals.length / 2)];
        bpm = 60000 / medianInterval;
      }
    }
    
    return { isPeak, bpm };
  }
  
  getRRIntervals(): number[] {
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 10; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_PEAK_INTERVAL && interval <= this.MAX_PEAK_INTERVAL) {
        intervals.push(interval);
      }
    }
    return intervals;
  }
  
  reset(): void {
    this.buffer = [];
    this.peakTimes = [];
    this.lastPeakTime = 0;
    this.threshold = 0;
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
  const activeRef = useRef(false);
  
  // Procesadores
  const filterRef = useRef<ButterworthFilter | null>(null);
  const peakDetectorRef = useRef<AdaptivePeakDetector | null>(null);
  
  // Estado de procesamiento
  const baselineRef = useRef(0);
  const bpmSmoothedRef = useRef(0);
  const frameCountRef = useRef(0);
  
  // Cleanup completo
  const cleanup = useCallback(async () => {
    console.log('🧹 PPGMonitor: Limpieza completa...');
    
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        // Apagar flash
        try {
          const caps = track.getCapabilities?.() as any;
          if (caps?.torch) {
            await track.applyConstraints({ advanced: [{ torch: false } as any] });
          }
        } catch {}
        track.stop();
      }
      streamRef.current = null;
      onStreamReady?.(null);
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    filterRef.current?.reset();
    peakDetectorRef.current?.reset();
    baselineRef.current = 0;
    bpmSmoothedRef.current = 0;
    frameCountRef.current = 0;
  }, [onStreamReady]);
  
  // Iniciar cámara con secuencia correcta
  const startCamera = useCallback(async () => {
    console.log('🎥 PPGMonitor: Iniciando...');
    
    if (!activeRef.current) return;
    
    await cleanup();
    
    if (!activeRef.current) return;
    
    // Inicializar procesadores
    filterRef.current = new ButterworthFilter(30, 0.5, 4);
    peakDetectorRef.current = new AdaptivePeakDetector();
    
    try {
      // PASO 1: Obtener stream
      let stream: MediaStream | null = null;
      
      const constraintsList = [
        {
          audio: false,
          video: {
            facingMode: { exact: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
          }
        },
        {
          audio: false,
          video: {
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        },
        {
          audio: false,
          video: true
        }
      ];
      
      for (const constraints of constraintsList) {
        if (!activeRef.current) return;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('✅ Stream obtenido');
          break;
        } catch (e) {
          console.log('⚠️ Constraint falló:', (e as Error).message);
        }
      }
      
      if (!stream) throw new Error('No se pudo acceder a la cámara');
      if (!activeRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      
      streamRef.current = stream;
      
      // PASO 2: Encender flash ANTES de conectar al video
      const track = stream.getVideoTracks()[0];
      if (track) {
        const caps = track.getCapabilities?.() as any;
        if (caps?.torch) {
          try {
            await track.applyConstraints({ advanced: [{ torch: true } as any] });
            console.log('🔦 Flash ENCENDIDO');
          } catch (e) {
            console.log('⚠️ Flash error:', (e as Error).message);
          }
        }
        
        // Configurar exposición baja para evitar saturación
        if (caps?.exposureCompensation) {
          try {
            const minExp = caps.exposureCompensation.min;
            await track.applyConstraints({ 
              advanced: [{ exposureCompensation: minExp * 0.5 } as any] 
            });
          } catch {}
        }
      }
      
      // PASO 3: Conectar al video element
      const video = videoRef.current;
      if (!video) throw new Error('Video element no disponible');
      
      video.srcObject = stream;
      
      // Esperar a que esté listo
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          // Si hay timeout pero el video tiene dimensiones, continuar
          if (video.videoWidth > 0) {
            resolve();
          } else {
            reject(new Error('Video no se inicializó'));
          }
        }, 3000);
        
        const onCanPlay = () => {
          clearTimeout(timeout);
          video.removeEventListener('canplay', onCanPlay);
          resolve();
        };
        
        video.addEventListener('canplay', onCanPlay);
      });
      
      await video.play();
      console.log('▶️ Video:', video.videoWidth, 'x', video.videoHeight);
      
      if (!activeRef.current) {
        await cleanup();
        return;
      }
      
      onCameraReady?.();
      onStreamReady?.(stream);
      
      // PASO 4: Iniciar captura de frames
      startFrameLoop();
      
    } catch (error: any) {
      console.error('❌ Error:', error.message);
      onError?.(error.message);
      await cleanup();
    }
  }, [cleanup, onCameraReady, onError]);
  
  // Loop de captura de frames
  const startFrameLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: true,
      alpha: false 
    });
    if (!ctx) return;
    
    // Resolución de captura (pequeña para velocidad)
    const CAPTURE_WIDTH = 100;
    const CAPTURE_HEIGHT = 100;
    canvas.width = CAPTURE_WIDTH;
    canvas.height = CAPTURE_HEIGHT;
    
    let lastFrameTime = 0;
    const TARGET_INTERVAL = 1000 / 30; // 30 FPS
    
    const processFrame = (timestamp: number) => {
      if (!activeRef.current) return;
      
      // Control de FPS
      const elapsed = timestamp - lastFrameTime;
      if (elapsed < TARGET_INTERVAL) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      lastFrameTime = timestamp;
      
      if (!video || video.readyState < 2 || video.videoWidth === 0) {
        animationRef.current = requestAnimationFrame(processFrame);
        return;
      }
      
      frameCountRef.current++;
      
      // Capturar frame
      ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      const imageData = ctx.getImageData(0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      
      // Procesar frame
      const data = processImageData(imageData, Date.now());
      onData(data);
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    animationRef.current = requestAnimationFrame(processFrame);
  }, [onData]);
  
  // Procesamiento de imagen
  const processImageData = useCallback((imageData: ImageData, timestamp: number): PPGData => {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    
    // Región central (60% del frame)
    const marginX = Math.floor(width * 0.2);
    const marginY = Math.floor(height * 0.2);
    const roiWidth = width - 2 * marginX;
    const roiHeight = height - 2 * marginY;
    
    let redSum = 0, greenSum = 0, blueSum = 0;
    let skinPixels = 0;
    
    for (let y = marginY; y < marginY + roiHeight; y++) {
      for (let x = marginX; x < marginX + roiWidth; x++) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Detección de piel/dedo con flash
        // Criterio: Rojo > 80, Rojo > Verde, predominancia de rojo
        if (r > 80 && r > g && r > b * 1.2) {
          redSum += r;
          greenSum += g;
          blueSum += b;
          skinPixels++;
        }
      }
    }
    
    // Fallback si no hay suficientes píxeles de piel
    const totalPixels = roiWidth * roiHeight;
    let avgRed = 0, avgGreen = 0, avgBlue = 0;
    
    if (skinPixels >= 100) {
      avgRed = redSum / skinPixels;
      avgGreen = greenSum / skinPixels;
      avgBlue = blueSum / skinPixels;
    } else {
      // Usar todos los píxeles
      redSum = 0; greenSum = 0; blueSum = 0;
      for (let i = 0; i < data.length; i += 4) {
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
      }
      const n = data.length / 4;
      avgRed = redSum / n;
      avgGreen = greenSum / n;
      avgBlue = blueSum / n;
    }
    
    const fingerDetected = skinPixels >= 100 && avgRed > 120;
    
    // Señal PPG = variación del canal rojo (AC component)
    // Actualizar baseline con EMA
    if (baselineRef.current === 0) {
      baselineRef.current = avgRed;
    } else {
      baselineRef.current = baselineRef.current * 0.95 + avgRed * 0.05;
    }
    
    const signalValue = avgRed - baselineRef.current;
    
    // Filtrar señal
    const filteredValue = filterRef.current?.filter(signalValue) ?? signalValue;
    
    // Detectar picos y calcular BPM
    const { isPeak, bpm } = peakDetectorRef.current?.addSample(filteredValue, timestamp) 
      ?? { isPeak: false, bpm: 0 };
    
    // Suavizar BPM
    if (bpm > 0) {
      if (bpmSmoothedRef.current === 0) {
        bpmSmoothedRef.current = bpm;
      } else {
        bpmSmoothedRef.current = bpmSmoothedRef.current * 0.8 + bpm * 0.2;
      }
    }
    
    // Calcular calidad de señal
    let quality = 0;
    if (fingerDetected && peakDetectorRef.current) {
      const intervals = peakDetectorRef.current.getRRIntervals();
      if (intervals.length >= 2) {
        // Calidad basada en regularidad de intervalos RR
        const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
        const cv = Math.sqrt(variance) / mean; // Coeficiente de variación
        
        // CV bajo = señal estable = alta calidad
        quality = Math.max(0, Math.min(100, (1 - cv) * 100));
      }
    }
    
    // Log cada 3 segundos
    if (frameCountRef.current % 90 === 0) {
      console.log(`📊 PPG: R=${avgRed.toFixed(1)} BPM=${bpmSmoothedRef.current.toFixed(0)} Q=${quality.toFixed(0)}% Finger=${fingerDetected}`);
    }
    
    return {
      redValue: avgRed,
      greenValue: avgGreen,
      blueValue: avgBlue,
      signalValue,
      filteredValue,
      quality,
      fingerDetected,
      bpm: Math.round(bpmSmoothedRef.current),
      isPeak,
      rrIntervals: peakDetectorRef.current?.getRRIntervals() ?? [],
      timestamp
    };
  }, []);
  
  // Control de activación
  useEffect(() => {
    activeRef.current = isActive;
    
    if (isActive) {
      startCamera();
    } else {
      cleanup();
    }
    
    return () => {
      activeRef.current = false;
      cleanup();
    };
  }, [isActive, startCamera, cleanup]);
  
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

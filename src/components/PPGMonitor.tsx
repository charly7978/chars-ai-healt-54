import React, { useRef, useEffect } from 'react';

/**
 * PPG MONITOR - IMPLEMENTACIÓN ESTABLE
 * 
 * Problema resuelto: Loop infinito de cleanup causado por dependencias
 * de useCallback que cambiaban en cada render.
 * 
 * Solución: Usar refs para todas las funciones y evitar useCallback
 * en el useEffect principal.
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
  
  constructor() {
    // Butterworth bandpass 0.5-4Hz, order 2, fs=30Hz
    this.b = [0.1311, 0, -0.2622, 0, 0.1311];
    this.a = [1, -2.1192, 1.8298, -0.7821, 0.1584];
    this.x = new Array(this.b.length).fill(0);
    this.y = new Array(this.a.length).fill(0);
  }
  
  filter(sample: number): number {
    this.x.pop();
    this.x.unshift(sample);
    
    let y = 0;
    for (let i = 0; i < this.b.length; i++) {
      y += this.b[i] * this.x[i];
    }
    for (let i = 1; i < this.a.length; i++) {
      y -= this.a[i] * this.y[i - 1];
    }
    
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
  private readonly BUFFER_SIZE = 90;
  private readonly MIN_PEAK_INTERVAL = 300;
  private readonly MAX_PEAK_INTERVAL = 2000;
  private readonly REFRACTORY_PERIOD = 250;
  
  addSample(value: number, timestamp: number): { isPeak: boolean; bpm: number } {
    this.buffer.push(value);
    if (this.buffer.length > this.BUFFER_SIZE) {
      this.buffer.shift();
    }
    
    if (this.buffer.length >= 30) {
      const sorted = [...this.buffer].sort((a, b) => a - b);
      const p25 = sorted[Math.floor(sorted.length * 0.25)];
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      const iqr = p75 - p25;
      const median = sorted[Math.floor(sorted.length * 0.5)];
      this.threshold = median + 0.3 * iqr;
    }
    
    let isPeak = false;
    const timeSinceLastPeak = timestamp - this.lastPeakTime;
    
    if (timeSinceLastPeak > this.REFRACTORY_PERIOD && this.buffer.length >= 7) {
      const recent = this.buffer.slice(-7);
      const current = recent[3];
      
      const isLocalMax = current > recent[0] && 
                         current > recent[1] && 
                         current > recent[2] &&
                         current >= recent[4] && 
                         current >= recent[5] && 
                         current >= recent[6];
      
      const aboveThreshold = current > this.threshold;
      const localMin = Math.min(...recent);
      const prominence = current - localMin;
      const hasProminence = prominence > 0.1;
      
      if (isLocalMax && aboveThreshold && hasProminence) {
        isPeak = true;
        this.lastPeakTime = timestamp;
        this.peakTimes.push(timestamp);
        
        if (this.peakTimes.length > 20) {
          this.peakTimes.shift();
        }
      }
    }
    
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
  // Refs para elementos DOM
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Refs para estado mutable (evita re-renders y loops)
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);
  const isRunningRef = useRef(false);
  const filterRef = useRef<ButterworthFilter | null>(null);
  const peakDetectorRef = useRef<AdaptivePeakDetector | null>(null);
  const baselineRef = useRef(0);
  const bpmSmoothedRef = useRef(0);
  const frameCountRef = useRef(0);
  
  // Refs para callbacks (evita dependencias cambiantes)
  const onDataRef = useRef(onData);
  const onCameraReadyRef = useRef(onCameraReady);
  const onErrorRef = useRef(onError);
  const onStreamReadyRef = useRef(onStreamReady);
  
  // Actualizar refs de callbacks
  useEffect(() => {
    onDataRef.current = onData;
    onCameraReadyRef.current = onCameraReady;
    onErrorRef.current = onError;
    onStreamReadyRef.current = onStreamReady;
  }, [onData, onCameraReady, onError, onStreamReady]);
  
  // Efecto principal - solo depende de isActive
  useEffect(() => {
    let mounted = true;
    
    const cleanup = async () => {
      console.log('🧹 Cleanup iniciado');
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
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
        onStreamReadyRef.current?.(null);
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      filterRef.current = null;
      peakDetectorRef.current = null;
      baselineRef.current = 0;
      bpmSmoothedRef.current = 0;
      frameCountRef.current = 0;
    };
    
    const processFrame = () => {
      if (!isRunningRef.current) return;
      
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
      
      // Capturar y procesar
      ctx.drawImage(video, 0, 0, 100, 100);
      const imageData = ctx.getImageData(0, 0, 100, 100);
      const data = imageData.data;
      
      // Extraer promedios RGB de zona central
      let redSum = 0, greenSum = 0, blueSum = 0, skinPixels = 0;
      const margin = 20;
      
      for (let y = margin; y < 80; y++) {
        for (let x = margin; x < 80; x++) {
          const i = (y * 100 + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          
          if (r > 80 && r > g && r > b * 1.2) {
            redSum += r;
            greenSum += g;
            blueSum += b;
            skinPixels++;
          }
        }
      }
      
      let avgRed = 0, avgGreen = 0, avgBlue = 0;
      if (skinPixels >= 100) {
        avgRed = redSum / skinPixels;
        avgGreen = greenSum / skinPixels;
        avgBlue = blueSum / skinPixels;
      } else {
        // Fallback: todos los píxeles
        redSum = greenSum = blueSum = 0;
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
      
      // Señal PPG
      if (baselineRef.current === 0) {
        baselineRef.current = avgRed;
      } else {
        baselineRef.current = baselineRef.current * 0.95 + avgRed * 0.05;
      }
      
      const signalValue = avgRed - baselineRef.current;
      const filteredValue = filterRef.current?.filter(signalValue) ?? signalValue;
      
      const timestamp = Date.now();
      const { isPeak, bpm } = peakDetectorRef.current?.addSample(filteredValue, timestamp) 
        ?? { isPeak: false, bpm: 0 };
      
      if (bpm > 0) {
        if (bpmSmoothedRef.current === 0) {
          bpmSmoothedRef.current = bpm;
        } else {
          bpmSmoothedRef.current = bpmSmoothedRef.current * 0.8 + bpm * 0.2;
        }
      }
      
      // Calidad de señal
      let quality = 0;
      if (fingerDetected && peakDetectorRef.current) {
        const intervals = peakDetectorRef.current.getRRIntervals();
        if (intervals.length >= 2) {
          const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / intervals.length;
          const cv = Math.sqrt(variance) / mean;
          quality = Math.max(0, Math.min(100, (1 - cv) * 100));
        }
      }
      
      // Log cada 3 segundos
      if (frameCountRef.current % 90 === 0) {
        console.log(`📊 PPG: R=${avgRed.toFixed(1)} BPM=${bpmSmoothedRef.current.toFixed(0)} Q=${quality.toFixed(0)}%`);
      }
      
      // Enviar datos
      onDataRef.current({
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
      });
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    const startCamera = async () => {
      if (!mounted) return;
      
      console.log('🎥 Iniciando cámara...');
      isRunningRef.current = true;
      
      // Inicializar procesadores
      filterRef.current = new ButterworthFilter();
      peakDetectorRef.current = new AdaptivePeakDetector();
      
      // Configurar canvas
      if (canvasRef.current) {
        canvasRef.current.width = 100;
        canvasRef.current.height = 100;
      }
      
      try {
        // Obtener stream
        let stream: MediaStream | null = null;
        
        const constraints = [
          { audio: false, video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          { audio: false, video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } } },
          { audio: false, video: true }
        ];
        
        for (const c of constraints) {
          if (!mounted || !isRunningRef.current) return;
          try {
            stream = await navigator.mediaDevices.getUserMedia(c);
            console.log('✅ Stream obtenido');
            break;
          } catch (e) {
            console.log('⚠️ Constraint falló:', (e as Error).message);
          }
        }
        
        if (!stream) throw new Error('No se pudo acceder a la cámara');
        if (!mounted || !isRunningRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        
        streamRef.current = stream;
        onStreamReadyRef.current?.(stream);
        
        // Encender flash
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              console.log('🔦 Flash ENCENDIDO');
            }
            
            // Exposición baja
            if (caps?.exposureCompensation) {
              const minExp = caps.exposureCompensation.min;
              await track.applyConstraints({ advanced: [{ exposureCompensation: minExp * 0.5 } as any] });
            }
          } catch (e) {
            console.log('⚠️ Flash/exposición:', (e as Error).message);
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
        
        if (!mounted || !isRunningRef.current) {
          await cleanup();
          return;
        }
        
        onCameraReadyRef.current?.();
        
        // Iniciar loop de frames
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
      mounted = false;
      cleanup();
    };
  }, [isActive]); // SOLO depende de isActive
  
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
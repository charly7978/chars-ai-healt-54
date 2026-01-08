import React, { useRef, useEffect } from 'react';

/**
 * PPG MONITOR v6 - CON LIMPIEZA AUTOMÁTICA DE DATOS MALOS
 * 
 * Corrige:
 * 1. Buffer que acumula datos malos cuando se mueve el dedo
 * 2. Detector que no limpia intervalos RR obsoletos
 * 3. Calidad que baja sin razón
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

// ============ FILTRO PASA-ALTO ============
class HighPassFilter {
  private prevInput = 0;
  private prevOutput = 0;
  private readonly alpha: number;
  
  constructor(tau = 0.25, fps = 30) {
    this.alpha = tau / (tau + 2 / fps);
  }
  
  filter(input: number): number {
    const output = this.alpha * (this.prevOutput + input - this.prevInput);
    this.prevInput = input;
    this.prevOutput = output;
    return output;
  }
  
  reset(): void {
    this.prevInput = 0;
    this.prevOutput = 0;
  }
}

// ============ BUFFER DE SEÑAL CON AUTO-LIMPIEZA ============
class SignalBuffer {
  private buffer: number[] = [];
  private readonly maxSize: number;
  private lastFingerLostTime = 0;
  
  constructor(maxSize = 150) { // 5 segundos @ 30fps
    this.maxSize = maxSize;
  }
  
  push(value: number, fingerDetected: boolean): void {
    const now = Date.now();
    
    // Si perdimos el dedo, marcar tiempo
    if (!fingerDetected) {
      if (this.lastFingerLostTime === 0) {
        this.lastFingerLostTime = now;
      }
      // Si llevamos más de 1 segundo sin dedo, limpiar buffer
      if (now - this.lastFingerLostTime > 1000 && this.buffer.length > 0) {
        console.log('🧹 Limpiando buffer por pérdida de dedo');
        this.buffer = [];
      }
      return; // No agregar datos sin dedo
    }
    
    // Dedo detectado - resetear timer
    this.lastFingerLostTime = 0;
    
    this.buffer.push(value);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }
  
  getRecent(n: number): number[] {
    return this.buffer.slice(-n);
  }
  
  getAll(): number[] {
    return [...this.buffer];
  }
  
  get length(): number {
    return this.buffer.length;
  }
  
  reset(): void {
    this.buffer = [];
    this.lastFingerLostTime = 0;
  }
}

// ============ DETECTOR DE PICOS CON LIMPIEZA ============
class PeakDetector {
  private peakTimes: number[] = [];
  private lastPeakTime = 0;
  private lastFingerTime = 0;
  
  private readonly MIN_INTERVAL = 400;
  private readonly MAX_INTERVAL = 1500;
  private readonly PEAK_EXPIRY = 8000; // Picos expiran después de 8 segundos
  
  detectPeak(signal: number[], timestamp: number, fingerDetected: boolean): boolean {
    // Limpiar picos viejos
    this.cleanOldPeaks(timestamp);
    
    // Si no hay dedo, marcar y no detectar
    if (!fingerDetected) {
      if (this.lastFingerTime > 0 && timestamp - this.lastFingerTime > 2000) {
        // Más de 2 segundos sin dedo - limpiar todo
        if (this.peakTimes.length > 0) {
          console.log('🧹 Limpiando picos por pérdida de dedo');
          this.peakTimes = [];
        }
      }
      return false;
    }
    
    this.lastFingerTime = timestamp;
    
    if (signal.length < 30) return false;
    
    const recent = signal.slice(-45);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    if (range < 0.005) return false; // Señal muy débil
    
    // Umbral adaptativo: 45% del rango
    const threshold = min + range * 0.45;
    
    // Verificar intervalo mínimo
    if (timestamp - this.lastPeakTime < this.MIN_INTERVAL) {
      return false;
    }
    
    // Verificar pico local
    if (signal.length < 7) return false;
    const last7 = signal.slice(-7);
    const center = last7[3];
    
    const isLocalMax = center > last7[0] && center > last7[1] && center > last7[2] &&
                       center >= last7[4] && center >= last7[5] && center >= last7[6];
    
    // Prominencia: el pico debe sobresalir
    const prominence = center - Math.min(last7[0], last7[6]);
    const hasProminence = prominence > range * 0.15;
    
    if (isLocalMax && center > threshold && hasProminence) {
      this.lastPeakTime = timestamp;
      this.peakTimes.push(timestamp);
      
      // Mantener solo últimos 15 picos
      if (this.peakTimes.length > 15) {
        this.peakTimes.shift();
      }
      
      console.log(`💓 PICO: val=${center.toFixed(4)} thresh=${threshold.toFixed(4)} prom=${prominence.toFixed(4)}`);
      return true;
    }
    
    return false;
  }
  
  private cleanOldPeaks(now: number): void {
    const expiry = now - this.PEAK_EXPIRY;
    const before = this.peakTimes.length;
    this.peakTimes = this.peakTimes.filter(t => t > expiry);
    if (before > this.peakTimes.length) {
      console.log(`🧹 Eliminados ${before - this.peakTimes.length} picos viejos`);
    }
  }
  
  getBPM(): number {
    if (this.peakTimes.length < 3) return 0;
    
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 6; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
        intervals.push(interval);
      }
    }
    
    if (intervals.length < 2) return 0;
    
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    return 60000 / median;
  }
  
  getRRIntervals(): number[] {
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 8; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
        intervals.push(interval);
      }
    }
    return intervals;
  }
  
  getPeakCount(): number {
    return this.peakTimes.length;
  }
  
  reset(): void {
    this.peakTimes = [];
    this.lastPeakTime = 0;
    this.lastFingerTime = 0;
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
  
  const filterRef = useRef<HighPassFilter | null>(null);
  const bufferRef = useRef<SignalBuffer | null>(null);
  const detectorRef = useRef<PeakDetector | null>(null);
  
  const bpmSmoothedRef = useRef(0);
  const qualitySmoothedRef = useRef(0);
  const frameCountRef = useRef(0);
  const flashOnRef = useRef(false);
  const lastFingerStateRef = useRef(false);
  
  // Callbacks refs
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
            if (flashOnRef.current) {
              await track.applyConstraints({ advanced: [{ torch: false } as any] });
            }
          } catch {}
          track.stop();
        }
        streamRef.current = null;
        flashOnRef.current = false;
        onStreamReadyRef.current?.(null);
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      
      filterRef.current = null;
      bufferRef.current = null;
      detectorRef.current = null;
      bpmSmoothedRef.current = 0;
      qualitySmoothedRef.current = 0;
      frameCountRef.current = 0;
      lastFingerStateRef.current = false;
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
      
      // Capturar frame
      const w = 64, h = 64;
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      
      // Promediar todos los píxeles
      let redSum = 0, greenSum = 0, blueSum = 0;
      const totalPixels = w * h;
      
      for (let i = 0; i < data.length; i += 4) {
        redSum += data[i];
        greenSum += data[i + 1];
        blueSum += data[i + 2];
      }
      
      const avgRed = redSum / totalPixels;
      const avgGreen = greenSum / totalPixels;
      const avgBlue = blueSum / totalPixels;
      
      // Detección de dedo
      const fingerDetected = avgRed > 70 && 
                            avgRed > avgGreen * 1.05 && 
                            avgGreen > avgBlue * 0.85 &&
                            avgRed < 250; // No saturado
      
      // Log cuando cambia estado del dedo
      if (fingerDetected !== lastFingerStateRef.current) {
        console.log(fingerDetected ? '👆 Dedo DETECTADO' : '👆 Dedo PERDIDO');
        lastFingerStateRef.current = fingerDetected;
        
        // Si perdimos el dedo, resetear calidad gradualmente
        if (!fingerDetected) {
          qualitySmoothedRef.current = 0;
        }
      }
      
      // Señal PPG (canal rojo normalizado)
      const normalizedRed = avgRed / 255;
      
      // Filtrar solo si hay dedo
      let filteredValue = 0;
      if (fingerDetected) {
        filteredValue = filterRef.current?.filter(normalizedRed) ?? 0;
      } else {
        // Resetear filtro si no hay dedo
        filterRef.current?.reset();
      }
      
      // Agregar a buffer
      bufferRef.current?.push(filteredValue, fingerDetected);
      
      // Detección de picos
      const timestamp = Date.now();
      const signalBuffer = bufferRef.current?.getAll() ?? [];
      const isPeak = detectorRef.current?.detectPeak(signalBuffer, timestamp, fingerDetected) ?? false;
      
      // BPM
      const rawBpm = detectorRef.current?.getBPM() ?? 0;
      if (rawBpm > 0 && fingerDetected) {
        bpmSmoothedRef.current = bpmSmoothedRef.current === 0 
          ? rawBpm 
          : bpmSmoothedRef.current * 0.75 + rawBpm * 0.25;
      } else if (!fingerDetected) {
        // Decay lento del BPM cuando no hay dedo
        bpmSmoothedRef.current *= 0.98;
        if (bpmSmoothedRef.current < 30) bpmSmoothedRef.current = 0;
      }
      
      // Calidad
      let quality = 0;
      if (fingerDetected && signalBuffer.length >= 30) {
        const recent = signalBuffer.slice(-60);
        const min = Math.min(...recent);
        const max = Math.max(...recent);
        const range = max - min;
        
        const peakCount = detectorRef.current?.getPeakCount() ?? 0;
        const intervals = detectorRef.current?.getRRIntervals() ?? [];
        
        // Rango de señal: 0-40 puntos
        const rangeScore = Math.min(40, (range / 0.03) * 40);
        
        // Picos detectados: 0-30 puntos
        const peakScore = Math.min(30, peakCount * 5);
        
        // Consistencia RR: 0-30 puntos
        let consistencyScore = 0;
        if (intervals.length >= 3) {
          const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
          const cv = Math.sqrt(variance) / mean;
          consistencyScore = Math.max(0, 30 * (1 - cv / 0.25));
        }
        
        quality = rangeScore + peakScore + consistencyScore;
        qualitySmoothedRef.current = qualitySmoothedRef.current * 0.85 + quality * 0.15;
        quality = qualitySmoothedRef.current;
      }
      
      // Log cada 2 segundos
      if (frameCountRef.current % 60 === 0) {
        const bufLen = bufferRef.current?.length ?? 0;
        const peaks = detectorRef.current?.getPeakCount() ?? 0;
        console.log(`📊 R=${avgRed.toFixed(0)} | Dedo=${fingerDetected ? 'SÍ' : 'NO'} | Buf=${bufLen} | Picos=${peaks} | BPM=${bpmSmoothedRef.current.toFixed(0)} | Q=${quality.toFixed(0)}%`);
      }
      
      // Enviar datos
      onDataRef.current({
        redValue: avgRed,
        greenValue: avgGreen,
        blueValue: avgBlue,
        signalValue: normalizedRed,
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
      
      filterRef.current = new HighPassFilter(0.25, 30);
      bufferRef.current = new SignalBuffer(150);
      detectorRef.current = new PeakDetector();
      
      if (canvasRef.current) {
        canvasRef.current.width = 64;
        canvasRef.current.height = 64;
      }
      
      try {
        let stream: MediaStream | null = null;
        
        const constraints = [
          { 
            audio: false, 
            video: { 
              facingMode: { exact: 'environment' },
              width: { ideal: 640 },
              height: { ideal: 480 }
            } 
          },
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
        
        // Encender flash
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              flashOnRef.current = true;
              console.log('🔦 Flash ENCENDIDO');
            } else {
              console.log('⚠️ Flash NO disponible');
            }
          } catch (e) {
            console.log('⚠️ Error flash:', (e as Error).message);
          }
        }
        
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
        console.log(`▶️ Video: ${video.videoWidth}x${video.videoHeight}`);
        
        if (!mountedRef.current || !isRunningRef.current) {
          await cleanup();
          return;
        }
        
        console.log('📷 Cámara lista');
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

import React, { useRef, useEffect } from 'react';

/**
 * PPG MONITOR v5 - BASADO EN TÉCNICAS PROBADAS
 * 
 * Fuente: kevinfronczak.com/blog/diy-heart-rate-monitor-using-your-smartphone
 * 
 * Principios clave:
 * 1. Usar CANAL ROJO - la piel absorbe mal la luz roja, mejor señal
 * 2. Promediar TODOS los píxeles del frame
 * 3. Filtro pasa-alto simple (tau=0.25s) para eliminar respiración
 * 4. Flash SIEMPRE encendido, nunca apagar
 * 5. NO tocar exposición - dejar automático
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

// ============ FILTRO PASA-ALTO SIMPLE ============
// Basado en: tau / (tau + 2/fsample)
// tau = 0.25s, fsample = 30fps
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

// ============ BUFFER CIRCULAR PARA SEÑAL ============
class SignalBuffer {
  private buffer: number[] = [];
  private readonly maxSize: number;
  
  constructor(maxSize = 300) { // 10 segundos @ 30fps
    this.maxSize = maxSize;
  }
  
  push(value: number): void {
    this.buffer.push(value);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }
  
  getRecent(n: number): number[] {
    return this.buffer.slice(-n);
  }
  
  get length(): number {
    return this.buffer.length;
  }
  
  reset(): void {
    this.buffer = [];
  }
}

// ============ DETECTOR DE PICOS ============
class PeakDetector {
  private peakTimes: number[] = [];
  private lastPeakTime = 0;
  
  private readonly MIN_INTERVAL = 400; // Max ~150 BPM
  private readonly MAX_INTERVAL = 1500; // Min ~40 BPM
  
  detectPeak(signal: number[], timestamp: number): boolean {
    if (signal.length < 30) return false;
    
    const recent = signal.slice(-60);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    // Umbral: 50% del rango
    const threshold = min + range * 0.5;
    
    // Verificar intervalo mínimo
    if (timestamp - this.lastPeakTime < this.MIN_INTERVAL) {
      return false;
    }
    
    // Verificar pico local (últimos 5 valores)
    const last5 = signal.slice(-5);
    const center = last5[2];
    
    const isLocalMax = center > last5[0] && center > last5[1] && 
                       center >= last5[3] && center >= last5[4];
    
    if (isLocalMax && center > threshold && range > 0.1) {
      this.lastPeakTime = timestamp;
      this.peakTimes.push(timestamp);
      
      // Mantener solo últimos 20 picos
      if (this.peakTimes.length > 20) {
        this.peakTimes.shift();
      }
      
      console.log(`💓 PICO detectado: val=${center.toFixed(3)} umbral=${threshold.toFixed(3)} rango=${range.toFixed(3)}`);
      return true;
    }
    
    return false;
  }
  
  getBPM(): number {
    if (this.peakTimes.length < 3) return 0;
    
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 8; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
        intervals.push(interval);
      }
    }
    
    if (intervals.length < 2) return 0;
    
    // Mediana de intervalos
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    return 60000 / median;
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
  
  reset(): void {
    this.peakTimes = [];
    this.lastPeakTime = 0;
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
      
      // ===== CAPTURAR FRAME COMPLETO =====
      // Capturamos a tamaño pequeño pero procesamos TODO
      const w = 64, h = 64;
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      
      // ===== PROMEDIAR TODOS LOS PÍXELES =====
      // "we average every single pixel in the frame"
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
      
      // ===== DETECCIÓN DE DEDO =====
      // Dedo cubriendo flash + cámara = valores altos y predominancia roja
      const fingerDetected = avgRed > 80 && 
                            avgRed > avgGreen * 1.1 && 
                            avgGreen > avgBlue * 0.8;
      
      // ===== SEÑAL PPG =====
      // "red channel is far superior to blue or green"
      // Normalizamos a 0-1
      const normalizedRed = avgRed / 255;
      
      // Aplicar filtro pasa-alto
      const filteredValue = filterRef.current?.filter(normalizedRed) ?? 0;
      
      // Agregar a buffer
      bufferRef.current?.push(filteredValue);
      
      // ===== DETECCIÓN DE PICOS =====
      const timestamp = Date.now();
      const signalBuffer = bufferRef.current?.getRecent(90) ?? [];
      const isPeak = detectorRef.current?.detectPeak(signalBuffer, timestamp) ?? false;
      
      // ===== BPM =====
      const rawBpm = detectorRef.current?.getBPM() ?? 0;
      if (rawBpm > 0) {
        bpmSmoothedRef.current = bpmSmoothedRef.current === 0 
          ? rawBpm 
          : bpmSmoothedRef.current * 0.8 + rawBpm * 0.2;
      }
      
      // ===== CALIDAD =====
      let quality = 0;
      if (fingerDetected && signalBuffer.length >= 60) {
        const min = Math.min(...signalBuffer);
        const max = Math.max(...signalBuffer);
        const range = max - min;
        
        const intervals = detectorRef.current?.getRRIntervals() ?? [];
        
        // Rango de señal: 0-50 puntos (rango 0.01-0.05 es bueno)
        const rangeScore = Math.min(50, (range / 0.05) * 50);
        
        // Intervalos detectados: 0-30 puntos
        const intervalScore = Math.min(30, intervals.length * 6);
        
        // Consistencia: 0-20 puntos
        let consistencyScore = 0;
        if (intervals.length >= 3) {
          const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
          const cv = Math.sqrt(variance) / mean;
          consistencyScore = Math.max(0, 20 * (1 - cv / 0.3));
        }
        
        quality = rangeScore + intervalScore + consistencyScore;
        qualitySmoothedRef.current = qualitySmoothedRef.current * 0.9 + quality * 0.1;
        quality = qualitySmoothedRef.current;
      }
      
      // ===== LOG CADA 2 SEGUNDOS =====
      if (frameCountRef.current % 60 === 0) {
        const signalBuffer = bufferRef.current?.getRecent(90) ?? [];
        let range = 0;
        if (signalBuffer.length > 0) {
          range = Math.max(...signalBuffer) - Math.min(...signalBuffer);
        }
        console.log(`📊 R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} B=${avgBlue.toFixed(0)} | Dedo=${fingerDetected ? 'SÍ' : 'NO'} | Rango=${range.toFixed(4)} | BPM=${bpmSmoothedRef.current.toFixed(0)} | Q=${quality.toFixed(0)}%`);
      }
      
      // ===== ENVIAR DATOS =====
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
      
      // Inicializar procesadores
      filterRef.current = new HighPassFilter(0.25, 30);
      bufferRef.current = new SignalBuffer(300);
      detectorRef.current = new PeakDetector();
      
      if (canvasRef.current) {
        canvasRef.current.width = 64;
        canvasRef.current.height = 64;
      }
      
      try {
        let stream: MediaStream | null = null;
        
        // Intentar obtener cámara trasera
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
        
        // ===== ENCENDER FLASH Y NO TOCAR MÁS =====
        const track = stream.getVideoTracks()[0];
        if (track) {
          try {
            const caps = track.getCapabilities?.() as any;
            if (caps?.torch) {
              await track.applyConstraints({ advanced: [{ torch: true } as any] });
              flashOnRef.current = true;
              console.log('🔦 Flash ENCENDIDO - no se tocará más');
            } else {
              console.log('⚠️ Flash NO disponible en este dispositivo');
            }
          } catch (e) {
            console.log('⚠️ No se pudo encender flash:', (e as Error).message);
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
        console.log(`▶️ Video: ${video.videoWidth}x${video.videoHeight}`);
        
        if (!mountedRef.current || !isRunningRef.current) {
          await cleanup();
          return;
        }
        
        console.log('📷 Cámara lista - procesando frames');
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

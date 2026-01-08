import React, { useRef, useEffect } from 'react';

/**
 * PPG MONITOR v7 - SEÑAL CRUDA SIN DETECCIÓN DE DEDO
 * 
 * Cambios principales:
 * 1. ELIMINADA detección de dedo - la señal fluye siempre
 * 2. Filtro pasa-banda IIR (0.5-4 Hz) para aislar latidos
 * 3. Buffer circular simple sin limpieza automática
 * 4. Detector de picos simplificado y robusto
 * 5. Calidad basada SOLO en rango de señal y consistencia
 */

interface PPGData {
  redValue: number;
  greenValue: number;
  blueValue: number;
  signalValue: number;
  filteredValue: number;
  quality: number;
  fingerDetected: boolean; // Solo informativo, NO bloquea nada
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

// ============ FILTRO PASA-BANDA BUTTERWORTH 2DO ORDEN ============
// Diseñado para 0.5-4 Hz @ 30 fps (frecuencia cardíaca 30-240 BPM)
class BandpassFilter {
  // Coeficientes pre-calculados para Butterworth 2do orden
  // Pasa-alto 0.5 Hz
  private hp_b = [0.9565, -1.913, 0.9565];
  private hp_a = [1, -1.911, 0.915];
  private hp_x: number[] = [0, 0, 0];
  private hp_y: number[] = [0, 0, 0];
  
  // Pasa-bajo 4 Hz
  private lp_b = [0.0675, 0.135, 0.0675];
  private lp_a = [1, -1.143, 0.413];
  private lp_x: number[] = [0, 0, 0];
  private lp_y: number[] = [0, 0, 0];
  
  filter(input: number): number {
    // Pasa-alto primero (elimina baseline drift)
    this.hp_x.unshift(input);
    this.hp_x.pop();
    
    const hp_out = 
      this.hp_b[0] * this.hp_x[0] + 
      this.hp_b[1] * this.hp_x[1] + 
      this.hp_b[2] * this.hp_x[2] -
      this.hp_a[1] * this.hp_y[0] - 
      this.hp_a[2] * this.hp_y[1];
    
    this.hp_y.unshift(hp_out);
    this.hp_y.pop();
    
    // Pasa-bajo después (elimina ruido de alta frecuencia)
    this.lp_x.unshift(hp_out);
    this.lp_x.pop();
    
    const lp_out = 
      this.lp_b[0] * this.lp_x[0] + 
      this.lp_b[1] * this.lp_x[1] + 
      this.lp_b[2] * this.lp_x[2] -
      this.lp_a[1] * this.lp_y[0] - 
      this.lp_a[2] * this.lp_y[1];
    
    this.lp_y.unshift(lp_out);
    this.lp_y.pop();
    
    return lp_out;
  }
  
  reset(): void {
    this.hp_x = [0, 0, 0];
    this.hp_y = [0, 0, 0];
    this.lp_x = [0, 0, 0];
    this.lp_y = [0, 0, 0];
  }
}

// ============ BUFFER CIRCULAR SIMPLE ============
class CircularBuffer {
  private buffer: number[];
  private index = 0;
  private count = 0;
  
  constructor(private readonly size: number) {
    this.buffer = new Array(size).fill(0);
  }
  
  push(value: number): void {
    this.buffer[this.index] = value;
    this.index = (this.index + 1) % this.size;
    if (this.count < this.size) this.count++;
  }
  
  getAll(): number[] {
    if (this.count < this.size) {
      return this.buffer.slice(0, this.count);
    }
    // Devolver en orden cronológico
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }
  
  getRecent(n: number): number[] {
    const all = this.getAll();
    return all.slice(-Math.min(n, all.length));
  }
  
  get length(): number {
    return this.count;
  }
  
  reset(): void {
    this.buffer.fill(0);
    this.index = 0;
    this.count = 0;
  }
}

// ============ DETECTOR DE PICOS ROBUSTO ============
class PeakDetector {
  private peakTimes: number[] = [];
  private lastPeakTime = 0;
  
  private readonly MIN_INTERVAL = 375;  // 160 BPM máximo
  private readonly MAX_INTERVAL = 1500; // 40 BPM mínimo
  private readonly MAX_PEAKS = 20;
  
  detectPeak(signal: number[], timestamp: number): boolean {
    if (signal.length < 15) return false;
    
    // Verificar intervalo mínimo desde último pico
    if (timestamp - this.lastPeakTime < this.MIN_INTERVAL) {
      return false;
    }
    
    const recent = signal.slice(-30);
    const min = Math.min(...recent);
    const max = Math.max(...recent);
    const range = max - min;
    
    // Señal muy débil - no detectar
    if (range < 0.003) return false;
    
    // Umbral adaptativo al 40% del rango
    const threshold = min + range * 0.40;
    
    // Verificar pico local en los últimos 5 samples
    const last5 = signal.slice(-5);
    const center = last5[2];
    
    // El centro debe ser máximo local
    const isLocalMax = center > last5[0] && 
                       center > last5[1] && 
                       center >= last5[3] && 
                       center >= last5[4];
    
    // El pico debe estar sobre el umbral
    const aboveThreshold = center > threshold;
    
    // Prominencia: diferencia con los extremos
    const prominence = center - Math.min(last5[0], last5[4]);
    const hasProminence = prominence > range * 0.12;
    
    if (isLocalMax && aboveThreshold && hasProminence) {
      this.lastPeakTime = timestamp;
      this.peakTimes.push(timestamp);
      
      // Mantener solo últimos N picos
      if (this.peakTimes.length > this.MAX_PEAKS) {
        this.peakTimes.shift();
      }
      
      // Limpiar picos muy viejos (>10 segundos)
      const cutoff = timestamp - 10000;
      this.peakTimes = this.peakTimes.filter(t => t > cutoff);
      
      return true;
    }
    
    return false;
  }
  
  getBPM(): number {
    if (this.peakTimes.length < 3) return 0;
    
    // Calcular intervalos RR válidos
    const intervals: number[] = [];
    for (let i = this.peakTimes.length - 1; i > 0 && intervals.length < 8; i--) {
      const interval = this.peakTimes[i] - this.peakTimes[i - 1];
      if (interval >= this.MIN_INTERVAL && interval <= this.MAX_INTERVAL) {
        intervals.push(interval);
      }
    }
    
    if (intervals.length < 2) return 0;
    
    // Usar mediana para robustez
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    
    return Math.round(60000 / median);
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
  
  getPeakCount(): number {
    return this.peakTimes.length;
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
  
  const filterRef = useRef<BandpassFilter | null>(null);
  const bufferRef = useRef<CircularBuffer | null>(null);
  const detectorRef = useRef<PeakDetector | null>(null);
  
  const bpmRef = useRef(0);
  const frameCountRef = useRef(0);
  const flashOnRef = useRef(false);
  
  // Smoothing refs
  const qualitySmoothedRef = useRef(0);
  const lastRedRef = useRef(0);
  
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
      bpmRef.current = 0;
      frameCountRef.current = 0;
      qualitySmoothedRef.current = 0;
      lastRedRef.current = 0;
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
      const timestamp = Date.now();
      
      // Capturar frame completo a 64x64
      const w = 64, h = 64;
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      
      // Promediar TODOS los píxeles - sin región de interés
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
      
      // Señal PPG: canal rojo normalizado (0-1)
      const rawSignal = avgRed / 255;
      
      // Aplicar filtro pasa-banda SIEMPRE
      const filteredValue = filterRef.current?.filter(rawSignal) ?? 0;
      
      // Agregar al buffer SIEMPRE
      bufferRef.current?.push(filteredValue);
      
      // Detectar picos
      const signalBuffer = bufferRef.current?.getAll() ?? [];
      const isPeak = detectorRef.current?.detectPeak(signalBuffer, timestamp) ?? false;
      
      // Calcular BPM
      const rawBpm = detectorRef.current?.getBPM() ?? 0;
      if (rawBpm > 0) {
        // Suavizado exponencial del BPM
        bpmRef.current = bpmRef.current === 0 
          ? rawBpm 
          : bpmRef.current * 0.7 + rawBpm * 0.3;
      }
      
      // Log de pico detectado
      if (isPeak) {
        console.log(`💓 PICO #${detectorRef.current?.getPeakCount()} | BPM=${Math.round(bpmRef.current)}`);
      }
      
      // ============ CALIDAD DE SEÑAL ============
      // Solo basada en: rango de señal filtrada + consistencia BPM
      let quality = 0;
      
      if (signalBuffer.length >= 30) {
        const recent = signalBuffer.slice(-60);
        const min = Math.min(...recent);
        const max = Math.max(...recent);
        const range = max - min;
        
        // Componente 1: Rango de señal (0-50 puntos)
        // range > 0.02 = señal muy buena
        const rangeScore = Math.min(50, (range / 0.025) * 50);
        
        // Componente 2: Picos detectados (0-30 puntos)
        const peakCount = detectorRef.current?.getPeakCount() ?? 0;
        const peakScore = Math.min(30, peakCount * 4);
        
        // Componente 3: Consistencia de intervalos RR (0-20 puntos)
        const intervals = detectorRef.current?.getRRIntervals() ?? [];
        let consistencyScore = 0;
        if (intervals.length >= 3) {
          const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
          const cv = Math.sqrt(variance) / mean; // Coeficiente de variación
          // CV < 0.1 = muy consistente, CV > 0.3 = muy variable
          consistencyScore = Math.max(0, 20 * (1 - cv / 0.3));
        }
        
        quality = rangeScore + peakScore + consistencyScore;
        
        // Suavizado de calidad
        qualitySmoothedRef.current = qualitySmoothedRef.current * 0.9 + quality * 0.1;
        quality = qualitySmoothedRef.current;
      }
      
      // ============ FINGER DETECTED (solo informativo) ============
      // Rojo alto + rojo > verde = probablemente hay dedo con flash
      const fingerDetected = avgRed > 60 && avgRed > avgGreen * 1.05;
      
      // Log cada 2 segundos
      if (frameCountRef.current % 60 === 0) {
        const bufLen = bufferRef.current?.length ?? 0;
        const peaks = detectorRef.current?.getPeakCount() ?? 0;
        const intervals = detectorRef.current?.getRRIntervals() ?? [];
        console.log(
          `📊 R=${avgRed.toFixed(0)} G=${avgGreen.toFixed(0)} B=${avgBlue.toFixed(0)} | ` +
          `Buf=${bufLen} | Picos=${peaks} | RR=[${intervals.slice(0,3).map(v => v.toFixed(0)).join(',')}] | ` +
          `BPM=${Math.round(bpmRef.current)} | Q=${quality.toFixed(0)}%`
        );
      }
      
      // Enviar datos
      onDataRef.current({
        redValue: avgRed,
        greenValue: avgGreen,
        blueValue: avgBlue,
        signalValue: rawSignal,
        filteredValue,
        quality: Math.round(Math.min(100, quality)),
        fingerDetected, // Solo informativo
        bpm: Math.round(bpmRef.current),
        isPeak,
        rrIntervals: detectorRef.current?.getRRIntervals() ?? [],
        timestamp
      });
      
      animationRef.current = requestAnimationFrame(processFrame);
    };
    
    const startCamera = async () => {
      if (!mountedRef.current) return;
      
      console.log('🎥 Iniciando cámara PPGv7...');
      isRunningRef.current = true;
      
      // Inicializar procesadores
      filterRef.current = new BandpassFilter();
      bufferRef.current = new CircularBuffer(180); // 6 segundos @ 30fps
      detectorRef.current = new PeakDetector();
      
      if (canvasRef.current) {
        canvasRef.current.width = 64;
        canvasRef.current.height = 64;
      }
      
      try {
        let stream: MediaStream | null = null;
        
        // Intentar diferentes configuraciones de cámara
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
        
        // Encender flash - CRÍTICO para PPG con dedo
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
        
        console.log('📷 PPGv7 listo - señal cruda sin filtro de dedo');
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
